/**
 * Worker Batch Mensuel Fidélité — CDC v3.0 §2.4.1
 * Cron mensuel : réévaluation de tous les statuts clients
 * Fréquence : 1er de chaque mois à 02h00
 */
'use strict';

const { CronJob } = require('cron');
const { runLoyaltyBatch } = require('../lib/loyalty-engine');

let job;

function start() {
  if (process.env.NODE_ENV === 'test') return;

  // Cron : 1er du mois à 02h00
  job = new CronJob('0 2 1 * *', async () => {
    console.log('[LOYALTY-BATCH] Début du batch mensuel de réévaluation');
    try {
      const results = await runLoyaltyBatch();
      console.log(`[LOYALTY-BATCH] Terminé : ${results.length} changements de statut`);
    } catch (err) {
      console.error('[LOYALTY-BATCH] Erreur:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  console.log('[LOYALTY-BATCH] Cron mensuel programmé (1er du mois à 02h00)');
}

function stop() {
  if (job) job.stop();
}

module.exports = { start, stop };
