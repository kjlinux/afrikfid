'use strict';

const { CronJob } = require('cron');
const { runRFMBatch } = require('../lib/rfm-engine');

// Batch RFM quotidien à 06h00 (CDC v3 §6.4)
const rfmBatchWorker = new CronJob('0 6 * * *', async () => {
  try {
    await runRFMBatch();
  } catch (err) {
    console.error('[RFM-WORKER] Erreur batch:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = rfmBatchWorker;
