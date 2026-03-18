/**
 * Worker Success Fee — CDC v3.0 §3.5
 * Calcul mensuel du success fee pour chaque marchand
 * Cron : 1er du mois à 04h00
 */
'use strict';

const { CronJob } = require('cron');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');

/**
 * Calcule le panier moyen de référence (3 premiers mois d'activité)
 */
async function calculateReferenceBasket(merchantId) {
  const merchant = (await db.query(
    'SELECT id, created_at, reference_avg_basket, reference_basket_calculated_at FROM merchants WHERE id = $1',
    [merchantId]
  )).rows[0];
  if (!merchant) return null;

  // Si déjà calculé, ne pas recalculer
  if (merchant.reference_basket_calculated_at) {
    return parseFloat(merchant.reference_avg_basket) || 0;
  }

  const threeMonthsAfterCreation = new Date(merchant.created_at);
  threeMonthsAfterCreation.setMonth(threeMonthsAfterCreation.getMonth() + 3);

  // Pas encore 3 mois d'activité
  if (new Date() < threeMonthsAfterCreation) return null;

  const res = await db.query(
    `SELECT COALESCE(AVG(gross_amount), 0) as avg_basket
     FROM transactions
     WHERE merchant_id = $1 AND status = 'completed' AND initiated_at <= $2`,
    [merchantId, threeMonthsAfterCreation.toISOString()]
  );
  const avgBasket = parseFloat(res.rows[0].avg_basket);

  await db.query(
    'UPDATE merchants SET reference_avg_basket = $1, reference_basket_calculated_at = NOW() WHERE id = $2',
    [avgBasket, merchantId]
  );

  return avgBasket;
}

/**
 * Calcule le success fee mensuel pour un marchand
 */
async function calculateSuccessFee(merchantId) {
  const merchant = (await db.query(
    'SELECT id, reference_avg_basket, success_fee_percent FROM merchants WHERE id = $1',
    [merchantId]
  )).rows[0];
  if (!merchant) return null;

  const refBasket = parseFloat(merchant.reference_avg_basket);
  if (!refBasket || refBasket <= 0) return null;

  const feePercent = parseFloat(merchant.success_fee_percent) || 3;

  // Période : mois précédent
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0); // dernier jour mois précédent
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);

  const res = await db.query(
    `SELECT COUNT(*) as tx_count, COALESCE(SUM(gross_amount), 0) as total_revenue,
            COALESCE(AVG(gross_amount), 0) as avg_basket
     FROM transactions
     WHERE merchant_id = $1 AND status = 'completed'
       AND initiated_at >= $2 AND initiated_at <= $3`,
    [merchantId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  const txCount = parseInt(res.rows[0].tx_count);
  const totalRevenue = parseFloat(res.rows[0].total_revenue);
  const currentAvgBasket = parseFloat(res.rows[0].avg_basket);

  if (txCount === 0) return null;

  // Success fee uniquement sur la croissance au-delà du panier moyen de référence
  const growthPerTransaction = Math.max(0, currentAvgBasket - refBasket);
  const growthAmount = growthPerTransaction * txCount;
  const feeAmount = (growthAmount * feePercent) / 100;

  if (feeAmount <= 0) return null;

  const id = uuidv4();
  await db.query(
    `INSERT INTO success_fees (id, merchant_id, period_start, period_end, reference_avg_basket, current_avg_basket,
       growth_amount, fee_percent, fee_amount, total_revenue_period, total_transactions_period)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, merchantId, periodStart.toISOString(), periodEnd.toISOString(), refBasket, currentAvgBasket,
      growthAmount, feePercent, Math.round(feeAmount), totalRevenue, txCount]
  );

  return { id, merchantId, feeAmount: Math.round(feeAmount), growthAmount };
}

async function runSuccessFeeBatch() {
  console.log('[SUCCESS-FEE] Début du calcul mensuel');
  const merchants = (await db.query(
    "SELECT id FROM merchants WHERE is_active = TRUE AND status = 'active'"
  )).rows;

  const results = [];
  for (const m of merchants) {
    // S'assurer que le panier de référence est calculé
    await calculateReferenceBasket(m.id);
    const fee = await calculateSuccessFee(m.id);
    if (fee) results.push(fee);
  }

  console.log(`[SUCCESS-FEE] Terminé : ${results.length} success fees calculés`);
  return results;
}

let job;

function start() {
  if (process.env.NODE_ENV === 'test') return;

  job = new CronJob('0 4 1 * *', async () => {
    try {
      await runSuccessFeeBatch();
    } catch (err) {
      console.error('[SUCCESS-FEE] Erreur:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  console.log('[SUCCESS-FEE] Cron mensuel programmé (1er du mois à 04h00)');
}

function stop() {
  if (job) job.stop();
}

module.exports = { start, stop, runSuccessFeeBatch, calculateReferenceBasket, calculateSuccessFee };
