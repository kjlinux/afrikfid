'use strict';

/**
 * Dispatch d'événements webhook vers les marchands.
 * POST signé HMAC-SHA256 sur `merchants.webhook_url`.
 *
 * Événements supportés :
 *   - trigger.fired
 *   - campaign.completed
 *   - loyalty.status_changed (déclenché ailleurs)
 */

const crypto = require('crypto');
const axios = require('axios');
const { pool } = require('./db');

const TIMEOUT_MS = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10);
const SECRET = process.env.WEBHOOK_SECRET || 'afrikfid-webhook-secret-change-in-production';

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('hex');
}

async function dispatchWebhook(merchantId, event, data) {
  if (!merchantId) return { skipped: true };
  const m = await pool.query('SELECT webhook_url FROM merchants WHERE id = $1', [merchantId]);
  const url = m.rows[0]?.webhook_url;
  if (!url) return { skipped: true, reason: 'no_url' };

  const payload = JSON.stringify({
    event,
    merchant_id: merchantId,
    sent_at: new Date().toISOString(),
    data,
  });
  const signature = sign(payload);

  try {
    const res = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-AfrikFid-Event': event,
        'X-AfrikFid-Signature': signature,
      },
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { dispatchWebhook };
