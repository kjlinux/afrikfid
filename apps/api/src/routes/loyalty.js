const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const { runLoyaltyBatch } = require('../lib/loyalty-engine');

// GET /api/v1/loyalty/config
router.get('/config', async (req, res) => {
  const config = (await db.query('SELECT * FROM loyalty_config ORDER BY sort_order')).rows;
  res.json({ config });
});

// PUT /api/v1/loyalty/config/:status (admin)
router.put('/config/:status', requireAdmin, async (req, res) => {
  const { status } = req.params;
  const { client_rebate_percent, label, color, min_purchases, min_cumulative_amount, evaluation_months, inactivity_months } = req.body;

  const existing = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [status])).rows[0];
  if (!existing) return res.status(404).json({ error: 'Statut non trouvé' });

  const updates = {};
  if (client_rebate_percent !== undefined) updates.client_rebate_percent = client_rebate_percent;
  if (label !== undefined) updates.label = label;
  if (color !== undefined) updates.color = color;
  if (min_purchases !== undefined) updates.min_purchases = min_purchases;
  if (min_cumulative_amount !== undefined) updates.min_cumulative_amount = min_cumulative_amount;
  if (evaluation_months !== undefined) updates.evaluation_months = evaluation_months;
  if (inactivity_months !== undefined) updates.inactivity_months = inactivity_months;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Aucune donnée' });

  updates.updated_at = new Date().toISOString();
  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(`UPDATE loyalty_config SET ${setClause} WHERE status = $${keys.length + 1}`, [...Object.values(updates), status]);

  const updated = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [status])).rows[0];
  res.json({ config: updated });
});

// POST /api/v1/loyalty/batch (admin)
router.post('/batch', requireAdmin, async (req, res) => {
  const results = await runLoyaltyBatch();
  res.json({ message: `Batch exécuté. ${results.length} changements de statut.`, changes: results });
});

// GET /api/v1/loyalty/stats (admin)
router.get('/stats', requireAdmin, async (req, res) => {
  const stats = (await db.query(`
    SELECT loyalty_status, COUNT(*) as count FROM clients WHERE is_active = TRUE GROUP BY loyalty_status
  `)).rows;

  const transitions = (await db.query(`
    SELECT
      COUNT(CASE WHEN loyalty_status = 'OPEN' THEN 1 END) as open_count,
      COUNT(CASE WHEN loyalty_status = 'LIVE' THEN 1 END) as live_count,
      COUNT(CASE WHEN loyalty_status = 'GOLD' THEN 1 END) as gold_count,
      COUNT(CASE WHEN loyalty_status = 'ROYAL' THEN 1 END) as royal_count,
      COUNT(*) as total
    FROM clients WHERE is_active = TRUE
  `)).rows[0];

  res.json({ byStatus: stats, summary: transitions });
});

module.exports = router;
