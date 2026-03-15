const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireApiKey, requireMerchant } = require('../middleware/auth');
const { calculateDistribution } = require('../lib/loyalty-engine');
const { decrypt, hashField } = require('../lib/crypto');

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
    : (await db.query("SELECT * FROM clients WHERE phone_hash = $1 AND is_active = TRUE", [hashField(phone)])).rows[0];

  if (!client) return res.json({ found: false });

  const loyaltyConfig = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [client.loyalty_status])).rows[0];
  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];

  res.json({
    found: true,
    client: {
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: decrypt(client.phone),
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
           m.api_key_public, m.api_key_secret,
           m.max_transaction_amount, m.daily_volume_limit, m.allow_guest_mode
    FROM payment_links pl
    JOIN merchants m ON pl.merchant_id = m.id
    WHERE pl.code = $1 AND pl.status = 'active'
  `, [req.params.code])).rows[0];

  if (!link) return res.status(404).json({ error: 'Lien invalide' });
  if (new Date(link.expires_at) < new Date()) return res.status(410).json({ error: 'Lien expiré' });
  if (link.uses_count >= link.max_uses) return res.status(410).json({ error: 'Lien déjà utilisé' });

  const { phone, payment_operator, payment_method, afrikfid_id, custom_amount } = req.body;
  const amount = link.amount || custom_amount;
  if (!amount) return res.status(400).json({ error: 'Montant requis' });

  const isCard = payment_method === 'card';
  if (!isCard && (!phone || !payment_operator)) {
    return res.status(400).json({ error: 'phone et payment_operator requis pour le paiement Mobile Money' });
  }

  // ── Vérification des seuils marchand ──────────────────────────────────────
  if (link.max_transaction_amount && parseFloat(amount) > parseFloat(link.max_transaction_amount)) {
    return res.status(400).json({
      error: 'AMOUNT_EXCEEDS_LIMIT',
      message: `Le montant dépasse la limite par transaction autorisée par ce marchand (${link.max_transaction_amount}).`,
    });
  }

  if (link.daily_volume_limit) {
    const today = new Date().toISOString().slice(0, 10);
    const dailyRes = await db.query(
      `SELECT COALESCE(SUM(gross_amount), 0) as daily_total FROM transactions WHERE merchant_id = $1 AND DATE(initiated_at) = $2 AND status != 'failed'`,
      [link.merchant_id, today]
    );
    const dailyTotal = parseFloat(dailyRes.rows[0].daily_total || 0);
    if (dailyTotal + parseFloat(amount) > parseFloat(link.daily_volume_limit)) {
      return res.status(400).json({
        error: 'DAILY_LIMIT_REACHED',
        message: 'La limite de volume journalier de ce marchand a été atteinte. Réessayez demain.',
      });
    }
  }

  let client = null;
  if (afrikfid_id) {
    client = (await db.query("SELECT * FROM clients WHERE afrikfid_id = $1 AND is_active = TRUE", [afrikfid_id])).rows[0];
  } else if (phone) {
    const { hashField } = require('../lib/crypto');
    client = (await db.query("SELECT * FROM clients WHERE phone_hash = $1 AND is_active = TRUE", [hashField(phone)])).rows[0];
  }

  // Mode invité interdit si allow_guest_mode = false
  if (!client && link.allow_guest_mode === false) {
    return res.status(403).json({
      error: 'GUEST_MODE_DISABLED',
      message: 'Ce marchand requiert une identification Afrik\'Fid pour payer. Créez ou connectez-vous à votre compte.',
    });
  }

  const loyaltyStatus = client ? client.loyalty_status : 'OPEN';
  // Invité sans compte → Y% = 0 (pas de remise)
  const effectiveLoyaltyStatus = client ? loyaltyStatus : null;
  const distribution = await calculateDistribution(amount, link.rebate_percent, effectiveLoyaltyStatus || 'OPEN');

  const txId = uuidv4();
  const reference = `PLK-${Date.now()}-${txId.slice(0, 6).toUpperCase()}`;
  const payMethod = isCard ? 'CARD' : 'MOBILE_MONEY';

  await db.query(`
    INSERT INTO transactions (
      id, reference, merchant_id, client_id,
      gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode,
      payment_method, payment_operator, payment_phone,
      currency, description, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
  `, [
    txId, reference, link.merchant_id, client ? client.id : null,
    // En cashback : le client paie le plein tarif, la remise est créditée sur son wallet après
    // En immédiate : la remise est déduite directement du montant payé
    amount, link.rebate_mode === 'cashback' ? amount : amount - distribution.clientRebateAmount,
    distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
    distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
    distribution.merchantReceives, loyaltyStatus, link.rebate_mode,
    payMethod, payment_operator || null, phone || null, link.currency, link.description,
    new Date(Date.now() + 120000).toISOString(),
  ]);

  await db.query('UPDATE payment_links SET uses_count = uses_count + 1 WHERE id = $1', [link.id]);
  if (link.uses_count + 1 >= link.max_uses) {
    await db.query("UPDATE payment_links SET status = 'used' WHERE id = $1", [link.id]);
  }

  // Paiement par carte : initier via CinetPay
  if (isCard) {
    try {
      const { initiateCardPayment } = require('../lib/adapters/cinetpay');
      const cardResult = await initiateCardPayment({
        transactionId: txId,
        reference,
        amount,
        currency: link.currency,
        customerName: client ? client.full_name : undefined,
        customerPhone: phone || undefined,
        description: link.description,
      });
      return res.json({
        transactionId: txId,
        reference,
        payment: { paymentUrl: cardResult.paymentUrl },
        message: 'Redirection vers la page de paiement sécurisée.',
      });
    } catch (err) {
      console.error('[payment-links/card]', err.message);
      return res.status(502).json({ error: 'Erreur lors de l\'initialisation du paiement carte. Réessayez.' });
    }
  }

  res.json({
    transactionId: txId,
    reference,
    transaction: { id: txId, reference },
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
