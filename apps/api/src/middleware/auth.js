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

/**
 * Middleware d'authentification par clé API pour les marchands
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
  if (merchant.kyc_status !== 'approved') return res.status(403).json({ error: 'KYC_PENDING', message: 'Vérification KYC requise avant de pouvoir accepter des paiements' });

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
 * Admin ou Merchant (pour les routes communes)
 */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function generateTokens(payload) {
  const jtiAccess = crypto.randomBytes(16).toString('hex');
  const jtiRefresh = crypto.randomBytes(16).toString('hex');
  const accessToken = jwt.sign({ ...payload, jti: jtiAccess }, JWT_SECRET, { expiresIn: '15m' });
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
