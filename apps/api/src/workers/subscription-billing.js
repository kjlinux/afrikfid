'use strict';

/**
 * Worker Prélèvement Abonnements — CDC v3.0 §2.5
 *
 * Prélève mensuellement les frais d'abonnement de chaque marchand actif.
 * Le montant effectif tient compte du bonus recrutement Starter Boost (§2.6).
 * Cron : 2e du mois à 05h00 (après le success-fee du 1er)
 */

const { CronJob } = require('cron');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { calculateStarterBoostDiscount } = require('../lib/loyalty-engine');
const { notifyAdminAlert } = require('../lib/notifications');

/**
 * Calcule et enregistre le prélèvement mensuel pour un abonnement donné.
 * Retourne null si rien à facturer (0 FCFA, déjà facturé ce mois, inactif).
 */
async function billSubscription(sub) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  // Déjà facturé ce mois ?
  if (sub.last_billed_at) {
    const lastBilled = new Date(sub.last_billed_at);
    if (
      lastBilled.getFullYear() === now.getFullYear() &&
      lastBilled.getMonth() === now.getMonth()
    ) {
      return null; // déjà traité
    }
  }

  const baseFee = parseFloat(sub.base_monthly_fee) || 0;
  if (baseFee <= 0) return null; // pas de frais (Starter Plus / Growth / Premium sur devis = 0 dans la table)

  // Calcul réduction Starter Boost (CDC §2.6)
  let discountPercent = 0;
  let recruitedCount = 0;
  if (sub.package === 'STARTER_BOOST') {
    const boost = await calculateStarterBoostDiscount(sub.merchant_id);
    discountPercent = boost.discountPercent;
    recruitedCount  = boost.recruitedCount;
  }

  const effectiveAmount = Math.round(baseFee * (1 - discountPercent / 100));
  const paymentId = uuidv4();

  await db.query(
    `INSERT INTO subscription_payments
       (id, subscription_id, merchant_id, period_start, period_end,
        base_amount, discount_percent, effective_amount, recruited_clients_count,
        status, paid_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', NOW(), NOW())`,
    [
      paymentId, sub.id, sub.merchant_id,
      periodStart.toISOString().slice(0, 10),
      periodEnd.toISOString().slice(0, 10),
      baseFee, discountPercent, effectiveAmount, recruitedCount,
    ]
  );

  // Mettre à jour last_billed_at + effective_monthly_fee sur la subscription
  const nextBillingAt = new Date(now.getFullYear(), now.getMonth() + 1, 2);
  await db.query(
    `UPDATE subscriptions
     SET last_billed_at = NOW(),
         effective_monthly_fee = $1,
         next_billing_at = $2,
         billing_failure_count = 0,
         updated_at = NOW()
     WHERE id = $3`,
    [effectiveAmount, nextBillingAt.toISOString(), sub.id]
  );

  console.log(
    `[SUBSCRIPTION-BILLING] Marchand ${sub.merchant_id} — ${effectiveAmount} FCFA prélevé (base ${baseFee}, -${discountPercent}%, ${recruitedCount} clients recrutés)`
  );

  return { paymentId, merchantId: sub.merchant_id, effectiveAmount, discountPercent, recruitedCount };
}

async function runSubscriptionBilling() {
  console.log('[SUBSCRIPTION-BILLING] Début du cycle de prélèvement mensuel');

  const subs = await db.query(
    `SELECT s.*, m.package
     FROM subscriptions s
     JOIN merchants m ON m.id = s.merchant_id
     WHERE s.status = 'active'
       AND m.status = 'active'
       AND m.is_active = TRUE`
  );

  const results  = [];
  const failures = [];

  for (const sub of subs.rows) {
    try {
      const result = await billSubscription(sub);
      if (result) results.push(result);
    } catch (err) {
      console.error(`[SUBSCRIPTION-BILLING] Erreur marchand ${sub.merchant_id}:`, err.message);

      // Incrémenter le compteur d'échecs
      await db.query(
        `UPDATE subscriptions
         SET billing_failure_count = billing_failure_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [sub.id]
      );

      failures.push({ merchantId: sub.merchant_id, error: err.message });
    }
  }

  if (failures.length > 0) {
    notifyAdminAlert(
      `[Prélèvements abonnements] ${failures.length} échec(s) sur ${subs.rows.length} abonnements. ` +
      `Marchands: ${failures.map(f => f.merchantId).join(', ')}`
    ).catch(() => {});
  }

  console.log(
    `[SUBSCRIPTION-BILLING] Terminé — ${results.length} prélèvements effectués, ${failures.length} échec(s)`
  );
  return { results, failures };
}

let job;

function start() {
  if (process.env.NODE_ENV === 'test') return;

  // Cron : 2e du mois à 05h00 (après success-fee du 1er à 04h00)
  job = new CronJob('0 5 2 * *', async () => {
    try {
      await runSubscriptionBilling();
    } catch (err) {
      console.error('[SUBSCRIPTION-BILLING] Erreur critique:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  console.log('[SUBSCRIPTION-BILLING] Cron mensuel programmé (2e du mois à 05h00)');
}

function stop() {
  if (job) job.stop();
}

module.exports = { start, stop, runSubscriptionBilling, billSubscription };
