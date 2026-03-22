'use strict';

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const { notifyRequalificationReminder } = require('../lib/notifications');
const { STATUS_NOTIFICATION_SCHEDULE } = require('../config/constants');

/**
 * CDC v3 §2.4.3 — Notifications de requalification planifiées
 * Utilise qualification_deadline (12 mois glissants) pour J-90, J-30, J-7, J+1
 */
async function runStatusNotifications() {
  console.log('[STATUS-NOTIF] Démarrage notifications requalification...');

  const now = new Date();
  let count = 0;

  // Charger la config loyauté une fois pour calculer les points manquants dynamiquement
  const loyaltyConfig = (await pool.query('SELECT * FROM loyalty_config')).rows;
  const configByStatus = Object.fromEntries(loyaltyConfig.map(c => [c.status, c]));

  // Clients avec statut > OPEN qui ont une deadline de requalification
  const clients = await pool.query(`
    SELECT c.id, c.full_name, c.phone, c.email, c.loyalty_status,
           c.qualification_deadline, c.status_points_12m
    FROM clients c
    WHERE c.is_active = true AND c.loyalty_status != 'OPEN'
      AND c.anonymized_at IS NULL AND c.qualification_deadline IS NOT NULL
  `);

  for (const client of clients.rows) {
    const deadline = new Date(client.qualification_deadline);
    const daysUntil = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

    // Calculer les points manquants dynamiquement (CDC §2.4.3)
    const config = configByStatus[client.loyalty_status];
    const requiredPoints = config ? parseInt(config.min_status_points) || 0 : 0;
    const currentPoints = parseInt(client.status_points_12m) || 0;
    const pointsNeeded = Math.max(0, requiredPoints - currentPoints);

    // Vérifier chaque palier de notification
    for (const schedule of STATUS_NOTIFICATION_SCHEDULE) {
      // Fenêtre ±1 jour pour absorber les décalages de cron (comparaison stricte = bug si cron décale)
      if (schedule.days_before && Math.abs(daysUntil - schedule.days_before) <= 1) {
        // J-90, J-30, J-7
        notifyRequalificationReminder({
          client,
          daysRemaining: schedule.days_before,
          currentStatus: client.loyalty_status,
          pointsNeeded,
        });
        count++;
      }
    }
  }

  // J+1 : notifier les changements de statut des dernières 24h
  // Utilise notified_j1 IS NULL pour éviter les doublons si le worker tourne plusieurs fois
  const j1Schedule = STATUS_NOTIFICATION_SCHEDULE.find(s => s.days_after === 1);
  if (j1Schedule) {
    const changes = await pool.query(`
      SELECT lsh.*, c.full_name, c.phone, c.email
      FROM loyalty_status_history lsh
      JOIN clients c ON c.id = lsh.client_id
      WHERE lsh.changed_at >= NOW() - INTERVAL '24 hours'
        AND lsh.changed_by = 'batch'
        AND lsh.notified_j1 IS NULL
    `);

    for (const change of changes.rows) {
      // Calculer points manquants pour le nouveau statut
      // new_status_points_12m n'est pas dans loyalty_status_history — lire sur le client
      const clientRow = (await pool.query('SELECT status_points_12m FROM clients WHERE id = $1', [change.client_id])).rows[0];
      const changeConfig = configByStatus[change.new_status];
      const changeRequired = changeConfig ? parseInt(changeConfig.min_status_points) || 0 : 0;
      const changePoints = parseInt(clientRow?.status_points_12m) || 0;
      const changePointsNeeded = Math.max(0, changeRequired - changePoints);

      notifyRequalificationReminder({
        client: change,
        daysRemaining: -1, // -1 indique une notification post-changement (J+1)
        currentStatus: change.new_status,
        pointsNeeded: changePointsNeeded,
      });

      // Marquer comme notifié pour éviter les doublons
      await pool.query(
        `UPDATE loyalty_status_history SET notified_j1 = NOW() WHERE id = $1`,
        [change.id]
      );
      count++;
    }
  }

  console.log(`[STATUS-NOTIF] ${count} notifications envoyées`);
  return count;
}

// Cron quotidien à 08h00 (CDC v3 §6.4)
const statusNotifWorker = new CronJob('0 8 * * *', async () => {
  try {
    await runStatusNotifications();
  } catch (err) {
    console.error('[STATUS-NOTIF] Erreur:', err.message);
  }
}, null, false, 'Africa/Abidjan');

module.exports = statusNotifWorker;
module.exports.runStatusNotifications = runStatusNotifications;
