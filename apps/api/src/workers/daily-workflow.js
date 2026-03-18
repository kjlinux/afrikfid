'use strict';

/**
 * CDC v3 §6.4 — Workflow Quotidien Automatisé
 *
 * L'orchestration est réalisée via les crons individuels :
 * 02h00 — Batch fidélité mensuel (loyalty-batch.js, 1er du mois)
 * 04h00 — Success fee mensuel (success-fee.js, 1er du mois)
 * 06h00 — Batch RFM quotidien (rfm-batch.js)
 * 07h00 — Triggers par segment + anniversaires (trigger-batch.js)
 * 08h00 — Notifications requalification statut (status-notifications.js)
 *
 * Ce module fournit un bilan de fin de journée (18h00)
 */

const { CronJob } = require('cron');
const { pool } = require('../lib/db');

async function generateDailySummary() {
  console.log('[WORKFLOW] Génération bilan journalier...');

  const today = new Date().toISOString().slice(0, 10);

  const txStats = await pool.query(`
    SELECT COUNT(*) AS count, COALESCE(SUM(gross_amount), 0) AS volume
    FROM transactions WHERE DATE(completed_at) = $1 AND status = 'completed'
  `, [today]);

  const newClients = await pool.query(
    `SELECT COUNT(*) AS count FROM clients WHERE DATE(created_at) = $1`, [today]
  );

  const triggersToday = await pool.query(
    `SELECT COUNT(*) AS count FROM trigger_logs WHERE DATE(created_at) = $1 AND status = 'sent'`, [today]
  );

  const rfmUpdates = await pool.query(
    `SELECT COUNT(*) AS count FROM rfm_scores WHERE DATE(calculated_at) = $1`, [today]
  );

  const summary = {
    date: today,
    transactions: Number(txStats.rows[0].count),
    volume: Number(txStats.rows[0].volume),
    new_clients: Number(newClients.rows[0].count),
    triggers_sent: Number(triggersToday.rows[0].count),
    rfm_scores_updated: Number(rfmUpdates.rows[0].count),
  };

  console.log(`[WORKFLOW] Bilan ${today}:`, JSON.stringify(summary));
  return summary;
}

// Bilan journalier à 18h00
const dailySummaryWorker = new CronJob('0 18 * * *', async () => {
  try {
    await generateDailySummary();
  } catch (err) {
    console.error('[WORKFLOW] Erreur bilan:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = dailySummaryWorker;
module.exports.generateDailySummary = generateDailySummary;
