'use strict';

/**
 * Worker d'expiration des transactions en attente.
 *
 * Selon le CDC §4.1.4 :
 * - Après TX_EXPIRY_MS (120s) sans confirmation → interroger l'opérateur
 * - Si toujours pending → setter retry_until = NOW() + 10min
 * - Toutes les 30s : re-interroger l'opérateur jusqu'à retry_until
 * - Après retry_until dépassé → expiration définitive + webhook payment.expired
 */

const db = require('../lib/db');
const { dispatchWebhook, WebhookEvents } = require('./webhook-dispatcher');
const { notifyTransactionExpired } = require('../lib/notifications');
const { checkPaymentStatus } = require('../lib/adapters/mobile-money');
const { TX_RETRY_WINDOW_MS } = require('../config/constants');
const { emit, SSE_EVENTS } = require('../lib/sse-emitter');

/**
 * Phase 1 : transactions pending dont expires_at est dépassé et sans retry_until
 * → interroger l'opérateur ; si toujours pending, ouvrir la fenêtre de retry 10min
 */
async function processInitialTimeouts() {
  const res = await db.query(
    `SELECT t.*, m.name AS merchant_name
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     WHERE t.status = 'pending'
       AND t.expires_at IS NOT NULL
       AND t.expires_at <= NOW()
       AND t.retry_until IS NULL
       AND t.payment_method != 'card'
     LIMIT 50`
  );

  for (const tx of res.rows) {
    let resolved = false;

    if (tx.operator_ref && tx.payment_operator) {
      try {
        const check = await checkPaymentStatus({ operatorRef: tx.operator_ref, operator: tx.payment_operator });
        if (check.status === 'completed') {
          const { processCompletedPayment } = require('../routes/payments');
          await processCompletedPayment(tx);
          resolved = true;
          console.log(`[expiry] TX ${tx.id} confirmée par opérateur ${tx.payment_operator}`);
        } else if (check.status === 'failed') {
          await db.query(
            `UPDATE transactions SET status = 'failed', failure_reason = $1, last_operator_check = NOW() WHERE id = $2`,
            [`Opérateur ${tx.payment_operator}: paiement échoué`, tx.id]
          );
          dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, {
            transaction_id: tx.id, reference: tx.reference,
          }).catch(() => {});
          resolved = true;
        }
      } catch (err) {
        console.error(`[expiry] checkPaymentStatus erreur TX ${tx.id}:`, err.message);
      }
    }

    if (!resolved) {
      const retryUntil = new Date(Date.now() + TX_RETRY_WINDOW_MS).toISOString();
      await db.query(
        `UPDATE transactions SET retry_until = $1, last_operator_check = NOW() WHERE id = $2`,
        [retryUntil, tx.id]
      );
    }
  }
}

/**
 * Phase 2a : transactions dont retry_until est dépassé → expiration définitive
 */
async function processExpiredRetry() {
  const now = new Date().toISOString();
  const res = await db.query(
    `SELECT t.*, m.name AS merchant_name
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     WHERE t.status = 'pending'
       AND t.retry_until IS NOT NULL
       AND t.retry_until <= NOW()
     LIMIT 50`
  );

  for (const tx of res.rows) {
    await db.query(
      `UPDATE transactions SET status = 'expired', failure_reason = 'Transaction expirée (timeout opérateur 10min)' WHERE id = $1`,
      [tx.id]
    );
    emit(SSE_EVENTS.PAYMENT_EXPIRED, {
      transactionId: tx.id, reference: tx.reference,
      merchantId: tx.merchant_id, status: 'expired',
      amount: tx.gross_amount, currency: tx.currency,
    });
    emit(SSE_EVENTS.TRANSACTION_STATUS, {
      transactionId: tx.id, status: 'expired',
      merchantId: tx.merchant_id,
    });
    dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_EXPIRED, {
      transaction_id: tx.id,
      reference: tx.reference,
      amount: tx.gross_amount,
      currency: tx.currency,
      expired_at: now,
    }).catch(err => console.error('[expiry] webhook error:', err.message));

    if (tx.client_id && tx.payment_phone) {
      notifyTransactionExpired({
        client: { phone: tx.payment_phone },
        transaction: tx,
      });
    }
  }

  return res.rows.length;
}

/**
 * Phase 2b : transactions en fenêtre de retry active → re-interroger l'opérateur (30s)
 */
async function processActiveRetry() {
  const res = await db.query(
    `SELECT t.*
     FROM transactions t
     WHERE t.status = 'pending'
       AND t.retry_until IS NOT NULL
       AND t.retry_until > NOW()
       AND t.payment_method != 'card'
       AND (t.last_operator_check IS NULL OR t.last_operator_check <= NOW() - INTERVAL '30 seconds')
     LIMIT 50`
  );

  for (const tx of res.rows) {
    if (!tx.operator_ref || !tx.payment_operator) continue;
    try {
      const check = await checkPaymentStatus({ operatorRef: tx.operator_ref, operator: tx.payment_operator });
      if (check.status === 'completed') {
        const { processCompletedPayment } = require('../routes/payments');
        await processCompletedPayment(tx);
        console.log(`[expiry] TX ${tx.id} confirmée par retry opérateur ${tx.payment_operator}`);
      } else if (check.status === 'failed') {
        await db.query(
          `UPDATE transactions SET status = 'failed', failure_reason = $1, last_operator_check = NOW() WHERE id = $2`,
          [`Opérateur ${tx.payment_operator}: paiement échoué`, tx.id]
        );
        dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, {
          transaction_id: tx.id, reference: tx.reference,
        }).catch(() => {});
      } else {
        await db.query(`UPDATE transactions SET last_operator_check = NOW() WHERE id = $1`, [tx.id]);
      }
    } catch (err) {
      console.error(`[expiry] retry check erreur TX ${tx.id}:`, err.message);
    }
  }
}

/**
 * Phase 3 : transactions carte pending > 10min → expirer directement
 * (les cartes sont gérées par webhook CinetPay/Flutterwave)
 */
async function processExpiredCardTransactions() {
  const res = await db.query(
    `SELECT t.merchant_id, t.id, t.reference, t.gross_amount, t.currency
     FROM transactions t
     WHERE t.status = 'pending'
       AND t.payment_method = 'card'
       AND t.expires_at IS NOT NULL
       AND t.expires_at <= NOW() - INTERVAL '10 minutes'
     LIMIT 50`
  );

  for (const tx of res.rows) {
    await db.query(
      `UPDATE transactions SET status = 'expired', failure_reason = 'Transaction carte expirée' WHERE id = $1`,
      [tx.id]
    );
    dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_EXPIRED, {
      transaction_id: tx.id, reference: tx.reference,
      amount: tx.gross_amount, currency: tx.currency,
      expired_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

async function processExpiredTransactions() {
  await Promise.all([
    processInitialTimeouts(),
    processActiveRetry(),
    processExpiredCardTransactions(),
  ]);
  return await processExpiredRetry();
}

module.exports = { processExpiredTransactions };
