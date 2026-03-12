const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { calculateDistribution } = require('../lib/loyalty-engine');
const { requireApiKey } = require('../middleware/auth');
const mobileMoney = require('../lib/adapters/mobile-money');
const { validate } = require('../middleware/validate');
const { InitiatePaymentSchema, RefundSchema } = require('../config/schemas');
const { TX_EXPIRY_MS } = require('../config/constants');
const { dispatchWebhook, WebhookEvents } = require('../workers/webhook-dispatcher');
const { notifyPaymentConfirmed, notifyCashbackCredit, notifyPaymentFailed } = require('../lib/notifications');
const { checkTransaction } = require('../lib/fraud');
const { initiateCardPayment, checkPaymentStatus } = require('../lib/adapters/cinetpay');

// POST /api/v1/payments/initiate
router.post('/initiate', requireApiKey, validate(InitiatePaymentSchema), async (req, res) => {
  const {
    amount, currency, client_phone, client_afrikfid_id,
    payment_method, payment_operator, description, idempotency_key,
  } = req.body;

  // Idempotence
  if (idempotency_key) {
    const existing = (await db.query('SELECT * FROM transactions WHERE idempotency_key = $1', [idempotency_key])).rows[0];
    if (existing) return res.status(200).json({ message: 'Transaction existante', transaction: sanitizeTx(existing) });
  }

  const merchant = req.merchant;

  let client = null;
  if (client_afrikfid_id) {
    client = (await db.query("SELECT * FROM clients WHERE afrikfid_id = $1 AND is_active = TRUE", [client_afrikfid_id])).rows[0];
  } else if (client_phone) {
    client = (await db.query("SELECT * FROM clients WHERE phone = $1 AND is_active = TRUE", [client_phone])).rows[0];
  }

  const loyaltyStatus = client ? client.loyalty_status : 'OPEN';

  const fraudCheck = await checkTransaction({
    amount, clientId: client ? client.id : null, clientPhone: client_phone || null, merchantId: merchant.id,
  });
  if (fraudCheck.blocked) {
    return res.status(403).json({ error: 'FRAUD_BLOCKED', message: fraudCheck.reason, riskScore: fraudCheck.riskScore });
  }

  const distribution = await calculateDistribution(amount, merchant.rebate_percent, loyaltyStatus);

  if (distribution.yExceedsX) {
    return res.status(422).json({
      error: 'DISTRIBUTION_ERROR',
      message: `Taux client Y (${distribution.clientRebatePercent}%) supérieur au taux marchand X (${distribution.merchantRebatePercent}%). Anomalie de configuration.`,
    });
  }

  const txId = uuidv4();
  const reference = `AFD-${Date.now()}-${txId.slice(0, 8).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + TX_EXPIRY_MS).toISOString();

  await db.query(`
    INSERT INTO transactions (
      id, reference, merchant_id, client_id,
      gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode,
      payment_method, payment_operator, payment_phone,
      status, currency, description, idempotency_key, expires_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, 'pending', $19, $20, $21, $22
    )
  `, [
    txId, reference, merchant.id, client ? client.id : null,
    amount, distribution.grossAmount - distribution.clientRebateAmount,
    distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
    distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
    distribution.merchantReceives, loyaltyStatus, merchant.rebate_mode,
    payment_method, payment_operator || null, client_phone || null,
    currency, description || null, idempotency_key || null, expiresAt,
  ]);

  let mmResult = null;
  let cardResult = null;

  if (payment_method === 'card') {
    cardResult = await initiateCardPayment({
      transactionId: txId, reference, amount: distribution.grossAmount, currency,
      customerName: client ? client.full_name : undefined,
      customerPhone: client_phone || undefined, description,
    });

    if (!cardResult.success) {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [cardResult.message, txId]);
      return res.status(422).json({ error: cardResult.error, message: cardResult.message });
    }
    await db.query("UPDATE transactions SET operator_ref = $1 WHERE id = $2", [cardResult.cinetpayRef, txId]);

  } else if (['ORANGE', 'MTN', 'AIRTEL', 'MPESA', 'WAVE', 'MOOV'].includes((payment_operator || '').toUpperCase())) {
    const clientAmount = merchant.rebate_mode === 'immediate'
      ? distribution.grossAmount - distribution.clientRebateAmount
      : distribution.grossAmount;

    mmResult = await mobileMoney.initiatePayment({
      operator: payment_operator, phone: client_phone, amount: clientAmount,
      currency, reference, description,
    });

    if (!mmResult.success) {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [mmResult.message, txId]);
      notifyPaymentFailed({ client, transaction: { gross_amount: amount, currency, merchant_name: merchant.name }, errorMessage: mmResult.message });
      return res.status(422).json({ error: mmResult.error, message: mmResult.message });
    }
    await db.query("UPDATE transactions SET operator_ref = $1 WHERE id = $2", [mmResult.operatorRef, txId]);
  }

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1', [txId])).rows[0];

  res.status(201).json({
    transaction: sanitizeTx(tx),
    distribution: {
      grossAmount: amount,
      merchantRebatePercent: distribution.merchantRebatePercent,
      clientRebatePercent: distribution.clientRebatePercent,
      platformCommissionPercent: distribution.platformCommissionPercent,
      clientRebateAmount: distribution.clientRebateAmount,
      merchantReceives: distribution.merchantReceives,
      mode: merchant.rebate_mode,
    },
    client: client ? { afrikfidId: client.afrikfid_id, loyaltyStatus, fullName: client.full_name } : null,
    payment: mmResult || (cardResult ? { paymentUrl: cardResult.paymentUrl, type: 'card_redirect' } : null),
  });
});

// POST /api/v1/payments/card/notify (CinetPay webhook)
router.post('/card/notify', async (req, res) => {
  const { cpm_trans_id, cpm_site_id } = req.body;

  if (process.env.CINETPAY_SITE_ID && cpm_site_id !== process.env.CINETPAY_SITE_ID) {
    return res.status(403).json({ error: 'Site ID invalide' });
  }

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1', [cpm_trans_id])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'pending') return res.status(200).json({ message: 'Déjà traitée' });

  const statusCheck = await checkPaymentStatus(cpm_trans_id);

  if (statusCheck.success && statusCheck.status === 'ACCEPTED') {
    await processCompletedPayment(tx);
  } else if (statusCheck.status === 'REFUSED' || statusCheck.status === 'CANCELLED') {
    await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`CinetPay: ${statusCheck.status}`, tx.id]);
    dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: statusCheck.status }).catch(() => {});
  }

  res.status(200).json({ message: 'OK' });
});

// POST /api/v1/payments/:id/confirm (sandbox)
router.post('/:id/confirm', requireApiKey, async (req, res) => {
  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1 AND merchant_id = $2', [req.params.id, req.merchant.id])).rows[0];

  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'pending') return res.status(400).json({ error: `Statut actuel: ${tx.status}` });

  await processCompletedPayment(tx);

  const updated = (await db.query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
  res.json({ transaction: sanitizeTx(updated), message: 'Paiement confirmé et distribution effectuée' });
});

// GET /api/v1/payments/:id/status
router.get('/:id/status', requireApiKey, async (req, res) => {
  const tx = (await db.query(`
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.id = $1 AND t.merchant_id = $2
  `, [req.params.id, req.merchant.id])).rows[0];

  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });

  const distributions = (await db.query('SELECT * FROM distributions WHERE transaction_id = $1', [tx.id])).rows;

  res.json({
    transaction: sanitizeTx(tx),
    distributions,
    client: tx.client_name ? { fullName: tx.client_name, afrikfidId: tx.afrikfid_id, loyaltyStatus: tx.loyalty_status } : null,
  });
});

// POST /api/v1/payments/:id/refund
router.post('/:id/refund', requireApiKey, validate(RefundSchema), async (req, res) => {
  const { amount, reason, refund_type } = req.body;

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1 AND merchant_id = $2', [req.params.id, req.merchant.id])).rows[0];

  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'completed') return res.status(400).json({ error: 'Seules les transactions complétées peuvent être remboursées' });

  const refundAmount = refund_type === 'full' ? tx.gross_amount : (amount || tx.gross_amount);
  const refundId = uuidv4();

  await db.query(
    `INSERT INTO refunds (id, transaction_id, amount, refund_type, reason, status, initiated_by) VALUES ($1, $2, $3, $4, $5, 'processing', $6)`,
    [refundId, tx.id, refundAmount, refund_type, reason || null, req.merchant.id]
  );

  if (tx.rebate_mode === 'cashback' && tx.client_id && tx.client_rebate_amount > 0) {
    const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [tx.client_id])).rows[0];
    if (wallet && wallet.balance >= tx.client_rebate_amount) {
      const newBalance = parseFloat(wallet.balance) - parseFloat(tx.client_rebate_amount);
      await db.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE client_id = $2', [newBalance, tx.client_id]);
      await db.query(
        `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description) VALUES ($1, $2, $3, 'debit', $4, $5, $6, $7)`,
        [uuidv4(), wallet.id, tx.id, tx.client_rebate_amount, wallet.balance, newBalance, `Remboursement transaction ${tx.reference}`]
      );
    }
  }

  await db.query("UPDATE transactions SET status = 'refunded' WHERE id = $1", [tx.id]);
  await db.query("UPDATE refunds SET status = 'completed', processed_at = NOW() WHERE id = $1", [refundId]);

  dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_REFUNDED, { transactionId: tx.id, reference: tx.reference, refundAmount }).catch(() => {});

  res.json({ refundId, message: 'Remboursement effectué avec succès', amount: refundAmount });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function processCompletedPayment(tx) {
  const now = new Date().toISOString();
  const distId1 = uuidv4();
  const distId2 = uuidv4();
  const distId3 = uuidv4();

  await db.query(`
    INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, executed_at)
    VALUES ($1, $2, 'merchant', $3, $4, $5, 'completed', $6),
           ($7, $8, 'platform', 'afrikfid', $9, $10, 'completed', $11)
  `, [
    distId1, tx.id, tx.merchant_id, tx.merchant_receives, tx.currency, now,
    distId2, tx.id, tx.platform_commission_amount, tx.currency, now,
  ]);

  if (tx.client_id && tx.client_rebate_amount > 0) {
    if (tx.rebate_mode === 'cashback') {
      let wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [tx.client_id])).rows[0];
      if (!wallet) {
        const walletId = uuidv4();
        await db.query('INSERT INTO wallets (id, client_id, currency) VALUES ($1, $2, $3)', [walletId, tx.client_id, tx.currency]);
        wallet = (await db.query('SELECT * FROM wallets WHERE id = $1', [walletId])).rows[0];
      }
      const newBalance = parseFloat(wallet.balance) + parseFloat(tx.client_rebate_amount);
      await db.query(
        'UPDATE wallets SET balance = $1, total_earned = total_earned + $2, updated_at = NOW() WHERE id = $3',
        [newBalance, tx.client_rebate_amount, wallet.id]
      );
      await db.query(
        `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description) VALUES ($1, $2, $3, 'credit', $4, $5, $6, $7)`,
        [uuidv4(), wallet.id, tx.id, tx.client_rebate_amount, wallet.balance, newBalance, `Cashback - ${tx.reference}`]
      );
      await db.query(
        `INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, executed_at) VALUES ($1, $2, 'client_cashback', $3, $4, $5, 'completed', $6)`,
        [distId3, tx.id, tx.client_id, tx.client_rebate_amount, tx.currency, now]
      );
    }

    await db.query(
      `UPDATE clients SET total_purchases = total_purchases + 1, total_amount = total_amount + $1, updated_at = NOW() WHERE id = $2`,
      [tx.gross_amount, tx.client_id]
    );
  }

  await db.query("UPDATE transactions SET status = 'completed', completed_at = $1 WHERE id = $2", [now, tx.id]);

  const completedTx = (await db.query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
  dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_COMPLETED, sanitizeTx(completedTx)).catch(() => {});

  if (tx.client_id) {
    const client = (await db.query('SELECT * FROM clients WHERE id = $1', [tx.client_id])).rows[0];
    const distRow = { client_rebate_amount: tx.client_rebate_amount, client_rebate_percent: tx.client_rebate_percent };
    notifyPaymentConfirmed({ client, transaction: { ...completedTx, merchant_name: null }, distribution: distRow });
    notifyCashbackCredit({ client, transaction: completedTx, distribution: distRow });
  }
}

function sanitizeTx(tx) {
  return {
    id: tx.id,
    reference: tx.reference,
    status: tx.status,
    grossAmount: tx.gross_amount,
    currency: tx.currency,
    merchantRebatePercent: tx.merchant_rebate_percent,
    clientRebatePercent: tx.client_rebate_percent,
    platformCommissionPercent: tx.platform_commission_percent,
    clientRebateAmount: tx.client_rebate_amount,
    platformCommissionAmount: tx.platform_commission_amount,
    merchantReceives: tx.merchant_receives,
    rebateMode: tx.rebate_mode,
    clientLoyaltyStatus: tx.client_loyalty_status,
    paymentMethod: tx.payment_method,
    paymentOperator: tx.payment_operator,
    operatorRef: tx.operator_ref,
    description: tx.description,
    initiatedAt: tx.initiated_at,
    completedAt: tx.completed_at,
    expiresAt: tx.expires_at,
  };
}

module.exports = router;
module.exports.processCompletedPayment = processCompletedPayment;
