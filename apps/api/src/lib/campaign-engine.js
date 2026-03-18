'use strict';

const { pool } = require('./db');
const { v4: uuidv4 } = require('uuid');
const { TRIGGER_TYPES, ABANDON_PROTOCOL_STEPS } = require('../config/constants');
const { sendSMS, sendEmail } = require('./notifications');

/**
 * Vérifie le cooldown d'un trigger pour un client
 */
async function canFireTrigger(triggerId, clientId, cooldownHours) {
  const res = await pool.query(
    `SELECT 1 FROM trigger_logs
     WHERE trigger_id = $1 AND client_id = $2 AND created_at > NOW() - INTERVAL '1 hour' * $3
     LIMIT 1`,
    [triggerId, clientId, cooldownHours]
  );
  return res.rows.length === 0;
}

/**
 * Envoie un trigger à un client
 */
async function fireTrigger(trigger, client) {
  const canFire = await canFireTrigger(trigger.id, client.id, trigger.cooldown_hours || 24);
  if (!canFire) return null;

  const message = (trigger.message_template || '')
    .replace('{client_name}', client.full_name || '')
    .replace('{merchant_name}', trigger.merchant_name || '')
    .replace('{phone}', client.phone || '');

  const logId = uuidv4();
  await pool.query(
    `INSERT INTO trigger_logs (id, trigger_id, client_id, merchant_id, trigger_type, channel, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
    [logId, trigger.id, client.id, trigger.merchant_id, trigger.trigger_type, trigger.channel || 'sms']
  );

  try {
    if (trigger.channel === 'email' && client.email) {
      await sendEmail(client.email, `Afrik'Fid — ${trigger.trigger_type}`, message);
    } else if (client.phone) {
      await sendSMS(client.phone, message);
    }
    await pool.query("UPDATE trigger_logs SET status = 'sent', sent_at = NOW() WHERE id = $1", [logId]);
    return logId;
  } catch (err) {
    await pool.query("UPDATE trigger_logs SET status = 'failed' WHERE id = $1", [logId]);
    console.error(`[TRIGGER] Erreur envoi ${trigger.trigger_type} à ${client.id}:`, err.message);
    return null;
  }
}

/**
 * Trigger BIENVENUE : nouveau client inscrit (appeler après création client)
 */
async function triggerBienvenue(merchantId, client) {
  const triggers = await pool.query(
    "SELECT t.*, m.name AS merchant_name FROM triggers t JOIN merchants m ON m.id = t.merchant_id WHERE t.merchant_id = $1 AND t.trigger_type = 'BIENVENUE' AND t.is_active = true",
    [merchantId]
  );
  for (const t of triggers.rows) {
    await fireTrigger(t, client);
  }
}

/**
 * Trigger 1ER_ACHAT : premier achat d'un client chez un marchand
 */
async function triggerPremierAchat(merchantId, client) {
  const count = await pool.query(
    "SELECT COUNT(*) AS c FROM transactions WHERE merchant_id = $1 AND client_id = $2 AND status = 'completed'",
    [merchantId, client.id]
  );
  if (Number(count.rows[0].c) !== 1) return; // seulement au 1er achat
  const triggers = await pool.query(
    "SELECT t.*, m.name AS merchant_name FROM triggers t JOIN merchants m ON m.id = t.merchant_id WHERE t.merchant_id = $1 AND t.trigger_type = '1ER_ACHAT' AND t.is_active = true",
    [merchantId]
  );
  for (const t of triggers.rows) {
    await fireTrigger(t, client);
  }
}

/**
 * Batch triggers basés sur segments RFM (ABSENCE, ALERTE_R, A_RISQUE, WIN_BACK)
 */
async function runSegmentTriggers() {
  console.log('[TRIGGERS] Exécution triggers par segment...');
  const segmentTriggerMap = {
    'ABSENCE': ['HIBERNANTS'],
    'ALERTE_R': ['A_RISQUE'],
    'A_RISQUE': ['A_RISQUE'],
    'WIN_BACK': ['PERDUS'],
  };

  let totalFired = 0;
  for (const [triggerType, segments] of Object.entries(segmentTriggerMap)) {
    const triggers = await pool.query(
      "SELECT t.*, m.name AS merchant_name FROM triggers t JOIN merchants m ON m.id = t.merchant_id WHERE t.trigger_type = $1 AND t.is_active = true",
      [triggerType]
    );
    for (const trigger of triggers.rows) {
      const clients = await pool.query(
        `SELECT c.* FROM rfm_scores rs
         JOIN clients c ON c.id = rs.client_id
         WHERE rs.merchant_id = $1 AND rs.segment = ANY($2) AND c.is_active = true`,
        [trigger.merchant_id, segments]
      );
      for (const client of clients.rows) {
        const result = await fireTrigger(trigger, client);
        if (result) totalFired++;
      }
    }
  }
  console.log(`[TRIGGERS] ${totalFired} triggers envoyés`);
  return totalFired;
}

/**
 * Trigger ANNIVERSAIRE (batch quotidien)
 */
async function runBirthdayTriggers() {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');

  const triggers = await pool.query(
    "SELECT t.*, m.name AS merchant_name FROM triggers t JOIN merchants m ON m.id = t.merchant_id WHERE t.trigger_type = 'ANNIVERSAIRE' AND t.is_active = true"
  );

  let count = 0;
  for (const trigger of triggers.rows) {
    const clients = await pool.query(
      `SELECT c.* FROM clients c
       JOIN transactions tx ON tx.client_id = c.id AND tx.merchant_id = $1
       WHERE c.birth_date IS NOT NULL
         AND TO_CHAR(c.birth_date, 'MM-DD') = $2
         AND c.is_active = true
       GROUP BY c.id`,
      [trigger.merchant_id, `${mm}-${dd}`]
    );
    for (const client of clients.rows) {
      const result = await fireTrigger(trigger, client);
      if (result) count++;
    }
  }
  console.log(`[TRIGGERS] ${count} anniversaires traités`);
  return count;
}

/**
 * Exécute une campagne : envoie les messages à tous les clients ciblés
 */
async function executeCampaign(campaignId) {
  const campaign = await pool.query(
    "SELECT ca.*, m.name AS merchant_name FROM campaigns ca JOIN merchants m ON m.id = ca.merchant_id WHERE ca.id = $1",
    [campaignId]
  );
  if (!campaign.rows[0]) throw new Error('Campagne introuvable');
  const c = campaign.rows[0];

  await pool.query("UPDATE campaigns SET status = 'running', updated_at = NOW() WHERE id = $1", [campaignId]);

  const clients = await pool.query(
    `SELECT cl.* FROM rfm_scores rs
     JOIN clients cl ON cl.id = rs.client_id
     WHERE rs.merchant_id = $1 AND rs.segment = $2 AND cl.is_active = true`,
    [c.merchant_id, c.target_segment]
  );

  await pool.query("UPDATE campaigns SET total_targeted = $1 WHERE id = $2", [clients.rows.length, campaignId]);

  let sent = 0;
  for (const client of clients.rows) {
    const actionId = uuidv4();
    const message = (c.message_template || '')
      .replace('{client_name}', client.full_name || '')
      .replace('{merchant_name}', c.merchant_name || '');

    await pool.query(
      `INSERT INTO campaign_actions (id, campaign_id, client_id, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())`,
      [actionId, campaignId, client.id]
    );

    try {
      if (c.channel === 'email' && client.email) {
        await sendEmail(client.email, `${c.name}`, message);
      } else if (client.phone) {
        await sendSMS(client.phone, message);
      }
      await pool.query("UPDATE campaign_actions SET status = 'sent', sent_at = NOW() WHERE id = $1", [actionId]);
      sent++;
    } catch {
      await pool.query("UPDATE campaign_actions SET status = 'failed' WHERE id = $1", [actionId]);
    }
  }

  await pool.query(
    "UPDATE campaigns SET status = 'completed', total_sent = $1, updated_at = NOW() WHERE id = $2",
    [sent, campaignId]
  );
  console.log(`[CAMPAIGN] ${c.name}: ${sent}/${clients.rows.length} envoyés`);
  return sent;
}

module.exports = {
  fireTrigger,
  canFireTrigger,
  triggerBienvenue,
  triggerPremierAchat,
  runSegmentTriggers,
  runBirthdayTriggers,
  executeCampaign,
};
