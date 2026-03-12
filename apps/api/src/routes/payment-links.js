const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireApiKey, requireMerchant } = require('../middleware/auth');
const { calculateDistribution } = require('../lib/loyalty-engine');

// POST /api/v1/payment-links (marchand)
router.post('/', requireMerchant, async (req, res) => {
  const { amount, currency = 'XOF', description, expires_in_hours = 24, max_uses = 1 } = req.body;

  const id = uuidv4();
  const code = `PL-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + expires_in_hours * 3600 * 1000).toISOString();

  await db.query(
    `INSERT INTO payment_links (id, merchant_id, code, amount, currency, description, expires_at, max_uses) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, req.merchant.id, code, amount || null, currency, description || null, expiresAt, max_uses]
  );

  const link = (await db.query('SELECT * FROM payment_links WHERE id = $1', [id])).rows[0];
  const payUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pay/${code}`;

  res.status(201).json({ link, payUrl });
});

// GET /api/v1/payment-links (marchand)
router.get('/', requireMerchant, async (req, res) => {
  const links = (await db.query(
    'SELECT * FROM payment_links WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.merchant.id]
  )).rows;
  res.json({ links });
});

// GET /api/v1/payment-links/:code/info (public)
router.get('/:code/info', async (req, res) => {
  const result = await db.query(`
    SELECT pl.*, m.name as merchant_name, m.rebate_percent, m.rebate_mode
    FROM payment_links pl
    JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = $1 AND pl.status = 'active'
  `, [req.params.code]);
  const link = result.rows[0];

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

// POST /api/v1/payment-links/:code/identify-client (public)
router.post('/:code/identify-client', async (req, res) => {
  const link = (await db.query(`
    SELECT pl.*, m.rebate_percent, m.rebate_mode
    FROM payment_links pl JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = $1 AND pl.status = 'active'
  `, [req.params.code])).rows[0];

  if (!link) return res.status(404).json({ error: 'Lien invalide' });

  const { phone, afrikfid_id } = req.body;
  if (!phone && !afrikfid_id) return res.status(400).json({ found: false });

  const client = afrikfid_id
    ? (await db.query("SELECT * FROM clients WHERE afrikfid_id = $1 AND is_active = TRUE", [afrikfid_id])).rows[0]
    : (await db.query("SELECT * FROM clients WHERE phone = $1 AND is_active = TRUE", [phone])).rows[0];

  if (!client) return res.json({ found: false });

  const loyaltyConfig = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [client.loyalty_status])).rows[0];
  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];

  res.json({
    found: true,
    client: {
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone,
      loyaltyStatus: client.loyalty_status,
      clientRebatePercent: loyaltyConfig ? parseFloat(loyaltyConfig.client_rebate_percent) : 0,
      walletBalance: wallet ? wallet.balance : 0,
      currency: 'XOF',
    },
  });
});

// POST /api/v1/payment-links/:code/pay (public)
router.post('/:code/pay', async (req, res) => {
  const link = (await db.query(`
    SELECT pl.*, m.id as merchant_id, m.name as merchant_name, m.rebate_percent, m.rebate_mode,
           m.api_key_public, m.api_key_secret
    FROM payment_links pl
    JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = $1 AND pl.status = 'active'
  `, [req.params.code])).rows[0];

  if (!link) return res.status(404).json({ error: 'Lien invalide' });
  if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'Lien expiré' });
  if (link.uses_count >= link.max_uses) return res.status(410).json({ error: 'Lien déjà utilisé' });

  const { phone, payment_operator, afrikfid_id, custom_amount } = req.body;
  const amount = link.amount || custom_amount;
  if (!amount) return res.status(400).json({ error: 'Montant requis' });
  if (!phone || !payment_operator) return res.status(400).json({ error: 'phone et payment_operator requis' });

  let client = null;
  if (afrikfid_id) {
    client = (await db.query("SELECT * FROM clients WHERE afrikfid_id = $1 AND is_active = TRUE", [afrikfid_id])).rows[0];
  } else {
    client = (await db.query("SELECT * FROM clients WHERE phone = $1 AND is_active = TRUE", [phone])).rows[0];
  }

  const loyaltyStatus = client ? client.loyalty_status : 'OPEN';
  const distribution = await calculateDistribution(amount, link.rebate_percent, loyaltyStatus);

  const txId = uuidv4();
  const reference = `PLK-${Date.now()}-${txId.slice(0, 6).toUpperCase()}`;

  await db.query(`
    INSERT INTO transactions (
      id, reference, merchant_id, client_id,
      gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode,
      payment_method, payment_operator, payment_phone,
      currency, description, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'MOBILE_MONEY', $16, $17, $18, $19, $20)
  `, [
    txId, reference, link.merchant_id, client ? client.id : null,
    amount, amount - distribution.clientRebateAmount,
    distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
    distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
    distribution.merchantReceives, loyaltyStatus, link.rebate_mode,
    payment_operator, phone, link.currency, link.description,
    new Date(Date.now() + 120000).toISOString(),
  ]);

  await db.query('UPDATE payment_links SET uses_count = uses_count + 1 WHERE id = $1', [link.id]);
  if (link.uses_count + 1 >= link.max_uses) {
    await db.query("UPDATE payment_links SET status = 'used' WHERE id = $1", [link.id]);
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
router.delete('/:id', requireMerchant, async (req, res) => {
  const link = (await db.query('SELECT * FROM payment_links WHERE id = $1 AND merchant_id = $2', [req.params.id, req.merchant.id])).rows[0];
  if (!link) return res.status(404).json({ error: 'Lien non trouvé' });

  await db.query("UPDATE payment_links SET status = 'cancelled' WHERE id = $1", [req.params.id]);
  res.json({ message: 'Lien annulé' });
});

module.exports = router;
