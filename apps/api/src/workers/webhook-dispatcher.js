'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { emit, SSE_EVENTS } = require('../lib/sse-emitter');

// Backoff exponentiel conforme CDC §4.5.3 : 3 tentatives étalées sur ~24h
const RETRY_DELAYS_MS = [
  5 * 60 * 1000,       // Tentative 2 : +5 min
  30 * 60 * 1000,      // Tentative 3 : +30 min
  2 * 3600 * 1000,     // Tentative 4 : +2h
  8 * 3600 * 1000,     // Tentative 5 : +8h
  24 * 3600 * 1000,    // Tentative 6 : +24h
];

const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const WEBHOOK_TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS) || 5000;

function signPayload(payload, secret) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${sig}`;
}

async function dispatchWebhook(merchantId, eventType, payload) {
  const res = await db.query(
    'SELECT id, webhook_url, api_key_secret FROM merchants WHERE id = $1 AND is_active = TRUE',
    [merchantId]
  );
  const merchant = res.rows[0];
  if (!merchant || !merchant.webhook_url) return null;

  const eventId = uuidv4();
  const payloadStr = JSON.stringify({
    id: eventId,
    event: eventType,
    data: payload,
    created_at: new Date().toISOString(),
    api_version: 'v1',
  });

  await db.query(
    `INSERT INTO webhook_events (id, merchant_id, event_type, payload, url, status, attempts, next_retry_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', 0, NOW())`,
    [eventId, merchantId, eventType, payloadStr, merchant.webhook_url]
  );

  await attemptDelivery(eventId);
  return eventId;
}

async function attemptDelivery(eventId) {
  const evRes = await db.query('SELECT * FROM webhook_events WHERE id = $1', [eventId]);
  const event = evRes.rows[0];
  if (!event || event.status === 'delivered') return;

  const mRes = await db.query('SELECT api_key_secret FROM merchants WHERE id = $1', [event.merchant_id]);
  const merchant = mRes.rows[0];
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

    await db.query(
      `UPDATE webhook_events SET status = 'delivered', attempts = $1, last_response_code = $2, sent_at = NOW(), last_error = NULL WHERE id = $3`,
      [attempts, response.status, eventId]
    );

  } catch (err) {
    const statusCode = err.response ? err.response.status : null;
    const errorMsg = (err.message || 'Erreur inconnue').slice(0, 500);

    if (attempts >= MAX_ATTEMPTS) {
      await db.query(
        `UPDATE webhook_events SET status = 'failed', attempts = $1, last_response_code = $2, last_error = $3, next_retry_at = NULL WHERE id = $4`,
        [attempts, statusCode, errorMsg, eventId]
      );
      // Notifier le dashboard admin en temps réel
      emit(SSE_EVENTS.WEBHOOK_FAILED, {
        webhookEventId: eventId,
        merchantId: event.merchant_id,
        eventType: event.event_type,
        attempts,
        lastError: errorMsg,
        failedAt: new Date().toISOString(),
      });
    } else {
      const delayMs = RETRY_DELAYS_MS[attempts - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const nextRetry = new Date(Date.now() + delayMs).toISOString();
      await db.query(
        `UPDATE webhook_events SET status = 'pending', attempts = $1, last_response_code = $2, last_error = $3, next_retry_at = $4 WHERE id = $5`,
        [attempts, statusCode, errorMsg, nextRetry, eventId]
      );
    }
  }
}

async function processRetryQueue() {
  const res = await db.query(
    `SELECT id FROM webhook_events WHERE status = 'pending' AND next_retry_at <= NOW() AND attempts < $1 ORDER BY next_retry_at ASC LIMIT 50`,
    [MAX_ATTEMPTS]
  );

  if (res.rows.length === 0) return 0;

  let processed = 0;
  for (const event of res.rows) {
    await attemptDelivery(event.id);
    processed++;
  }
  return processed;
}

async function requeueWebhook(eventId) {
  const res = await db.query('SELECT id FROM webhook_events WHERE id = $1', [eventId]);
  if (!res.rows[0]) return false;

  await db.query(
    `UPDATE webhook_events SET status = 'pending', next_retry_at = NOW(), last_error = NULL WHERE id = $1`,
    [eventId]
  );

  attemptDelivery(eventId).catch(console.error);
  return true;
}

const WebhookEvents = {
  // Paiements (noms conformes CDC §4.5.3)
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_COMPLETED: 'payment.success',   // alias rétrocompat
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_EXPIRED: 'payment.expired',
  PAYMENT_REFUNDED: 'refund.completed',
  // Distribution (CDC §4.5.3)
  DISTRIBUTION_COMPLETED: 'distribution.completed',
  // Fidélité (CDC §4.5.3)
  STATUS_CHANGED: 'loyalty.status_changed',
  STATUS_UPGRADED: 'loyalty.status_changed', // alias rétrocompat
};

module.exports = {
  dispatchWebhook,
  processRetryQueue,
  requeueWebhook,
  signPayload,
  WebhookEvents,
};
