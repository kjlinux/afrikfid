'use strict';

/**
 * CDC v3 §6.4 — Workflow 10h00
 * "Dashboard équipe — Liste des clients à contacter en priorité"
 *
 * Ce worker génère et stocke la liste quotidienne des clients à contacter
 * en priorité pour chaque marchand, accessible via GET /reports/contact-priority.
 *
 * Critères de priorisation :
 * 1. Clients en segment À_RISQUE ou HIBERNANTS avec score churn élevé (critical/high)
 * 2. Clients dont c'est l'anniversaire aujourd'hui (trigger ANNIVERSAIRE)
 * 3. Clients avec statut ALERTE_R récent (R passé de 4→3)
 * 4. Clients du protocole abandon en étape active (win-back non répondu)
 */

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const { getMerchantChurnRisk } = require('../lib/churn-prediction');

/**
 * Génère la liste de priorités pour tous les marchands actifs
 */
async function generateContactPriorityLists() {
  console.log('[CONTACT-PRIORITY] Génération listes 10h00...');

  // Récupérer tous les marchands actifs
  const merchants = await pool.query(
    "SELECT id, name, package FROM merchants WHERE status = 'active'"
  );

  let totalGenerated = 0;

  for (const merchant of merchants.rows) {
    try {
      const list = await buildPriorityList(merchant.id);
      if (list.length === 0) continue;

      // Stocker dans la table contact_priority_lists (upsert par date)
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(`
        INSERT INTO contact_priority_lists (merchant_id, date, items, generated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (merchant_id, date)
        DO UPDATE SET items = EXCLUDED.items, generated_at = NOW()
      `, [merchant.id, today, JSON.stringify(list)]);

      totalGenerated += list.length;
    } catch (err) {
      console.error(`[CONTACT-PRIORITY] Erreur marchand ${merchant.id}:`, err.message);
    }
  }

  console.log(`[CONTACT-PRIORITY] ${totalGenerated} contacts prioritaires générés pour ${merchants.rows.length} marchands`);
  return totalGenerated;
}

/**
 * Construit la liste de contacts prioritaires pour un marchand
 */
async function buildPriorityList(merchantId) {
  const today = new Date();
  const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [riskClients, birthdayClients, abandonClients] = await Promise.all([
    // 1. Clients churn high/critical
    getMerchantChurnRisk(merchantId, 'high', 20).catch(() => []),

    // 2. Clients avec anniversaire aujourd'hui
    pool.query(`
      SELECT c.id, c.full_name, c.phone, c.loyalty_status,
        'ANNIVERSAIRE' AS priority_reason, 'high' AS priority_level
      FROM clients c
      JOIN transactions t ON t.client_id = c.id
      WHERE t.merchant_id = $1
        AND TO_CHAR(c.birth_date, 'MM-DD') = $2
      GROUP BY c.id, c.full_name, c.phone, c.loyalty_status
    `, [merchantId, todayMD]).catch(() => ({ rows: [] })),

    // 3. Clients en protocole abandon actif (étape 1-4)
    pool.query(`
      SELECT c.id, c.full_name, c.phone, c.loyalty_status,
        at.step AS abandon_step,
        at.next_action_at,
        'ABANDON_PROTOCOL' AS priority_reason,
        CASE WHEN at.step >= 3 THEN 'critical' ELSE 'high' END AS priority_level
      FROM abandon_tracking at
      JOIN clients c ON c.id = at.client_id
      WHERE at.merchant_id = $1
        AND at.status = 'active'
        AND at.step < 5
        AND at.next_action_at <= NOW() + INTERVAL '2 hours'
      ORDER BY at.step DESC, at.next_action_at ASC
      LIMIT 10
    `, [merchantId]).catch(() => ({ rows: [] })),
  ]);

  const list = [];

  // Clients à risque churn
  for (const r of riskClients) {
    list.push({
      client_id: r.client_id,
      client_name: r.client_name,
      priority_reason: r.churn_level === 'critical' ? 'CHURN_CRITIQUE' : 'CHURN_ELEVE',
      priority_level: r.churn_level,
      churn_score: r.churn_score,
      signals: r.signals,
      recommended_action: r.recommendation,
    });
  }

  // Clients anniversaire
  for (const row of birthdayClients.rows) {
    list.push({
      client_id: row.id,
      client_name: row.full_name,
      priority_reason: 'ANNIVERSAIRE',
      priority_level: 'high',
      recommended_action: 'Envoyer message personnalisé + cadeau fidélité',
    });
  }

  // Clients protocole abandon
  for (const row of abandonClients.rows) {
    list.push({
      client_id: row.id,
      client_name: row.full_name,
      priority_reason: `ABANDON_ETAPE_${row.abandon_step}`,
      priority_level: row.priority_level,
      next_action_at: row.next_action_at,
      recommended_action: getAbandonAction(Number(row.abandon_step)),
    });
  }

  // Trier: critical d'abord, puis high
  const levels = { critical: 0, high: 1, medium: 2, low: 3 };
  list.sort((a, b) => (levels[a.priority_level] ?? 4) - (levels[b.priority_level] ?? 4));

  return list;
}

function getAbandonAction(step) {
  const actions = {
    1: 'Win-back 1 : Offre -15% ou points x2',
    2: 'Win-back 2 : Message "Vous nous manquez" + offre -20%',
    3: 'Win-back 3 : Dernière chance -30%',
    4: 'Enquête satisfaction : "Pourquoi êtes-vous parti ?"',
  };
  return actions[step] || 'Action de réactivation';
}

// Cron 10h00 quotidien (CDC §6.4)
const contactPriorityWorker = new CronJob('0 10 * * *', async () => {
  try {
    await generateContactPriorityLists();
  } catch (err) {
    console.error('[CONTACT-PRIORITY] Erreur worker:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = contactPriorityWorker;
module.exports.generateContactPriorityLists = generateContactPriorityLists;
module.exports.buildPriorityList = buildPriorityList;
