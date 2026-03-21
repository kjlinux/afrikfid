'use strict';

/**
 * Worker de disbursement automatique vers les marchands.
 *
 * Selon le CDC, chaque marchand a une fréquence de règlement :
 *   - 'daily'   : chaque jour à 06h00
 *   - 'weekly'  : chaque lundi à 06h00
 *   - 'monthly' : le 1er de chaque mois à 06h00
 *
 * Ce worker calcule pour chaque marchand éligible :
 *   1. Le montant cumulé des transactions complétées non encore réglées (merchant_receives)
 *   2. Crée un enregistrement dans disbursements avec statut 'pending'
 *   3. Tente le virement via mobile money ou marque pour virement manuel
 *   4. Émet un webhook distribution.completed
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { dispatchWebhook, WebhookEvents } = require('./webhook-dispatcher');
const { notifyDisbursementCompleted, notifyDisbursementFailed } = require('../lib/notifications');

/**
 * Détermine si un marchand est éligible au règlement maintenant
 * en fonction de sa settlement_frequency et du dernier disbursement.
 */
function isEligibleForDisbursement(merchant, lastDisbursementAt) {
  const now = new Date();
  const freq = merchant.settlement_frequency || 'daily';

  if (!lastDisbursementAt) return true; // Premier règlement

  const last = new Date(lastDisbursementAt);

  if (freq === 'daily') {
    // Éligible si le dernier règlement date d'au moins 23h
    return (now - last) >= 23 * 3600 * 1000;
  }
  if (freq === 'weekly') {
    // Éligible si lundi ET dernier règlement il y a plus de 6j
    return now.getDay() === 1 && (now - last) >= 6 * 24 * 3600 * 1000;
  }
  if (freq === 'monthly') {
    // Éligible si 1er du mois ET dernier règlement le mois précédent
    return now.getDate() === 1 && (last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear());
  }
  return false;
}

/**
 * Traite les règlements pour tous les marchands éligibles.
 * @returns {Promise<{processed: number, totalAmount: number}>}
 */
async function processDisbursements() {
  const merchants = (await db.query(`
    SELECT m.*, c.currency as country_currency
    FROM merchants m
    LEFT JOIN countries c ON m.country_id = c.id
    WHERE m.status = 'active' AND m.is_active = TRUE
  `)).rows;

  let processed = 0;
  let totalAmount = 0;

  for (const merchant of merchants) {
    try {
      // Récupérer le dernier disbursement effectué
      const lastDisbRes = await db.query(`
        SELECT MAX(created_at) as last_at FROM disbursements
        WHERE beneficiary_type = 'merchant' AND beneficiary_id = $1 AND status = 'completed'
      `, [merchant.id]);
      const lastDisbursementAt = lastDisbRes.rows[0]?.last_at || null;

      if (!isEligibleForDisbursement(merchant, lastDisbursementAt)) continue;

      // Calculer le montant non encore réglé — filtre sur disbursed_at IS NULL
      // (évite l'anti-pattern NOT IN avec NULLs qui exclurait toutes les lignes)
      const pendingRes = await db.query(`
        SELECT COALESCE(SUM(merchant_receives), 0) as amount,
               COUNT(*) as count, currency,
               ARRAY_AGG(id) as tx_ids
        FROM transactions
        WHERE merchant_id = $1
          AND status = 'completed'
          AND disbursed_at IS NULL
        GROUP BY currency
      `, [merchant.id]);

      for (const row of pendingRes.rows) {
        const amount = parseFloat(row.amount);
        if (amount <= 0) continue;

        const disbId = uuidv4();
        const currency = row.currency || merchant.country_currency || 'XOF';

        // Créer l'enregistrement de disbursement
        await db.query(`
          INSERT INTO disbursements (id, beneficiary_type, beneficiary_id, amount, currency, status, operator, created_at)
          VALUES ($1, 'merchant', $2, $3, $4, 'pending', $5, NOW())
        `, [disbId, merchant.id, amount, currency, merchant.mm_operator || 'manual']);

        // Si le marchand a un compte mobile money, tenter le virement automatique
        let disbStatus = 'pending_manual';
        let operatorRef = null;

        if (merchant.mm_phone && merchant.mm_operator) {
          try {
            const { disburseFunds } = require('../lib/adapters/mobile-money');
            const result = await disburseFunds({
              operator: merchant.mm_operator,
              phone: merchant.mm_phone,
              amount,
              currency,
              reference: `DISB-${disbId.slice(0, 8).toUpperCase()}`,
            });
            if (result.success) {
              disbStatus = 'completed';
              operatorRef = result.operatorRef;
            }
          } catch (payErr) {
            console.error(`[DISB] Payout failed for merchant ${merchant.id}:`, payErr.message);
            disbStatus = 'failed';
            notifyDisbursementFailed({ merchant, disbursement: { id: disbId, amount, currency }, errorMessage: payErr.message });
          }
        }

        await db.query(`
          UPDATE disbursements SET status = $1, operator_ref = $2, executed_at = NOW()
          WHERE id = $3
        `, [disbStatus, operatorRef, disbId]);

        // Marquer les transactions comme réglées pour éviter double-disbursement
        if (row.tx_ids && row.tx_ids.length > 0) {
          await db.query(
            `UPDATE transactions SET disbursed_at = NOW() WHERE id = ANY($1::text[])`,
            [row.tx_ids]
          );
        }

        // Notification email/SMS marchand
        if (disbStatus === 'completed') {
          notifyDisbursementCompleted({ merchant, disbursement: { id: disbId, amount, currency, operator_ref: operatorRef, operator: merchant.mm_operator, executed_at: new Date().toISOString() } });
        }

        // Webhook distribution.completed
        if (merchant.webhook_url) {
          dispatchWebhook(merchant.id, WebhookEvents.DISTRIBUTION_COMPLETED, {
            disbursement_id: disbId,
            amount,
            currency,
            status: disbStatus,
            operator: merchant.mm_operator || 'manual',
            operator_ref: operatorRef,
            executed_at: new Date().toISOString(),
          }).catch(() => {});
        }

        processed++;
        totalAmount += amount;
        console.log(`[DISB] Marchand ${merchant.name}: ${amount} ${currency} → ${disbStatus}`);
      }
    } catch (err) {
      console.error(`[DISB] Erreur pour marchand ${merchant.id}:`, err.message);
    }
  }

  return { processed, totalAmount };
}

/**
 * Règlement immédiat pour un marchand spécifique.
 * Appelé après chaque payment.success si settlement_frequency = 'instant'.
 * @param {string} merchantId
 * @param {string} [mode='instant'] - filtre sur settlement_frequency
 */
async function processDisbursementsForMerchant(merchantId, mode = 'instant') {
  const res = await db.query(`
    SELECT m.*, c.currency as country_currency
    FROM merchants m
    LEFT JOIN countries c ON m.country_id = c.id
    WHERE m.id = $1 AND m.status = 'active' AND m.is_active = TRUE AND m.settlement_frequency = $2
  `, [merchantId, mode]);

  const merchant = res.rows[0];
  if (!merchant) return; // Pas en mode instant, rien à faire

  // Réutilise la logique principale mais sans vérifier l'éligibilité temporelle
  // Filtre sur disbursed_at IS NULL (évite NOT IN avec NULLs)
  const pendingRes = await db.query(`
    SELECT COALESCE(SUM(merchant_receives), 0) as amount,
           COUNT(*) as count, currency,
           ARRAY_AGG(id) as tx_ids
    FROM transactions
    WHERE merchant_id = $1
      AND status = 'completed'
      AND disbursed_at IS NULL
    GROUP BY currency
  `, [merchantId]);

  for (const row of pendingRes.rows) {
    const amount = parseFloat(row.amount);
    if (amount <= 0) continue;

    const disbId = uuidv4();
    const currency = row.currency || merchant.country_currency || 'XOF';

    await db.query(`
      INSERT INTO disbursements (id, beneficiary_type, beneficiary_id, amount, currency, status, operator, created_at)
      VALUES ($1, 'merchant', $2, $3, $4, 'pending', $5, NOW())
    `, [disbId, merchantId, amount, currency, merchant.mm_operator || 'manual']);

    let disbStatus = 'pending_manual';
    let operatorRef = null;

    if (merchant.mm_phone && merchant.mm_operator) {
      try {
        const { disburseFunds } = require('../lib/adapters/mobile-money');
        const result = await disburseFunds({
          operator: merchant.mm_operator,
          phone: merchant.mm_phone,
          amount,
          currency,
          reference: `DISB-${disbId.slice(0, 8).toUpperCase()}`,
        });
        if (result.success) {
          disbStatus = 'completed';
          operatorRef = result.operatorRef;
        }
      } catch (payErr) {
        console.error(`[DISB/instant] Payout failed for merchant ${merchantId}:`, payErr.message);
        disbStatus = 'failed';
      }
    }

    await db.query(`
      UPDATE disbursements SET status = $1, operator_ref = $2, executed_at = NOW() WHERE id = $3
    `, [disbStatus, operatorRef, disbId]);

    // Marquer les transactions comme réglées pour éviter double-disbursement
    if (row.tx_ids && row.tx_ids.length > 0) {
      await db.query(
        `UPDATE transactions SET disbursed_at = NOW() WHERE id = ANY($1::text[])`,
        [row.tx_ids]
      );
    }

    if (merchant.webhook_url) {
      dispatchWebhook(merchantId, WebhookEvents.DISTRIBUTION_COMPLETED, {
        disbursement_id: disbId,
        amount,
        currency,
        status: disbStatus,
        operator: merchant.mm_operator || 'manual',
        operator_ref: operatorRef,
        executed_at: new Date().toISOString(),
      }).catch(() => {});
    }
  }
}

module.exports = { processDisbursements, processDisbursementsForMerchant };
