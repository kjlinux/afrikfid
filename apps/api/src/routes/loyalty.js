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

  //invariant : Y ≤ X obligatoire — bloquer AVANT l'UPDATE si violation détectée
  if (client_rebate_percent !== undefined) {
    const newY = parseFloat(client_rebate_percent);
    const conflicting = (await db.query(
      `SELECT id, name, rebate_percent FROM merchants WHERE is_active = TRUE AND rebate_percent < $1`,
      [newY]
    )).rows;
    if (conflicting.length > 0) {
      return res.status(409).json({
        error: 'Y_EXCEEDS_X',
        message: `Impossible : le taux Y% (${newY}%) dépasse le taux X% de ${conflicting.length} marchand(s), entraînant une commission Z% négative (violation.`,
        affectedMerchants: conflicting.map(m => ({ id: m.id, name: m.name, rebatePercent: m.rebate_percent })),
      });
    }
  }

  updates.updated_at = new Date().toISOString();
  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await db.query(`UPDATE loyalty_config SET ${setClause} WHERE status = $${keys.length + 1}`, [...Object.values(updates), status]);

  const updated = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [status])).rows[0];

  res.json({ config: updated });
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

// ───— Cas Particuliers de gestion des statuts ────────

/**
 * POST /api/v1/loyalty/clients/:clientId/fraud-revoke
 * Retrait immédiat du statut suite à fraude avérée, sans préavis 
 * Le statut est remis à OPEN immédiatement.
 */
router.post('/clients/:clientId/fraud-revoke', requireAdmin, async (req, res) => {
  const { clientId } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason requis' });

  const client = (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  if (client.loyalty_status === 'OPEN') return res.status(409).json({ error: 'Client déjà au statut OPEN' });

  const previousStatus = client.loyalty_status;
  const { v4: uuidv4 } = require('uuid');

  // Retrait immédiat → OPEN, sans Soft Landing 
  await db.query(
    `UPDATE clients
     SET loyalty_status = 'OPEN', fraud_status_revoked_at = NOW(), fraud_status_revoked_reason = $1,
         status_points_12m = 0, updated_at = NOW()
     WHERE id = $2`,
    [reason, clientId]
  );

  // Historique audit
  await db.query(
    `INSERT INTO loyalty_status_history (id, client_id, old_status, new_status, changed_by, reason, changed_at)
     VALUES ($1, $2, $3, 'OPEN', 'fraud_revoke', $4, NOW())`,
    [uuidv4(), clientId, previousStatus, reason]
  );

  // Log dans audit_logs si table existe
  try {
    await db.query(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES ($1, $2, 'FRAUD_STATUS_REVOKE', 'client', $3, $4, NOW())`,
      [uuidv4(), req.admin.id, clientId, JSON.stringify({ previousStatus, reason })]
    );
  } catch { /* table peut ne pas avoir cette structure */ }

  res.json({ message: `Statut retiré immédiatement (fraude). ${previousStatus} → OPEN.`, clientId, previousStatus });
});

/**
 * POST /api/v1/loyalty/clients/:clientId/partner-exit-hold
 * Partenaire sortant : maintien du statut acquis pendant 6 mois 
 */
router.post('/clients/:clientId/partner-exit-hold', requireAdmin, async (req, res) => {
  const { clientId } = req.params;
  const { merchant_id, reason } = req.body;
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id requis' });

  const client = (await db.query('SELECT id, loyalty_status FROM clients WHERE id = $1', [clientId])).rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const merchant = (await db.query('SELECT id, name FROM merchants WHERE id = $1', [merchant_id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });

  // Marque le marchand comme sortant et fixe la date de sortie
  const holdUntil = new Date();
  holdUntil.setMonth(holdUntil.getMonth() + 6);
  await db.query(
    'UPDATE merchants SET partner_exit_at = NOW(), partner_exit_status_hold_until = $1 WHERE id = $2',
    [holdUntil.toISOString(), merchant_id]
  );

  // Fixe la deadline de requalification du client à 6 mois (conservation du statut)
  await db.query(
    'UPDATE clients SET qualification_deadline = $1, updated_at = NOW() WHERE id = $2',
    [holdUntil.toISOString(), clientId]
  );

  const { v4: uuidv4 } = require('uuid');
  try {
    await db.query(
      `INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details, created_at)
       VALUES ($1, $2, 'PARTNER_EXIT_HOLD', 'client', $3, $4, NOW())`,
      [uuidv4(), req.admin.id, clientId, JSON.stringify({ merchant_id, merchantName: merchant.name, holdUntil, reason })]
    );
  } catch { /* ignore */ }

  res.json({
    message: `Statut ${client.loyalty_status} maintenu jusqu'au ${holdUntil.toISOString().slice(0, 10)} (partenaire sortant).`,
    clientId, merchantId: merchant_id, holdUntil,
  });
});

/**
 * POST /api/v1/loyalty/governance-requests — Créer une demande de geste commercial 
 * Requiert validation du comité de gouvernance.
 */
router.post('/governance-requests', requireAdmin, async (req, res) => {
  const { client_id, type, requested_status, reason } = req.body;
  const validTypes = ['commercial_gesture', 'retroactive_restore', 'fraud_revoke', 'partner_exit'];
  if (!client_id || !type || !reason) return res.status(400).json({ error: 'client_id, type et reason requis' });
  if (!validTypes.includes(type)) return res.status(400).json({ error: `type invalide. Valeurs: ${validTypes.join(', ')}` });

  const client = (await db.query('SELECT id, loyalty_status FROM clients WHERE id = $1', [client_id])).rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  await db.query(
    `INSERT INTO governance_requests (id, client_id, requested_by, type, current_status, requested_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, client_id, req.admin.id, type, client.loyalty_status, requested_status || null, reason]
  );

  const request = (await db.query('SELECT * FROM governance_requests WHERE id = $1', [id])).rows[0];
  res.status(201).json({ request, message: 'Demande créée. En attente de validation par le comité de gouvernance.' });
});

/**
 * GET /api/v1/loyalty/governance-requests — Lister les demandes de gouvernance
 */
router.get('/governance-requests', requireAdmin, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let sql = `
    SELECT gr.*, c.full_name as client_name, c.loyalty_status as client_current_status,
           a1.full_name as requester_name, a2.full_name as reviewer_name
    FROM governance_requests gr
    JOIN clients c ON c.id = gr.client_id
    JOIN admins a1 ON a1.id = gr.requested_by
    LEFT JOIN admins a2 ON a2.id = gr.reviewed_by
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;
  if (status) { sql += ` AND gr.status = $${idx++}`; params.push(status); }
  sql += ` ORDER BY gr.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const rows = (await db.query(sql, params)).rows;
  const countP = params.slice(0, params.length - 2);
  const countSql = status
    ? 'SELECT COUNT(*) as c FROM governance_requests WHERE status = $1'
    : 'SELECT COUNT(*) as c FROM governance_requests';
  const total = parseInt((await db.query(countSql, countP)).rows[0].c);
  res.json({ requests: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

/**
 * PATCH /api/v1/loyalty/governance-requests/:id/review — Approuver ou rejeter 
 * Si approuvé, applique le changement de statut ou le geste commercial.
 */
router.patch('/governance-requests/:id/review', requireAdmin, async (req, res) => {
  const { decision, comment } = req.body; // decision: 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision doit être "approved" ou "rejected"' });
  }

  const request = (await db.query('SELECT * FROM governance_requests WHERE id = $1', [req.params.id])).rows[0];
  if (!request) return res.status(404).json({ error: 'Demande non trouvée' });
  if (request.status !== 'pending') return res.status(409).json({ error: 'Demande déjà traitée' });

  await db.query(
    `UPDATE governance_requests
     SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_comment = $3
     WHERE id = $4`,
    [decision, req.admin.id, comment || null, req.params.id]
  );

  if (decision === 'approved' && request.requested_status) {
    const { v4: uuidv4 } = require('uuid');
    const client = (await db.query('SELECT loyalty_status FROM clients WHERE id = $1', [request.client_id])).rows[0];

    await db.query(
      `UPDATE clients SET loyalty_status = $1, updated_at = NOW() WHERE id = $2`,
      [request.requested_status, request.client_id]
    );
    await db.query(
      `INSERT INTO loyalty_status_history (id, client_id, old_status, new_status, changed_by, reason, changed_at)
       VALUES ($1, $2, $3, $4, 'governance', $5, NOW())`,
      [uuidv4(), request.client_id, client?.loyalty_status || request.current_status, request.requested_status, request.reason]
    );
    await db.query('UPDATE governance_requests SET applied_at = NOW() WHERE id = $1', [req.params.id]);
  }

  const updated = (await db.query('SELECT * FROM governance_requests WHERE id = $1', [req.params.id])).rows[0];
  res.json({ request: updated, message: decision === 'approved' ? 'Demande approuvée et appliquée.' : 'Demande rejetée.' });
});

module.exports = router;
