const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { requireAdmin, requireApiKey, requireClient } = require('../middleware/auth');
const { evaluateClientStatus, applyStatusChange } = require('../lib/loyalty-engine');
const { validate } = require('../middleware/validate');
const { CreateClientSchema, UpdateLoyaltyStatusSchema, LookupClientSchema } = require('../config/schemas');
const { encrypt, decrypt, hashField } = require('../lib/crypto');

// POST /api/v1/clients
router.post('/', validate(CreateClientSchema), async (req, res) => {
  const { full_name, phone, email, country_id, password } = req.body;

  const phoneHash = hashField(phone);
  const existing = await db.query('SELECT id FROM clients WHERE phone_hash = $1', [phoneHash]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Numéro de téléphone déjà enregistré' });

  const id = uuidv4();
  const afrikfidId = `AFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const encPhone = encrypt(phone);
  const encEmail = email ? encrypt(email) : null;
  const emailHash = email ? hashField(email) : null;

  await db.query(
    `INSERT INTO clients (id, afrikfid_id, full_name, phone, phone_hash, email, email_hash, country_id, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, afrikfidId, full_name, encPhone, phoneHash, encEmail, emailHash, country_id || null, passwordHash]
  );

  await db.query('INSERT INTO wallets (id, client_id) VALUES ($1, $2)', [uuidv4(), id]);

  const client = (await db.query('SELECT * FROM clients WHERE id = $1', [id])).rows[0];
  res.status(201).json({ client: sanitizeClient(client) });
});

// GET /api/v1/clients (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { status, page = 1, limit = 20, q } = req.query;
  let sql = `
    SELECT c.*, co.name as country_name, co.currency
    FROM clients c LEFT JOIN countries co ON c.country_id = co.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (status) { sql += ` AND c.loyalty_status = $${idx++}`; params.push(status); }
  if (q) {
    // phone et email sont chiffrés AES-256-GCM — recherche via leur hash HMAC-SHA256
    const qHash = hashField(q);
    sql += ` AND (c.full_name ILIKE $${idx++} OR c.phone_hash = $${idx++} OR c.email_hash = $${idx++} OR c.afrikfid_id ILIKE $${idx++})`;
    params.push(`%${q}%`, qHash, qHash, `%${q}%`);
  }

  sql += ` ORDER BY c.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const clients = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM clients')).rows[0].c);

  res.json({ clients: clients.map(sanitizeClient), total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/clients/:id/profile
router.get('/:id/profile', async (req, res) => {
  const result = await db.query(`
    SELECT c.*, co.name as country_name, co.currency
    FROM clients c LEFT JOIN countries co ON c.country_id = co.id
    WHERE c.id = $1 OR c.afrikfid_id = $1
  `, [req.params.id]);
  const client = result.rows[0];

  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const txStats = (await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total FROM transactions WHERE client_id = $1 AND status = 'completed'`,
    [client.id]
  )).rows[0];

  res.json({
    client: sanitizeClient(client),
    wallet: wallet ? { balance: wallet.balance, totalEarned: wallet.total_earned, currency: wallet.currency } : null,
    stats: txStats,
  });
});

// GET /api/v1/clients/:id/wallet
router.get('/:id/wallet', async (req, res) => {
  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  if (!wallet) return res.status(404).json({ error: 'Portefeuille non trouvé' });

  const movements = (await db.query(`
    SELECT wm.*, t.reference as tx_reference
    FROM wallet_movements wm
    LEFT JOIN transactions t ON wm.transaction_id = t.id
    WHERE wm.wallet_id = $1
    ORDER BY wm.created_at DESC
    LIMIT 50
  `, [wallet.id])).rows;

  res.json({ wallet: { ...wallet, movements } });
});

// GET /api/v1/clients/:id/transactions
router.get('/:id/transactions', async (req, res) => {
  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const { page = 1, limit = 20 } = req.query;
  const transactions = (await db.query(`
    SELECT t.*, m.name as merchant_name
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    WHERE t.client_id = $1
    ORDER BY t.initiated_at DESC
    LIMIT $2 OFFSET $3
  `, [client.id, parseInt(limit), (page - 1) * limit])).rows;

  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions WHERE client_id = $1', [client.id])).rows[0].c);
  res.json({ transactions, total });
});

// PATCH /api/v1/clients/:id/loyalty-status (admin)
router.patch('/:id/loyalty-status', requireAdmin, validate(UpdateLoyaltyStatusSchema), async (req, res) => {
  const { status } = req.body;

  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!clientRes.rows[0]) return res.status(404).json({ error: 'Client non trouvé' });

  await applyStatusChange(req.params.id, status);
  const updated = (await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id])).rows[0];
  res.json({ client: sanitizeClient(updated), message: 'Statut mis à jour' });
});

// DELETE /api/v1/clients/:id — RGPD droit à l'effacement (admin ou client lui-même)
router.delete('/:id', requireAdmin, async (req, res) => {
  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  if (client.anonymized_at) return res.status(400).json({ error: 'Client déjà anonymisé' });

  // Pseudonymisation RGPD : on remplace les données PII par des valeurs neutres
  const anonPhone = encrypt(`DELETED_${uuidv4()}`);
  const anonEmail = encrypt(`DELETED_${uuidv4()}`);
  const anonHash = hashField(`DELETED_${uuidv4()}`);

  await db.query(`
    UPDATE clients SET
      full_name = 'Utilisateur supprimé',
      phone = $1, phone_hash = $2,
      email = $3, email_hash = $2,
      password_hash = NULL,
      is_active = FALSE,
      anonymized_at = NOW(),
      updated_at = NOW()
    WHERE id = $4
  `, [anonPhone, anonHash, anonEmail, client.id]);

  // Log audit
  await db.query(`INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
    VALUES ($1, 'admin', $2, 'gdpr_anonymize', 'client', $3, $4)`,
    [uuidv4(), req.admin.id, client.id, req.ip]);

  res.json({ message: 'Données client anonymisées (RGPD). Les transactions historiques sont conservées à des fins comptables.', clientId: client.id });
});

// GET /api/v1/clients/:id/export — RGPD portabilité des données (admin)
router.get('/:id/export', requireAdmin, async (req, res) => {
  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const movements = (await db.query('SELECT * FROM wallet_movements WHERE wallet_id = $1 ORDER BY created_at DESC', [wallet?.id || ''])).rows;
  const transactions = (await db.query('SELECT id, reference, gross_amount, currency, status, initiated_at FROM transactions WHERE client_id = $1 ORDER BY initiated_at DESC', [client.id])).rows;

  const exportData = {
    exportedAt: new Date().toISOString(),
    client: {
      id: client.id,
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: decrypt(client.phone),
      email: decrypt(client.email),
      countryId: client.country_id,
      loyaltyStatus: client.loyalty_status,
      createdAt: client.created_at,
    },
    wallet: wallet ? { balance: wallet.balance, totalEarned: wallet.total_earned, currency: wallet.currency } : null,
    walletMovements: movements,
    transactions,
  };

  await db.query(`INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
    VALUES ($1, 'admin', $2, 'gdpr_export', 'client', $3, $4)`,
    [uuidv4(), req.admin.id, client.id, req.ip]);

  res.json(exportData);
});

// POST /api/v1/clients/lookup (marchands)
router.post('/lookup', requireApiKey, validate(LookupClientSchema), async (req, res) => {
  const { phone, afrikfid_id } = req.body;

  let clientRes;
  if (afrikfid_id) {
    clientRes = await db.query('SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.afrikfid_id = $1 AND c.is_active = TRUE', [afrikfid_id]);
  } else if (phone) {
    const ph = hashField(phone);
    clientRes = await db.query('SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.phone_hash = $1 AND c.is_active = TRUE', [ph]);
  }

  const client = clientRes && clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé. Mode invité appliqué.' });

  const wallet = (await db.query('SELECT balance FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const loyaltyConfig = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [client.loyalty_status])).rows[0];

  res.json({
    found: true,
    client: {
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone,
      loyaltyStatus: client.loyalty_status,
      clientRebatePercent: loyaltyConfig ? parseFloat(loyaltyConfig.client_rebate_percent) : 0,
      walletBalance: wallet ? wallet.balance : 0,
      currency: client.currency || 'XOF',
    },
  });
});

function sanitizeClient(c) {
  return {
    id: c.id,
    afrikfidId: c.afrikfid_id,
    fullName: c.full_name,
    email: decrypt(c.email),
    phone: decrypt(c.phone),
    countryId: c.country_id,
    countryName: c.country_name,
    loyaltyStatus: c.loyalty_status,
    statusSince: c.status_since,
    totalPurchases: c.total_purchases,
    totalAmount: c.total_amount,
    walletBalance: c.wallet_balance,
    isActive: c.is_active,
    createdAt: c.created_at,
  };
}

module.exports = router;
