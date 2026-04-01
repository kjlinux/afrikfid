'use strict';

/**
 * CDC v3 §6.3 — Rapport trimestriel automatique
 * Packages : Starter Plus (1/an = Q1), Growth (2/an = Q1+Q3), Premium (4/an = tous les trimestres)
 *
 * Cron : 1er jour du mois suivant la fin d'un trimestre (01/04, 01/07, 01/10, 01/01) à 09h00
 * Q1 (Jan-Mar)  → généré le 01/04
 * Q2 (Avr-Jun)  → généré le 01/07
 * Q3 (Jul-Sep)  → généré le 01/10
 * Q4 (Oct-Déc)  → généré le 01/01
 */

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const { v4: uuidv4 } = require('uuid');

const QUARTER_MONTHS = {
  4:  { q: 1, yearOffset: 0 },  // 1er avril → rapport Q1
  7:  { q: 2, yearOffset: 0 },  // 1er juillet → rapport Q2
  10: { q: 3, yearOffset: 0 },  // 1er octobre → rapport Q3
  1:  { q: 4, yearOffset: -1 }, // 1er janvier → rapport Q4 de l'année précédente
};

// Packages éligibles par trimestre
function isEligibleQuarter(pkg, quarter) {
  switch (pkg) {
    case 'STARTER_PLUS': return quarter === 1;         // 1 rapport/an = Q1 uniquement
    case 'GROWTH':       return quarter === 1 || quarter === 3; // 2/an = Q1+Q3
    case 'PREMIUM':      return true;                  // 4/an = tous
    default:             return false;
  }
}

async function generateQuarterlyReports() {
  const now = new Date();
  const monthNum = now.getMonth() + 1; // 1-12
  const quarterInfo = QUARTER_MONTHS[monthNum];

  if (!quarterInfo) {
    console.log(`[QUARTERLY] Pas de rapport trimestriel ce mois (mois=${monthNum})`);
    return;
  }

  const { q, yearOffset } = quarterInfo;
  const reportYear = now.getFullYear() + yearOffset;
  const periodStart = new Date(reportYear, (q - 1) * 3, 1);
  const periodEnd   = new Date(reportYear, q * 3, 1);
  const periodLabel = `Q${q} ${reportYear}`;

  console.log(`[QUARTERLY] Génération rapports ${periodLabel}...`);

  // Récupérer tous les marchands éligibles
  const merchants = await pool.query(`
    SELECT m.id, m.name, m.package, m.email
    FROM merchants m
    WHERE m.status = 'active'
      AND m.package IN ('STARTER_PLUS', 'GROWTH', 'PREMIUM')
  `);

  let generated = 0;
  for (const merchant of merchants.rows) {
    if (!isEligibleQuarter(merchant.package, q)) continue;

    // Vérifier si déjà généré
    const existing = await pool.query(
      'SELECT id FROM periodic_reports WHERE merchant_id = $1 AND period_label = $2 AND report_type = $3',
      [merchant.id, periodLabel, 'quarterly']
    );
    if (existing.rows[0]) continue;

    try {
      const reportData = await buildQuarterlyData(merchant.id, periodStart, periodEnd, periodLabel);

      await pool.query(`
        INSERT INTO periodic_reports
          (id, merchant_id, report_type, period_label, period_start, period_end, data, status)
        VALUES ($1, $2, 'quarterly', $3, $4, $5, $6, 'generated')
      `, [uuidv4(), merchant.id, periodLabel, periodStart, periodEnd, JSON.stringify(reportData)]);

      generated++;
      console.log(`[QUARTERLY] Rapport ${periodLabel} généré pour marchand ${merchant.name}`);
    } catch (err) {
      console.error(`[QUARTERLY] Erreur marchand ${merchant.id}:`, err.message);
    }
  }

  // Rapport global admin (tous packages)
  try {
    const globalData = await buildGlobalQuarterlyData(periodStart, periodEnd, periodLabel);
    await pool.query(`
      INSERT INTO periodic_reports
        (id, merchant_id, report_type, period_label, period_start, period_end, data, status)
      VALUES ($1, NULL, 'quarterly', $2, $3, $4, $5, 'generated')
      ON CONFLICT DO NOTHING
    `, [uuidv4(), periodLabel, periodStart, periodEnd, JSON.stringify(globalData)]);
  } catch (err) {
    console.error('[QUARTERLY] Erreur rapport global:', err.message);
  }

  console.log(`[QUARTERLY] ${generated} rapports marchands générés pour ${periodLabel}`);
  return generated;
}

async function buildQuarterlyData(merchantId, periodStart, periodEnd, periodLabel) {
  const [txStats, loyaltyStats, rfmStats, newClients, topClients, returnRate] = await Promise.all([
    pool.query(`
      SELECT COUNT(*) AS total_tx,
        COALESCE(SUM(gross_amount), 0) AS total_revenue,
        COALESCE(AVG(gross_amount), 0) AS avg_basket,
        COUNT(DISTINCT client_id) AS unique_clients,
        COALESCE(SUM(platform_commission_amount), 0) AS total_commission,
        COALESCE(SUM(client_rebate_amount), 0) AS total_rebates
      FROM transactions
      WHERE merchant_id = $1 AND status = 'completed'
        AND completed_at >= $2 AND completed_at < $3
    `, [merchantId, periodStart, periodEnd]),
    pool.query(`
      SELECT loyalty_status, COUNT(*) AS count
      FROM clients c
      JOIN transactions t ON t.client_id = c.id
      WHERE t.merchant_id = $1 AND t.status = 'completed'
        AND t.completed_at >= $2 AND t.completed_at < $3
      GROUP BY loyalty_status
    `, [merchantId, periodStart, periodEnd]),
    pool.query(`
      SELECT segment, COUNT(*) AS count
      FROM rfm_scores
      WHERE merchant_id = $1
        AND calculated_at >= $2 AND calculated_at < $3
      GROUP BY segment ORDER BY count DESC
    `, [merchantId, periodStart, periodEnd]),
    pool.query(`
      SELECT COUNT(*) AS count FROM clients
      WHERE created_at >= $1 AND created_at < $2
    `, [periodStart, periodEnd]),
    pool.query(`
      SELECT c.full_name, SUM(t.gross_amount) AS total_spent, COUNT(t.id) AS tx_count
      FROM transactions t JOIN clients c ON c.id = t.client_id
      WHERE t.merchant_id = $1 AND t.status = 'completed'
        AND t.completed_at >= $2 AND t.completed_at < $3
      GROUP BY c.full_name ORDER BY total_spent DESC LIMIT 10
    `, [merchantId, periodStart, periodEnd]),
    pool.query(`
      SELECT
        COUNT(DISTINCT client_id) AS total,
        COUNT(DISTINCT CASE WHEN tx_count > 1 THEN client_id END) AS returning
      FROM (
        SELECT client_id, COUNT(*) AS tx_count
        FROM transactions
        WHERE merchant_id = $1 AND status = 'completed'
          AND completed_at >= $2 AND completed_at < $3
        GROUP BY client_id
      ) sub
    `, [merchantId, periodStart, periodEnd]),
  ]);

  const rrRow = returnRate.rows[0] || {};
  const totalC = Number(rrRow.total || 0);
  const returnRatePct = totalC > 0
    ? Math.round(Number(rrRow.returning) / totalC * 100 * 10) / 10
    : 0;

  return {
    period: periodLabel,
    period_start: periodStart,
    period_end: periodEnd,
    merchant_id: merchantId,
    transactions: txStats.rows[0],
    loyalty_distribution: loyaltyStats.rows,
    rfm_segmentation: rfmStats.rows,
    new_clients_period: Number(newClients.rows[0]?.count || 0),
    top_clients: topClients.rows,
    return_rate_pct: returnRatePct,
    generated_at: new Date().toISOString(),
  };
}

async function buildGlobalQuarterlyData(periodStart, periodEnd, periodLabel) {
  const stats = await pool.query(`
    SELECT
      COUNT(t.id) AS total_tx,
      COALESCE(SUM(t.gross_amount), 0) AS total_volume,
      COALESCE(SUM(t.platform_commission_amount), 0) AS total_commissions,
      COUNT(DISTINCT t.merchant_id) AS active_merchants,
      COUNT(DISTINCT t.client_id) AS active_clients
    FROM transactions t
    WHERE t.status = 'completed'
      AND t.completed_at >= $1 AND t.completed_at < $2
  `, [periodStart, periodEnd]);

  const subscriptionRevenue = await pool.query(`
    SELECT COALESCE(SUM(effective_amount), 0) AS total
    FROM subscription_payments
    WHERE period_start >= $1 AND period_start < $2 AND status = 'paid'
  `, [periodStart, periodEnd]).catch(() => ({ rows: [{ total: 0 }] }));

  return {
    period: periodLabel,
    period_start: periodStart,
    period_end: periodEnd,
    type: 'admin_global',
    platform_stats: stats.rows[0],
    subscription_revenue: Number(subscriptionRevenue.rows[0]?.total || 0),
    generated_at: new Date().toISOString(),
  };
}

// Cron: le 1er de chaque mois à 09h00 — vérifie si c'est un mois de fin de trimestre
const quarterlyReportWorker = new CronJob('0 9 1 * *', async () => {
  try {
    await generateQuarterlyReports();
  } catch (err) {
    console.error('[QUARTERLY] Erreur worker:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = quarterlyReportWorker;
module.exports.generateQuarterlyReports = generateQuarterlyReports;
