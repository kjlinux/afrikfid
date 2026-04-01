'use strict';

const { CronJob } = require('cron');
const { pool } = require('../lib/db');

/**
 * CDC v3 §3.1.4 — Nettoyage des clés d'idempotence expirées (24h)
 * + Nettoyage des trigger_logs anciens (> 90 jours)
 */
async function runCleanup() {
  console.log('[CLEANUP] Nettoyage des données expirées...');

  // 1. Expirer les clés d'idempotence > 24h
  const idemRes = await pool.query(`
    UPDATE transactions SET idempotency_key = NULL
    WHERE idempotency_key IS NOT NULL AND initiated_at < NOW() - INTERVAL '24 hours'
  `);
  const idemCount = idemRes.rowCount || 0;

  // 2. Nettoyer les trigger_logs > 90 jours
  const triggerRes = await pool.query(`
    DELETE FROM trigger_logs WHERE created_at < NOW() - INTERVAL '90 days'
  `);
  const triggerCount = triggerRes.rowCount || 0;

  // 3. Purger les rfm_transitions traitées > 90 jours (CDC §6.4 — éviter la croissance infinie)
  const rfmRes = await pool.query(`
    DELETE FROM rfm_transitions
    WHERE processed_at IS NOT NULL AND processed_at < NOW() - INTERVAL '90 days'
  `);
  const rfmCount = rfmRes.rowCount || 0;

  if (idemCount > 0 || triggerCount > 0 || rfmCount > 0) {
    console.log(`[CLEANUP] ${idemCount} clés idempotence expirées, ${triggerCount} trigger_logs purgés, ${rfmCount} rfm_transitions purgées`);
  }

  return { idempotencyKeysCleared: idemCount, triggerLogsPurged: triggerCount, rfmTransitionsPurged: rfmCount };
}

// Cron quotidien à 03h00
const cleanupWorker = new CronJob('0 3 * * *', async () => {
  try {
    await runCleanup();
  } catch (err) {
    console.error('[CLEANUP] Erreur:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = cleanupWorker;
module.exports.runCleanup = runCleanup;
