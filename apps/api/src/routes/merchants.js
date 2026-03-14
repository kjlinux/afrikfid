const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { requireAdmin, requireMerchant, generateTokens } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { CreateMerchantSchema, UpdateMerchantSchema, MerchantLoginSchema } = require('../config/schemas');
const { encrypt, decrypt, hashField } = require('../lib/crypto');
const { notifyKycApproved, notifyKycRejected } = require('../lib/notifications');
const { kycUpload, toFileMetadata } = require('../lib/upload');

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

  const existing = await db.query('SELECT id FROM merchants WHERE email = $1', [email]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Email déjà utilisé' });

  const id = uuidv4();
  const apiKeyPublic = `af_pub_${uuidv4().replace(/-/g, '')}`;
  const apiKeySecret = `af_sec_${uuidv4().replace(/-/g, '')}`;
  const sandboxKeyPublic = `af_sandbox_pub_${uuidv4().replace(/-/g, '')}`;
  const sandboxKeySecret = `af_sandbox_sec_${uuidv4().replace(/-/g, '')}`;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const encBankAccount = bank_account ? encrypt(bank_account) : null;
  const bankAccountHash = bank_account ? hashField(bank_account) : null;

  await db.query(`
    INSERT INTO merchants (
      id, name, email, phone, country_id, category,
      rebate_percent, rebate_mode, business_registration, address, website,
      mm_operator, mm_phone, bank_name, bank_account, bank_account_hash,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      webhook_url, settlement_frequency, password_hash,
      status, kyc_status
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18, $19, $20,
      $21, $22, $23,
      'pending', 'pending'
    )
  `, [
    id, name, email, phone || null, country_id || null, category || 'general',
    rebate_percent, rebate_mode, business_registration || null, address || null, website || null,
    mm_operator || null, mm_phone || null, bank_name || null, encBankAccount, bankAccountHash,
    apiKeyPublic, apiKeySecret, sandboxKeyPublic, sandboxKeySecret,
    webhook_url || null, settlement_frequency, passwordHash,
  ]);

  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1', [id])).rows[0];
  res.status(201).json({ merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { status, country_id, page = 1, limit = 20, q } = req.query;
  let sql = 'SELECT m.*, c.name as country_name, c.currency FROM merchants m LEFT JOIN countries c ON m.country_id = c.id WHERE 1=1';
  const params = [];
  let idx = 1;

  if (status) { sql += ` AND m.status = $${idx++}`; params.push(status); }
  if (country_id) { sql += ` AND m.country_id = $${idx++}`; params.push(country_id); }
  if (q) { sql += ` AND (m.name ILIKE $${idx++} OR m.email ILIKE $${idx++})`; params.push(`%${q}%`, `%${q}%`); }

  sql += ` ORDER BY m.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const merchants = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM merchants')).rows[0].c);

  res.json({ merchants: merchants.map(m => sanitizeMerchant(m, false)), total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/merchants/:id (admin)
router.get('/:id', requireAdmin, async (req, res) => {
  const result = await db.query(`
    SELECT m.*, c.name as country_name, c.currency
    FROM merchants m LEFT JOIN countries c ON m.country_id = c.id
    WHERE m.id = $1
  `, [req.params.id]);
  const merchant = result.rows[0];

  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });
  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// PATCH /api/v1/merchants/:id (admin)
router.patch('/:id', requireAdmin, validate(UpdateMerchantSchema), async (req, res) => {
  const allowed = ['name', 'phone', 'rebate_percent', 'rebate_mode', 'status', 'kyc_status',
    'webhook_url', 'settlement_frequency', 'mm_operator', 'mm_phone', 'bank_name',
    'category', 'address', 'max_transaction_amount', 'daily_volume_limit', 'allow_guest_mode'];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  // Chiffrement bank_account séparé
  if (req.body.bank_account !== undefined) {
    updates.bank_account = req.body.bank_account ? encrypt(req.body.bank_account) : null;
    updates.bank_account_hash = req.body.bank_account ? hashField(req.body.bank_account) : null;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'EMPTY_UPDATE', message: 'Aucune donnée à mettre à jour' });

  updates.updated_at = new Date().toISOString();
  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(`UPDATE merchants SET ${setClause} WHERE id = $${keys.length + 1}`, [...Object.values(updates), req.params.id]);

  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1', [req.params.id])).rows[0];
  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants/:id/balance (admin)
router.get('/:id/balance', requireAdmin, async (req, res) => {
  const result = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_receives ELSE 0 END), 0) as total_earned,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
    FROM transactions WHERE merchant_id = $1
  `, [req.params.id]);

  res.json({ balance: result.rows[0] });
});

// GET /api/v1/merchants/:id/transactions (admin)
router.get('/:id/transactions', requireAdmin, async (req, res) => {
  const { page = 1, limit = 20, status, from, to } = req.query;
  let sql = `
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status as current_client_status
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.merchant_id = $1
  `;
  const params = [req.params.id];
  let idx = 2;

  if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
  if (from) { sql += ` AND t.initiated_at >= $${idx++}`; params.push(from); }
  if (to) { sql += ` AND t.initiated_at <= $${idx++}`; params.push(to); }

  sql += ` ORDER BY t.initiated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions WHERE merchant_id = $1', [req.params.id])).rows[0].c);

  res.json({ transactions, total });
});

// POST /api/v1/merchants/auth/login
router.post('/auth/login', validate(MerchantLoginSchema), async (req, res) => {
  const { email, password } = req.body;

  const result = await db.query('SELECT * FROM merchants WHERE email = $1 AND is_active = TRUE', [email]);
  const merchant = result.rows[0];
  if (!merchant || !merchant.password_hash) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  const tokens = generateTokens({ sub: merchant.id, role: 'merchant', email: merchant.email });
  res.json({ ...tokens, merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants/me/profile (marchand connecté)
router.get('/me/profile', requireMerchant, async (req, res) => {
  const result = await db.query(`
    SELECT m.*, c.name as country_name, c.currency
    FROM merchants m LEFT JOIN countries c ON m.country_id = c.id
    WHERE m.id = $1
  `, [req.merchant.id]);

  res.json({ merchant: sanitizeMerchant(result.rows[0], true) });
});

// GET /api/v1/merchants/me/transactions (marchand connecté)
router.get('/me/transactions', requireMerchant, async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  let sql = `
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status as client_current_status
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.merchant_id = $1
  `;
  const params = [req.merchant.id];
  let idx = 2;
  if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
  sql += ` ORDER BY t.initiated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions WHERE merchant_id = $1', [req.merchant.id])).rows[0].c);
  res.json({ transactions, total });
});

// GET /api/v1/merchants/me/stats (marchand connecté)
router.get('/me/stats', requireMerchant, async (req, res) => {
  const mid = req.merchant.id;
  const statsRes = await db.query(`
    SELECT
      COUNT(*) as total_transactions,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_receives ELSE 0 END), 0) as total_received,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_rebate_amount ELSE 0 END), 0) as total_rebate_given,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count
    FROM transactions WHERE merchant_id = $1
  `, [mid]);

  const byStatusRes = await db.query(`
    SELECT client_loyalty_status, COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as volume
    FROM transactions WHERE merchant_id = $1 AND status = 'completed'
    GROUP BY client_loyalty_status
  `, [mid]);

  res.json({ stats: statsRes.rows[0], byLoyaltyStatus: byStatusRes.rows });
});

// GET /api/v1/merchants/me/clients — Clients fidélisés du marchand (CDC §4.6.2)
router.get('/me/clients', requireMerchant, async (req, res) => {
  const { page = 1, limit = 20, loyalty_status } = req.query;
  const mid = req.merchant.id;

  let sql = `
    SELECT
      c.id as "clientId", c.afrikfid_id as "afrikfidId", c.full_name as "clientName",
      c.loyalty_status as "loyaltyStatus",
      COUNT(t.id) as "txCount",
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.gross_amount ELSE 0 END), 0) as "totalVolume",
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.client_rebate_amount ELSE 0 END), 0) as "totalRebates",
      MAX(t.initiated_at) as "lastTx"
    FROM clients c
    JOIN transactions t ON t.client_id = c.id AND t.merchant_id = $1
    WHERE c.is_active = TRUE
  `;
  const params = [mid];
  let idx = 2;

  if (loyalty_status) { sql += ` AND c.loyalty_status = $${idx++}`; params.push(loyalty_status); }

  sql += ` GROUP BY c.id, c.afrikfid_id, c.full_name, c.loyalty_status ORDER BY "totalVolume" DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const clients = (await db.query(sql, params)).rows;

  // Total + stats par statut
  const countSql = `
    SELECT COUNT(DISTINCT c.id) as total
    FROM clients c JOIN transactions t ON t.client_id = c.id AND t.merchant_id = $1
    WHERE c.is_active = TRUE ${loyalty_status ? `AND c.loyalty_status = $2` : ''}
  `;
  const countParams = loyalty_status ? [mid, loyalty_status] : [mid];
  const total = parseInt((await db.query(countSql, countParams)).rows[0].total);

  const byStatusRes = (await db.query(`
    SELECT c.loyalty_status, COUNT(DISTINCT c.id) as count
    FROM clients c JOIN transactions t ON t.client_id = c.id AND t.merchant_id = $1
    WHERE c.is_active = TRUE GROUP BY c.loyalty_status
  `, [mid])).rows;

  res.json({ clients, total, page: parseInt(page), limit: parseInt(limit), stats: { byStatus: byStatusRes } });
});

// POST /api/v1/merchants/me/kyc — Marchand soumet ses informations KYC (CDC §4.2.1)
// Accepte un multipart/form-data avec jusqu'à 5 fichiers (PDF, JPEG, PNG, WEBP)
// ET/OU un champ JSON "documents" pour les métadonnées textuelles
router.post('/me/kyc', requireMerchant, (req, res, next) => {
  // Multer gère l'upload des fichiers avant le handler principal
  kycUpload.array('files', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'UPLOAD_ERROR', message: err.message });
    }
    next();
  });
}, async (req, res) => {
  const merchant = (await db.query('SELECT kyc_status FROM merchants WHERE id = $1', [req.merchant.id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand introuvable' });
  if (merchant.kyc_status === 'approved') return res.status(400).json({ error: 'KYC déjà approuvé' });

  // Métadonnées textuelles (champ "documents" JSON ou champs individuels du formulaire)
  let textDocuments = {};
  if (req.body.documents) {
    try {
      textDocuments = typeof req.body.documents === 'string'
        ? JSON.parse(req.body.documents)
        : req.body.documents;
    } catch {
      textDocuments = {};
    }
  }

  // Fichiers uploadés
  const uploadedFiles = (req.files || []).map(toFileMetadata);

  // Fusionner métadonnées textuelles + fichiers uploadés
  const kycData = {
    ...textDocuments,
    files: uploadedFiles,
    submittedAt: new Date().toISOString(),
  };

  await db.query(
    `UPDATE merchants SET kyc_status = 'submitted', kyc_submitted_at = NOW(), kyc_documents = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(kycData), req.merchant.id]
  );

  res.json({
    message: 'Dossier KYC soumis. Notre équipe le traitera sous 24-48h.',
    kycStatus: 'submitted',
    filesUploaded: uploadedFiles.length,
  });
});

// PATCH /api/v1/merchants/:id/kyc/review — Admin approuve ou rejette le KYC
router.patch('/:id/kyc/review', requireAdmin, async (req, res) => {
  const { action, reason } = req.body;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: "action doit être 'approve' ou 'reject'" });
  }

  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1', [req.params.id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand introuvable' });
  if (merchant.kyc_status !== 'submitted') {
    return res.status(400).json({ error: `Statut KYC actuel: ${merchant.kyc_status}. Seul le statut 'submitted' peut être examiné.` });
  }

  const newKycStatus = action === 'approve' ? 'approved' : 'rejected';
  const newMerchantStatus = action === 'approve' ? 'active' : merchant.status;

  await db.query(
    `UPDATE merchants SET
       kyc_status = $1, kyc_reviewed_at = NOW(), kyc_reviewed_by = $2, kyc_rejection_reason = $3,
       status = $4, updated_at = NOW()
     WHERE id = $5`,
    [newKycStatus, req.admin.id, reason || null, newMerchantStatus, req.params.id]
  );

  // Notifier le marchand par email/SMS
  if (action === 'approve') {
    notifyKycApproved({ merchant });
  } else {
    notifyKycRejected({ merchant, reason });
  }

  res.json({ message: `KYC ${action === 'approve' ? 'approuvé' : 'rejeté'}`, kycStatus: newKycStatus, merchantStatus: newMerchantStatus });
});

// DELETE /api/v1/merchants/:id (admin — désactivation + suppression si aucune transaction)
router.delete('/:id', requireAdmin, async (req, res) => {
  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1', [req.params.id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });

  // Vérifier s'il y a des transactions
  const txCount = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions WHERE merchant_id = $1', [req.params.id])).rows[0].c);

  if (txCount > 0) {
    // Ne pas supprimer physiquement si des transactions existent — désactiver seulement
    await db.query(
      `UPDATE merchants SET status = 'suspended', is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    return res.json({ message: `Marchand désactivé (${txCount} transactions liées — suppression physique impossible).`, suspended: true });
  }

  // Suppression physique si aucune transaction
  await db.query('DELETE FROM payment_links WHERE merchant_id = $1', [req.params.id]);
  await db.query('DELETE FROM webhook_events WHERE merchant_id = $1', [req.params.id]);
  await db.query('DELETE FROM merchants WHERE id = $1', [req.params.id]);

  res.json({ message: 'Marchand supprimé définitivement.', deleted: true });
});

// POST /api/v1/merchants/register (self-service)
router.post('/register', async (req, res) => {
  const { name, email, phone, country_id, category, rebate_percent, rebate_mode, webhook_url, website, password } = req.body;

  if (!name || !email || !phone || !country_id || !password) {
    return res.status(400).json({ error: 'name, email, phone, country_id et password sont requis' });
  }
  if (!email.includes('@')) return res.status(400).json({ error: 'Email invalide' });
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe: minimum 8 caractères' });

  const existing = await db.query('SELECT id FROM merchants WHERE email = $1', [email]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Un compte avec cet email existe déjà' });

  const id = uuidv4();
  const sandboxKeyPublic = `af_sandbox_pub_${uuidv4().replace(/-/g, '')}`;
  const sandboxKeySecret = `af_sandbox_sec_${uuidv4().replace(/-/g, '')}`;
  const apiKeyPublic = `af_pub_${uuidv4().replace(/-/g, '')}`;
  const apiKeySecret = `af_sec_${uuidv4().replace(/-/g, '')}`;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await db.query(`
      INSERT INTO merchants (
        id, name, email, phone, country_id, category,
        rebate_percent, rebate_mode, website,
        api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
        webhook_url, password_hash, status, kyc_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending', 'pending')
    `, [
      id, name, email, phone, country_id, category || 'general',
      parseFloat(rebate_percent) || 5, rebate_mode || 'cashback', website || null,
      apiKeyPublic, apiKeySecret, sandboxKeyPublic, sandboxKeySecret,
      webhook_url || null, passwordHash,
    ]);
  } catch (e) {
    if (e.message?.includes('unique') || e.code === '23505') return res.status(409).json({ error: 'Email déjà utilisé' });
    throw e;
  }

  res.status(201).json({
    message: "Demande d'inscription reçue. Notre équipe validera votre compte sous 24-48h.",
    id,
  });
});

function sanitizeMerchant(m, includeKeys = false) {
  const base = {
    id: m.id, name: m.name, email: m.email, phone: m.phone,
    countryId: m.country_id, countryName: m.country_name, currency: m.currency,
    category: m.category, rebatePercent: m.rebate_percent, rebateMode: m.rebate_mode,
    settlementFrequency: m.settlement_frequency, webhookUrl: m.webhook_url,
    status: m.status, kycStatus: m.kyc_status, isActive: m.is_active,
    maxTransactionAmount: m.max_transaction_amount ?? null,
    dailyVolumeLimit: m.daily_volume_limit ?? null,
    allowGuestMode: m.allow_guest_mode !== false && m.allow_guest_mode !== 0,
    bankName: m.bank_name,
    createdAt: m.created_at, updatedAt: m.updated_at,
  };
  if (includeKeys) {
    base.apiKeyPublic = m.api_key_public;
    base.sandboxKeyPublic = m.sandbox_key_public;
    // Déchiffrer le RIB/IBAN pour l'affichage admin/marchand
    base.bankAccount = decrypt(m.bank_account);
  }
  return base;
}

// GET /api/v1/merchants/:id/kyc/files/:filename — Télécharger un fichier KYC (admin)
router.get('/:id/kyc/files/:filename', requireAdmin, async (req, res) => {
  const { getFileUrl, UPLOAD_DIR } = require('../lib/upload');
  const path = require('path');
  const fs = require('fs');

  const merchant = (await db.query('SELECT id, kyc_documents FROM merchants WHERE id = $1', [req.params.id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand introuvable' });

  const filename = path.basename(req.params.filename); // Sanitize — basename only
  const filePath = path.join(UPLOAD_DIR, merchant.id, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }

  // Vérifier que le fichier appartient bien au merchant (dans son dossier)
  const resolvedPath = fs.realpathSync(filePath);
  const expectedDir = fs.realpathSync(path.join(UPLOAD_DIR, merchant.id));
  if (!resolvedPath.startsWith(expectedDir)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  res.sendFile(resolvedPath);
});

// GET /api/v1/merchants/me/refunds (marchand connecté — CDC §4.6.2)
router.get('/me/refunds', requireMerchant, async (req, res) => {
  const { page = 1, limit = 20, status, refund_type } = req.query;
  let sql = `
    SELECT r.id, r.transaction_id, r.refund_type, r.amount, r.status, r.reason,
           r.created_at, r.processed_at,
           t.reference as transaction_reference, t.currency, t.gross_amount as original_amount,
           t.client_id, c.full_name as client_name, c.loyalty_status as client_status
    FROM refunds r
    JOIN transactions t ON r.transaction_id = t.id
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.merchant_id = $1
  `;
  const params = [req.merchant.id];
  let idx = 2;

  if (status) { sql += ` AND r.status = $${idx++}`; params.push(status); }
  if (refund_type) { sql += ` AND r.refund_type = $${idx++}`; params.push(refund_type); }

  const countSql = sql.replace(/SELECT r\.id.*FROM refunds r/, 'SELECT COUNT(*) as c FROM refunds r');
  const total = parseInt((await db.query(countSql, params)).rows[0]?.c || 0);

  sql += ` ORDER BY r.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const refunds = (await db.query(sql, params)).rows;
  res.json({ refunds, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── Taux X% par catégorie de produit (CDC §2.1) ──────────────────────────────

// GET /api/v1/merchants/:id/category-rates
router.get('/:id/category-rates', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const merchant = (await db.query('SELECT id FROM merchants WHERE id = $1', [id])).rows[0];
    if (!merchant) return res.status(404).json({ error: 'NOT_FOUND', message: 'Marchand introuvable' });

    const rates = (await db.query(
      'SELECT id, category, discount_rate, updated_at FROM merchant_category_rates WHERE merchant_id = $1 ORDER BY category',
      [id]
    )).rows;
    res.json({ merchant_id: id, category_rates: rates });
  } catch (err) { next(err); }
});

// PUT /api/v1/merchants/:id/category-rates/:category
router.put('/:id/category-rates/:category', requireAdmin, async (req, res, next) => {
  try {
    const { id, category } = req.params;
    const { discount_rate } = req.body;

    if (discount_rate === undefined || discount_rate === null) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'discount_rate requis' });
    }
    const rate = parseFloat(discount_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'discount_rate doit être entre 0 et 100' });
    }

    const merchant = (await db.query('SELECT id, rebate_percent FROM merchants WHERE id = $1', [id])).rows[0];
    if (!merchant) return res.status(404).json({ error: 'NOT_FOUND', message: 'Marchand introuvable' });

    const result = await db.query(
      `INSERT INTO merchant_category_rates (id, merchant_id, category, discount_rate, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (merchant_id, category) DO UPDATE SET discount_rate = $4, updated_at = NOW()
       RETURNING *`,
      [uuidv4(), id, category, rate]
    );
    res.json({ category_rate: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/v1/merchants/:id/category-rates/:category
router.delete('/:id/category-rates/:category', requireAdmin, async (req, res, next) => {
  try {
    const { id, category } = req.params;
    const result = await db.query(
      'DELETE FROM merchant_category_rates WHERE merchant_id = $1 AND category = $2 RETURNING id',
      [id, category]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Taux catégorie introuvable' });
    }
    res.json({ message: 'Taux catégorie supprimé' });
  } catch (err) { next(err); }
});

module.exports = router;
