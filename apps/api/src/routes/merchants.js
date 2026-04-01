const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { requireAdmin, requireMerchant, generateTokens } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { CreateMerchantSchema, UpdateMerchantSchema, MerchantLoginSchema } = require('../config/schemas');
const { encrypt, decrypt, hashField } = require('../lib/crypto');
const {
  notifyKycApproved, notifyKycRejected,
  notifyMerchantWelcome, notifyRefundApproved, notifyRefundRejected, notifyAccountSuspended,
} = require('../lib/notifications');
const { kycUpload, toFileMetadata } = require('../lib/upload');
const { requirePackage } = require('../middleware/require-package');
const { generateInsights } = require('../lib/ai-insights');

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

  // Si aucun mot de passe fourni par l'admin, en générer un temporaire aléatoire
  const tempPassword = !password
    ? `Afk-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    : null;
  const finalPassword = password || tempPassword;
  const passwordHash = await bcrypt.hash(finalPassword, 10);

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

  // Notifier le marchand avec ses credentials — awaité pour détecter un échec d'envoi
  let emailSent = true;
  try {
    await notifyMerchantWelcome({
      merchant: { ...merchant, phone: phone || null, sandbox_key_public: sandboxKeyPublic },
      tempPassword, // null si l'admin a fourni un password
      createdByAdmin: true,
    });
  } catch {
    emailSent = false;
  }

  res.status(201).json({
    merchant: sanitizeMerchant(merchant, true),
    ...(tempPassword && { tempPassword, note: 'Mot de passe temporaire généré — conserver cette valeur en cas d\'échec email' }),
    ...(!emailSent && { emailWarning: "L'email de bienvenue n'a pas pu être envoyé. Communiquer le tempPassword manuellement au marchand." }),
  });
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

// GET /api/v1/merchants/:id (admin) — exclure les routes /me/*
router.get('/:id', (req, res, next) => { if (req.params.id === 'me') return next('route'); next() }, requireAdmin, async (req, res) => {
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
router.patch('/:id', (req, res, next) => { if (req.params.id === 'me') return next('route'); next() }, requireAdmin, validate(UpdateMerchantSchema), async (req, res) => {
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
  if (updates.status === 'suspended') {
    notifyAccountSuspended({ merchant, reason: req.body.suspension_reason || null });
  }
  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// GET /api/v1/merchants/:id/balance (admin)
router.get('/:id/balance', (req, res, next) => { if (req.params.id === 'me') return next('route'); next() }, requireAdmin, async (req, res) => {
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
router.get('/:id/transactions', (req, res, next) => { if (req.params.id === 'me') return next('route'); next() }, requireAdmin, async (req, res) => {
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

// POST /api/v1/merchants/auth/login — déprécié, redirige vers la route canonique sécurisée
// La route canonique avec 2FA, lockout Redis et rate limiting est : POST /api/v1/auth/merchant/login
router.post('/auth/login', (req, res) => {
  res.status(301).json({
    error: 'MOVED',
    message: "Cette route est dépréciée. Utilisez POST /api/v1/auth/merchant/login (authentification sécurisée avec 2FA et protection anti-brute force).",
    location: '/api/v1/auth/merchant/login',
  });
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
  const { page = 1, limit = 20, status, sandbox } = req.query;
  const isSandboxView = sandbox === 'true';
  let sql = `
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status as client_current_status,
      rs.segment as client_rfm_segment
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN LATERAL (
      SELECT segment FROM rfm_scores WHERE client_id = c.id AND merchant_id = $1 ORDER BY calculated_at DESC LIMIT 1
    ) rs ON TRUE
    WHERE t.merchant_id = $1 AND t.is_sandbox = $2
  `;
  const params = [req.merchant.id, isSandboxView];
  let idx = 3;
  if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
  sql += ` ORDER BY t.initiated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions WHERE merchant_id = $1 AND is_sandbox = $2', [req.merchant.id, isSandboxView])).rows[0].c);
  res.json({ transactions, total, isSandbox: isSandboxView });
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
    FROM transactions WHERE merchant_id = $1 AND is_sandbox = FALSE
  `, [mid]);

  const byStatusRes = await db.query(`
    SELECT client_loyalty_status, COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as volume
    FROM transactions WHERE merchant_id = $1 AND status = 'completed' AND is_sandbox = FALSE
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
      MAX(t.initiated_at) as "lastTx",
      rs.segment as "rfmSegment",
      at2.current_step as "abandonStep",
      at2.status as "abandonStatus"
    FROM clients c
    JOIN transactions t ON t.client_id = c.id AND t.merchant_id = $1 AND t.is_sandbox = FALSE
    LEFT JOIN rfm_scores rs ON rs.client_id = c.id AND rs.merchant_id = $1
    LEFT JOIN abandon_tracking at2 ON at2.client_id = c.id AND at2.merchant_id = $1
    WHERE c.is_active = TRUE
  `;
  const params = [mid];
  let idx = 2;

  if (loyalty_status) { sql += ` AND c.loyalty_status = $${idx++}`; params.push(loyalty_status); }

  sql += ` GROUP BY c.id, c.afrikfid_id, c.full_name, c.loyalty_status, rs.segment, at2.current_step, at2.status ORDER BY "totalVolume" DESC LIMIT $${idx++} OFFSET $${idx++}`;
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

// PATCH /api/v1/merchants/me/settings — Marchand modifie ses propres paramètres (CDC §4.2.2)
// Seuls les champs autorisés au marchand : webhook_url, rebate_mode, allow_guest_mode
router.patch('/me/settings', requireMerchant, async (req, res) => {
  const allowed = ['webhook_url', 'rebate_mode', 'allow_guest_mode'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'EMPTY_UPDATE', message: 'Aucun paramètre modifiable fourni' });
  }
  updates.updated_at = new Date().toISOString();
  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(`UPDATE merchants SET ${setClause} WHERE id = $${keys.length + 1}`, [...Object.values(updates), req.merchant.id]);
  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1', [req.merchant.id])).rows[0];
  res.json({ merchant: sanitizeMerchant(merchant, true) });
});

// POST /api/v1/merchants/me/reveal-secret — Révéler la clé secrète (mot de passe requis)
router.post('/me/reveal-secret', requireMerchant, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });

  const result = await db.query('SELECT password_hash, api_key_secret, sandbox_key_secret, kyc_status FROM merchants WHERE id = $1', [req.merchant.id]);
  const merchant = result.rows[0];

  if (merchant.kyc_status !== 'approved') {
    return res.status(403).json({ error: 'KYC_REQUIRED', message: 'Votre KYC doit être approuvé pour accéder aux clés API de production.' });
  }

  if (!merchant.password_hash) return res.status(400).json({ error: 'Aucun mot de passe défini sur ce compte' });

  const valid = await bcrypt.compare(password, merchant.password_hash);
  if (!valid) return res.status(401).json({ error: 'Mot de passe incorrect' });

  res.json({ apiKeySecret: merchant.api_key_secret, sandboxKeySecret: merchant.sandbox_key_secret });
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
router.delete('/:id', (req, res, next) => { if (req.params.id === 'me') return next('route'); next() }, requireAdmin, async (req, res) => {
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
router.post('/register', async (req, res, next) => {
  try {
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

    notifyMerchantWelcome({ merchant: { name, email, sandbox_key_public: sandboxKeyPublic } });
    res.status(201).json({
      message: "Demande d'inscription reçue. Notre équipe validera votre compte sous 24-48h.",
      id,
    });
  } catch (err) {
    next(err);
  }
});

function sanitizeMerchant(m, includeKeys = false) {
  const base = {
    id: m.id, name: m.name, email: m.email, phone: m.phone,
    countryId: m.country_id, countryName: m.country_name, currency: m.currency,
    category: m.category, rebatePercent: m.rebate_percent, rebateMode: m.rebate_mode,
    settlementFrequency: m.settlement_frequency, webhookUrl: m.webhook_url,
    status: m.status, kycStatus: m.kyc_status, isActive: m.is_active,
    kycSubmittedAt: m.kyc_submitted_at,
    kycReviewedAt: m.kyc_reviewed_at,
    kycRejectionReason: m.kyc_rejection_reason,
    kycDocuments: m.kyc_documents
      ? (typeof m.kyc_documents === 'string' ? JSON.parse(m.kyc_documents) : m.kyc_documents)
      : null,
    maxTransactionAmount: m.max_transaction_amount ?? null,
    dailyVolumeLimit: m.daily_volume_limit ?? null,
    allowGuestMode: m.allow_guest_mode !== false && m.allow_guest_mode !== 0,
    bankName: m.bank_name,
    createdAt: m.created_at, updatedAt: m.updated_at,
  };
  if (includeKeys) {
    base.apiKeyPublic = m.api_key_public;
    base.sandboxKeyPublic = m.sandbox_key_public;
    // Déchiffrer le RIB/IBAN pour l'affichage admin/marchand — try/catch si clé changée
    try {
      base.bankAccount = m.bank_account ? decrypt(m.bank_account) : null;
    } catch {
      base.bankAccount = null; // clé de chiffrement changée ou données corrompues
    }
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

// PATCH /api/v1/merchants/me/refunds/:refundId — Approuver ou rejeter une demande client
router.patch('/me/refunds/:refundId', requireMerchant, async (req, res) => {
  const { action, note } = req.body; // action: 'approve' | 'reject'
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action doit être approve ou reject' });
  }

  const refund = (await db.query(`
    SELECT r.*, t.merchant_id, t.gross_amount, t.currency, t.client_id, t.rebate_mode,
           t.merchant_rebate_amount, t.client_rebate_amount, t.platform_commission_amount
    FROM refunds r JOIN transactions t ON r.transaction_id = t.id
    WHERE r.id = $1 AND t.merchant_id = $2 AND r.status = 'pending'
  `, [req.params.refundId, req.merchant.id])).rows[0];

  if (!refund) return res.status(404).json({ error: 'Demande non trouvée ou déjà traitée' });

  if (action === 'reject') {
    await db.query("UPDATE refunds SET status = 'rejected', processed_at = NOW() WHERE id = $1", [refund.id]);
    if (refund.client_id) {
      const clientRow = (await db.query('SELECT * FROM clients WHERE id = $1', [refund.client_id])).rows[0];
      if (clientRow) {
        const { decrypt } = require('../lib/crypto');
        notifyRefundRejected({
          client: { ...clientRow, phone: decrypt(clientRow.phone), email: clientRow.email ? decrypt(clientRow.email) : null },
          refund: { ...refund, amount: refund.gross_amount, currency: refund.currency || 'XOF' },
          merchantName: req.merchant.name,
        });
      }
    }
    return res.json({ message: 'Demande de remboursement rejetée' });
  }

  // Approuver : exécuter le remboursement complet
  const { v4: uuidv4 } = require('uuid');
  const grossAmount = parseFloat(refund.gross_amount);
  const merchantRebateRefunded = parseFloat(refund.merchant_rebate_amount);
  const clientRebateRefunded = parseFloat(refund.client_rebate_amount);
  const platformCommissionRefunded = parseFloat(refund.platform_commission_amount);

  await db.query(`
    UPDATE refunds SET status = 'completed', amount = $1,
      merchant_rebate_refunded = $2, client_rebate_refunded = $3,
      platform_commission_refunded = $4, refund_ratio = 1,
      processed_at = NOW() WHERE id = $5
  `, [grossAmount, merchantRebateRefunded, clientRebateRefunded, platformCommissionRefunded, refund.id]);

  // Annulation cashback client si applicable
  if (refund.rebate_mode === 'cashback' && refund.client_id && clientRebateRefunded > 0) {
    const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [refund.client_id])).rows[0];
    if (wallet) {
      const debit = Math.min(parseFloat(wallet.balance), clientRebateRefunded);
      if (debit > 0) {
        const newBalance = parseFloat(wallet.balance) - debit;
        await db.query('UPDATE wallets SET balance = $1, total_spent = total_spent + $2, updated_at = NOW() WHERE client_id = $3', [newBalance, debit, refund.client_id]);
        await db.query(
          `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description) VALUES ($1, $2, $3, 'debit', $4, $5, $6, $7)`,
          [uuidv4(), wallet.id, refund.transaction_id, debit, wallet.balance, newBalance, `Annulation cashback - remboursement approuvé`]
        );
      }
    }
  }

  await db.query("UPDATE transactions SET status = 'refunded' WHERE id = $1", [refund.transaction_id]);

  if (refund.client_id) {
    const clientRow = (await db.query('SELECT * FROM clients WHERE id = $1', [refund.client_id])).rows[0];
    if (clientRow) {
      const { decrypt } = require('../lib/crypto');
      notifyRefundApproved({
        client: { ...clientRow, phone: decrypt(clientRow.phone), email: clientRow.email ? decrypt(clientRow.email) : null },
        refund: { ...refund, amount: grossAmount, currency: refund.currency || 'XOF' },
        merchantName: req.merchant.name,
      });
    }
  }

  res.json({ message: 'Remboursement approuvé et exécuté' });
});

// ─── Taux X% par catégorie de produit  ──────────────────────────────

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

    // CDC §2.2 : le taux catégorie ne peut pas dépasser le taux X% du marchand → Z% resterait positif
    if (rate > parseFloat(merchant.rebate_percent)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Le taux catégorie (${rate}%) ne peut pas dépasser le taux X% du marchand (${merchant.rebate_percent}%) — CDC §2.2.`,
      });
    }

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

// GET /api/v1/merchants/me/subscription — Abonnement + bonus recrutement (CDC §2.5, §2.6)
router.get('/me/subscription', requireMerchant, async (req, res, next) => {
  try {
    const mid = req.merchant.id;
    const sub = (await db.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM subscription_payments WHERE subscription_id = s.id AND status = 'completed') as payments_done,
        (SELECT COALESCE(SUM(effective_amount), 0) FROM subscription_payments WHERE subscription_id = s.id AND status = 'completed') as total_paid
      FROM subscriptions s WHERE s.merchant_id = $1 AND s.status = 'active' LIMIT 1
    `, [mid])).rows[0] || null;

    const recentPayments = (await db.query(`
      SELECT * FROM subscription_payments WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 6
    `, [mid])).rows;

    res.json({ subscription: sub, recentPayments });
  } catch (err) { next(err); }
});

// GET /api/v1/merchants/me/success-fees — Success fees du marchand (CDC §3.5)
router.get('/me/success-fees', requireMerchant, async (req, res, next) => {
  try {
    const mid = req.merchant.id;
    const fees = (await db.query(`
      SELECT * FROM success_fees WHERE merchant_id = $1 ORDER BY period_start DESC LIMIT 12
    `, [mid])).rows;

    const kpis = (await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'paid' THEN fee_amount ELSE 0 END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN status = 'calculated' THEN fee_amount ELSE 0 END), 0) as pending,
        COALESCE(SUM(growth_amount), 0) as total_growth
      FROM success_fees WHERE merchant_id = $1
    `, [mid])).rows[0];

    res.json({ fees, kpis });
  } catch (err) { next(err); }
});

// GET /api/v1/merchants/me/rfm-summary — Résumé RFM et triggers (GROWTH+ — CDC §5.1, §5.4)
router.get('/me/rfm-summary', requireMerchant, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const mid = req.merchant.id;

    const segments = (await db.query(`
      SELECT segment,
        COUNT(*) as count,
        ROUND(COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) as pct
      FROM rfm_scores WHERE merchant_id = $1
      GROUP BY segment ORDER BY count DESC
    `, [mid])).rows;

    const triggerStats = (await db.query(`
      SELECT trigger_type, COUNT(*) as total,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as delivered
      FROM trigger_logs WHERE merchant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY trigger_type ORDER BY total DESC
    `, [mid])).rows;

    const abandonStats = (await db.query(`
      SELECT current_step, status, COUNT(*) as count
      FROM abandon_tracking WHERE merchant_id = $1
      GROUP BY current_step, status
    `, [mid])).rows;

    res.json({ segments, triggerStats, abandonStats });
  } catch (err) { next(err); }
});

// GET /api/v1/merchants/me/ai-insights — Recommandations IA (PREMIUM uniquement — CDC §6.3)
router.get('/me/ai-insights', requireMerchant, requirePackage('PREMIUM'), async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Le service IA n\'est pas configuré sur ce serveur.',
      });
    }
    const insights = await generateInsights(req.merchant.id);
    res.json(insights);
  } catch (err) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/v1/merchants/me/sandbox/docs
 * Documentation sandbox + guide d'intégration pour le marchand (CDC §6.3)
 * Retourne les endpoints, exemples de requêtes, clés sandbox et guide webhooks.
 */
router.get('/me/sandbox/docs', requireMerchant, async (req, res, next) => {
  try {
    const merchant = (await db.query(
      'SELECT id, name, sandbox_key_public, webhook_url, country_id FROM merchants WHERE id = $1',
      [req.merchant.id]
    )).rows[0];
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable' });

    const baseUrl = process.env.API_BASE_URL || `https://api.afrikfid.com`;
    const sandboxUrl = process.env.SANDBOX_API_URL || `https://sandbox-api.afrikfid.com`;
    const webhookTestUrl = `${baseUrl}/api/v1/merchants/me/sandbox/webhook-test`;

    res.json({
      merchant_id: merchant.id,
      merchant_name: merchant.name,
      sandbox: {
        base_url: sandboxUrl,
        api_key_public: merchant.sandbox_key_public,
        note: 'En mode sandbox, les paiements sont simulés. Aucun fonds réel n\'est débité.',
      },
      authentication: {
        method: 'API Key dans l\'en-tête X-API-Key',
        header: 'X-API-Key: <votre_clé_api>',
        example: `curl -H "X-API-Key: ${merchant.sandbox_key_public}" ${sandboxUrl}/api/v1/payments/initiate`,
      },
      endpoints: [
        {
          name: 'Initier un paiement',
          method: 'POST',
          url: `${sandboxUrl}/api/v1/payments/initiate`,
          description: 'Initie une transaction avec calcul automatique X/Y/Z',
          example_body: {
            amount: 10000,
            currency: 'XOF',
            payment_method: 'mobile_money',
            payment_operator: 'ORANGE',
            client_phone: '+22507000000',
            description: 'Achat test sandbox',
            idempotency_key: 'test-' + Date.now(),
          },
        },
        {
          name: 'Statut d\'une transaction',
          method: 'GET',
          url: `${sandboxUrl}/api/v1/payments/{transaction_id}/status`,
          description: 'Récupère le statut et le détail de répartition X/Y/Z',
        },
        {
          name: 'Confirmer un paiement (sandbox)',
          method: 'POST',
          url: `${sandboxUrl}/api/v1/sandbox/auto-confirm`,
          description: 'Confirme automatiquement un paiement pending (sandbox seulement)',
          example_body: { transaction_id: '<transaction_id>' },
        },
        {
          name: 'Profil client + statut fidélité',
          method: 'GET',
          url: `${sandboxUrl}/api/v1/clients/{client_id}/profile`,
          description: 'Statut fidélité, points statut, points récompense, portefeuille',
        },
        {
          name: 'Remboursement',
          method: 'POST',
          url: `${sandboxUrl}/api/v1/payments/{transaction_id}/refund`,
          example_body: { amount: 5000, reason: 'Client insatisfait' },
        },
      ],
      webhooks: {
        your_webhook_url: merchant.webhook_url || '(non configurée — configurez dans vos paramètres)',
        webhook_test_url: webhookTestUrl,
        events: [
          { event: 'payment.success', description: 'Paiement confirmé avec répartition X/Y/Z', trigger: 'POST /payments/initiate → confirmation opérateur' },
          { event: 'payment.failed', description: 'Paiement échoué', trigger: 'Après timeout ou refus opérateur' },
          { event: 'payment.expired', description: 'Transaction expirée après 120s', trigger: 'Cron expiry worker' },
          { event: 'refund.completed', description: 'Remboursement effectué', trigger: 'POST /payments/{id}/refund' },
          { event: 'loyalty.status_changed', description: 'Changement de statut fidélité client', trigger: 'Batch mensuel fidélité' },
          { event: 'distribution.completed', description: 'Distribution des fonds finalisée', trigger: 'Après paiement confirmé' },
        ],
        signature: {
          header: 'X-Webhook-Signature',
          method: 'HMAC-SHA256 du body JSON avec votre webhook_secret',
          verification: 'const sig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex"); assert(sig === req.headers["x-webhook-signature"])',
        },
      },
      quick_start: [
        '1. Copiez votre clé API sandbox (voir ci-dessus)',
        '2. Initiez un paiement test avec POST /payments/initiate',
        '3. Confirmez le paiement avec POST /sandbox/auto-confirm',
        '4. Configurez votre URL webhook dans vos paramètres',
        '5. Testez la réception webhook avec POST /merchants/me/sandbox/webhook-test',
        '6. En production, remplacez la clé sandbox par votre clé API de production',
      ],
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/merchants/me/sandbox/webhook-test
 * Envoie un webhook de test vers l'URL configurée (CDC §6.3 — "documentation sandbox")
 */
router.post('/me/sandbox/webhook-test', requireMerchant, async (req, res, next) => {
  try {
    const merchant = (await db.query(
      'SELECT id, name, webhook_url, webhook_secret FROM merchants WHERE id = $1',
      [req.merchant.id]
    )).rows[0];

    if (!merchant?.webhook_url) {
      return res.status(400).json({
        error: 'WEBHOOK_URL_NOT_SET',
        message: 'Configurez votre URL webhook dans vos paramètres avant de tester.',
      });
    }

    const crypto = require('crypto');
    const axios = require('axios');

    const event = req.body.event || 'payment.success';
    const payload = {
      event,
      merchant_id: merchant.id,
      sandbox: true,
      timestamp: new Date().toISOString(),
      data: req.body.data || {
        transaction_id: 'test-' + uuidv4(),
        amount: 10000,
        currency: 'XOF',
        status: 'completed',
        client_rebate_amount: 500,
        platform_commission_amount: 700,
        merchant_receives: 8800,
      },
    };

    const body = JSON.stringify(payload);
    const signature = merchant.webhook_secret
      ? crypto.createHmac('sha256', merchant.webhook_secret).update(body).digest('hex')
      : 'sandbox-no-secret';

    let deliveryResult;
    try {
      const response = await axios.post(merchant.webhook_url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Afrikfid-Event': event,
          'X-Sandbox': 'true',
        },
        timeout: 10000,
      });
      deliveryResult = { success: true, status: response.status, response: String(response.data).slice(0, 200) };
    } catch (httpErr) {
      deliveryResult = {
        success: false,
        status: httpErr.response?.status || null,
        error: httpErr.message,
      };
    }

    res.json({
      event,
      webhook_url: merchant.webhook_url,
      payload,
      signature,
      delivery: deliveryResult,
    });
  } catch (err) { next(err); }
});

module.exports = router;
