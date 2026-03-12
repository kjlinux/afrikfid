const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { requireAdmin, requireMerchant, generateTokens } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { CreateMerchantSchema, UpdateMerchantSchema, MerchantLoginSchema } = require('../config/schemas');

// POST /api/v1/merchants (admin)
router.post('/', requireAdmin, validate(CreateMerchantSchema), async (req, res) => {
  const {
    name, email, phone, country_id, category,
    rebate_percent, rebate_mode,
    business_registration, address, website,
    mm_operator, mm_phone, bank_name, bank_account,
    webhook_url, settlement_frequency,
    password,
  } = req.body;

  const existing = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email déjà utilisé' });

  const id = uuidv4();
  const apiKeyPublic = `af_pub_${uuidv4().replace(/-/g, '')}`;
  const apiKeySecret = `af_sec_${uuidv4().replace(/-/g, '')}`;
  const sandboxKeyPublic = `af_sandbox_pub_${uuidv4().replace(/-/g, '')}`;
  const sandboxKeySecret = `af_sandbox_sec_${uuidv4().replace(/-/g, '')}`;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  db.prepare(`
    INSERT INTO merchants (
      id, name, email, phone, country_id, category,
      rebate_percent, rebate_mode, business_registration, address, website,
      mm_operator, mm_phone, bank_name, bank_account,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      webhook_url, settlement_frequency, password_hash,
      status, kyc_status
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      'pending', 'pending'
    )
  `).run(
    id, name, email, phone || null, country_id || null, category || 'general',
    rebate_percent, rebate_mode, business_registration || null, address || null, website || null,
    mm_operator || null, mm_phone || null, bank_name || null, bank_account || null,
    apiKeyPublic, apiKeySecret, sandboxKeyPublic, sandboxKeySecret,
    webhook_url || null, settlement_frequency, passwordHash
  );

  const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
  res.status(201).json({ merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants (admin)
router.get('/', requireAdmin, (req, res) => {
  const { status, country_id, page = 1, limit = 20, q } = req.query;
  let query = 'SELECT m.*, c.name as country_name, c.currency FROM merchants m LEFT JOIN countries c ON m.country_id = c.id WHERE 1=1';
  const params = [];

  if (status) { query += ' AND m.status = ?'; params.push(status); }
  if (country_id) { query += ' AND m.country_id = ?'; params.push(country_id); }
  if (q) { query += ' AND (m.name LIKE ? OR m.email LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  query += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
  const offset = (page - 1) * limit;
  params.push(parseInt(limit), offset);

  const merchants = db.prepare(query).all(...params);
  const total = db.prepare("SELECT COUNT(*) as c FROM merchants WHERE 1=1").get().c;

  res.json({ merchants: merchants.map(m => sanitizeMerchant(m, false)), total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/merchants/:id (admin)
router.get('/:id', requireAdmin, (req, res) => {
  const merchant = db.prepare(`
    SELECT m.*, c.name as country_name, c.currency
    FROM merchants m LEFT JOIN countries c ON m.country_id = c.id
    WHERE m.id = ?
  `).get(req.params.id);

  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });
  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// PATCH /api/v1/merchants/:id (admin)
router.patch('/:id', requireAdmin, validate(UpdateMerchantSchema), (req, res) => {
  const allowed = ['name', 'phone', 'rebate_percent', 'rebate_mode', 'status', 'kyc_status',
    'webhook_url', 'settlement_frequency', 'mm_operator', 'mm_phone', 'bank_name', 'bank_account',
    'category', 'address'];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'EMPTY_UPDATE', message: 'Aucune donnée à mettre à jour' });

  updates.updated_at = new Date().toISOString();
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE merchants SET ${setClause} WHERE id = ?`).run(...Object.values(updates), req.params.id);

  const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.params.id);
  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants/:id/balance (admin ou marchand)
router.get('/:id/balance', requireAdmin, (req, res) => {
  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_receives ELSE 0 END), 0) as total_earned,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
    FROM transactions WHERE merchant_id = ?
  `).get(req.params.id);

  res.json({ balance: stats });
});

// GET /api/v1/merchants/:id/transactions (admin ou marchand)
router.get('/:id/transactions', requireAdmin, (req, res) => {
  const { page = 1, limit = 20, status, from, to } = req.query;
  let query = `
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status as current_client_status
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.merchant_id = ?
  `;
  const params = [req.params.id];

  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (from) { query += ' AND t.initiated_at >= ?'; params.push(from); }
  if (to) { query += ' AND t.initiated_at <= ?'; params.push(to); }

  query += ' ORDER BY t.initiated_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE merchant_id = ?').get(req.params.id).c;

  res.json({ transactions, total });
});

// ─── Auth marchand ────────────────────────────────────────────────────────────

// POST /api/v1/merchants/auth/login
router.post('/auth/login', validate(MerchantLoginSchema), async (req, res) => {
  const { email, password } = req.body;

  const merchant = db.prepare('SELECT * FROM merchants WHERE email = ? AND is_active = 1').get(email);
  if (!merchant || !merchant.password_hash) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  const tokens = generateTokens({ sub: merchant.id, role: 'merchant', email: merchant.email });
  res.json({ ...tokens, merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants/me (marchand connecté)
router.get('/me/profile', requireMerchant, (req, res) => {
  const merchant = db.prepare(`
    SELECT m.*, c.name as country_name, c.currency
    FROM merchants m LEFT JOIN countries c ON m.country_id = c.id
    WHERE m.id = ?
  `).get(req.merchant.id);

  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants/me/transactions (marchand connecté)
router.get('/me/transactions', requireMerchant, (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  let query = `
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status as client_current_status
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.merchant_id = ?
  `;
  const params = [req.merchant.id];
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  query += ' ORDER BY t.initiated_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE merchant_id = ?').get(req.merchant.id).c;
  res.json({ transactions, total });
});

// GET /api/v1/merchants/me/stats (marchand connecté)
router.get('/me/stats', requireMerchant, (req, res) => {
  const mid = req.merchant.id;
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_transactions,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_receives ELSE 0 END), 0) as total_received,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_rebate_amount ELSE 0 END), 0) as total_rebate_given,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
    FROM transactions WHERE merchant_id = ?
  `).get(mid);

  const byStatus = db.prepare(`
    SELECT client_loyalty_status, COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as volume
    FROM transactions WHERE merchant_id = ? AND status = 'completed'
    GROUP BY client_loyalty_status
  `).all(mid);

  res.json({ stats, byLoyaltyStatus: byStatus });
});

function sanitizeMerchant(m, includeKeys = false) {
  const base = {
    id: m.id, name: m.name, email: m.email, phone: m.phone,
    countryId: m.country_id, countryName: m.country_name, currency: m.currency,
    category: m.category, rebatePercent: m.rebate_percent, rebateMode: m.rebate_mode,
    settlementFrequency: m.settlement_frequency, webhookUrl: m.webhook_url,
    status: m.status, kycStatus: m.kyc_status, isActive: m.is_active,
    createdAt: m.created_at, updatedAt: m.updated_at,
  };
  if (includeKeys) {
    base.apiKeyPublic = m.api_key_public;
    base.sandboxKeyPublic = m.sandbox_key_public;
  }
  return base;
}

// POST /api/v1/merchants/register (self-service — crée un compte en attente)
router.post('/register', async (req, res) => {
  const { name, email, phone, country_id, category, rebate_percent, rebate_mode, webhook_url, website, password } = req.body;

  // Validation basique
  if (!name || !email || !phone || !country_id || !password) {
    return res.status(400).json({ error: 'name, email, phone, country_id et password sont requis' });
  }
  if (!email.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe: minimum 8 caractères' });

  const existing = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Un compte avec cet email existe déjà' });

  const id = uuidv4();
  const sandboxKeyPublic = `af_sandbox_pub_${uuidv4().replace(/-/g, '')}`;
  const sandboxKeySecret = `af_sandbox_sec_${uuidv4().replace(/-/g, '')}`;
  const apiKeyPublic = `af_pub_${uuidv4().replace(/-/g, '')}`;
  const apiKeySecret = `af_sec_${uuidv4().replace(/-/g, '')}`;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    db.prepare(`
      INSERT INTO merchants (
        id, name, email, phone, country_id, category,
        rebate_percent, rebate_mode, website,
        api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
        webhook_url, password_hash, status, kyc_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
    `).run(
      id, name, email, phone, country_id, category || 'general',
      parseFloat(rebate_percent) || 5, rebate_mode || 'cashback', website || null,
      apiKeyPublic, apiKeySecret, sandboxKeyPublic, sandboxKeySecret,
      webhook_url || null, passwordHash
    );
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email déjà utilisé' });
    throw e;
  }

  res.status(201).json({
    message: 'Demande d\'inscription reçue. Notre équipe validera votre compte sous 24-48h.',
    id,
  });
});

module.exports = router;
