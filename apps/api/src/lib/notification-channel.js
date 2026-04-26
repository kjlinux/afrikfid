'use strict';

/**
 * Service unifié de notifications client/marchand.
 *
 * Pipeline : Lafricamobile WhatsApp (prioritaire) → Meta/Twilio WhatsApp (fallback)
 *            → Email (si canal explicite ou échec WA + email dispo) → sandbox.
 *
 * Tous les envois sont consignés dans `communication_log` (audit consolidé)
 * et exposent un retry_count exploitable par le worker `notification-retry`.
 */

const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db');
const lam = require('./lafricamobile-whatsapp');
const { sendWhatsApp } = require('./whatsapp');
const { sendEmail, sendSMS } = require('./notifications');

const DEFAULT_COUNTRY_CODE = process.env.LAM_DEFAULT_COUNTRY_CODE || '225';

function normaliseWaId(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 9) return DEFAULT_COUNTRY_CODE + digits.replace(/^0+/, '');
  return digits;
}

/**
 * Envoi unifié.
 *
 * @param {object} params
 *   - rawPhone, rawEmail (déjà déchiffrés par l'appelant)
 *   - text             — corps texte (utilisé si template non fourni / fallback)
 *   - template         — { name, namespace, languageCode, bodyParams } (optionnel)
 *   - subject          — sujet email
 *   - channel          — 'whatsapp' | 'email' | 'auto' (def. 'auto')
 *   - context          — { type, ref_id, merchant_id, client_id } pour audit
 */
async function send({ rawPhone, rawEmail, text, template, subject, channel = 'auto', context = {} }) {
  const logId = uuidv4();
  const ctx = context || {};
  let provider = null;
  let status = 'failed';
  let errorMessage = null;
  let externalId = null;

  await pool.query(
    `INSERT INTO communication_log
       (id, ref_type, ref_id, merchant_id, client_id, channel, status, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())`,
    [
      logId,
      ctx.type || null,
      ctx.ref_id || null,
      ctx.merchant_id || null,
      ctx.client_id || null,
      channel,
      JSON.stringify({ text: text ? text.slice(0, 500) : null, hasTemplate: !!template, subject: subject || null }),
    ]
  ).catch(() => { /* la table peut ne pas être migrée encore */ });

  try {
    if ((channel === 'whatsapp' || channel === 'auto') && rawPhone) {
      const waId = normaliseWaId(rawPhone);

      if (waId && lam.isConfigured() && template) {
        const r = await lam.sendTemplate(waId, template);
        if (r.ok) { provider = 'lafricamobile_template'; status = 'sent'; externalId = r.messageId; }
        else { errorMessage = r.error || `lam_${r.status}`; }
      }

      if (status !== 'sent' && waId && lam.isConfigured() && text) {
        const r = await lam.sendText(waId, text);
        if (r.ok) { provider = 'lafricamobile_text'; status = 'sent'; externalId = r.messageId; }
        else { errorMessage = errorMessage || r.error || `lam_${r.status}`; }
      }

      if (status !== 'sent' && text) {
        try {
          const r = await sendWhatsApp(rawPhone, text);
          if (r && r.status === 'sent') { provider = `wa_${r.provider}`; status = 'sent'; externalId = r.messageId; }
          else if (r && r.status === 'sandbox') { provider = 'wa_sandbox'; status = 'sent'; }
        } catch (err) { errorMessage = errorMessage || err.message; }
      }
    }

    // Fallback email : canal email explicite, ou whatsapp/auto sans téléphone, ou auto après échec WA
    const tryEmail = channel === 'email'
      || (channel !== 'email' && !rawPhone)
      || (channel === 'auto' && status !== 'sent');
    if (status !== 'sent' && tryEmail && rawEmail) {
      try {
        await sendEmail(rawEmail, subject || 'Afrik\'Fid', text || '');
        provider = 'email'; status = 'sent';
      } catch (err) { errorMessage = errorMessage || err.message; }
    }

    // Dernier recours SMS uniquement en mode 'auto' avec téléphone disponible
    if (status !== 'sent' && channel === 'auto' && rawPhone && text) {
      try { await sendSMS(rawPhone, text); provider = 'sms'; status = 'sent'; }
      catch (err) { errorMessage = errorMessage || err.message; }
    }
  } catch (err) {
    errorMessage = err.message;
  }

  await pool.query(
    `UPDATE communication_log
       SET status = $2, provider = $3, external_id = $4, error_message = $5,
           sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
     WHERE id = $1`,
    [logId, status, provider, externalId, errorMessage]
  ).catch(() => {});

  return { logId, status, provider, externalId, error: errorMessage };
}

module.exports = { send, normaliseWaId };
