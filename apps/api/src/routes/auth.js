const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../lib/db');
const { generateTokens, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AdminLoginSchema, MerchantLoginSchema } = require('../config/schemas');
const redis = require('../lib/redis');
const { generateTotpSecret, generateQrCode, verifyTotp, generateBackupCodes } = require('../lib/totp');
const { notify2FAEnabled, notify2FADisabled } = require('../lib/notifications');

const JWT_SECRET = process.env.JWT_SECRET || 'afrikfid-secret-key';
const REFRESH_TTL = 7 * 24 * 3600; // 7 jours en secondes

// ─── Anti-brute force sur les endpoints de login  ────────────────
// Rate limit IP-level (mémoire) : premier filet de sécurité
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // souple car le lockout Redis par email est le vrai garde-fou
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Trop de tentatives depuis cette adresse IP. Réessayez dans 15 minutes.' },
  skipSuccessfulRequests: true,
});

// Lockout persistant Redis par identifiant (email ou phone)
// 5 échecs => blocage 15 minutes, résistant aux redémarrages serveur
const LOCKOUT_MAX = 5;
const LOCKOUT_TTL = 15 * 60; // 15 minutes en secondes

function lockoutKey(identifier) { return `lockout:${identifier}`; }
function failKey(identifier) { return `login_fails:${identifier}`; }

async function checkLockout(identifier) {
  const locked = await redis.exists(lockoutKey(identifier));
  return !!locked;
}

async function recordFailure(identifier) {
  const key = failKey(identifier);
  const fails = await redis.incr(key);
  if (fails === 1) await redis.expire(key, LOCKOUT_TTL);
  if (fails >= LOCKOUT_MAX) {
    await redis.setEx(lockoutKey(identifier), LOCKOUT_TTL, '1');
    await redis.del(key);
  }
  return fails;
}

async function clearFailures(identifier) {
  await redis.del(failKey(identifier));
  await redis.del(lockoutKey(identifier));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function refreshKey(tokenId) { return `refresh:${tokenId}`; }
function revokedKey(jti) { return `revoked:${jti}`; }

/** Extrait le JTI (JWT ID) depuis un token sans vérification de signature. */
function extractJti(token) {
  try {
    const payload = jwt.decode(token);
    return payload && payload.jti ? payload.jti : null;
  } catch { return null; }
}

// ─── POST /api/v1/auth/admin/login ───────────────────────────────────────────
router.post('/admin/login', loginLimiter, validate(AdminLoginSchema), async (req, res) => {
  const { email, password, totp_code } = req.body;

  if (await checkLockout(email)) {
    return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const result = await db.query('SELECT * FROM admins WHERE email = $1 AND is_active = TRUE', [email]);
  const admin = result.rows[0];
  if (!admin) {
    await recordFailure(email);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) {
    await recordFailure(email);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  // Vérification 2FA si activé
  if (admin.totp_enabled && admin.totp_secret) {
    if (!totp_code) {
      return res.status(200).json({ requires2FA: true, message: 'Code 2FA requis. Veuillez fournir le champ totp_code.' });
    }
    // Vérifier le code TOTP
    const totpValid = verifyTotp(admin.totp_secret, totp_code);
    if (!totpValid) {
      // Vérifier les codes de secours
      const backupCodes = admin.totp_backup_codes ? JSON.parse(admin.totp_backup_codes) : [];
      const backupIdx = backupCodes.indexOf(String(totp_code).toUpperCase());
      if (backupIdx === -1) {
        return res.status(401).json({ error: 'Code 2FA invalide' });
      }
      // Invalider le code de secours utilisé
      backupCodes.splice(backupIdx, 1);
      await db.query('UPDATE admins SET totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(backupCodes), admin.id]);
    }
  }

  await clearFailures(email);
  await db.query('UPDATE admins SET last_login = NOW() WHERE id = $1', [admin.id]);

  const tokens = generateTokens({ sub: admin.id, role: 'admin', email: admin.email });

  // Stocker le refresh token dans Redis pour permettre la révocation
  const refreshJti = extractJti(tokens.refreshToken);
  if (refreshJti) {
    await redis.setEx(refreshKey(refreshJti), REFRESH_TTL, JSON.stringify({ sub: admin.id, role: 'admin' }));
  }

  res.json({
    ...tokens,
    admin: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role, totpEnabled: admin.totp_enabled || false },
  });
});

// ─── POST /api/v1/auth/merchant/login ────────────────────────────────────────
router.post('/merchant/login', loginLimiter, validate(MerchantLoginSchema), async (req, res) => {
  const { email, password, totp_code } = req.body;

  if (await checkLockout(email)) {
    return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const result = await db.query('SELECT * FROM merchants WHERE email = $1 AND is_active = TRUE', [email]);
  let merchant = result.rows[0];

  // Stratégie d'authentification :
  //   1. Si compte local avec password_hash : on tente bcrypt local (cas legacy / admins ayant rotaté).
  //   2. Sinon (ou si bcrypt échoue) : on délègue à business-api (source unique).
  //   3. Si business-api valide et que le merchant local n'existe pas → provisioning au vol.
  let valid = false;
  if (merchant?.password_hash) {
    valid = await bcrypt.compare(password, merchant.password_hash);
  }

  if (!valid) {
    try {
      const afrikfidClient = require('../lib/afrikfid-client');
      const { findOrCreateMerchantFromBapiUser } = require('../lib/merchant-sso-provisioning');
      const verify = await afrikfidClient.verifyPassword(email, password);
      if (verify.ok && verify.user) {
        const { merchant: m } = await findOrCreateMerchantFromBapiUser(verify.user);
        merchant = m;
        valid = true;
      }
    } catch (err) {
      // 5xx / config absente : on log mais on ne bloque pas un login local valide
      console.warn('[auth/merchant/login] business-api delegation failed:', err.message);
    }
  }

  if (!merchant || !valid) {
    await recordFailure(email);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  // Vérification 2FA marchand si activé — authentification forte)
  if (merchant.totp_enabled && merchant.totp_secret) {
    if (!totp_code) {
      return res.status(200).json({ requires2FA: true, message: 'Code 2FA requis. Veuillez fournir le champ totp_code.' });
    }
    const totpValid = verifyTotp(merchant.totp_secret, totp_code);
    if (!totpValid) {
      const backupCodes = merchant.totp_backup_codes ? JSON.parse(merchant.totp_backup_codes) : [];
      const backupIdx = backupCodes.indexOf(String(totp_code).toUpperCase());
      if (backupIdx === -1) {
        await recordFailure(email);
        return res.status(401).json({ error: 'Code 2FA invalide' });
      }
      backupCodes.splice(backupIdx, 1);
      await db.query('UPDATE merchants SET totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(backupCodes), merchant.id]);
    }
  }

  await clearFailures(email);
  const tokens = generateTokens({ sub: merchant.id, role: 'merchant', email: merchant.email });

  // Stocker le refresh token dans Redis
  const refreshJti = extractJti(tokens.refreshToken);
  if (refreshJti) {
    await redis.setEx(refreshKey(refreshJti), REFRESH_TTL, JSON.stringify({ sub: merchant.id, role: 'merchant' }));
  }

  res.json({
    ...tokens,
    merchant: {
      id: merchant.id, name: merchant.name, email: merchant.email,
      status: merchant.status, rebatePercent: merchant.rebate_percent,
      totpEnabled: merchant.totp_enabled || false,
      package: merchant.package || 'STARTER_BOOST',
    },
  });
});

// ─── GET /api/v1/auth/merchant/me ────────────────────────────────────────────
router.get('/merchant/me', require('../middleware/auth').requireMerchant, (req, res) => {
  const m = req.merchant;
  res.json({ merchant: { id: m.id, name: m.name, email: m.email, status: m.status, totpEnabled: m.totp_enabled || false } });
});

// ─── POST /api/v1/auth/refresh ───────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken manquant' });

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Refresh token invalide ou expiré' });
  }

  if (decoded.type !== 'refresh') {
    return res.status(401).json({ error: 'Token de type incorrect' });
  }

  // Vérifier que le refresh token n'a pas été révoqué
  const jti = decoded.jti;
  if (jti) {
    const stored = await redis.get(refreshKey(jti));
    if (!stored) {
      return res.status(401).json({ error: 'Session expirée ou révoquée. Reconnectez-vous.' });
    }
    // Révoquer l'ancien refresh token (rotation)
    await redis.del(refreshKey(jti));
  }

  // Émettre de nouveaux tokens
  const payload = { sub: decoded.sub, role: decoded.role, email: decoded.email };
  const tokens = generateTokens(payload);

  // Stocker le nouveau refresh token
  const newJti = extractJti(tokens.refreshToken);
  if (newJti) {
    await redis.setEx(refreshKey(newJti), REFRESH_TTL, JSON.stringify(payload));
  }

  res.json(tokens);
});

// ─── POST /api/v1/auth/logout ─────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { refreshToken } = req.body || {};

  // Révoquer l'access token courant (TTL de 15min)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const accessToken = authHeader.slice(7);
    try {
      const decoded = jwt.verify(accessToken, JWT_SECRET);
      const ttl = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
      if (decoded.jti && ttl > 0) {
        await redis.setEx(revokedKey(decoded.jti), ttl, '1');
      }
    } catch { /* token déjà expiré, pas besoin de révoquer */ }
  }

  // Révoquer le refresh token
  if (refreshToken) {
    try {
      const decoded = jwt.decode(refreshToken);
      if (decoded && decoded.jti) {
        await redis.del(refreshKey(decoded.jti));
      }
    } catch { /* ignore */ }
  }

  res.json({ message: 'Déconnexion effectuée' });
});

// ─── GET /api/v1/auth/me ──────────────────────────────────────────────────────
router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: { id: req.admin.id, email: req.admin.email, fullName: req.admin.full_name, role: req.admin.role, totpEnabled: req.admin.totp_enabled || false } });
});

// ─── POST /api/v1/auth/2fa/setup — Initier l'enrollment 2FA (admin) ──────────
router.post('/2fa/setup', requireAdmin, async (req, res) => {
  const admin = req.admin;
  if (admin.totp_enabled) return res.status(400).json({ error: '2FA déjà activé sur ce compte' });

  const { secret, otpauth_url } = generateTotpSecret(admin.email);
  const qrCode = await generateQrCode(otpauth_url);

  // Stocker le secret temporairement (non encore activé)
  await db.query('UPDATE admins SET totp_secret = $1 WHERE id = $2', [secret, admin.id]);

  res.json({
    message: 'Scannez ce QR code avec votre application 2FA (Google Authenticator, Authy, etc.), puis confirmez avec POST /auth/2fa/verify',
    qrCode,
    secret, // Pour entrée manuelle
  });
});

// ─── POST /api/v1/auth/2fa/verify — Confirmer et activer le 2FA ──────────────
router.post('/2fa/verify', requireAdmin, async (req, res) => {
  const { totp_code } = req.body;
  if (!totp_code) return res.status(400).json({ error: 'totp_code requis' });

  const adminRes = await db.query('SELECT * FROM admins WHERE id = $1', [req.admin.id]);
  const admin = adminRes.rows[0];
  if (!admin.totp_secret) return res.status(400).json({ error: "Initiez d'abord l'enrollment via POST /auth/2fa/setup" });

  const valid = verifyTotp(admin.totp_secret, totp_code);
  if (!valid) return res.status(401).json({ error: 'Code TOTP invalide. Vérifiez que votre horloge est synchronisée.' });

  const backupCodes = generateBackupCodes();
  await db.query(
    'UPDATE admins SET totp_enabled = TRUE, totp_backup_codes = $1 WHERE id = $2',
    [JSON.stringify(backupCodes), admin.id]
  );

  notify2FAEnabled({ user: { email: admin.email, name: admin.full_name }, backupCodes, ip: req.ip });

  res.json({
    message: '2FA activé avec succès. Conservez ces codes de secours dans un endroit sûr.',
    backupCodes,
  });
});

// ─── DELETE /api/v1/auth/2fa/disable — Désactiver le 2FA ─────────────────────
router.delete('/2fa/disable', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis pour désactiver le 2FA' });

  const adminRes = await db.query('SELECT * FROM admins WHERE id = $1', [req.admin.id]);
  const admin = adminRes.rows[0];

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

  await db.query(
    'UPDATE admins SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1',
    [admin.id]
  );

  notify2FADisabled({ user: { email: admin.email, name: admin.full_name }, ip: req.ip });

  res.json({ message: '2FA désactivé' });
});

// ─── 2FA Marchands — authentification forte) ─────────────────────

// POST /api/v1/auth/merchant/2fa/setup
router.post('/merchant/2fa/setup', require('../middleware/auth').requireMerchant, async (req, res) => {
  const merchant = req.merchant;
  if (merchant.totp_enabled) return res.status(400).json({ error: '2FA déjà activé sur ce compte marchand' });

  const { secret, otpauth_url } = generateTotpSecret(merchant.email);
  const qrCode = await generateQrCode(otpauth_url);

  await db.query('UPDATE merchants SET totp_secret = $1 WHERE id = $2', [secret, merchant.id]);

  res.json({
    message: 'Scannez ce QR code avec votre application 2FA, puis confirmez avec POST /auth/merchant/2fa/verify',
    qrCode,
    secret,
  });
});

// POST /api/v1/auth/merchant/2fa/verify
router.post('/merchant/2fa/verify', require('../middleware/auth').requireMerchant, async (req, res) => {
  const { totp_code } = req.body;
  if (!totp_code) return res.status(400).json({ error: 'totp_code requis' });

  const merchantRes = await db.query('SELECT * FROM merchants WHERE id = $1', [req.merchant.id]);
  const merchant = merchantRes.rows[0];
  if (!merchant.totp_secret) return res.status(400).json({ error: "Initiez d'abord l'enrollment via POST /auth/merchant/2fa/setup" });

  const valid = verifyTotp(merchant.totp_secret, totp_code);
  if (!valid) return res.status(401).json({ error: 'Code TOTP invalide. Vérifiez que votre horloge est synchronisée.' });

  const backupCodes = generateBackupCodes();
  await db.query(
    'UPDATE merchants SET totp_enabled = TRUE, totp_backup_codes = $1 WHERE id = $2',
    [JSON.stringify(backupCodes), merchant.id]
  );

  notify2FAEnabled({ user: { email: merchant.email, name: merchant.name }, backupCodes, ip: req.ip });

  res.json({
    message: '2FA marchand activé avec succès. Conservez ces codes de secours dans un endroit sûr.',
    backupCodes,
  });
});

// DELETE /api/v1/auth/merchant/2fa/disable
router.delete('/merchant/2fa/disable', require('../middleware/auth').requireMerchant, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis pour désactiver le 2FA' });

  const merchantRes = await db.query('SELECT * FROM merchants WHERE id = $1', [req.merchant.id]);
  const merchant = merchantRes.rows[0];

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

  await db.query(
    'UPDATE merchants SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1',
    [merchant.id]
  );

  notify2FADisabled({ user: { email: merchant.email, name: merchant.name }, ip: req.ip });

  res.json({ message: '2FA marchand désactivé' });
});

// ─── POST /api/v1/auth/client/login ──────────────────────────────────────────
// Accepte : phone (local ou international), email, ou afrikfid_id + password
router.post('/client/login', loginLimiter, async (req, res) => {
  const { phone, email, afrikfid_id, country_prefix, password } = req.body;
  if (!password) return res.status(400).json({ error: 'password requis' });
  if (!phone && !email && !afrikfid_id) return res.status(400).json({ error: 'phone, email ou afrikfid_id requis' });

  const { hashField, decrypt } = require('../lib/crypto');

  let client = null;
  let identifier = '';

  if (afrikfid_id) {
    // Connexion par identifiant Afrik'Fid (AFD-XXXX-XXXX)
    identifier = afrikfid_id.trim().toUpperCase();
    if (await checkLockout(identifier)) {
      return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
    }
    const result = await db.query('SELECT * FROM clients WHERE afrikfid_id = $1 AND is_active = TRUE', [identifier]);
    client = result.rows[0];
  } else if (email) {
    // Connexion par email
    identifier = email.trim().toLowerCase();
    if (await checkLockout(identifier)) {
      return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
    }
    const emailHash = hashField(identifier);
    const result = await db.query('SELECT * FROM clients WHERE email_hash = $1 AND is_active = TRUE', [emailHash]);
    client = result.rows[0];
  } else {
    // Connexion par téléphone — normalisation du numéro
    // Si le numéro commence par 0 et qu'un country_prefix est fourni, on compose le numéro international
    let normalizedPhone = phone.trim().replace(/\s/g, '');
    if (country_prefix && normalizedPhone.startsWith('0')) {
      normalizedPhone = country_prefix + normalizedPhone.slice(1);
    } else if (!normalizedPhone.startsWith('+')) {
      // Numéro sans indicatif ni préfixe : on le laisse tel quel (hashField cherchera)
    }
    identifier = normalizedPhone;
    if (await checkLockout(identifier)) {
      return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
    }
    const phoneHash = hashField(normalizedPhone);
    const result = await db.query('SELECT * FROM clients WHERE phone_hash = $1 AND is_active = TRUE', [phoneHash]);
    client = result.rows[0];
  }

  if (!client || !client.password_hash) {
    await recordFailure(identifier);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  const valid = await bcrypt.compare(password, client.password_hash);
  if (!valid) {
    await recordFailure(identifier);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  await clearFailures(identifier);

  // Support 2FA client
  if (client.totp_enabled && client.totp_secret) {
    const { totp_code } = req.body;
    if (!totp_code) {
      return res.status(200).json({ requires2FA: true, message: 'Code 2FA requis.' });
    }
    const totpValid = verifyTotp(client.totp_secret, totp_code);
    if (!totpValid) {
      const backupCodes = client.totp_backup_codes ? JSON.parse(client.totp_backup_codes) : [];
      const backupIdx = backupCodes.indexOf(String(totp_code).toUpperCase());
      if (backupIdx === -1) {
        await recordFailure(identifier);
        return res.status(401).json({ error: 'Code 2FA invalide' });
      }
      backupCodes.splice(backupIdx, 1);
      await db.query('UPDATE clients SET totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(backupCodes), client.id]);
    }
  }

  const tokens = generateTokens({ sub: client.id, role: 'client', afrikfidId: client.afrikfid_id });

  const refreshJti = extractJti(tokens.refreshToken);
  if (refreshJti) {
    await redis.setEx(refreshKey(refreshJti), REFRESH_TTL, JSON.stringify({ sub: client.id, role: 'client' }));
  }

  const wallet = (await db.query('SELECT balance FROM wallets WHERE client_id = $1', [client.id])).rows[0];

  res.json({
    ...tokens,
    client: {
      id: client.id,
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone ? decrypt(client.phone) : null,
      loyaltyStatus: client.loyalty_status,
      walletBalance: wallet?.balance || 0,
      totpEnabled: client.totp_enabled || false,
    },
  });
});

// ─── Login client par OTP (sans mot de passe) ────────────────────────────────
//
// Flow en 3 étapes côté UI :
//   1. POST /auth/client/login/request          { identifier }              → 200 { consommateurId, channels: [{id, masked}] }
//   2. POST /auth/client/login/send-otp         { consommateurId, channel } → 200 { sent: true, channel, masked, ttl }
//   3. POST /auth/client/login/verify           { consommateurId, channel, otp } → 200 { accessToken, refreshToken, client }
//
// La passerelle ne stocke aucun mot de passe pour ces clients : ils sont la
// projection locale des Consommateurs business-api. Le provisioning local se
// fait au moment de /verify (réutilise upsertClientFromCarteInfo).

router.post('/client/login/request', loginLimiter, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) return res.status(400).json({ error: 'identifier requis' });

  let lookup;
  try {
    lookup = await afrikfidClient.lookupConsommateurByIdentifier(identifier);
  } catch (err) {
    console.warn('[client/login/request] lookup failed:', err.message);
    return res.status(503).json({ error: 'service_unavailable', message: 'Service fidélité momentanément indisponible.' });
  }

  if (!lookup) {
    return res.status(404).json({ error: 'not_found', message: 'Aucun compte trouvé. Adressez-vous à votre marchand pour vous inscrire.' });
  }

  // On ne renvoie au client QUE les masques + ids opaques de canaux.
  // Les valeurs réelles (phone_e164, email) sont stockées le temps de l'envoi.
  res.json({
    consommateurId: lookup.consommateur_id,
    numeroCarte: lookup.numero_carte || null,
    channels: (lookup.channels || []).map(c => ({ id: c.id, masked: c.masked })),
  });
});

router.post('/client/login/send-otp', loginLimiter, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const lam = require('../lib/lafricamobile-whatsapp');
  const { sendSMS, sendEmail } = require('../lib/notifications');
  const { issueOtp, isOnCooldown, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS } = require('../lib/client-login-otp');

  const consommateurId = parseInt(req.body?.consommateurId, 10);
  const channel = String(req.body?.channel || '').toLowerCase();
  if (!consommateurId || !['sms', 'whatsapp', 'email'].includes(channel)) {
    return res.status(400).json({ error: 'consommateurId et channel (sms|whatsapp|email) requis' });
  }

  if (await isOnCooldown(consommateurId, channel)) {
    return res.status(429).json({ error: 'cooldown', cooldownSeconds: RESEND_COOLDOWN_SECONDS });
  }

  // Re-fetch des canaux pour récupérer les valeurs réelles côté serveur
  // (jamais renvoyées au client). On retrouve via le numéro de carte ou
  // un identifier dérivé : ici on rappelle Laravel avec consommateur_id ?
  // Plus simple : on relookup via un identifier qu'on a déjà — on demande
  // à l'UI de nous le repasser dans le payload original. Approche choisie :
  // l'UI passe l'`identifier` initial, on relookup pour resolver.
  const identifier = String(req.body?.identifier || '').trim();
  if (!identifier) return res.status(400).json({ error: 'identifier requis' });

  let lookup;
  try { lookup = await afrikfidClient.lookupConsommateurByIdentifier(identifier); }
  catch { return res.status(503).json({ error: 'service_unavailable' }); }
  if (!lookup || lookup.consommateur_id !== consommateurId) {
    return res.status(400).json({ error: 'identifier_mismatch' });
  }

  const channelData = (lookup.channels || []).find(c => c.id === channel);
  if (!channelData) return res.status(400).json({ error: 'channel_unavailable' });

  // Stockage Redis : la clé est le channel DEMANDÉ (jamais un alias type 'sms_fallback').
  // L'OTP envoyé par fallback SMS reste vérifiable avec channel='whatsapp' au verify.
  // C'est l'invariant qui rend ce flow correct ; voir A17 dans l'audit.
  const code = await issueOtp(consommateurId, channel);
  let actuallyDeliveredVia = channel;
  let fallbackUsed = false;

  try {
    if (channel === 'whatsapp') {
      const wa = lam.toWaId(channelData.phone_e164);
      if (!wa || !lam.isConfigured() || !lam.isTemplateConfigured()) {
        await sendSMS(channelData.phone_e164, `Afrik'Fid : votre code de connexion est ${code}. Valable ${Math.round(OTP_TTL_SECONDS / 60)} min.`);
        actuallyDeliveredVia = 'sms';
        fallbackUsed = true;
      } else {
        const result = await lam.sendOtpTemplate(wa, code);
        if (!result.ok) {
          await sendSMS(channelData.phone_e164, `Afrik'Fid : votre code de connexion est ${code}. Valable ${Math.round(OTP_TTL_SECONDS / 60)} min.`);
          actuallyDeliveredVia = 'sms';
          fallbackUsed = true;
        }
      }
    } else if (channel === 'sms') {
      await sendSMS(channelData.phone_e164, `Afrik'Fid : votre code de connexion est ${code}. Valable ${Math.round(OTP_TTL_SECONDS / 60)} min.`);
    } else if (channel === 'email') {
      await sendEmail(channelData.email, "Votre code de connexion Afrik'Fid",
        `Bonjour,\n\nVotre code de connexion Afrik'Fid est : ${code}\nIl est valable ${Math.round(OTP_TTL_SECONDS / 60)} minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`);
    }
  } catch (err) {
    console.warn('[client/login/send-otp] send failed:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n==========================`);
      console.log(`[OTP DEV] consommateurId=${consommateurId} channel=${channel}`);
      console.log(`[OTP DEV] CODE: ${code}`);
      console.log(`==========================\n`);
      // En dev, on considère l'envoi comme réussi pour ne pas bloquer les tests
    } else {
      return res.status(502).json({ error: 'send_failed', message: "Échec de l'envoi du code, réessayez." });
    }
  }

  // Contrat fixe : `channel` est TOUJOURS celui demandé par l'UI (pour qu'elle
  // puisse le renvoyer tel quel au verify). `deliveredVia` indique le canal réel
  // si différent (ex: WhatsApp demandé mais fallback SMS).
  res.json({
    sent: true,
    channel,
    deliveredVia: actuallyDeliveredVia,
    fallbackUsed,
    masked: channelData.masked,
    ttlSeconds: OTP_TTL_SECONDS,
  });
});

router.post('/client/login/verify', loginLimiter, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const { verifyOtp } = require('../lib/client-login-otp');
  const { upsertClientFromCarteInfo } = require('../lib/business-api-sync');

  const consommateurId = parseInt(req.body?.consommateurId, 10);
  const channel = String(req.body?.channel || '').toLowerCase();
  const otp = String(req.body?.otp || '').trim();
  const identifier = String(req.body?.identifier || '').trim();

  if (!consommateurId || !channel || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'consommateurId, channel, otp (6 chiffres) requis' });
  }

  // Si on a fait un fallback SMS, l'OTP a été stocké sous channel='whatsapp' :
  // on essaie d'abord le canal demandé, puis le canal d'origine.
  let check = await verifyOtp(consommateurId, channel, otp);
  if (!check.ok && channel === 'sms') {
    // Cas fallback : l'utilisateur a cliqué WA mais a reçu par SMS. On a stocké
    // sous 'whatsapp', le verify est sous 'whatsapp'. UI doit envoyer 'whatsapp' →
    // ce branchement n'est utile que si l'UI confond. Sinon on tombe simplement
    // sur 'invalid_code' et on retourne l'erreur normale.
  }
  if (!check.ok) {
    const msg = {
      expired_or_missing: 'Code expiré, demandez-en un nouveau.',
      too_many_attempts: 'Trop de tentatives, demandez-en un nouveau.',
      invalid_code: `Code incorrect.${check.remaining != null ? ` ${check.remaining} essai(s) restant(s).` : ''}`,
    }[check.reason] || 'Vérification impossible.';
    return res.status(401).json({ error: msg, reason: check.reason, remaining: check.remaining });
  }

  // Provisioning local : si on n'a pas encore le client en DB, on le crée
  // depuis le payload Laravel (lookupCard si carte connue, sinon création
  // minimaliste à partir des données du lookup).
  let client = (await db.query(
    'SELECT * FROM clients WHERE business_api_consommateur_id = $1 AND is_active = TRUE',
    [consommateurId]
  )).rows[0];

  if (!client) {
    // Re-lookup par identifier pour récupérer numero_carte si possible
    let numeroCarte = null;
    try {
      const lookup = await afrikfidClient.lookupConsommateurByIdentifier(identifier);
      numeroCarte = lookup?.numero_carte || null;
    } catch { /* ignore */ }

    if (numeroCarte) {
      const card = await afrikfidClient.lookupCard(numeroCarte).catch(() => null);
      if (card) client = await upsertClientFromCarteInfo(card, numeroCarte);
    }
    // Si toujours pas de client (cas rare : consommateur sans carte), on crée
    // un mirror minimal avec un afrikfid_id legacy.
    if (!client) {
      const id = require('uuid').v4();
      const legacyAfrikfidId = `AFD-BAPI-${consommateurId}`;
      await db.query(
        `INSERT INTO clients (id, afrikfid_id, full_name, business_api_consommateur_id, is_active)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (afrikfid_id) DO NOTHING`,
        [id, legacyAfrikfidId, `Client ${consommateurId}`, consommateurId]
      );
      client = (await db.query(
        'SELECT * FROM clients WHERE business_api_consommateur_id = $1',
        [consommateurId]
      )).rows[0];
    }
  }

  if (!client) return res.status(500).json({ error: 'provisioning_failed' });

  // Émission tokens passerelle (cohérent avec /client/login classique)
  const tokens = generateTokens({ sub: client.id, role: 'client', afrikfidId: client.afrikfid_id });
  const refreshJti = extractJti(tokens.refreshToken);
  if (refreshJti) {
    await redis.setEx(refreshKey(refreshJti), REFRESH_TTL, JSON.stringify({ sub: client.id, role: 'client', via: 'otp' }));
  }

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload, ip_address)
     VALUES ($1, 'client', $2, 'login_otp', 'client', $3, $4, $5)`,
    [require('uuid').v4(), client.id, client.id,
     JSON.stringify({ channel, consommateurId }),
     req.ip]
  );

  const wallet = (await db.query('SELECT balance FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const { decrypt } = require('../lib/crypto');
  res.json({
    ...tokens,
    client: {
      id: client.id,
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone ? decrypt(client.phone) : null,
      loyaltyStatus: client.loyalty_status,
      walletBalance: wallet?.balance || 0,
      totpEnabled: client.totp_enabled || false,
    },
  });
});

// ─── POST /api/v1/auth/client/2fa/setup ──────────────────────────────────────
router.post('/client/2fa/setup', require('../middleware/auth').requireClient, async (req, res) => {
  const client = req.client;
  if (client.totp_enabled) return res.status(400).json({ error: '2FA déjà activé' });
  const identifier = client.afrikfid_id || client.id;
  const { secret, otpauth_url } = generateTotpSecret(identifier);
  const qrCode = await generateQrCode(otpauth_url);
  await db.query('UPDATE clients SET totp_secret = $1 WHERE id = $2', [secret, client.id]);
  res.json({ secret, qrCode, message: 'Scannez le QR code puis confirmez avec POST /auth/client/2fa/verify' });
});

// ─── POST /api/v1/auth/client/2fa/verify ─────────────────────────────────────
router.post('/client/2fa/verify', require('../middleware/auth').requireClient, async (req, res) => {
  const { totp_code } = req.body;
  if (!totp_code) return res.status(400).json({ error: 'totp_code requis' });
  const clientRow = (await db.query('SELECT * FROM clients WHERE id = $1', [req.client.id])).rows[0];
  if (!clientRow.totp_secret) return res.status(400).json({ error: "Initiez d'abord l'enrollment via POST /auth/client/2fa/setup" });
  const valid = verifyTotp(clientRow.totp_secret, totp_code);
  if (!valid) return res.status(401).json({ error: 'Code TOTP invalide' });
  const backupCodes = generateBackupCodes();
  await db.query('UPDATE clients SET totp_enabled = TRUE, totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(backupCodes), req.client.id]);
  res.json({ message: '2FA activé', backupCodes });
});

// ─── DELETE /api/v1/auth/client/2fa/disable ───────────────────────────────────
router.delete('/client/2fa/disable', require('../middleware/auth').requireClient, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  const clientRow = (await db.query('SELECT * FROM clients WHERE id = $1', [req.client.id])).rows[0];
  const valid = await bcrypt.compare(password, clientRow.password_hash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });
  await db.query('UPDATE clients SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1', [req.client.id]);
  res.json({ message: '2FA client désactivé' });
});

// ─── POST /api/v1/auth/client/resolve-card ───────────────────────────────────
// Résolution d'une carte fidélité AfrikFid (12-chars, 2014xxxxxxx) par la gateway.
// Flux: la page /pay demande le numéro → cet endpoint interroge business-api →
// si connu, provisionne (lazy) le client local et renvoie un profil masqué.
// Aucun token n'est émis ici : le login complet passe par /client/login.
router.post('/client/resolve-card', loginLimiter, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const { hashField, encrypt } = require('../lib/crypto');
  const { randomUUID } = require('crypto');

  const numero = (req.body?.numero || '').trim();
  if (!afrikfidClient.isValidCardNumero(numero)) {
    return res.status(400).json({ error: 'INVALID_CARD_FORMAT', message: 'Numéro attendu: 12 chiffres au format 2014xxxxxxx.' });
  }

  // 1) Client déjà connu localement ?
  let local = (await db.query('SELECT * FROM clients WHERE afrikfid_id = $1', [numero])).rows[0];

  // 2) Sinon on interroge business-api (fail-open : null si indisponible)
  let card = null;
  if (!local) {
    try {
      card = await afrikfidClient.lookupCard(numero);
    } catch (e) {
      if (e.code === 'INTEGRATION_DISABLED' || e.code === 'CONFIG_MISSING') {
        return res.status(503).json({ error: 'INTEGRATION_UNAVAILABLE', message: 'Intégration AfrikFid indisponible.' });
      }
      card = null;
    }
    if (!card) return res.json({ known: false });

    // Provisioning lazy : on n'écrit que les champs disponibles chez business-api.
    const consommateur = card.consommateur || {};
    const fullName = [consommateur.prenom, consommateur.nom].filter(Boolean).join(' ').trim() || 'Client AfrikFid';
    const encPhone = consommateur.telephone ? encrypt(consommateur.telephone) : null;
    const phoneHash = consommateur.telephone ? hashField(consommateur.telephone) : null;
    const encEmail = consommateur.email ? encrypt(consommateur.email) : null;
    const emailHash = consommateur.email ? hashField(consommateur.email) : null;

    const id = randomUUID();
    try {
      await db.query(
        `INSERT INTO clients
          (id, afrikfid_id, business_api_consommateur_id, full_name, phone, phone_hash, email, email_hash, loyalty_status, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', TRUE)
         ON CONFLICT (afrikfid_id) DO NOTHING`,
        [id, numero, consommateur.id || null, fullName, encPhone, phoneHash, encEmail, emailHash]
      );
    } catch (e) {
      // Concurrent insert : on relit simplement la ligne.
    }
    local = (await db.query('SELECT * FROM clients WHERE afrikfid_id = $1', [numero])).rows[0];
  }

  if (!local) return res.json({ known: false });

  // Réponse masquée : pas de PII complète, juste de quoi confirmer l'identité à l'utilisateur.
  const { decrypt } = require('../lib/crypto');
  const clearPhone = local.phone ? decrypt(local.phone) : null;
  const maskedPhone = clearPhone ? clearPhone.replace(/\d(?=\d{2})/g, '•') : null;
  const firstName = (local.full_name || '').split(' ')[0] || '';

  res.json({
    known: true,
    masked: {
      firstName,
      phoneMask: maskedPhone,
      loyaltyStatus: local.loyalty_status || 'OPEN',
      points: card?.points_cumules ?? null,
      hasPassword: !!local.password_hash,
    },
  });
});

// ─── GET /api/v1/auth/sso ─────────────────────────────────────────────────────
//
// SSO entrant depuis business-api : on vérifie le JWT signé, on provisionne ou
// retrouve le merchant local, on émet une session passerelle et on redirige.
//
// Deux modes de réponse :
//   - format=json (XHR/fetch)        → 200 { accessToken, refreshToken, merchant, redirectTo }
//   - défaut (navigation directe)    → 302 vers la SPA marchand avec les tokens
//                                        en fragment d'URL (jamais en query : pas de fuite logs)
//
// Audit : chaque entrée SSO est tracée dans audit_logs.
router.get('/sso', async (req, res) => {
  const { verifySsoToken } = require('../lib/sso');
  const { findOrCreateMerchantFromBapiUser } = require('../lib/merchant-sso-provisioning');

  const token = String(req.query.token || '').trim();
  const wantJson = req.query.format === 'json' || (req.headers.accept || '').includes('application/json');
  const fail = (status, code, msg) => {
    if (wantJson) return res.status(status).json({ error: code, message: msg });
    return res.status(status).send(`<html><body style="font-family:sans-serif;padding:40px"><h2>Connexion impossible</h2><p>${msg}</p><p style="color:#888;font-size:12px">code: ${code}</p></body></html>`);
  };

  const verify = verifySsoToken(token);
  if (!verify.ok) return fail(401, verify.error, 'Lien SSO invalide ou expiré.');

  let merchant;
  try {
    const provision = await findOrCreateMerchantFromBapiUser(verify.claims);
    merchant = provision.merchant;
  } catch (err) {
    return fail(403, err.code || 'PROVISIONING_FAILED', 'Impossible de créer ou retrouver le compte marchand.');
  }

  if (!merchant.is_active) return fail(403, 'INACTIVE', 'Compte marchand désactivé.');

  // Émission tokens passerelle (cohérent avec /merchant/login)
  const tokens = generateTokens({ sub: merchant.id, role: 'merchant', email: merchant.email });
  const refreshJti = extractJti(tokens.refreshToken);
  if (refreshJti) {
    await redis.setEx(refreshKey(refreshJti), REFRESH_TTL, JSON.stringify({ sub: merchant.id, role: 'merchant', via: 'sso' }));
  }

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload, ip_address)
     VALUES ($1, 'merchant', $2, 'sso_login', 'merchant', $3, $4, $5)`,
    [require('uuid').v4(), merchant.id, merchant.id,
     JSON.stringify({ bapi_user_id: verify.claims.sub, jti: verify.claims.jti, role: verify.claims.role }),
     req.ip]
  );

  await clearFailures(merchant.email);

  const redirectTo = verify.claims.redirect_to || '/merchant';

  if (wantJson) {
    return res.json({
      ...tokens,
      merchant: {
        id: merchant.id, name: merchant.name, email: merchant.email,
        status: merchant.status, rebatePercent: merchant.rebate_percent,
        package: merchant.package || 'STARTER_BOOST',
      },
      redirectTo,
    });
  }

  // Fragment URL = pas envoyé au serveur, pas dans les logs proxy.
  // La SPA marchand lit window.location.hash au mount.
  const params = new URLSearchParams({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  return res.redirect(302, `${redirectTo}#${params.toString()}`);
});

module.exports = router;
