'use strict';

/**
 * Webhook Dispatcher — Afrik'Fid
 *
 * Gère l'envoi asynchrone des événements webhook aux marchands.
 * Fonctionnalités:
 *   - Signature HMAC-SHA256 de chaque payload
 *   - Retry avec backoff exponentiel (3 tentatives: 3min, 10min, 30min)
 *   - Enregistrement du statut dans webhook_events
 *   - Planification périodique via processRetryQueue()
 */

const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');

// Délais de retry en millisecondes
const RETRY_DELAYS_MS = [
  3 * 60 * 1000,  // 3 minutes
  10 * 60 * 1000, // 10 minutes
  30 * 60 * 1000, // 30 minutes
];

const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // 4 tentatives au total
const WEBHOOK_TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS) || 5000;

/**
 * Génère la signature HMAC-SHA256 d'un payload
 * Format: sha256=<hex>
 */
function signPayload(payload, secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${sig}`;
}

/**
 * Crée un événement webhook en base et tente l'envoi immédiat
 *
 * @param {string} merchantId
 * @param {string} eventType  - ex: 'payment.completed', 'payment.refunded'
 * @param {object} payload    - données de l'événement
 */
async function dispatchWebhook(merchantId, eventType, payload) {
  const merchant = db.prepare(
    'SELECT id, webhook_url, api_key_secret FROM merchants WHERE id = ? AND is_active = 1'
  ).get(merchantId);

  if (!merchant || !merchant.webhook_url) return null;

  const eventId = uuidv4();
  const payloadStr = JSON.stringify({
    id: eventId,
    event: eventType,
    data: payload,
    created_at: new Date().toISOString(),
    api_version: 'v1',
  });

  db.prepare(`
    INSERT INTO webhook_events (id, merchant_id, event_type, payload, url, status, attempts, next_retry_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, datetime('now'))
  `).run(eventId, merchantId, eventType, payloadStr, merchant.webhook_url);

  // Tentative immédiate
  await attemptDelivery(eventId);
  return eventId;
}

/**
 * Tente d'envoyer un webhook et met à jour son statut
 */
async function attemptDelivery(eventId) {
  const event = db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(eventId);
  if (!event || event.status === 'delivered') return;

  const merchant = db.prepare(
    'SELECT api_key_secret FROM merchants WHERE id = ?'
  ).get(event.merchant_id);

  const secret = merchant ? (merchant.api_key_secret || '') : '';
  if (!secret) {
    console.warn(`[webhook] Merchant ${event.merchant_id} has no api_key_secret — signature header will be invalid`);
  }
  const signature = signPayload(event.payload, secret);

  const attempts = event.attempts + 1;

  try {
    const response = await axios.post(event.url, JSON.parse(event.payload), {
      timeout: WEBHOOK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-AfrikFid-Signature': signature,
        'X-AfrikFid-Event': event.event_type,
        'X-AfrikFid-Delivery': eventId,
      },
    });

    // Succès si code 2xx
    db.prepare(`
      UPDATE webhook_events
      SET status = 'delivered', attempts = ?, last_response_code = ?, sent_at = datetime('now'), last_error = NULL
      WHERE id = ?
    `).run(attempts, response.status, eventId);

  } catch (err) {
    const statusCode = err.response ? err.response.status : null;
    const errorMsg = err.message || 'Erreur inconnue';

    if (attempts >= MAX_ATTEMPTS) {
      // Épuisé toutes les tentatives
      db.prepare(`
        UPDATE webhook_events
        SET status = 'failed', attempts = ?, last_response_code = ?, last_error = ?, next_retry_at = NULL
        WHERE id = ?
      `).run(attempts, statusCode, errorMsg.slice(0, 500), eventId);
    } else {
      // Planifier le prochain retry
      const delayMs = RETRY_DELAYS_MS[attempts - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextRetry = new Date(Date.now() + delayMs).toISOString();

      db.prepare(`
        UPDATE webhook_events
        SET status = 'pending', attempts = ?, last_response_code = ?, last_error = ?, next_retry_at = ?
        WHERE id = ?
      `).run(attempts, statusCode, errorMsg.slice(0, 500), nextRetry, eventId);
    }
  }
}

/**
 * Traite la file des webhooks en attente de retry
 * À appeler périodiquement (ex: toutes les 2 minutes via cron)
 */
async function processRetryQueue() {
  const pending = db.prepare(`
    SELECT id FROM webhook_events
    WHERE status = 'pending'
    AND next_retry_at <= datetime('now')
    AND attempts < ?
    ORDER BY next_retry_at ASC
    LIMIT 50
  `).all(MAX_ATTEMPTS);

  if (pending.length === 0) return 0;

  let processed = 0;
  for (const event of pending) {
    await attemptDelivery(event.id);
    processed++;
  }

  return processed;
}

/**
 * Remet un webhook échoué en file de retry (admin)
 */
function requeueWebhook(eventId) {
  const event = db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(eventId);
  if (!event) return false;

  db.prepare(`
    UPDATE webhook_events
    SET status = 'pending', next_retry_at = datetime('now'), last_error = NULL
    WHERE id = ?
  `).run(eventId);

  // Tenter immédiatement en arrière-plan
  attemptDelivery(eventId).catch(console.error);
  return true;
}

/**
 * Helpers pour créer des événements typés
 */
const WebhookEvents = {
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  STATUS_UPGRADED: 'loyalty.status_upgraded',
};

module.exports = {
  dispatchWebhook,
  processRetryQueue,
  requeueWebhook,
  signPayload,
  WebhookEvents,
};
