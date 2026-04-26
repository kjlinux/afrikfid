'use strict';

/**
 * Scheduler auto des campagnes : toutes les 5 minutes, exécute les campagnes
 * dont `scheduled_at <= NOW()` et `status = 'scheduled'`.
 */

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const { executeCampaign } = require('../lib/campaign-engine');

async function tick() {
  const due = await pool.query(
    `SELECT id FROM campaigns
       WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 50`
  );
  if (!due.rows.length) return;
  console.log(`[CAMPAIGN-SCHEDULER] ${due.rows.length} campagne(s) à exécuter`);
  for (const row of due.rows) {
    try { await executeCampaign(row.id); }
    catch (err) {
      console.error(`[CAMPAIGN-SCHEDULER] échec ${row.id}:`, err.message);
      // Marquer en failed pour éviter une boucle infinie
      await pool.query(
        "UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1",
        [row.id]
      ).catch(() => {});
    }
  }
}

const campaignSchedulerWorker = new CronJob('*/5 * * * *', tick, null, false, 'Africa/Abidjan');

module.exports = campaignSchedulerWorker;
module.exports.tick = tick;
