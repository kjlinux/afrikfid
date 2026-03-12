'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin, requireApiKey } = require('../middleware/auth');
const { requeueWebhook, dispatchWebhook, WebhookEvents } = require('../workers/webhook-dispatcher');

// GET /api/v1/webhooks (admin — liste tous les événements)
router.get('/', requireAdmin, (req, res) => {
  const { merchant_id, status, page = 1, limit = 50 } = req.query;
  let query = `
    SELECT we.*, m.name as merchant_name
    FROM webhook_events we
    JOIN merchants m ON we.merchant_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (merchant_id) { query += ' AND we.merchant_id = ?'; params.push(merchant_id); }
  if (status) { query += ' AND we.status = ?'; params.push(status); }

  query += ' ORDER BY we.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const events = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM webhook_events').get().c;

  res.json({ events, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/webhooks/:id (admin — détail)
router.get('/:id', requireAdmin, (req, res) => {
  const event = db.prepare(`
    SELECT we.*, m.name as merchant_name, m.webhook_url
    FROM webhook_events we
    JOIN merchants m ON we.merchant_id = m.id
    WHERE we.id = ?
  `).get(req.params.id);

  if (!event) return res.status(404).json({ error: 'Événement non trouvé' });

  // Parser le payload pour l'affichage
  let parsedPayload = null;
  try { parsedPayload = JSON.parse(event.payload); } catch {}

  res.json({ event: { ...event, parsedPayload } });
});

// POST /api/v1/webhooks/:id/retry (admin — forcer retry)
router.post('/:id/retry', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Événement non trouvé' });

  const queued = requeueWebhook(req.params.id);
  if (!queued) return res.status(400).json({ error: 'Impossible de remettre en file' });

  res.json({ message: 'Webhook remis en file de livraison', eventId: req.params.id });
});

// POST /api/v1/webhooks/test (marchand — tester son endpoint)
router.post('/test', requireApiKey, async (req, res) => {
  const merchant = req.merchant;
  if (!merchant.webhook_url) {
    return res.status(400).json({ error: 'Aucune URL webhook configurée pour ce marchand' });
  }

  const eventId = await dispatchWebhook(merchant.id, 'webhook.test', {
    message: 'Ceci est un test de webhook Afrik\'Fid',
    merchantId: merchant.id,
    timestamp: new Date().toISOString(),
  });

  res.json({ message: 'Événement test envoyé', eventId });
});

// GET /api/v1/webhooks/stats (admin — statistiques)
router.get('/stats/summary', requireAdmin, (req, res) => {
  const stats = db.prepare(`
    SELECT
      status,
      COUNT(*) as count,
      AVG(attempts) as avg_attempts
    FROM webhook_events
    GROUP BY status
  `).all();

  const byMerchant = db.prepare(`
    SELECT m.name, m.id,
      COUNT(we.id) as total,
      COUNT(CASE WHEN we.status = 'delivered' THEN 1 END) as delivered,
      COUNT(CASE WHEN we.status = 'failed' THEN 1 END) as failed
    FROM webhook_events we
    JOIN merchants m ON we.merchant_id = m.id
    GROUP BY m.id
    ORDER BY total DESC
    LIMIT 10
  `).all();

  res.json({ byStatus: stats, byMerchant });
});

module.exports = router;
