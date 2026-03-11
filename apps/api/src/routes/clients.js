const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { requireAdmin, requireApiKey } = require('../middleware/auth');
const { evaluateClientStatus, applyStatusChange } = require('../lib/loyalty-engine');
const { validate } = require('../middleware/validate');
const { CreateClientSchema, UpdateLoyaltyStatusSchema, LookupClientSchema } = require('../config/schemas');

// POST /api/v1/clients - Créer un client (via API marchands ou admin)
router.post('/', validate(CreateClientSchema), async (req, res) => {
  const { full_name, phone, email, country_id, password } = req.body;

  const existing = db.prepare('SELECT id FROM clients WHERE phone = ?').get(phone);
  if (existing) return res.status(409).json({ error: 'Numéro de téléphone déjà enregistré' });

  const id = uuidv4();
  const afrikfidId = `AFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  db.prepare(`
    INSERT INTO clients (id, afrikfid_id, full_name, phone, email, country_id, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, afrikfidId, full_name, phone, email || null, country_id || null, passwordHash);

  // Créer le portefeuille
  db.prepare("INSERT INTO wallets (id, client_id) VALUES (?, ?)").run(uuidv4(), id);

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  res.status(201).json({ client: sanitizeClient(client) });
});

// GET /api/v1/clients (admin)
router.get('/', requireAdmin, (req, res) => {
  const { status, page = 1, limit = 20, q } = req.query;
  let query = `
    SELECT c.*, co.name as country_name, co.currency
    FROM clients c LEFT JOIN countries co ON c.country_id = co.id
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND c.loyalty_status = ?'; params.push(status); }
  if (q) { query += ' AND (c.full_name LIKE ? OR c.phone LIKE ? OR c.afrikfid_id LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (page - 1) * limit);

  const clients = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;

  res.json({ clients: clients.map(sanitizeClient), total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/clients/:id/profile
router.get('/:id/profile', (req, res) => {
  const client = db.prepare(`
    SELECT c.*, co.name as country_name, co.currency
    FROM clients c LEFT JOIN countries co ON c.country_id = co.id
    WHERE c.id = ? OR c.afrikfid_id = ?
  `).get(req.params.id, req.params.id);

  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const wallet = db.prepare('SELECT * FROM wallets WHERE client_id = ?').get(client.id);
  const txStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
    FROM transactions WHERE client_id = ? AND status = 'completed'
  `).get(client.id);

  res.json({
    client: sanitizeClient(client),
    wallet: wallet ? { balance: wallet.balance, totalEarned: wallet.total_earned, currency: wallet.currency } : null,
    stats: txStats,
  });
});

// GET /api/v1/clients/:id/wallet
router.get('/:id/wallet', (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ? OR afrikfid_id = ?').get(req.params.id, req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const wallet = db.prepare('SELECT * FROM wallets WHERE client_id = ?').get(client.id);
  if (!wallet) return res.status(404).json({ error: 'Portefeuille non trouvé' });

  const movements = db.prepare(`
    SELECT wm.*, t.reference as tx_reference
    FROM wallet_movements wm
    LEFT JOIN transactions t ON wm.transaction_id = t.id
    WHERE wm.wallet_id = ?
    ORDER BY wm.created_at DESC
    LIMIT 50
  `).all(wallet.id);

  res.json({ wallet: { ...wallet, movements } });
});

// GET /api/v1/clients/:id/transactions
router.get('/:id/transactions', (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ? OR afrikfid_id = ?').get(req.params.id, req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const { page = 1, limit = 20 } = req.query;
  const transactions = db.prepare(`
    SELECT t.*, m.name as merchant_name
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    WHERE t.client_id = ?
    ORDER BY t.initiated_at DESC
    LIMIT ? OFFSET ?
  `).all(client.id, parseInt(limit), (page - 1) * limit);

  const total = db.prepare('SELECT COUNT(*) as c FROM transactions WHERE client_id = ?').get(client.id).c;
  res.json({ transactions, total });
});

// PATCH /api/v1/clients/:id/status (admin)
router.patch('/:id/loyalty-status', requireAdmin, validate(UpdateLoyaltyStatusSchema), (req, res) => {
  const { status } = req.body;

  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  applyStatusChange(req.params.id, status);
  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json({ client: sanitizeClient(updated), message: 'Statut mis à jour' });
});

// POST /api/v1/clients/lookup (par marchands pour identifier un client avant paiement)
router.post('/lookup', requireApiKey, validate(LookupClientSchema), (req, res) => {
  const { phone, afrikfid_id } = req.body;

  let client = null;
  if (afrikfid_id) {
    client = db.prepare("SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.afrikfid_id = ? AND c.is_active = 1").get(afrikfid_id);
  } else if (phone) {
    client = db.prepare("SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.phone = ? AND c.is_active = 1").get(phone);
  }

  if (!client) return res.status(404).json({ error: 'Client non trouvé. Mode invité appliqué.' });

  const wallet = db.prepare('SELECT balance FROM wallets WHERE client_id = ?').get(client.id);

  // Calculer le taux de remise applicable
  const loyaltyConfig = db.prepare('SELECT * FROM loyalty_config WHERE status = ?').get(client.loyalty_status);

  res.json({
    found: true,
    client: {
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone,
      loyaltyStatus: client.loyalty_status,
      clientRebatePercent: loyaltyConfig ? loyaltyConfig.client_rebate_percent : 0,
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
    email: c.email,
    phone: c.phone,
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
