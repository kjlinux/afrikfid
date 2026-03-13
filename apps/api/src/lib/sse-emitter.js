'use strict';

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

const SSE_EVENTS = {
  PAYMENT_SUCCESS: 'payment.success',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_EXPIRED: 'payment.expired',
  WEBHOOK_FAILED: 'webhook.failed',
  LOYALTY_CHANGED: 'loyalty.status_changed',
  TRANSACTION_STATUS: 'transaction.status',
};

/**
 * Émet un événement SSE en local (EventEmitter) et optionnellement via Redis pub/sub.
 * @param {string} eventType — une des valeurs de SSE_EVENTS
 * @param {object} payload   — données à envoyer aux clients SSE
 */
function emit(eventType, payload) {
  emitter.emit(eventType, payload);

  if (process.env.NODE_ENV !== 'test') {
    try {
      const redis = require('./redis');
      const client = redis.getClient ? redis.getClient() : null;
      if (client && typeof client.publish === 'function') {
        client.publish(`sse:${eventType}`, JSON.stringify(payload)).catch(() => {});
      }
    } catch { /* Redis non disponible — pas bloquant */ }
  }
}

module.exports = { emitter, emit, SSE_EVENTS };
