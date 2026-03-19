'use strict';

/**
 * CDC v3 §6.2 — Réconciliation quotidienne
 * Vérifie la cohérence entre transactions, distributions et wallets.
 * Seuil d'alerte : 0.01% d'écart.
 */

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const { notifyAdminAlert } = require('../lib/notifications');

const RECONCILIATION_THRESHOLD = 0.0001; // 0.01%

async function runReconciliation() {
  const report = { date: new Date().toISOString(), checks: [], alerts: [] };

  // 1. Vérifier total distributions vs transactions completed
  const txRes = await pool.query(`
    SELECT COALESCE(SUM(gross_amount), 0) AS total_tx,
           COUNT(*) AS count_tx
    FROM transactions WHERE status = 'completed'
  `);
  const distRes = await pool.query(`
    SELECT COALESCE(SUM(amount), 0) AS total_dist,
           COUNT(*) AS count_dist
    FROM distributions WHERE status = 'completed'
  `);

  const totalTx = parseFloat(txRes.rows[0].total_tx);
  const totalDist = parseFloat(distRes.rows[0].total_dist);

  const distCheck = {
    name: 'distributions_vs_transactions',
    total_transactions: totalTx,
    total_distributions: totalDist,
    status: 'ok',
  };

  if (totalTx > 0) {
    const ratio = Math.abs(totalTx - totalDist) / totalTx;
    if (ratio > RECONCILIATION_THRESHOLD) {
      distCheck.status = 'alert';
      distCheck.deviation = (ratio * 100).toFixed(4) + '%';
      report.alerts.push(`Écart distributions/transactions: ${distCheck.deviation} (seuil: 0.01%)`);
    }
  }
  report.checks.push(distCheck);

  // 2. Vérifier wallets — solde ne doit pas être négatif
  const negWallets = await pool.query(`
    SELECT w.id, w.client_id, w.balance
    FROM wallets w WHERE w.balance < 0
  `);
  const walletCheck = {
    name: 'negative_wallets',
    count: negWallets.rows.length,
    status: negWallets.rows.length > 0 ? 'alert' : 'ok',
  };
  if (negWallets.rows.length > 0) {
    report.alerts.push(`${negWallets.rows.length} wallet(s) avec solde négatif`);
  }
  report.checks.push(walletCheck);

  // 3. Vérifier transactions pending > 24h (possiblement orphelines)
  const orphanTx = await pool.query(`
    SELECT COUNT(*) AS c FROM transactions
    WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'
  `);
  const orphanCount = parseInt(orphanTx.rows[0].c);
  const orphanCheck = {
    name: 'orphan_pending_transactions',
    count: orphanCount,
    status: orphanCount > 0 ? 'warning' : 'ok',
  };
  if (orphanCount > 0) {
    report.alerts.push(`${orphanCount} transaction(s) pending depuis plus de 24h`);
  }
  report.checks.push(orphanCheck);

  // 4. Vérifier cohérence points statut — total_status_points_12m vs somme transactions 12 mois
  const pointsCheck = await pool.query(`
    SELECT c.id, c.status_points_12m,
           COALESCE((SELECT SUM(t.status_points_earned) FROM transactions t
            WHERE t.client_id = c.id AND t.status = 'completed'
            AND t.completed_at > NOW() - INTERVAL '12 months'), 0) AS calc_points
    FROM clients c WHERE c.is_active = TRUE
    HAVING ABS(c.status_points_12m - COALESCE((SELECT SUM(t.status_points_earned) FROM transactions t
            WHERE t.client_id = c.id AND t.status = 'completed'
            AND t.completed_at > NOW() - INTERVAL '12 months'), 0)) > 1
    LIMIT 50
  `);
  const pointsDriftCheck = {
    name: 'points_drift',
    count: pointsCheck.rows.length,
    status: pointsCheck.rows.length > 0 ? 'warning' : 'ok',
  };
  if (pointsCheck.rows.length > 0) {
    report.alerts.push(`${pointsCheck.rows.length} client(s) avec dérive de points statut`);
  }
  report.checks.push(pointsDriftCheck);

  // Log et alerte admin si problèmes
  if (report.alerts.length > 0) {
    console.warn(`[RECONCILIATION] ${report.alerts.length} alerte(s):`, report.alerts);
    notifyAdminAlert({
      subject: `Réconciliation — ${report.alerts.length} alerte(s)`,
      body: report.alerts.join('\n'),
    }).catch(() => {});
  } else {
    console.log('[RECONCILIATION] Toutes les vérifications sont OK');
  }

  // Persister le rapport
  try {
    await pool.query(
      `INSERT INTO audit_logs (id, action, actor_type, actor_id, details, created_at)
       VALUES ($1, 'RECONCILIATION', 'system', 'reconciliation-worker', $2, NOW())`,
      [require('uuid').v4(), JSON.stringify(report)]
    );
  } catch (_) { /* audit_logs may not exist in test */ }

  return report;
}

// Cron : tous les jours à 05h00
const job = new CronJob('0 5 * * *', async () => {
  try {
    console.log('[CRON] Réconciliation quotidienne...');
    await runReconciliation();
  } catch (err) {
    console.error('[RECONCILIATION] Erreur:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = { start: () => { if (process.env.NODE_ENV !== 'test') job.start(); }, runReconciliation };
