'use strict';

/**
 * Worker quotidien — cycle de vie des abonnements marchands.
 *
 * Pour chaque subscription active :
 *  1. Si current_period_end <= NOW() → expireAndAdvance (consomme période, active
 *     la suivante en file ou bascule en STARTER_BOOST + envoi notif J0).
 *  2. Sinon, si current_period_end - NOW() ∈ {10, 7, 3} jours → envoi des
 *     rappels (Email + WhatsApp + SMS) avec idempotence par
 *     subscription_notifications.
 *
 * Cron : 06h00 Africa/Abidjan, tous les jours.
 *
 * Le marchand paie via Stripe ou Mobile Money depuis l'espace marchand —
 * ce worker ne facture rien automatiquement, il orchestre seulement la fin de vie.
 */

const { CronJob } = require('cron');
const db = require('../lib/db');
const engine = require('../lib/subscription-engine');
const subNotif = require('../lib/subscription-notifications');
const { notifyAdminAlert } = require('../lib/notifications');
const { SUBSCRIPTION_REMINDER_DAYS } = require('../config/constants');

const MS_DAY = 24 * 60 * 60 * 1000;

async function processSubscription(sub) {
  const now = Date.now();
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end).getTime() : null;
  if (!periodEnd) return { skipped: true };

  // Expiration ?
  if (periodEnd <= now) {
    const result = await engine.expireAndAdvance(sub);
    if (result.changed && result.downgraded) {
      const merchant = (await db.query(
        `SELECT id, name, email, phone FROM merchants WHERE id = $1`,
        [sub.merchant_id]
      )).rows[0];
      if (merchant) {
        try { await subNotif.sendExpired(merchant, sub); } catch (e) { /* fire-and-forget */ }
      }
    }
    return { expired: true, ...result };
  }

  // Rappels J-10 / J-7 / J-3
  const daysLeft = Math.ceil((periodEnd - now) / MS_DAY);
  if (!SUBSCRIPTION_REMINDER_DAYS.includes(daysLeft)) return { ok: true };

  const merchant = (await db.query(
    `SELECT id, name, email, phone, package FROM merchants WHERE id = $1`,
    [sub.merchant_id]
  )).rows[0];
  if (!merchant) return { ok: true };

  const kind = `reminder_d${daysLeft}`;
  const periodEndRef = new Date(sub.current_period_end);
  // Idempotence par canal : insère préalablement les 3 (chacun unique par canal)
  const channels = ['email', 'whatsapp', 'sms'];
  const sendable = [];
  for (const ch of channels) {
    if (await engine.alreadySent(sub.id, kind, ch, periodEndRef)) continue;
    sendable.push(ch);
  }
  if (sendable.length === 0) return { ok: true, alreadySent: true };

  try {
    await subNotif.sendReminder(merchant, sub, daysLeft);
  } catch (e) { /* fire-and-forget */ }

  for (const ch of sendable) {
    await engine.recordReminderSent(sub.id, kind, ch, periodEndRef);
  }
  return { reminder: kind, channels: sendable };
}

async function runDaily() {
  console.log('[SUBSCRIPTION-WORKER] Début du cycle quotidien');
  const subs = await db.query(
    `SELECT s.* FROM subscriptions s
       JOIN merchants m ON m.id = s.merchant_id
      WHERE s.status = 'active'
        AND m.is_active = TRUE`
  );
  let expired = 0, reminders = 0, errors = 0;
  for (const sub of subs.rows) {
    try {
      const r = await processSubscription(sub);
      if (r.expired) expired++;
      if (r.reminder) reminders++;
    } catch (err) {
      errors++;
      console.error(`[SUBSCRIPTION-WORKER] Erreur sub ${sub.id}:`, err.message);
    }
  }
  if (errors > 0) {
    notifyAdminAlert(`[Worker abonnements] ${errors} erreur(s) sur ${subs.rows.length} subs`).catch(() => { });
  }
  console.log(`[SUBSCRIPTION-WORKER] Terminé — ${expired} expirations, ${reminders} rappels, ${errors} erreurs`);
  return { expired, reminders, errors, total: subs.rows.length };
}

let job;
function start() {
  if (process.env.NODE_ENV === 'test') return;
  job = new CronJob('0 6 * * *', async () => {
    try { await runDaily(); }
    catch (err) { console.error('[SUBSCRIPTION-WORKER] Erreur critique:', err.message); }
  }, null, true, 'Africa/Abidjan');
  console.log('[SUBSCRIPTION-WORKER] Cron quotidien programmé (06h00 Abidjan)');
}

function stop() { if (job) job.stop(); }

module.exports = { start, stop, runDaily, processSubscription };
