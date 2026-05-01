'use strict';

/**
 * Adapter LAfricaMobile — SMS + WhatsApp Business.
 *
 * Endpoints (docs LAfricaMobile) :
 *   - SMS  : POST {BASE}/sms/send       { to, from, text }
 *   - WApp : POST {BASE}/whatsapp/send  { to, text } (template optionnel)
 *
 * Auth : header `Authorization: Bearer <LAFRICAMOBILE_API_KEY>`.
 *
 * Mode sandbox : si LAFRICAMOBILE_API_KEY absent → log console et succès simulé.
 *
 * Variables d'env :
 *   LAFRICAMOBILE_API_KEY
 *   LAFRICAMOBILE_SENDER         (sender ID SMS, ex: "AFRIKFID")
 *   LAFRICAMOBILE_BASE_URL       (par défaut https://api.lafricamobile.com/v1)
 *   LAFRICAMOBILE_WHATSAPP_FROM  (numéro WhatsApp expéditeur, optionnel)
 */

const axios = require('axios');

const API_KEY = process.env.LAFRICAMOBILE_API_KEY;
const SENDER = process.env.LAFRICAMOBILE_SENDER || "AFRIKFID";
const BASE_URL = process.env.LAFRICAMOBILE_BASE_URL || 'https://api.lafricamobile.com/v1';
const WHATSAPP_FROM = process.env.LAFRICAMOBILE_WHATSAPP_FROM;

const ENABLED = !!API_KEY;

function formatPhone(phone, defaultCountryCode = '225') {
  let clean = String(phone || '').replace(/[\s\-().]/g, '');
  if (clean.startsWith('+')) clean = clean.slice(1);
  if (clean.startsWith('00')) clean = clean.slice(2);
  if (clean.length <= 9) clean = defaultCountryCode + clean;
  return clean;
}

async function sendSMS(to, message) {
  if (!to) throw new Error('Numéro requis');
  const phone = formatPhone(to);
  const text = String(message).slice(0, 480);

  if (!ENABLED) {
    console.info(`[LAfricaMobile/SMS] sandbox to=${phone} msg="${text.slice(0, 80)}"`);
    return { status: 'sandbox', to: phone };
  }

  try {
    const res = await axios.post(
      `${BASE_URL}/sms/send`,
      { to: phone, from: SENDER, text },
      { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    return { status: 'sent', provider: 'lafricamobile', messageId: res.data?.id || res.data?.message_id, to: phone };
  } catch (err) {
    console.error('[LAfricaMobile/SMS] erreur:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || err.message);
  }
}

async function sendWhatsApp(to, message) {
  if (!to) throw new Error('Numéro requis');
  const phone = formatPhone(to);
  const text = String(message).slice(0, 4096);

  if (!ENABLED) {
    console.info(`[LAfricaMobile/WApp] sandbox to=${phone} msg="${text.slice(0, 80)}"`);
    return { status: 'sandbox', to: phone };
  }

  try {
    const payload = { to: phone, text };
    if (WHATSAPP_FROM) payload.from = WHATSAPP_FROM;
    const res = await axios.post(
      `${BASE_URL}/whatsapp/send`,
      payload,
      { headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    return { status: 'sent', provider: 'lafricamobile', messageId: res.data?.id || res.data?.message_id, to: phone };
  } catch (err) {
    console.error('[LAfricaMobile/WApp] erreur:', err.response?.data || err.message);
    throw new Error(err.response?.data?.message || err.message);
  }
}

module.exports = { sendSMS, sendWhatsApp, formatPhone, ENABLED };
