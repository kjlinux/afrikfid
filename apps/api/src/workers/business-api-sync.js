'use strict';

/**
 * Worker de synchronisation afrikid → business-api.
 *
 * Toutes les N minutes, on récupère les transactions `status=completed`
 * attachées à un client (afrikfid_id connu) et non encore poussées vers le SI
 * fidélité historique, puis on appelle POST /external/transactions (HMAC).
 *
 * L'idempotence est garantie par `reference_afrikid` (id de la transaction afrikid)
 * qui est UNIQUE côté Laravel.
 */

const db = require('../lib/db');
const afrikfidClient = require('../lib/afrikfid-client');

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;

async function syncPendingTransactions() {
  // Sélectionne les tx à synchroniser : completed, avec client, non synchronisées,
  // et qui n'ont pas atteint le plafond de retries.
  // Résoudre les marchands sans business_api_marchand_id (find-or-create côté fidelite-api)
  const unmapped = await db.query(`
    SELECT DISTINCT m.id, m.name, m.phone
    FROM merchants m
    JOIN transactions t ON t.merchant_id = m.id
    JOIN clients c ON c.id = t.client_id
    WHERE m.business_api_marchand_id IS NULL
      AND t.status = 'completed'
      AND c.afrikfid_id ~ '^2014[0-9]{8}$'
      AND t.payment_method != 'REWARD_POINTS'
    LIMIT 20
  `);
  for (const m of unmapped.rows) {
    try {
      const bapiId = await afrikfidClient.findOrCreateMarchand({
        afrikid_merchant_id: m.id,
        designation: m.name,
        telephone: m.phone || null,
      });
      if (bapiId) {
        await db.query('UPDATE merchants SET business_api_marchand_id = $1 WHERE id = $2', [bapiId, m.id]);
      }
    } catch { /* fail-open : on retentera au prochain cycle */ }
  }

  const { rows } = await db.query(`
    SELECT t.id, t.merchant_id, t.gross_amount, t.currency, t.completed_at, t.initiated_at,
           c.afrikfid_id, c.business_api_consommateur_id,
           m.business_api_marchand_id
    FROM transactions t
    JOIN clients c ON c.id = t.client_id
    JOIN merchants m ON m.id = t.merchant_id
    WHERE t.status = 'completed'
      AND t.business_api_synced_at IS NULL
      AND COALESCE(t.business_api_sync_attempts, 0) < $1
      AND c.afrikfid_id ~ '^2014[0-9]{8}$'
      AND m.business_api_marchand_id IS NOT NULL
      AND t.payment_method != 'REWARD_POINTS'
    ORDER BY t.completed_at ASC NULLS LAST, t.initiated_at ASC
    LIMIT $2
  `, [MAX_ATTEMPTS, BATCH_SIZE]);

  let ok = 0;
  let failed = 0;

  for (const tx of rows) {
    try {
      const result = await afrikfidClient.creditTransaction({
        numero: tx.afrikfid_id,
        montant_total_xof: Math.round(Number(tx.gross_amount) || 0),
        marchand_id: tx.business_api_marchand_id,
        reference_afrikid: tx.id,
        occurred_at: tx.completed_at || tx.initiated_at,
      });
      await db.query(`
        UPDATE transactions
           SET business_api_transaction_id = $1,
               business_api_points_awarded = $2,
               business_api_synced_at = NOW(),
               business_api_sync_error = NULL,
               business_api_sync_attempts = COALESCE(business_api_sync_attempts, 0) + 1
         WHERE id = $3
      `, [result?.transaction_id || null, result?.points_awarded || null, tx.id]);
      ok++;
    } catch (err) {
      const msg = (err && (err.data?.error || err.message)) || 'unknown_error';
      await db.query(`
        UPDATE transactions
           SET business_api_sync_error = $1,
               business_api_sync_attempts = COALESCE(business_api_sync_attempts, 0) + 1
         WHERE id = $2
      `, [String(msg).slice(0, 500), tx.id]);
      failed++;
    }
  }

  return { scanned: rows.length, ok, failed };
}

module.exports = { syncPendingTransactions };
