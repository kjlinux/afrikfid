'use strict';

/**
 * Élasticité-prix — CDC v3 §6.1 (Premium)
 *
 * Analyse comment la distribution des montants de transaction varie
 * selon les promotions/remises appliquées, et recommande le taux de remise
 * optimal pour maximiser le CA.
 *
 * Méthode : analyse des clusters de paniers + corrélation remise/volume.
 * Pas de ML externe — calcul statistique pur sur les données transactionnelles.
 */

const { pool } = require('./db');
const { v4: uuidv4 } = require('uuid');

/**
 * Calcule les percentiles d'un tableau de nombres
 */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Calcule le score de sensibilité au prix (0-100)
 * Basé sur la corrélation entre le taux de remise et le volume de transactions
 */
function calculateSensitivityScore(rebateGroups) {
  if (rebateGroups.length < 2) return 50; // pas assez de données

  // Corrélation de Spearman simplifiée entre remise % et volume
  const sorted = [...rebateGroups].sort((a, b) => a.rebate_pct - b.rebate_pct);
  const n = sorted.length;
  if (n < 2) return 50;

  // Calculer si le volume augmente avec la remise
  let positiveCorrelations = 0;
  let totalPairs = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const rebateDiff = sorted[j].rebate_pct - sorted[i].rebate_pct;
      const volumeDiff = sorted[j].avg_basket - sorted[i].avg_basket;
      if (rebateDiff > 0) {
        totalPairs++;
        if (volumeDiff > 0) positiveCorrelations++;
      }
    }
  }

  if (totalPairs === 0) return 50;
  return Math.round((positiveCorrelations / totalPairs) * 100);
}

/**
 * Calcule l'analyse d'élasticité-prix pour un marchand
 * @param {string} merchantId
 * @param {Object} options  { months: 3 }
 */
async function calculatePriceElasticity(merchantId, { months = 3 } = {}) {
  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - months);

  // Récupérer toutes les transactions complétées avec remises
  const txRes = await pool.query(`
    SELECT
      gross_amount,
      client_rebate_amount,
      CASE WHEN gross_amount > 0
        THEN ROUND((client_rebate_amount / gross_amount * 100)::numeric, 1)
        ELSE 0 END AS rebate_pct,
      client_loyalty_status,
      completed_at
    FROM transactions
    WHERE merchant_id = $1
      AND status = 'completed'
      AND completed_at >= $2
    ORDER BY completed_at DESC
    LIMIT 5000
  `, [merchantId, periodStart]);

  const rows = txRes.rows;
  if (rows.length < 10) {
    return {
      merchant_id: merchantId,
      insufficient_data: true,
      message: 'Données insuffisantes (< 10 transactions sur la période)',
      period_months: months,
    };
  }

  const amounts = rows.map(r => Number(r.gross_amount));
  const avgBasket = amounts.reduce((a, b) => a + b, 0) / amounts.length;

  // Distribution des paniers (deciles)
  const distribution = {};
  const buckets = [
    { label: '0-5k', min: 0, max: 5000 },
    { label: '5k-10k', min: 5000, max: 10000 },
    { label: '10k-25k', min: 10000, max: 25000 },
    { label: '25k-50k', min: 25000, max: 50000 },
    { label: '50k-100k', min: 50000, max: 100000 },
    { label: '100k+', min: 100000, max: Infinity },
  ];
  for (const b of buckets) {
    const inBucket = amounts.filter(a => a >= b.min && a < b.max);
    distribution[b.label] = {
      count: inBucket.length,
      pct: Math.round(inBucket.length / amounts.length * 100),
      avg: inBucket.length > 0 ? Math.round(inBucket.reduce((a, b) => a + b, 0) / inBucket.length) : 0,
    };
  }

  // Grouper par taux de remise arrondi (0%, 5%, 8%, 12%)
  const rebateGroups = {};
  for (const row of rows) {
    const pct = Math.round(Number(row.rebate_pct));
    if (!rebateGroups[pct]) rebateGroups[pct] = { rebate_pct: pct, count: 0, total_amount: 0 };
    rebateGroups[pct].count++;
    rebateGroups[pct].total_amount += Number(row.gross_amount);
  }
  const rebateArr = Object.values(rebateGroups).map(g => ({
    ...g,
    avg_basket: g.count > 0 ? Math.round(g.total_amount / g.count) : 0,
  }));

  const sensitivityScore = calculateSensitivityScore(rebateArr);

  // Analyse par statut de fidélité
  const segmentsAnalysis = {};
  const statuses = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];
  for (const status of statuses) {
    const statusRows = rows.filter(r => r.client_loyalty_status === status);
    if (statusRows.length === 0) continue;
    const statusAmounts = statusRows.map(r => Number(r.gross_amount));
    segmentsAnalysis[status] = {
      count: statusRows.length,
      avg_basket: Math.round(statusAmounts.reduce((a, b) => a + b, 0) / statusAmounts.length),
      median_basket: Math.round(percentile(statusAmounts, 50)),
      p75_basket: Math.round(percentile(statusAmounts, 75)),
    };
  }

  // Remise optimale : maximise revenue = count(rebate%) × avg_basket(rebate%)
  let optimalDiscount = 0;
  let maxRevenue = 0;
  for (const g of rebateArr) {
    const projectedRevenue = g.count * g.avg_basket;
    if (projectedRevenue > maxRevenue) {
      maxRevenue = projectedRevenue;
      optimalDiscount = g.rebate_pct;
    }
  }

  // Sauvegarder le snapshot
  const snapshotId = uuidv4();
  await pool.query(`
    INSERT INTO price_elasticity_snapshots
      (id, merchant_id, period_start, period_end, avg_basket, basket_distribution,
       price_sensitivity_score, optimal_discount_pct, revenue_at_optimal, segments_analysis)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT DO NOTHING
  `, [
    snapshotId,
    merchantId,
    periodStart,
    new Date(),
    avgBasket,
    JSON.stringify(distribution),
    sensitivityScore,
    optimalDiscount,
    maxRevenue,
    JSON.stringify(segmentsAnalysis),
  ]).catch(() => {}); // Non-bloquant si la table n'est pas encore créée

  return {
    merchant_id: merchantId,
    period_months: months,
    period_start: periodStart,
    total_transactions: rows.length,
    avg_basket: Math.round(avgBasket),
    median_basket: Math.round(percentile(amounts, 50)),
    p25_basket: Math.round(percentile(amounts, 25)),
    p75_basket: Math.round(percentile(amounts, 75)),
    basket_distribution: distribution,
    rebate_impact: rebateArr.sort((a, b) => a.rebate_pct - b.rebate_pct),
    price_sensitivity_score: sensitivityScore,
    sensitivity_label: sensitivityScore >= 70 ? 'élevée' : sensitivityScore >= 40 ? 'modérée' : 'faible',
    optimal_discount_pct: optimalDiscount,
    revenue_at_optimal: maxRevenue,
    segments_analysis: segmentsAnalysis,
    recommendation: buildElasticityRecommendation(sensitivityScore, optimalDiscount, avgBasket),
    computed_at: new Date().toISOString(),
  };
}

function buildElasticityRecommendation(sensitivityScore, optimalDiscount, avgBasket) {
  if (sensitivityScore >= 70) {
    return `Clientèle très sensible aux remises. Le taux optimal est ${optimalDiscount}%. ` +
      `Privilégier des offres ciblées plutôt que des remises permanentes pour préserver les marges.`;
  } else if (sensitivityScore >= 40) {
    return `Sensibilité modérée au prix. Taux optimal : ${optimalDiscount}%. ` +
      `Les remises de fidélité ont un effet mesurable sur le panier moyen (${Math.round(avgBasket).toLocaleString('fr-FR')} FCFA).`;
  } else {
    return `Clientèle peu sensible aux remises — la fidélité prime sur le prix. ` +
      `Investir davantage dans la qualité de service et les avantages exclusifs pour les statuts élevés.`;
  }
}

module.exports = { calculatePriceElasticity };
