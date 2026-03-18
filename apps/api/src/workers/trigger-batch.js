'use strict';

const { CronJob } = require('cron');
const { runSegmentTriggers, runBirthdayTriggers } = require('../lib/campaign-engine');

// Triggers par segment à 07h00 + anniversaires (CDC v3 §6.4)
const triggerBatchWorker = new CronJob('0 7 * * *', async () => {
  try {
    await runSegmentTriggers();
    await runBirthdayTriggers();
  } catch (err) {
    console.error('[TRIGGER-WORKER] Erreur batch:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = triggerBatchWorker;
