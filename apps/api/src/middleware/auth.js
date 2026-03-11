const jwt = require('jsonwebtoken');
const db = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'afrikfid-secret-key';

/**
 * Middleware d'authentification JWT pour les admins
 */
function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Accès interdit' });

    const admin = db.prepare('SELECT * FROM admins WHERE id = ? AND is_active = 1').get(decoded.sub);
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
function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'Clé API manquante' });

  const isSandbox = req.headers['x-sandbox'] === 'true' || process.env.SANDBOX_MODE === 'true';

  let merchant;
  if (isSandbox) {
    merchant = db.prepare('SELECT * FROM merchants WHERE sandbox_key_public = ? AND is_active = 1').get(apiKey);
  } else {
    merchant = db.prepare('SELECT * FROM merchants WHERE api_key_public = ? AND is_active = 1').get(apiKey);
  }

  if (!merchant) return res.status(401).json({ error: 'Clé API invalide' });
  if (merchant.status !== 'active') return res.status(403).json({ error: 'Compte marchand inactif ou suspendu' });

  req.merchant = merchant;
  req.isSandbox = isSandbox;
  req.user = { id: merchant.id, role: 'merchant' };
  next();
}

/**
 * Middleware d'authentification JWT pour les marchands (dashboard)
 */
function requireMerchant(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'merchant') return res.status(403).json({ error: 'Accès interdit' });

    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ? AND is_active = 1').get(decoded.sub);
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
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    if (decoded.role === 'admin') {
      const admin = db.prepare('SELECT * FROM admins WHERE id = ? AND is_active = 1').get(decoded.sub);
      if (!admin) return res.status(401).json({ error: 'Session invalide' });
      req.admin = admin;
    } else if (decoded.role === 'merchant') {
      const merchant = db.prepare('SELECT * FROM merchants WHERE id = ? AND is_active = 1').get(decoded.sub);
      if (!merchant) return res.status(401).json({ error: 'Session invalide' });
      req.merchant = merchant;
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function generateTokens(payload) {
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

module.exports = { requireAdmin, requireApiKey, requireMerchant, requireAuth, generateTokens };
