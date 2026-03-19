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

  // Vérification anomalie Y > X : alerter si le taux Y% dépasse le X% minimal des marchands actifs 
  const warnings = [];
  if (client_rebate_percent !== undefined) {
    const newY = parseFloat(client_rebate_percent);
    const merchantsWithLowX = (await db.query(
      `SELECT id, name, rebate_percent FROM merchants
       WHERE is_active = TRUE AND rebate_percent < $1`,
      [newY]
    )).rows;

    if (merchantsWithLowX.length > 0) {
      warnings.push({
        type: 'Y_EXCEEDS_X',
        message: `ALERTE : Le taux Y% (${newY}%) dépasse le taux X% de ${merchantsWithLowX.length} marchand(s). Cela entraînerait une commission Z négative pour ces marchands.`,
        affectedMerchants: merchantsWithLowX.map(m => ({ id: m.id, name: m.name, rebatePercent: m.rebate_percent })),
      });
    }
  }

  res.json({ config: updated, warnings });
});

// POST /api/v1/loyalty/batch (admin) — alias legacy
router.post('/batch', requireAdmin, async (req, res) => {
  const results = await runLoyaltyBatch();
  res.json({ message: `Batch exécuté. ${results.length} changements de statut.`, changes: results });
});

// POST /api/v1/loyalty/batch/evaluate (admin) — CDC v3 §3.6 endpoint officiel
router.post('/batch/evaluate', requireAdmin, async (req, res) => {
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
      COUNT(CASE WHEN loyalty_status = 'ROYAL_ELITE' THEN 1 END) as royal_elite_count,
      COUNT(*) as total
    FROM clients WHERE is_active = TRUE
  `)).rows[0];

  res.json({ byStatus: stats, summary: transitions });
});

// ─── Taux Y% par pays  ──────────────────────────────────────────

// GET /api/v1/loyalty/config-country — liste toutes les surcharges par pays
router.get('/config-country', requireAdmin, async (req, res) => {
  const rows = (await db.query(
    `SELECT lcc.*, c.name as country_name FROM loyalty_config_country lcc
     JOIN countries c ON c.id = lcc.country_id
     ORDER BY lcc.country_id, lcc.status`
  )).rows;
  res.json({ overrides: rows });
});

// PUT /api/v1/loyalty/config-country/:countryId/:status — créer/mettre à jour un taux par pays
router.put('/config-country/:countryId/:status', requireAdmin, async (req, res) => {
  const { countryId, status } = req.params;
  const { client_rebate_percent } = req.body;

  if (client_rebate_percent === undefined || isNaN(parseFloat(client_rebate_percent))) {
    return res.status(400).json({ error: 'client_rebate_percent requis (nombre)' });
  }
  const country = (await db.query('SELECT id FROM countries WHERE id = $1', [countryId])).rows[0];
  if (!country) return res.status(404).json({ error: 'Pays non trouvé' });

  const loyaltyStatuses = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];
  if (!loyaltyStatuses.includes(status)) {
    return res.status(400).json({ error: `Statut invalide. Valeurs: ${loyaltyStatuses.join(', ')}` });
  }

  const { v4: uuidv4 } = require('uuid');
  await db.query(
    `INSERT INTO loyalty_config_country (id, country_id, status, client_rebate_percent, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (country_id, status) DO UPDATE SET client_rebate_percent = EXCLUDED.client_rebate_percent, updated_at = NOW()`,
    [uuidv4(), countryId, status, parseFloat(client_rebate_percent)]
  );

  const updated = (await db.query(
    'SELECT * FROM loyalty_config_country WHERE country_id = $1 AND status = $2',
    [countryId, status]
  )).rows[0];
  res.json({ override: updated });
});

// DELETE /api/v1/loyalty/config-country/:countryId/:status — supprimer une surcharge (retour au taux global)
router.delete('/config-country/:countryId/:status', requireAdmin, async (req, res) => {
  const { countryId, status } = req.params;
  const result = await db.query(
    'DELETE FROM loyalty_config_country WHERE country_id = $1 AND status = $2',
    [countryId, status]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Surcharge non trouvée' });
  res.json({ message: 'Surcharge supprimée, taux global restauré' });
});

// ─── Configuration plafond wallet  ────────────────────────────────

// GET /api/v1/loyalty/wallet-config — lire la config globale des plafonds
router.get('/wallet-config', requireAdmin, async (req, res) => {
  const config = (await db.query("SELECT * FROM wallet_config WHERE id = 'global'")).rows[0];
  res.json({ walletConfig: config || { id: 'global', default_max_balance: null } });
});

// PUT /api/v1/loyalty/wallet-config — mettre à jour le plafond global
router.put('/wallet-config', requireAdmin, async (req, res) => {
  const { default_max_balance } = req.body;
  if (default_max_balance !== null && (isNaN(parseFloat(default_max_balance)) || parseFloat(default_max_balance) < 0)) {
    return res.status(400).json({ error: 'default_max_balance doit être un nombre positif ou null (illimité)' });
  }
  const cap = default_max_balance != null ? parseFloat(default_max_balance) : null;
  await db.query(
    `INSERT INTO wallet_config (id, default_max_balance, updated_at) VALUES ('global', $1, NOW())
     ON CONFLICT (id) DO UPDATE SET default_max_balance = EXCLUDED.default_max_balance, updated_at = NOW()`,
    [cap]
  );
  const updated = (await db.query("SELECT * FROM wallet_config WHERE id = 'global'")).rows[0];
  res.json({ walletConfig: updated, message: cap ? `Plafond global fixé à ${cap}` : 'Plafond supprimé (illimité)' });
});

// PATCH /api/v1/loyalty/wallet/:clientId/cap — plafond individuel pour un client
router.patch('/wallet/:clientId/cap', requireAdmin, async (req, res) => {
  const { max_balance } = req.body;
  if (max_balance !== null && (isNaN(parseFloat(max_balance)) || parseFloat(max_balance) < 0)) {
    return res.status(400).json({ error: 'max_balance doit être un nombre positif ou null (illimité)' });
  }
  const cap = max_balance != null ? parseFloat(max_balance) : null;
  const result = await db.query(
    'UPDATE wallets SET max_balance = $1, updated_at = NOW() WHERE client_id = $2',
    [cap, req.params.clientId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Portefeuille client non trouvé' });
  res.json({ message: cap ? `Plafond individuel fixé à ${cap}` : 'Plafond individuel supprimé', clientId: req.params.clientId, maxBalance: cap });
});

module.exports = router;
