'use strict';

const { CronJob } = require('cron');
const { pool } = require('../lib/db');
const { notifyRequalificationReminder } = require('../lib/notifications');
const { LOYALTY_POINTS_THRESHOLDS } = require('../config/constants');

/**
 * CDC v3 §2.4.3 — Notifications de requalification
 * J-90, J-30, J-7 avant évaluation mensuelle
 * Évaluation = 1er du mois → on calcule les jours restants par rapport au prochain 1er
 */
async function runStatusNotifications() {
  console.log('[STATUS-NOTIF] Démarrage notifications requalification...');

  const now = new Date();
  const nextFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysUntilEval = Math.ceil((nextFirst - now) / (1000 * 60 * 60 * 24));

  // Déterminer quels rappels envoyer aujourd'hui
  const reminders = [];
  if (daysUntilEval === 90) reminders.push(90);
  if (daysUntilEval === 30) reminders.push(30);
  if (daysUntilEval === 7) reminders.push(7);

  // J+1 = lendemain du 1er du mois
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isJ1 = yesterday.getDate() === 1;

  if (reminders.length === 0 && !isJ1) {
    console.log('[STATUS-NOTIF] Aucun rappel à envoyer aujourd\'hui');
    return 0;
  }

  let count = 0;

  if (reminders.length > 0) {
    // Clients avec statut > OPEN qui risquent de ne pas se requalifier
    const clients = await pool.query(`
      SELECT c.*, lc.min_status_points
      FROM clients c
      JOIN loyalty_config lc ON lc.status = c.loyalty_status
      WHERE c.is_active = true AND c.loyalty_status != 'OPEN' AND c.anonymized_at IS NULL
    `);

    for (const client of clients.rows) {
      const minPoints = Number(client.min_status_points) || 0;
      const currentPoints = Number(client.status_points_12m) || 0;
      const deficit = minPoints - currentPoints;

      if (deficit > 0) {
        for (const days of reminders) {
          notifyRequalificationReminder({
            client,
            daysRemaining: days,
            currentStatus: client.loyalty_status,
            pointsNeeded: deficit,
          });
          count++;
        }
      }
    }
  }

  if (isJ1) {
    // J+1 : notifier les changements de statut du batch
    const changes = await pool.query(`
      SELECT lsh.*, c.full_name, c.phone, c.email
      FROM loyalty_status_history lsh
      JOIN clients c ON c.id = lsh.client_id
      WHERE lsh.changed_at >= NOW() - INTERVAL '2 days'
    `);

    for (const change of changes.rows) {
      notifyRequalificationReminder({
        client: change,
        daysRemaining: 0,
        currentStatus: change.new_status,
        pointsNeeded: 0,
      });
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
