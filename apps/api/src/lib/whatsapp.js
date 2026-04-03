'use strict';

/**
 * WhatsApp Business API — Notifications Afrik'Fid
 * CDC v3 §1.4 — Starter Boost: Dashboard WhatsApp simplifié + notifications push
 *
 * Supporte deux providers :
 * 1. WhatsApp Business Cloud API (Meta) — WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID
 * 2. Twilio WhatsApp — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM
 * 3. Mode sandbox (log console) si aucun provider configuré
 */

const axios = require('axios');

const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM; // ex: whatsapp:+14155238886

const META_ENABLED = !!(WA_TOKEN && WA_PHONE_NUMBER_ID);
const TWILIO_ENABLED = !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);

/**
 * Formate un numéro de téléphone pour WhatsApp (E.164 sans le +)
 * Ex: "+225 07 00 00 00" → "2250700000" | "0700000000" (CI) → "2250700000" si country_code fourni
 */
function formatPhone(phone, defaultCountryCode = '225') {
  let clean = phone.replace(/[\s\-().]/g, '');
  if (clean.startsWith('+')) clean = clean.slice(1);
  if (clean.startsWith('00')) clean = clean.slice(2);
  // Si le numéro ne commence pas par un indicatif (< 10 chiffres), préfixer
  if (clean.length <= 9) clean = defaultCountryCode + clean;
  return clean;
}

// ─── Provider 1 : Meta Cloud API ─────────────────────────────────────────────

async function sendViaMeta(to, message) {
  const phone = formatPhone(to);
  const res = await axios.post(
    `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );
  const msgId = res.data?.messages?.[0]?.id;
  return { status: 'sent', provider: 'meta', messageId: msgId, to: phone };
}

// ─── Provider 2 : Twilio WhatsApp ─────────────────────────────────────────────

async function sendViaTwilio(to, message) {
  const phone = 'whatsapp:+' + formatPhone(to);
  const params = new URLSearchParams({
    From: TWILIO_FROM,
    To: phone,
    Body: message,
  });
  const res = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    params.toString(),
    {
      auth: { username: TWILIO_SID, password: TWILIO_TOKEN },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    }
  );
  return { status: 'sent', provider: 'twilio', messageId: res.data?.sid, to: phone };
}

// ─── Envoi unifié ─────────────────────────────────────────────────────────────

/**
 * Envoie un message WhatsApp
 * @param {string} to   Numéro de téléphone (format libre, sera normalisé)
 * @param {string} message  Texte du message (max 4096 chars)
 */
async function sendWhatsApp(to, message) {
  if (!to) throw new Error('Numéro de téléphone requis');
  const text = message.slice(0, 4096);

  if (META_ENABLED) return sendViaMeta(to, text);
  if (TWILIO_ENABLED) return sendViaTwilio(to, text);

  // Sandbox
  console.info(`[NOTIF/WHATSAPP] sandbox: to=${to} msg="${text.slice(0, 80)}..."`);
  return { status: 'sandbox', to, message: text };
}

// ─── Templates métier Afrik'Fid ───────────────────────────────────────────────

/**
 * Notification de bienvenue Starter Boost
 *Trigger BIENVENUE
 */
async function notifyWelcomeWhatsApp(client, merchantName) {
  const name = client.full_name || 'cher client';
  const message =
    `👋 Bienvenu(e) ${name} !\n\n` +
    `Vous faites maintenant partie du programme de fidélité *${merchantName}* via *Afrik'Fid*.\n\n` +
    `✨ Gagnez des points à chaque achat et profitez de remises exclusives.\n` +
    `💳 Votre statut actuel : *OPEN* — continuez vos achats pour progresser !\n\n` +
    `_Afrik'Fid — Smart Loyalty_`;
  return sendWhatsApp(client.phone, message);
}

/**
 * Confirmation de paiement avec détail remise
 *étape 8
 */
async function notifyPaymentWhatsApp(client, tx) {
  const name = client.full_name || 'client';
  const rebate = Number(tx.client_rebate_amount || 0);
  const message =
    `✅ *Paiement confirmé* — ${Number(tx.gross_amount).toLocaleString('fr-FR')} FCFA\n\n` +
    `Bonjour ${name},\n` +
    `Votre paiement chez *${tx.merchant_name || 'le marchand'}* a bien été reçu.\n\n` +
    (rebate > 0
      ? `🎁 Remise fidélité appliquée : *${rebate.toLocaleString('fr-FR')} FCFA*\n`
      : '') +
    `📊 Statut fidélité : *${tx.client_loyalty_status || 'OPEN'}*\n\n` +
    `_Afrik'Fid_`;
  return sendWhatsApp(client.phone, message);
}

/**
 * Alerte churn — segment À RISQUE Trigger ALERTE_R)
 */
async function notifyChurnAlertWhatsApp(client, merchantName, offerText) {
  const name = client.full_name || 'cher client';
  const offer = offerText || 'des points x2 sur votre prochain achat';
  const message =
    `💛 *Vous nous manquez, ${name} !*\n\n` +
    `Cela fait un moment que vous n'avez pas visité *${merchantName}*.\n\n` +
    `🎁 Offre spéciale pour vous : ${offer}\n\n` +
    `Profitez-en maintenant !\n\n` +
    `_Afrik'Fid — Smart Loyalty_`;
  return sendWhatsApp(client.phone, message);
}

/**
 * Notification de montée de statut Trigger PALIER)
 */
async function notifyStatusUpgradeWhatsApp(client, newStatus) {
  const name = client.full_name || 'cher client';
  const emojis = { LIVE: '⭐', GOLD: '🥇', ROYAL: '👑', ROYAL_ELITE: '💎' };
  const emoji = emojis[newStatus] || '🎉';
  const message =
    `${emoji} *Félicitations ${name} !*\n\n` +
    `Vous venez de passer au statut *${newStatus}* dans le programme Afrik'Fid !\n\n` +
    `🎁 Vos nouveaux avantages sont maintenant actifs.\n` +
    `Continuez vos achats pour profiter de remises encore plus importantes.\n\n` +
    `_Afrik'Fid — Smart Loyalty_`;
  return sendWhatsApp(client.phone, message);
}

/**
 * Rappel requalification 
 */
async function notifyRequalificationWhatsApp(client, daysLeft, pointsNeeded, currentStatus) {
  const name = client.full_name || 'cher client';
  const message =
    `⏰ *Rappel statut fidélité — ${daysLeft} jours restants*\n\n` +
    `Bonjour ${name},\n\n` +
    `Il vous reste *${daysLeft} jours* pour maintenir votre statut *${currentStatus}*.\n` +
    `Points encore nécessaires : *${pointsNeeded.toLocaleString('fr-FR')} pts*\n\n` +
    `Effectuez des achats maintenant pour garder vos avantages !\n\n` +
    `_Afrik'Fid — Smart Loyalty_`;
  return sendWhatsApp(client.phone, message);
}

/**
 * Rapport fidélité mensuel simplifié pour marchand Starter Boost
 *— "Score fidélité mensuel"
 */
async function notifyMerchantMonthlyScoreWhatsApp(merchant, stats) {
  const name = merchant.name || 'Marchand';
  const message =
    `📊 *Rapport fidélité mensuel — ${name}*\n\n` +
    `🗓️ ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}\n\n` +
    `👥 Clients actifs : *${stats.active_clients}*\n` +
    `🔁 Taux de retour : *${stats.return_rate}%*\n` +
    `💰 CA mensuel : *${Number(stats.monthly_revenue).toLocaleString('fr-FR')} FCFA*\n` +
    `⭐ Clients fidèles (Live+) : *${stats.loyal_clients}*\n\n` +
    (stats.top_client_name
      ? `🏆 Meilleur client : *${stats.top_client_name}*\n\n`
      : '') +
    `_Afrik'Fid — Smart Loyalty_`;
  return sendWhatsApp(merchant.whatsapp || merchant.phone, message);
}

module.exports = {
  sendWhatsApp,
  notifyWelcomeWhatsApp,
  notifyPaymentWhatsApp,
  notifyChurnAlertWhatsApp,
  notifyStatusUpgradeWhatsApp,
  notifyRequalificationWhatsApp,
  notifyMerchantMonthlyScoreWhatsApp,
  formatPhone,
};
