'use strict';

const { CronJob } = require('cron');
const { runSegmentTriggers, runBirthdayTriggers, runAbandonProtocol, runTransitionTriggers } = require('../lib/campaign-engine');

// Triggers par segment à 07h00 + transitions RFM + anniversaires + protocole abandon
// CDC v3 §5.4, §5.5, §6.4 — "Identification des clients à risque et des transitions"
const triggerBatchWorker = new CronJob('0 7 * * *', async () => {
  try {
    await runTransitionTriggers(); // Traiter d'abord les transitions R 5→4, 4→3
    await runSegmentTriggers();
    await runBirthdayTriggers();
    await runAbandonProtocol();
  } catch (err) {
    console.error('[TRIGGER-WORKER] Erreur batch:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = triggerBatchWorker;
