'use strict';

const { pool } = require('./db');
const { v4: uuidv4 } = require('uuid');
const { TRIGGER_TYPES, ABANDON_PROTOCOL_STEPS } = require('../config/constants');
const { sendSMS, sendEmail } = require('./notifications');
const { decrypt } = require('./crypto');

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

  // Déchiffrer phone/email (stockés chiffrés AES-256-GCM en base)
  let rawPhone = null;
  let rawEmail = null;
  try { rawPhone = client.phone ? decrypt(client.phone) : null; } catch { rawPhone = null; }
  try { rawEmail = client.email ? decrypt(client.email) : null; } catch { rawEmail = null; }

  const message = (trigger.message_template || '')
    .replace('{client_name}', client.full_name || '')
    .replace('{merchant_name}', trigger.merchant_name || '')
    .replace('{phone}', rawPhone || '');

  const logId = uuidv4();
  await pool.query(
    `INSERT INTO trigger_logs (id, trigger_id, client_id, merchant_id, trigger_type, channel, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
    [logId, trigger.id, client.id, trigger.merchant_id, trigger.trigger_type, trigger.channel || 'sms']
  );

  try {
    if (trigger.channel === 'email' && rawEmail) {
      await sendEmail(rawEmail, `Afrik'Fid — ${trigger.trigger_type}`, message);
    } else if (rawPhone) {
      await sendSMS(rawPhone, message);
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

  if (['running', 'completed'].includes(c.status)) {
    throw Object.assign(new Error(`Campagne déjà ${c.status}`), { code: 'CAMPAIGN_ALREADY_EXECUTED', status: 409 });
  }

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

    let rawPhone = null;
    let rawEmail = null;
    try { rawPhone = client.phone ? decrypt(client.phone) : null; } catch { rawPhone = null; }
    try { rawEmail = client.email ? decrypt(client.email) : null; } catch { rawEmail = null; }

    try {
      if (c.channel === 'email' && rawEmail) {
        await sendEmail(rawEmail, `${c.name}`, message);
      } else if (rawPhone) {
        await sendSMS(rawPhone, message);
      }
      await pool.query("UPDATE campaign_actions SET status = 'sent', sent_at = NOW() WHERE id = $1", [actionId]);
      sent++;
    } catch (err) {
      //: audit trail obligatoire pour toutes les communications marketing
      console.error(`[CAMPAIGN] Échec envoi action ${actionId} (client ${client.id}):`, err.message);
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

/**
 * Trigger PALIER : changement de statut fidélité (CDC v3 §5.4)
 * Appelé depuis loyalty-engine.js lors d'un changement de statut
 */
async function triggerPalier(merchantId, client, oldStatus, newStatus) {
  const triggers = await pool.query(
    "SELECT t.*, m.name AS merchant_name FROM triggers t JOIN merchants m ON m.id = t.merchant_id WHERE t.merchant_id = $1 AND t.trigger_type = 'PALIER' AND t.is_active = true",
    [merchantId]
  );
  for (const t of triggers.rows) {
    const enrichedTrigger = {
      ...t,
      message_template: (t.message_template || '')
        .replace('{old_status}', oldStatus)
        .replace('{new_status}', newStatus),
    };
    await fireTrigger(enrichedTrigger, client);
  }
}

/**
 * Protocole d'abandon automatisé (CDC v3 §5.5)
 * Démarre le suivi pour les clients A_RISQUE, progresse les étapes, classe en PERDU
 */
async function runAbandonProtocol() {
  console.log('[ABANDON] Exécution du protocole d\'abandon...');
  const now = new Date();
  let actionsCount = 0;

  // 1. Démarrer le protocole pour les nouveaux clients A_RISQUE sans tracking actif
  const newAtRisk = await pool.query(`
    SELECT rs.client_id, rs.merchant_id, c.full_name, c.phone, c.email, m.name AS merchant_name
    FROM rfm_scores rs
    JOIN clients c ON c.id = rs.client_id
    JOIN merchants m ON m.id = rs.merchant_id
    LEFT JOIN abandon_tracking at ON at.client_id = rs.client_id AND at.merchant_id = rs.merchant_id AND at.status = 'active'
    WHERE rs.segment IN ('A_RISQUE', 'HIBERNANTS') AND c.is_active = true AND at.id IS NULL
  `);

  for (const row of newAtRisk.rows) {
    const step = ABANDON_PROTOCOL_STEPS[0];
    const nextStepAt = new Date(now);
    nextStepAt.setDate(nextStepAt.getDate() + (ABANDON_PROTOCOL_STEPS[1]?.delay_days || 14));

    await pool.query(
      `INSERT INTO abandon_tracking (id, client_id, merchant_id, current_step, step_started_at, next_step_at, status, created_at, updated_at)
       VALUES ($1, $2, $3, 1, NOW(), $4, 'active', NOW(), NOW())
       ON CONFLICT (client_id, merchant_id) DO NOTHING`,
      [uuidv4(), row.client_id, row.merchant_id, nextStepAt.toISOString()]
    );

    // Envoyer le message de l'étape 1
    if (step.message) {
      const message = step.message
        .replace('{client_name}', row.full_name || '')
        .replace('{merchant_name}', row.merchant_name || '');
      let rawPhone = null;
      try { rawPhone = row.phone ? decrypt(row.phone) : null; } catch { /* chiffrement corrompu */ }
      if (rawPhone) {
        try { await sendSMS(rawPhone, message); } catch { /* ignore */ }
      }
    }
    actionsCount++;
  }

  // 2. Progresser les étapes pour les trackings actifs dont la date est atteinte
  const dueTrackings = await pool.query(`
    SELECT at.*, c.full_name, c.phone, c.email, m.name AS merchant_name
    FROM abandon_tracking at
    JOIN clients c ON c.id = at.client_id
    JOIN merchants m ON m.id = at.merchant_id
    WHERE at.status = 'active' AND at.next_step_at <= NOW()
  `);

  for (const tracking of dueTrackings.rows) {
    // current_step est 1-based (1..5). On utilise current_step comme index pour accéder
    // à l'étape SUIVANTE dans le tableau (index 0-based). Ex: current_step=1 → ABANDON_PROTOCOL_STEPS[1] = étape 2.
    // Quand current_step=5 (étape finale atteinte), l'index 5 est hors tableau → on ignore.
    const nextStepIdx = tracking.current_step;
    if (nextStepIdx >= ABANDON_PROTOCOL_STEPS.length) continue;

    const nextStep = ABANDON_PROTOCOL_STEPS[nextStepIdx];

    if (nextStep.step === 5) {
      // Étape 5 = classement PERDU définitif
      await pool.query(
        "UPDATE abandon_tracking SET current_step = 5, status = 'lost', updated_at = NOW() WHERE id = $1",
        [tracking.id]
      );
      // Mettre à jour le segment RFM en PERDUS
      await pool.query(
        "UPDATE rfm_scores SET segment = 'PERDUS' WHERE client_id = $1 AND merchant_id = $2",
        [tracking.client_id, tracking.merchant_id]
      );
    } else {
      // Calculer la prochaine date
      const futureStepIdx = nextStepIdx + 1;
      const futureDelay = futureStepIdx < ABANDON_PROTOCOL_STEPS.length ? ABANDON_PROTOCOL_STEPS[futureStepIdx].delay_days : 30;
      const nextDate = new Date(now);
      nextDate.setDate(nextDate.getDate() + futureDelay);

      await pool.query(
        "UPDATE abandon_tracking SET current_step = $1, step_started_at = NOW(), next_step_at = $2, updated_at = NOW() WHERE id = $3",
        [nextStep.step, nextDate.toISOString(), tracking.id]
      );

      // Envoyer le message
      if (nextStep.message) {
        const message = nextStep.message
          .replace('{client_name}', tracking.full_name || '')
          .replace('{merchant_name}', tracking.merchant_name || '');
        let rawPhone = null;
        try { rawPhone = tracking.phone ? decrypt(tracking.phone) : null; } catch { /* chiffrement corrompu */ }
        if (rawPhone) {
          try { await sendSMS(rawPhone, message); } catch { /* ignore */ }
        }
      }
    }
    actionsCount++;
  }

  // 3. Réactiver les clients qui ont acheté récemment
  const reactivated = await pool.query(`
    UPDATE abandon_tracking SET status = 'reactivated', reactivated_at = NOW(), updated_at = NOW()
    WHERE status = 'active' AND client_id IN (
      SELECT DISTINCT t.client_id FROM transactions t
      JOIN abandon_tracking at2 ON at2.client_id = t.client_id AND at2.merchant_id = t.merchant_id
      WHERE t.status = 'completed' AND t.initiated_at > at2.created_at AND at2.status = 'active'
    )
    RETURNING id
  `);
  if (reactivated.rows.length > 0) {
    console.log(`[ABANDON] ${reactivated.rows.length} client(s) réactivé(s)`);
  }

  console.log(`[ABANDON] ${actionsCount} actions exécutées`);
  return actionsCount;
}

/**
 * Traite les transitions RFM détectées depuis le dernier batch — Workflow 07h00)
 * Transitions trackers : ABSENCE (R 5→4), ALERTE_R (R 4→3), passage entre segments
 */
async function runTransitionTriggers() {
  // Récupérer les transitions non traitées des dernières 36h
  const transitions = await pool.query(`
    SELECT rt.*, c.id as cid, c.full_name, c.phone, c.email, c.loyalty_status
    FROM rfm_transitions rt
    JOIN clients c ON c.id = rt.client_id
    WHERE rt.transitioned_at > NOW() - INTERVAL '36 hours'
      AND rt.processed_at IS NULL
      AND c.is_active = TRUE AND c.anonymized_at IS NULL
    ORDER BY rt.transitioned_at DESC
    LIMIT 500
  `).catch(() => ({ rows: [] }));

  let count = 0;

  for (const t of transitions.rows) {
    try {
      // Déclencher le bon trigger selon le type de transition
      let triggerName = null;

      //— Trigger ABSENCE : R passe de 5→4
      if (t.old_r_score === 5 && t.new_r_score === 4) {
        triggerName = 'ABSENCE';
      }
      //— Trigger ALERTE_R : R passe de 4→3
      else if (t.old_r_score === 4 && t.new_r_score === 3) {
        triggerName = 'ALERTE_R';
      }
      //— Trigger WIN_BACK : R tombe à 1 (client perdu)
      else if (t.new_r_score === 1 && t.old_r_score > 1) {
        triggerName = 'WIN_BACK';
      }
      // Passage vers segment À_RISQUE
      else if (t.new_segment === 'A_RISQUE' && t.old_segment !== 'A_RISQUE') {
        triggerName = 'A_RISQUE';
      }

      if (triggerName) {
        // Récupérer la config du trigger pour ce marchand
        const triggerRes = await pool.query(
          "SELECT * FROM triggers WHERE merchant_id = $1 AND name = $2 AND is_active = TRUE LIMIT 1",
          [t.merchant_id, triggerName]
        );
        const trigger = triggerRes.rows[0];

        if (trigger) {
          // Déchiffrer les coordonnées client
          let rawPhone = null, rawEmail = null;
          try { rawPhone = t.phone ? require('./crypto').decrypt(t.phone) : null; } catch { /* skip */ }
          try { rawEmail = t.email ? require('./crypto').decrypt(t.email) : null; } catch { /* skip */ }
          const client = { ...t, id: t.client_id, phone: rawPhone, email: rawEmail };
          await fireTrigger(trigger, client);
        }

        count++;
      }

      // Marquer la transition comme traitée
      await pool.query(
        'UPDATE rfm_transitions SET processed_at = NOW() WHERE id = $1',
        [t.id]
      ).catch(() => { });
    } catch (err) {
      console.error(`[TRANSITIONS] Erreur client ${t.client_id}:`, err.message);
    }
  }

  if (count > 0) console.log(`[TRANSITIONS] ${count} triggers de transition déclenchés`);
  return count;
}

module.exports = {
  fireTrigger,
  canFireTrigger,
  triggerBienvenue,
  triggerPremierAchat,
  triggerPalier,
  runSegmentTriggers,
  runBirthdayTriggers,
  runAbandonProtocol,
  runTransitionTriggers,
  executeCampaign,
};
