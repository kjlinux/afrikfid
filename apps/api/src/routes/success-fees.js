/**
 * Routes Success Fee — CDC v3.0 §3.5
 * Commission 3-5% sur la croissance réelle du CA marchand
 */
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin, requireAuth } = require('../middleware/auth');

// GET /api/v1/success-fees/:merchantId — détail du success fee (admin ou marchand)
router.get('/:merchantId', requireAuth, async (req, res) => {
  const { merchantId } = req.params;
  if (req.merchant && req.merchant.id !== merchantId && !req.admin) {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  const merchant = (await db.query(
    'SELECT id, name, reference_avg_basket, reference_basket_calculated_at, success_fee_percent FROM merchants WHERE id = $1',
    [merchantId]
  )).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });

  const fees = (await db.query(
    'SELECT * FROM success_fees WHERE merchant_id = $1 ORDER BY period_start DESC LIMIT 12',
    [merchantId]
  )).rows;

  res.json({ merchant, fees });
});

// GET /api/v1/success-fees — tous les success fees (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let sql = `
    SELECT sf.*, m.name as merchant_name
    FROM success_fees sf JOIN merchants m ON sf.merchant_id = m.id WHERE 1=1
  `;
  const params = [];
  let idx = 1;
  if (status) { sql += ` AND sf.status = $${idx++}`; params.push(status); }
  sql += ` ORDER BY sf.period_start DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const rows = (await db.query(sql, params)).rows;
  const countP = params.slice(0, params.length - 2);
  const countSql = status
    ? `SELECT COUNT(*) as c FROM success_fees WHERE status = $1`
    : `SELECT COUNT(*) as c FROM success_fees`;
  const total = parseInt((await db.query(countSql, countP)).rows[0].c);
  res.json({ fees: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// PATCH /api/v1/success-fees/:id/status — changer statut (admin)
router.patch('/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  const valid = ['calculated', 'invoiced', 'paid', 'waived'];
  if (!valid.includes(status)) return res.status(400).json({ error: `Statut invalide. Valeurs: ${valid.join(', ')}` });

  const result = await db.query(
    'UPDATE success_fees SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Success fee non trouvé' });
  res.json({ fee: result.rows[0] });
});

module.exports = router;
