'use strict';

/**
 * Worker d'expiration des transactions en attente.
 *
 * Selon le CDC §4.1.4 :
 * - Après TX_EXPIRY_MS (120s) sans confirmation → statut "expired"
 * - L'opérateur dispose d'un délai de vérification max de 10 minutes
 * - Ce worker tourne toutes les 30 secondes pour traiter les transactions expirées
 */

const db = require('../lib/db');
const { dispatchWebhook, WebhookEvents } = require('./webhook-dispatcher');
const { notifyPaymentFailed } = require('../lib/notifications');

/**
 * Expire les transactions pending dont expires_at est dépassé.
 * Dispatche un webhook payment.expired pour chaque transaction expirée.
 * @returns {Promise<number>} nombre de transactions expirées
 */
async function processExpiredTransactions() {
  const res = await db.query(
    `SELECT t.*, m.name AS merchant_name
     FROM transactions t
     JOIN merchants m ON m.id = t.merchant_id
     WHERE t.status = 'pending'
       AND t.expires_at IS NOT NULL
       AND t.expires_at <= NOW()
     LIMIT 100`
  );

  if (res.rows.length === 0) return 0;

  let expired = 0;
  for (const tx of res.rows) {
    await db.query(
      `UPDATE transactions SET status = 'expired', failure_reason = 'Transaction expirée (timeout opérateur)' WHERE id = $1`,
      [tx.id]
    );

    // Webhook payment.expired vers le marchand
    dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_EXPIRED, {
      transaction_id: tx.id,
      reference: tx.reference,
      amount: tx.gross_amount,
      currency: tx.currency,
      expired_at: new Date().toISOString(),
    }).catch(err => console.error('[expiry] webhook error:', err.message));

    // Notification SMS/Email si client connu
    if (tx.client_id && tx.payment_phone) {
      notifyPaymentFailed({
        client: { phone: tx.payment_phone },
        transaction: tx,
        errorMessage: 'Transaction expirée (timeout opérateur)',
      }).catch(() => {});
    }

    expired++;
  }

  if (expired > 0) {
    console.log(`[transaction-expiry] ${expired} transaction(s) expirée(s)`);
  }

  return expired;
}

module.exports = { processExpiredTransactions };
