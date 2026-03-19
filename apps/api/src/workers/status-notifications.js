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

    // Vérifier chaque palier de notification
    for (const schedule of STATUS_NOTIFICATION_SCHEDULE) {
      if (schedule.days_before && daysUntil === schedule.days_before) {
        // J-90, J-30, J-7
        notifyRequalificationReminder({
          client,
          daysRemaining: schedule.days_before,
          currentStatus: client.loyalty_status,
          pointsNeeded: 0, // calculé dans le handler
        });
        count++;
      }
    }
  }

  // J+1 : notifier les changements de statut récents (dans les 2 derniers jours)
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isJ1Check = true; // On vérifie toujours les changements récents

  if (isJ1Check) {
    const changes = await pool.query(`
      SELECT lsh.*, c.full_name, c.phone, c.email
      FROM loyalty_status_history lsh
      JOIN clients c ON c.id = lsh.client_id
      WHERE lsh.changed_at >= NOW() - INTERVAL '2 days' AND lsh.changed_by = 'batch'
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
