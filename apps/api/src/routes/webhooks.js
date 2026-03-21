'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin, requireApiKey } = require('../middleware/auth');
const { requeueWebhook, dispatchWebhook, WebhookEvents } = require('../workers/webhook-dispatcher');

// GET /api/v1/webhooks (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { merchant_id, status, page = 1, limit = 50 } = req.query;
  let sql = `
    SELECT we.*, m.name as merchant_name
    FROM webhook_events we
    JOIN merchants m ON we.merchant_id = m.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (merchant_id) { sql += ` AND we.merchant_id = $${idx++}`; params.push(merchant_id); }
  if (status) { sql += ` AND we.status = $${idx++}`; params.push(status); }

  sql += ` ORDER BY we.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const events = (await db.query(sql, params)).rows;
  const countP = params.slice(0, params.length - 2);
  let ci = 1;
  let countSql = `SELECT COUNT(*) as c FROM webhook_events we WHERE 1=1`;
  if (merchant_id) countSql += ` AND we.merchant_id = $${ci++}`;
  if (status) countSql += ` AND we.status = $${ci++}`;
  const total = parseInt((await db.query(countSql, countP)).rows[0].c);

  res.json({ events, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/webhooks/:id (admin) — exclure /stats/summary
router.get('/:id', (req, res, next) => { if (req.params.id === 'stats') return next('route'); next() }, requireAdmin, async (req, res) => {
  const result = await db.query(`
    SELECT we.*, m.name as merchant_name, m.webhook_url
    FROM webhook_events we
    JOIN merchants m ON we.merchant_id = m.id
    WHERE we.id = $1
  `, [req.params.id]);
  const event = result.rows[0];

  if (!event) return res.status(404).json({ error: 'Événement non trouvé' });

  let parsedPayload = null;
  try { parsedPayload = JSON.parse(event.payload); } catch {}

  res.json({ event: { ...event, parsedPayload } });
});

// POST /api/v1/webhooks/:id/retry (admin) — exclure /test/retry
router.post('/:id/retry', (req, res, next) => { if (req.params.id === 'test') return next('route'); next() }, requireAdmin, async (req, res) => {
  const event = (await db.query('SELECT * FROM webhook_events WHERE id = $1', [req.params.id])).rows[0];
  if (!event) return res.status(404).json({ error: 'Événement non trouvé' });

  const queued = await requeueWebhook(req.params.id);
  if (!queued) return res.status(400).json({ error: 'Impossible de remettre en file' });

  res.json({ message: 'Webhook remis en file de livraison', eventId: req.params.id });
});

// POST /api/v1/webhooks/test (marchand)
router.post('/test', requireApiKey, async (req, res) => {
  const merchant = req.merchant;
  if (!merchant.webhook_url) {
    return res.status(400).json({ error: 'Aucune URL webhook configurée pour ce marchand' });
  }

  const eventId = await dispatchWebhook(merchant.id, 'webhook.test', {
    message: "Ceci est un test de webhook Afrik'Fid",
    merchantId: merchant.id,
    timestamp: new Date().toISOString(),
  });

  res.json({ message: 'Événement test envoyé', eventId });
});

// GET /api/v1/webhooks/stats/summary (admin)
router.get('/stats/summary', requireAdmin, async (req, res) => {
  const stats = (await db.query(`
    SELECT status, COUNT(*) as count, AVG(attempts) as avg_attempts
    FROM webhook_events
    GROUP BY status
  `)).rows;

  const byMerchant = (await db.query(`
    SELECT m.name, m.id,
      COUNT(we.id) as total,
      COUNT(CASE WHEN we.status = 'delivered' THEN 1 END) as delivered,
      COUNT(CASE WHEN we.status = 'failed' THEN 1 END) as failed
    FROM webhook_events we
    JOIN merchants m ON we.merchant_id = m.id
    GROUP BY m.id
    ORDER BY total DESC
    LIMIT 10
  `)).rows;

  res.json({ byStatus: stats, byMerchant });
});

module.exports = router;
