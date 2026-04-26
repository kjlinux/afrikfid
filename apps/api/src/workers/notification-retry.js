'use strict';

/**
 * Retry des notifications échouées (trigger_logs + campaign_actions).
 * Backoff : 15 min × 2^retry_count, max 3 essais.
 */

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const notif = require('../lib/notification-channel');
const { decrypt } = require('../lib/crypto');

const MAX_RETRIES = 3;

async function retryTriggerLogs() {
  const rows = await pool.query(`
    SELECT tl.*, t.message_template, t.template_name, t.template_namespace, t.cooldown_hours,
           c.full_name, c.phone, c.email,
           m.name AS merchant_name
      FROM trigger_logs tl
      JOIN triggers t ON t.id = tl.trigger_id
      JOIN clients c ON c.id = tl.client_id
      JOIN merchants m ON m.id = tl.merchant_id
     WHERE tl.status = 'failed'
       AND tl.trigger_id IS NOT NULL
       AND tl.retry_count < $1
       AND (tl.next_retry_at IS NULL OR tl.next_retry_at <= NOW())
     LIMIT 100`, [MAX_RETRIES]);

  let ok = 0;
  for (const r of rows.rows) {
    let rawPhone = null, rawEmail = null;
    try { rawPhone = r.phone ? decrypt(r.phone) : null; } catch {}
    try { rawEmail = r.email ? decrypt(r.email) : null; } catch {}

    const message = (r.message_template || '')
      .replace('{client_name}', r.full_name || '')
      .replace('{merchant_name}', r.merchant_name || '');

    const result = await notif.send({
      rawPhone, rawEmail, text: message, channel: r.channel,
      subject: `Afrik'Fid — ${r.trigger_type}`,
      template: r.template_name ? { name: r.template_name, namespace: r.template_namespace, bodyParams: [r.full_name || '', r.merchant_name || ''] } : null,
      context: { type: 'trigger', ref_id: r.trigger_id, merchant_id: r.merchant_id, client_id: r.client_id },
    });

    const newCount = r.retry_count + 1;
    if (result.status === 'sent') {
      await pool.query(
        "UPDATE trigger_logs SET status = 'sent', sent_at = NOW(), retry_count = $2, last_error = NULL WHERE id = $1",
        [r.id, newCount]
      );
      ok++;
    } else {
      const backoffMin = 15 * Math.pow(2, newCount);
      const next = new Date(Date.now() + backoffMin * 60 * 1000);
      await pool.query(
        "UPDATE trigger_logs SET retry_count = $2, last_error = $3, next_retry_at = $4 WHERE id = $1",
        [r.id, newCount, result.error || 'unknown', next.toISOString()]
      );
    }
  }
  return ok;
}

async function retryCampaignActions() {
  const rows = await pool.query(`
    SELECT ca.*, c.message_template, c.template_name, c.template_namespace, c.channel, c.name AS campaign_name,
           cl.full_name, cl.phone, cl.email,
           m.id AS merchant_id, m.name AS merchant_name
      FROM campaign_actions ca
      JOIN campaigns c ON c.id = ca.campaign_id
      JOIN clients cl ON cl.id = ca.client_id
      JOIN merchants m ON m.id = c.merchant_id
     WHERE ca.status = 'failed'
       AND ca.retry_count < $1
       AND (ca.next_retry_at IS NULL OR ca.next_retry_at <= NOW())
     LIMIT 100`, [MAX_RETRIES]);

  let ok = 0;
  for (const r of rows.rows) {
    let rawPhone = null, rawEmail = null;
    try { rawPhone = r.phone ? decrypt(r.phone) : null; } catch {}
    try { rawEmail = r.email ? decrypt(r.email) : null; } catch {}

    const message = (r.message_template || '')
      .replace('{client_name}', r.full_name || '')
      .replace('{merchant_name}', r.merchant_name || '');

    const result = await notif.send({
      rawPhone, rawEmail, text: message,
      channel: r.channel === 'email' ? 'email' : 'whatsapp',
      subject: r.campaign_name,
      template: r.template_name ? { name: r.template_name, namespace: r.template_namespace, bodyParams: [r.full_name || '', r.merchant_name || ''] } : null,
      context: { type: 'campaign', ref_id: r.campaign_id, merchant_id: r.merchant_id, client_id: r.client_id },
    });

    const newCount = r.retry_count + 1;
    if (result.status === 'sent') {
      await pool.query(
        "UPDATE campaign_actions SET status = 'sent', sent_at = NOW(), retry_count = $2, last_error = NULL WHERE id = $1",
        [r.id, newCount]
      );
      await pool.query("UPDATE campaigns SET total_sent = total_sent + 1 WHERE id = $1", [r.campaign_id]);
      ok++;
    } else {
      const backoffMin = 15 * Math.pow(2, newCount);
      const next = new Date(Date.now() + backoffMin * 60 * 1000);
      await pool.query(
        "UPDATE campaign_actions SET retry_count = $2, last_error = $3, next_retry_at = $4 WHERE id = $1",
        [r.id, newCount, result.error || 'unknown', next.toISOString()]
      );
    }
  }
  return ok;
}

async function tick() {
  try {
    const t = await retryTriggerLogs();
    const c = await retryCampaignActions();
    if (t + c > 0) console.log(`[NOTIF-RETRY] ${t} triggers + ${c} campaign actions rejoués avec succès`);
  } catch (err) {
    console.error('[NOTIF-RETRY] erreur:', err.message);
  }
}

const notificationRetryWorker = new CronJob('*/15 * * * *', tick, null, false, 'Africa/Abidjan');

module.exports = notificationRetryWorker;
module.exports.tick = tick;
