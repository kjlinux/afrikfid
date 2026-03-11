const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireApiKey, requireMerchant } = require('../middleware/auth');
const { calculateDistribution } = require('../lib/loyalty-engine');

// POST /api/v1/payment-links (marchand)
router.post('/', requireMerchant, (req, res) => {
  const { amount, currency = 'XOF', description, expires_in_hours = 24, max_uses = 1 } = req.body;

  const id = uuidv4();
  const code = `PL-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + expires_in_hours * 3600 * 1000).toISOString();

  db.prepare(`
    INSERT INTO payment_links (id, merchant_id, code, amount, currency, description, expires_at, max_uses)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.merchant.id, code, amount || null, currency, description || null, expiresAt, max_uses);

  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(id);
  const payUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pay/${code}`;

  res.status(201).json({ link, payUrl });
});

// GET /api/v1/payment-links (marchand)
router.get('/', requireMerchant, (req, res) => {
  const links = db.prepare(`
    SELECT * FROM payment_links WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.merchant.id);
  res.json({ links });
});

// GET /api/v1/payment-links/:code/info (public — page de paiement)
router.get('/:code/info', (req, res) => {
  const link = db.prepare(`
    SELECT pl.*, m.name as merchant_name, m.rebate_percent, m.rebate_mode
    FROM payment_links pl
    JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = ? AND pl.status = 'active'
  `).get(req.params.code);

  if (!link) return res.status(404).json({ error: 'Lien de paiement invalide ou expiré' });
  if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'Lien expiré' });
  if (link.uses_count >= link.max_uses) return res.status(410).json({ error: 'Lien déjà utilisé' });

  res.json({
    code: link.code,
    merchantName: link.merchant_name,
    amount: link.amount,
    currency: link.currency,
    description: link.description,
    expiresAt: link.expires_at,
    rebateMode: link.rebate_mode,
    operators: ['ORANGE', 'MTN', 'WAVE', 'AIRTEL', 'MOOV'],
  });
});

// POST /api/v1/payment-links/:code/identify-client (public — lookup client via lien)
router.post('/:code/identify-client', (req, res) => {
  const link = db.prepare(`
    SELECT pl.*, m.rebate_percent, m.rebate_mode
    FROM payment_links pl JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = ? AND pl.status = 'active'
  `).get(req.params.code);

  if (!link) return res.status(404).json({ error: 'Lien invalide' });

  const { phone, afrikfid_id } = req.body;
  if (!phone && !afrikfid_id) return res.status(400).json({ found: false });

  const client = afrikfid_id
    ? db.prepare("SELECT * FROM clients WHERE afrikfid_id = ? AND is_active = 1").get(afrikfid_id)
    : db.prepare("SELECT * FROM clients WHERE phone = ? AND is_active = 1").get(phone);

  if (!client) return res.json({ found: false });

  const loyaltyConfig = db.prepare("SELECT * FROM loyalty_config WHERE status = ?").get(client.loyalty_status);
  const wallet = db.prepare("SELECT * FROM wallets WHERE client_id = ?").get(client.id);

  res.json({
    found: true,
    client: {
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone,
      loyaltyStatus: client.loyalty_status,
      clientRebatePercent: loyaltyConfig ? loyaltyConfig.client_rebate_percent : 0,
      walletBalance: wallet ? wallet.balance : 0,
      currency: 'XOF',
    },
  });
});

// POST /api/v1/payment-links/:code/pay (public — déclenche le paiement via le lien)
router.post('/:code/pay', async (req, res) => {
  const link = db.prepare(`
    SELECT pl.*, m.id as merchant_id, m.name as merchant_name, m.rebate_percent, m.rebate_mode,
           m.api_key_public, m.api_key_secret
    FROM payment_links pl
    JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = ? AND pl.status = 'active'
  `).get(req.params.code);

  if (!link) return res.status(404).json({ error: 'Lien invalide' });
  if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'Lien expiré' });
  if (link.uses_count >= link.max_uses) return res.status(410).json({ error: 'Lien déjà utilisé' });

  const { phone, payment_operator, afrikfid_id, custom_amount } = req.body;
  const amount = link.amount || custom_amount;
  if (!amount) return res.status(400).json({ error: 'Montant requis' });
  if (!phone || !payment_operator) return res.status(400).json({ error: 'phone et payment_operator requis' });

  // Identifier le client
  let client = null;
  if (afrikfid_id) {
    client = db.prepare("SELECT * FROM clients WHERE afrikfid_id = ? AND is_active = 1").get(afrikfid_id);
  } else {
    client = db.prepare("SELECT * FROM clients WHERE phone = ? AND is_active = 1").get(phone);
  }

  const loyaltyStatus = client ? client.loyalty_status : 'OPEN';
  const distribution = calculateDistribution(amount, link.rebate_percent, loyaltyStatus);

  // Créer la transaction
  const txId = uuidv4();
  const reference = `PLK-${Date.now()}-${txId.slice(0, 6).toUpperCase()}`;

  db.prepare(`
    INSERT INTO transactions (
      id, reference, merchant_id, client_id,
      gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode,
      payment_method, payment_operator, payment_phone,
      currency, description, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MOBILE_MONEY', ?, ?, ?, ?, ?)
  `).run(
    txId, reference, link.merchant_id, client ? client.id : null,
    amount, amount - distribution.clientRebateAmount,
    distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
    distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
    distribution.merchantReceives, loyaltyStatus, link.rebate_mode,
    payment_operator, phone, link.currency, link.description,
    new Date(Date.now() + 120000).toISOString()
  );

  // Incrémenter le compteur du lien
  db.prepare("UPDATE payment_links SET uses_count = uses_count + 1 WHERE id = ?").run(link.id);
  if (link.uses_count + 1 >= link.max_uses) {
    db.prepare("UPDATE payment_links SET status = 'used' WHERE id = ?").run(link.id);
  }

  res.json({
    transactionId: txId,
    reference,
    distribution: {
      amount,
      clientPays: distribution.grossAmount - distribution.clientRebateAmount,
      clientRebate: distribution.clientRebateAmount,
      rebateMode: link.rebate_mode,
    },
    message: 'Paiement initié. Confirmez sur votre mobile.',
  });
});

// DELETE /api/v1/payment-links/:id (marchand)
router.delete('/:id', requireMerchant, (req, res) => {
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ? AND merchant_id = ?')
    .get(req.params.id, req.merchant.id);
  if (!link) return res.status(404).json({ error: 'Lien non trouvé' });

  db.prepare("UPDATE payment_links SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ message: 'Lien annulé' });
});

module.exports = router;
