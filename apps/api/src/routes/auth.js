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

const JWT_SECRET = process.env.JWT_SECRET || 'afrikfid-secret-key';
const REFRESH_TTL = 7 * 24 * 3600; // 7 jours en secondes

// ─── Anti-brute force sur les endpoints de login (CDC §5.4) ──────────────────
// Blocage après 5 tentatives par email ou par IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => (req.body && req.body.email) || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Trop de tentatives de connexion. Compte temporairement bloqué (15 minutes).' },
  skipSuccessfulRequests: true,
});

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
  const { email, password } = req.body;

  const result = await db.query('SELECT * FROM admins WHERE email = $1 AND is_active = TRUE', [email]);
  const admin = result.rows[0];
  if (!admin) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  await db.query('UPDATE admins SET last_login = NOW() WHERE id = $1', [admin.id]);

  const tokens = generateTokens({ sub: admin.id, role: 'admin', email: admin.email });

  // Stocker le refresh token dans Redis pour permettre la révocation
  const refreshJti = extractJti(tokens.refreshToken);
  if (refreshJti) {
    await redis.setEx(refreshKey(refreshJti), REFRESH_TTL, JSON.stringify({ sub: admin.id, role: 'admin' }));
  }

  res.json({
    ...tokens,
    admin: { id: admin.id, email: admin.email, fullName: admin.full_name, role: admin.role },
  });
});

// ─── POST /api/v1/auth/merchant/login ────────────────────────────────────────
router.post('/merchant/login', loginLimiter, validate(MerchantLoginSchema), async (req, res) => {
  const { email, password } = req.body;

  const result = await db.query('SELECT * FROM merchants WHERE email = $1 AND is_active = TRUE', [email]);
  const merchant = result.rows[0];
  if (!merchant || !merchant.password_hash) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

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
  res.json({ admin: { id: req.admin.id, email: req.admin.email, fullName: req.admin.full_name, role: req.admin.role } });
});

module.exports = router;
