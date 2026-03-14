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

const JWT_SECRET = process.env.JWT_SECRET || 'afrikfid-secret-key';
const REFRESH_TTL = 7 * 24 * 3600; // 7 jours en secondes

// ─── Anti-brute force sur les endpoints de login (CDC §5.4.2) ────────────────
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
  const { email, password } = req.body;

  if (await checkLockout(email)) {
    return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const result = await db.query('SELECT * FROM merchants WHERE email = $1 AND is_active = TRUE', [email]);
  const merchant = result.rows[0];
  if (!merchant || !merchant.password_hash) {
    await recordFailure(email);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) {
    await recordFailure(email);
    return res.status(401).json({ error: 'Identifiants invalides' });
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
    },
  });
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

  res.json({ message: '2FA désactivé' });
});

// ─── POST /api/v1/auth/client/login ──────────────────────────────────────────
router.post('/client/login', loginLimiter, async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'phone et password requis' });

  if (await checkLockout(phone)) {
    return res.status(429).json({ error: 'ACCOUNT_LOCKED', message: 'Compte temporairement bloqué après trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const { hashField } = require('../lib/crypto');
  const { decrypt } = require('../lib/crypto');
  const phoneHash = hashField(phone);

  const result = await db.query('SELECT * FROM clients WHERE phone_hash = $1 AND is_active = TRUE', [phoneHash]);
  const client = result.rows[0];
  if (!client || !client.password_hash) {
    await recordFailure(phone);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  const valid = await bcrypt.compare(password, client.password_hash);
  if (!valid) {
    await recordFailure(phone);
    return res.status(401).json({ error: 'Identifiants invalides' });
  }

  await clearFailures(phone);
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
      phone: decrypt(client.phone),
      loyaltyStatus: client.loyalty_status,
      walletBalance: wallet?.balance || 0,
    },
  });
});

module.exports = router;
