const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const { runLoyaltyBatch } = require('../lib/loyalty-engine');

// GET /api/v1/loyalty/config
router.get('/config', (req, res) => {
  const config = db.prepare('SELECT * FROM loyalty_config ORDER BY sort_order').all();
  res.json({ config });
});

// PUT /api/v1/loyalty/config/:status (admin)
router.put('/config/:status', requireAdmin, (req, res) => {
  const { status } = req.params;
  const {
    client_rebate_percent,
    label,
    color,
    min_purchases,
    min_cumulative_amount,
    evaluation_months,
    inactivity_months,
  } = req.body;

  const existing = db.prepare('SELECT * FROM loyalty_config WHERE status = ?').get(status);
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
  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE loyalty_config SET ${setClause} WHERE status = ?`).run(...Object.values(updates), status);

  const updated = db.prepare('SELECT * FROM loyalty_config WHERE status = ?').get(status);
  res.json({ config: updated });
});

// POST /api/v1/loyalty/batch (admin — déclenche l'évaluation des statuts)
router.post('/batch', requireAdmin, (req, res) => {
  const results = runLoyaltyBatch();
  res.json({ message: `Batch exécuté. ${results.length} changements de statut.`, changes: results });
});

// GET /api/v1/loyalty/stats (admin)
router.get('/stats', requireAdmin, (req, res) => {
  const stats = db.prepare(`
    SELECT loyalty_status, COUNT(*) as count
    FROM clients WHERE is_active = 1
    GROUP BY loyalty_status
  `).all();

  const transitions = db.prepare(`
    SELECT
      COUNT(CASE WHEN loyalty_status = 'OPEN' THEN 1 END) as open_count,
      COUNT(CASE WHEN loyalty_status = 'LIVE' THEN 1 END) as live_count,
      COUNT(CASE WHEN loyalty_status = 'GOLD' THEN 1 END) as gold_count,
      COUNT(CASE WHEN loyalty_status = 'ROYAL' THEN 1 END) as royal_count,
      COUNT(*) as total
    FROM clients WHERE is_active = 1
  `).get();

  res.json({ byStatus: stats, summary: transitions });
});

module.exports = router;
