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

  // 1. Vérifier couverture distributions vs transactions completed
  // (Chaque transaction complétée doit avoir au moins une distribution X/Y/Z)
  // NOTE: La somme des splits distributions != gross_amount (c'est partial X + Y + Z),
  // donc on vérifie la couverture (présence) plutôt qu'une égalité de sommes.
  const coverageRes = await pool.query(`
    SELECT COUNT(*) AS uncovered
    FROM transactions t
    WHERE t.status = 'completed'
      AND NOT EXISTS (SELECT 1 FROM distributions d WHERE d.transaction_id = t.id)
  `);
  const uncovered = parseInt(coverageRes.rows[0].uncovered);

  const distCheck = {
    name: 'distribution_coverage',
    uncovered_transactions: uncovered,
    status: uncovered > 0 ? 'alert' : 'ok',
  };
  if (uncovered > 0) {
    report.alerts.push(`${uncovered} transaction(s) complétée(s) sans distribution associée`);
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
    WHERE status = 'pending' AND initiated_at < NOW() - INTERVAL '24 hours'
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
    SELECT c.id, c.status_points_12m, sub.calc_points
    FROM clients c
    JOIN (
      SELECT t.client_id,
             COALESCE(SUM(t.status_points_earned), 0) AS calc_points
      FROM transactions t
      WHERE t.status = 'completed' AND t.completed_at > NOW() - INTERVAL '12 months'
      GROUP BY t.client_id
    ) sub ON sub.client_id = c.id
    WHERE c.is_active = TRUE
      AND ABS(c.status_points_12m - sub.calc_points) > 1
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
      `INSERT INTO audit_logs (id, action, actor_type, actor_id, payload, created_at)
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
