'use strict';

/**
 * Routes audit logs — journal d'audit complet (CDC §4.6.1)
 * Accès admin uniquement.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');

// GET /api/v1/audit-logs
// Paramètres query: actor_type, actor_id, action, resource_type, resource_id,
//                   date_from, date_to, page, limit
router.get('/', requireAdmin, async (req, res) => {
  const {
    actor_type, actor_id, action, resource_type, resource_id,
    date_from, date_to,
    page = 1, limit = 50,
  } = req.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const values = [];
  let idx = 1;

  if (actor_type) { conditions.push(`actor_type = $${idx++}`); values.push(actor_type); }
  if (actor_id)   { conditions.push(`actor_id = $${idx++}`);   values.push(actor_id); }
  if (action)     { conditions.push(`action ILIKE $${idx++}`); values.push(`%${action}%`); }
  if (resource_type) { conditions.push(`resource_type = $${idx++}`); values.push(resource_type); }
  if (resource_id)   { conditions.push(`resource_id = $${idx++}`);   values.push(resource_id); }
  if (date_from)  { conditions.push(`created_at >= $${idx++}`); values.push(date_from); }
  if (date_to)    { conditions.push(`created_at <= $${idx++}`); values.push(date_to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRes = await db.query(`SELECT COUNT(*) as total FROM audit_logs ${where}`, values);
  const total = parseInt(totalRes.rows[0].total);

  const rows = (await db.query(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    [...values, limitNum, offset]
  )).rows;

  res.json({
    logs: rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// GET /api/v1/audit-logs/:id — détail d'une entrée
router.get('/:id', requireAdmin, async (req, res) => {
  const log = (await db.query('SELECT * FROM audit_logs WHERE id = $1', [req.params.id])).rows[0];
  if (!log) return res.status(404).json({ error: 'Entrée non trouvée' });

  // Tenter de parser le payload JSON
  let parsedPayload = log.payload;
  if (log.payload) {
    try { parsedPayload = JSON.parse(log.payload); } catch (_) { /* laisser brut */ }
  }

  res.json({ log: { ...log, payload: parsedPayload } });
});

module.exports = router;
