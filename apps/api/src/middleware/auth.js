const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'afrikfid-secret-key';
const redis = require('../lib/redis');

/**
 * Middleware d'authentification JWT pour les admins
 */
async function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Accès interdit' });

    // Vérifier que le token n'a pas été révoqué (logout)
    if (decoded.jti && await redis.exists(`revoked:${decoded.jti}`)) {
      return res.status(401).json({ error: 'Token révoqué. Reconnectez-vous.' });
    }

    const result = await db.query('SELECT * FROM admins WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
    const admin = result.rows[0];
    if (!admin) return res.status(401).json({ error: 'Session invalide' });

    req.admin = admin;
    req.user = { id: admin.id, role: 'admin' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ─── Constantes rate limiting par clé API  ──────────────────────
// Fenêtre glissante : API_KEY_RATE_LIMIT_MAX requêtes par API_KEY_RATE_LIMIT_WINDOW_MS
const API_KEY_RATE_LIMIT_MAX = parseInt(process.env.API_KEY_RATE_LIMIT_MAX) || 100;
const API_KEY_RATE_LIMIT_WINDOW_MS = parseInt(process.env.API_KEY_RATE_LIMIT_WINDOW_MS) || 60000; // 1 minute

/**
 * Middleware d'authentification par clé API pour les marchands
 * Inclut un rate limiting par clé API stocké dans Redis 
 */
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'Clé API manquante' });

  const isSandbox = req.headers['x-sandbox'] === 'true' || process.env.SANDBOX_MODE === 'true';

  let result;
  if (isSandbox) {
    result = await db.query('SELECT * FROM merchants WHERE sandbox_key_public = $1 AND is_active = TRUE', [apiKey]);
  } else {
    result = await db.query('SELECT * FROM merchants WHERE api_key_public = $1 AND is_active = TRUE', [apiKey]);
  }
  const merchant = result.rows[0];

  if (!merchant) return res.status(401).json({ error: 'Clé API invalide' });
  if (merchant.status !== 'active') return res.status(403).json({ error: 'Compte marchand inactif ou suspendu' });
  // En mode sandbox, le KYC n'est pas requis (le marchand peut tester son intégration pendant l'examen)
  if (!isSandbox && merchant.kyc_status !== 'approved') {
    return res.status(403).json({ error: 'KYC_REQUIRED', message: 'Vérification KYC requise avant de pouvoir accepter des paiements en production.' });
  }

  // ── Rate limiting par clé API (fenêtre glissante via Redis) ──────────────
  try {
    const rateLimitKey = `ratelimit:apikey:${apiKey}`;
    const windowSecs = Math.ceil(API_KEY_RATE_LIMIT_WINDOW_MS / 1000);

    // Incrémenter le compteur ; s'il n'existe pas, Redis setEx l'initialise à 1
    const currentStr = await redis.get(rateLimitKey);
    const current = currentStr ? parseInt(currentStr) : 0;

    if (current >= API_KEY_RATE_LIMIT_MAX) {
      res.set('X-RateLimit-Limit', String(API_KEY_RATE_LIMIT_MAX));
      res.set('X-RateLimit-Remaining', '0');
      res.set('Retry-After', String(windowSecs));
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Limite de ${API_KEY_RATE_LIMIT_MAX} requêtes par minute dépassée pour cette clé API. Réessayez dans ${windowSecs}s.`,
      });
    }

    // Incrémenter avec TTL (setEx remet le TTL à chaque appel — comportement fenêtre fixe)
    // Pour une fenêtre glissante exacte on utiliserait ZADD, mais setEx suffit pour la protection contre les abus
    if (current === 0) {
      await redis.setEx(rateLimitKey, windowSecs, '1');
    } else {
      // Juste incrémenter sans reset du TTL (fenêtre fixe)
      await redis.setEx(rateLimitKey, windowSecs, String(current + 1));
    }

    res.set('X-RateLimit-Limit', String(API_KEY_RATE_LIMIT_MAX));
    res.set('X-RateLimit-Remaining', String(API_KEY_RATE_LIMIT_MAX - current - 1));
  } catch {
    // En cas d'erreur Redis, on laisse passer (dégradation gracieuse)
  }

  req.merchant = merchant;
  req.isSandbox = isSandbox;
  req.user = { id: merchant.id, role: 'merchant' };
  next();
}

/**
 * Middleware d'authentification JWT pour les marchands (dashboard)
 */
async function requireMerchant(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'merchant') return res.status(403).json({ error: 'Accès interdit' });

    // Vérifier que le token n'a pas été révoqué (logout)
    if (decoded.jti && await redis.exists(`revoked:${decoded.jti}`)) {
      return res.status(401).json({ error: 'Token révoqué. Reconnectez-vous.' });
    }

    const result = await db.query('SELECT * FROM merchants WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
    const merchant = result.rows[0];
    if (!merchant) return res.status(401).json({ error: 'Session invalide' });

    req.merchant = merchant;
    req.user = { id: merchant.id, role: 'merchant' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

/**
 * Admin, Merchant (JWT dashboard) ou Client — pour les routes partagées.
 * Vérifie aussi la révocation JTI (logout).
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Vérifier révocation JTI (logout)
    if (decoded.jti && await redis.exists(`revoked:${decoded.jti}`)) {
      return res.status(401).json({ error: 'Token révoqué. Reconnectez-vous.' });
    }

    req.user = decoded;

    if (decoded.role === 'admin') {
      const result = await db.query('SELECT * FROM admins WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
      const admin = result.rows[0];
      if (!admin) return res.status(401).json({ error: 'Session invalide' });
      req.admin = admin;
    } else if (decoded.role === 'merchant') {
      const result = await db.query('SELECT * FROM merchants WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
      const merchant = result.rows[0];
      if (!merchant) return res.status(401).json({ error: 'Session invalide' });
      req.merchant = merchant;
    } else if (decoded.role === 'client') {
      const result = await db.query('SELECT * FROM clients WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
      const client = result.rows[0];
      if (!client) return res.status(401).json({ error: 'Session invalide' });
      req.client = client;
    } else {
      return res.status(403).json({ error: 'Rôle non reconnu' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function generateTokens(payload) {
  const jtiAccess = crypto.randomBytes(16).toString('hex');
  const jtiRefresh = crypto.randomBytes(16).toString('hex');
  const accessToken = jwt.sign({ ...payload, jti: jtiAccess }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '2h' });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh', jti: jtiRefresh }, JWT_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * Middleware d'authentification JWT pour les clients (paiement wallet)
 */
async function requireClient(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'client') return res.status(403).json({ error: 'Accès réservé aux clients' });

    if (decoded.jti && await redis.exists(`revoked:${decoded.jti}`)) {
      return res.status(401).json({ error: 'Token révoqué. Reconnectez-vous.' });
    }

    const result = await db.query('SELECT * FROM clients WHERE id = $1 AND is_active = TRUE', [decoded.sub]);
    const client = result.rows[0];
    if (!client) return res.status(401).json({ error: 'Session invalide' });

    req.client = client;
    req.user = { id: client.id, role: 'client' };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = { requireAdmin, requireApiKey, requireMerchant, requireAuth, requireClient, generateTokens };
