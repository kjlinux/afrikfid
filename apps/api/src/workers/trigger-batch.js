'use strict';

const { CronJob } = require('cron');
const { runSegmentTriggers, runBirthdayTriggers, runAbandonProtocol } = require('../lib/campaign-engine');

// Triggers par segment à 07h00 + anniversaires + protocole abandon (CDC v3 §5.4, §5.5, §6.4)
const triggerBatchWorker = new CronJob('0 7 * * *', async () => {
  try {
    await runSegmentTriggers();
    await runBirthdayTriggers();
    await runAbandonProtocol();
  } catch (err) {
    console.error('[TRIGGER-WORKER] Erreur batch:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = triggerBatchWorker;
