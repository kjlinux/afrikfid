'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../lib/db');
const { emitter, SSE_EVENTS } = require('../lib/sse-emitter');

const JWT_SECRET = process.env.JWT_SECRET || 'afrikfid-secret-key';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendSSE(res, id, event, data) {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function setupSSEHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx
  res.flushHeaders();
}

/** Vérifie le token JWT depuis le query param ?token= (EventSource ne supporte pas les headers custom) */
function verifySSEToken(req) {
  const token = req.query.token;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function startKeepalive(res) {
  const iv = setInterval(() => {
    if (res.writableEnded) { clearInterval(iv); return; }
    res.write(': keepalive\n\n');
  }, 25000);
  return iv;
}

// ─── GET /api/v1/sse/admin ────────────────────────────────────────────────────
// Flux admin : tous les événements (paiements, webhooks, fidélité)
router.get('/admin', async (req, res) => {
  const decoded = verifySSEToken(req);
  if (!decoded || decoded.role !== 'admin') {
    return res.status(401).json({ error: 'Token SSE invalide ou rôle insuffisant' });
  }

  setupSSEHeaders(res);

  // Catch-up : dernières transactions (depuis Last-Event-ID si fourni)
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    try {
      const since = new Date(Number(lastEventId));
      const { rows } = await db.query(
        `SELECT id, status, amount, currency, operator, merchant_id, updated_at
           FROM transactions
          WHERE updated_at > $1
          ORDER BY updated_at ASC
          LIMIT 50`,
        [since]
      );
      for (const tx of rows) {
        sendSSE(res, Date.now(), SSE_EVENTS.TRANSACTION_STATUS, tx);
      }
    } catch { /* catch-up non bloquant */ }
  }

  sendSSE(res, Date.now(), 'connected', { message: 'Flux admin connecté' });

  // Abonnement aux événements
  const events = Object.values(SSE_EVENTS);
  const handlers = {};

  for (const evt of events) {
    handlers[evt] = (payload) => {
      if (res.writableEnded) return;
      sendSSE(res, Date.now(), evt, payload);
    };
    emitter.on(evt, handlers[evt]);
  }

  const keepalive = startKeepalive(res);

  req.on('close', () => {
    clearInterval(keepalive);
    for (const evt of events) emitter.off(evt, handlers[evt]);
  });
});

// ─── GET /api/v1/sse/merchant ─────────────────────────────────────────────────
// Flux marchand : événements filtrés sur son merchant_id
router.get('/merchant', async (req, res) => {
  const decoded = verifySSEToken(req);
  if (!decoded || decoded.role !== 'merchant') {
    return res.status(401).json({ error: 'Token SSE invalide ou rôle insuffisant' });
  }

  const merchantId = decoded.sub;
  setupSSEHeaders(res);

  // Catch-up depuis last-event-id
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    try {
      const since = new Date(Number(lastEventId));
      const { rows } = await db.query(
        `SELECT id, status, amount, currency, operator, updated_at
           FROM transactions
          WHERE merchant_id = $1 AND updated_at > $2
          ORDER BY updated_at ASC
          LIMIT 50`,
        [merchantId, since]
      );
      for (const tx of rows) {
        sendSSE(res, Date.now(), SSE_EVENTS.TRANSACTION_STATUS, tx);
      }
    } catch { /* non bloquant */ }
  }

  sendSSE(res, Date.now(), 'connected', { message: 'Flux marchand connecté' });

  // Seuls les événements pertinents pour le marchand
  const relevantEvents = [
    SSE_EVENTS.PAYMENT_SUCCESS,
    SSE_EVENTS.PAYMENT_FAILED,
    SSE_EVENTS.PAYMENT_EXPIRED,
    SSE_EVENTS.TRANSACTION_STATUS,
    SSE_EVENTS.LOYALTY_CHANGED,
    SSE_EVENTS.WEBHOOK_FAILED,
  ];

  const handlers = {};
  for (const evt of relevantEvents) {
    handlers[evt] = (payload) => {
      if (res.writableEnded) return;
      // Filtrer sur le merchant_id
      if (payload.merchantId && payload.merchantId !== merchantId) return;
      sendSSE(res, Date.now(), evt, payload);
    };
    emitter.on(evt, handlers[evt]);
  }

  const keepalive = startKeepalive(res);

  req.on('close', () => {
    clearInterval(keepalive);
    for (const evt of relevantEvents) emitter.off(evt, handlers[evt]);
  });
});

// ─── GET /api/v1/sse/transaction/:id ─────────────────────────────────────────
// Flux dédié à une transaction spécifique (page de paiement client)
router.get('/transaction/:id', async (req, res) => {
  const { id } = req.params;

  // Pour la page paiement, on accepte aussi les clients non authentifiés
  // (le txId est un UUID non-guessable — sécurité suffisante)
  // Si un token est fourni, on le valide quand même
  const decoded = verifySSEToken(req);
  if (req.query.token && !decoded) {
    return res.status(401).json({ error: 'Token SSE invalide' });
  }

  // Vérifier que la transaction existe
  let tx;
  try {
    const { rows } = await db.query('SELECT id, status, amount, currency, operator FROM transactions WHERE id = $1', [id]);
    tx = rows[0];
  } catch {
    return res.status(500).json({ error: 'Erreur base de données' });
  }

  if (!tx) return res.status(404).json({ error: 'Transaction introuvable' });

  setupSSEHeaders(res);

  // Envoyer l'état courant immédiatement
  sendSSE(res, Date.now(), SSE_EVENTS.TRANSACTION_STATUS, { transactionId: id, status: tx.status, amount: tx.amount, currency: tx.currency, operator: tx.operator });

  // Si déjà terminée, fermer le flux
  if (['completed', 'failed', 'expired', 'refunded'].includes(tx.status)) {
    res.end();
    return;
  }

  const handler = (payload) => {
    if (res.writableEnded) return;
    if (payload.transactionId !== id) return;
    sendSSE(res, Date.now(), SSE_EVENTS.TRANSACTION_STATUS, payload);
    // Fermer automatiquement si état final
    if (['completed', 'failed', 'expired'].includes(payload.status)) {
      setTimeout(() => { if (!res.writableEnded) res.end(); }, 500);
    }
  };

  emitter.on(SSE_EVENTS.TRANSACTION_STATUS, handler);

  const keepalive = startKeepalive(res);

  req.on('close', () => {
    clearInterval(keepalive);
    emitter.off(SSE_EVENTS.TRANSACTION_STATUS, handler);
  });
});

module.exports = router;
