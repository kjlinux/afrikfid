'use strict';

/**
 * Gestion des litiges (CDC §4.6.1 — Refunds & Disputes Management)
 * Un litige est un désaccord signalé sur une transaction : montant incorrect,
 * service non rendu, fraude supposée, etc.
 *
 * Workflow : open → investigating → resolved | rejected
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAdmin, requireApiKey, requireAuth } = require('../middleware/auth');

// ─── GET /api/v1/disputes — liste des litiges (admin) ────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  const { status, merchant_id, page = 1, limit = 20 } = req.query;

  let sql = `
    SELECT d.*, t.reference as tx_reference, t.gross_amount, t.currency,
           m.name as merchant_name, c.full_name as client_name, c.afrikfid_id
    FROM disputes d
    LEFT JOIN transactions t ON d.transaction_id = t.id
    LEFT JOIN merchants m ON d.merchant_id = m.id
    LEFT JOIN clients c ON d.client_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (status) { sql += ` AND d.status = $${idx++}`; params.push(status); }
  if (merchant_id) { sql += ` AND d.merchant_id = $${idx++}`; params.push(merchant_id); }

  sql += ` ORDER BY d.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const disputes = (await db.query(sql, params)).rows;

  let countSql = 'SELECT COUNT(*) as c FROM disputes WHERE 1=1';
  const countParams = [];
  let ci = 1;
  if (status) { countSql += ` AND status = $${ci++}`; countParams.push(status); }
  if (merchant_id) { countSql += ` AND merchant_id = $${ci++}`; countParams.push(merchant_id); }
  const total = parseInt((await db.query(countSql, countParams)).rows[0].c);

  // Stats par statut
  const stats = (await db.query(`
    SELECT status, COUNT(*) as count
    FROM disputes GROUP BY status
  `)).rows;

  res.json({ disputes, total, page: parseInt(page), limit: parseInt(limit), stats });
});

// ─── GET /api/v1/disputes/:id — détail d'un litige ──────────────────────────
router.get('/:id', requireAdmin, async (req, res) => {
  const dispute = (await db.query(`
    SELECT d.*, t.reference as tx_reference, t.gross_amount, t.currency,
           t.payment_method, t.payment_operator, t.initiated_at as tx_date,
           t.merchant_rebate_percent, t.client_rebate_percent, t.platform_commission_percent,
           m.name as merchant_name, m.email as merchant_email,
           c.full_name as client_name, c.afrikfid_id
    FROM disputes d
    LEFT JOIN transactions t ON d.transaction_id = t.id
    LEFT JOIN merchants m ON d.merchant_id = m.id
    LEFT JOIN clients c ON d.client_id = c.id
    WHERE d.id = $1
  `, [req.params.id])).rows[0];

  if (!dispute) return res.status(404).json({ error: 'Litige non trouvé' });

  // Historique des mises à jour
  const history = (await db.query(`
    SELECT * FROM dispute_history WHERE dispute_id = $1 ORDER BY created_at DESC
  `, [dispute.id])).rows;

  res.json({ dispute, history });
});

// ─── POST /api/v1/disputes — déclarer un litige (marchand via API key ou admin) ──
router.post('/', requireAuth, async (req, res) => {
  const { transaction_id, reason, description, amount_disputed } = req.body;

  if (!transaction_id || !reason) {
    return res.status(400).json({ error: 'transaction_id et reason sont requis' });
  }

  const validReasons = ['incorrect_amount', 'service_not_rendered', 'duplicate_payment', 'fraud', 'other'];
  if (!validReasons.includes(reason)) {
    return res.status(400).json({ error: `Motif invalide. Valeurs: ${validReasons.join(', ')}` });
  }

  // Récupérer la transaction
  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1', [transaction_id])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });

  // Vérifier les droits : chaque acteur ne peut agir que sur ses propres transactions
  if (req.merchant && tx.merchant_id !== req.merchant.id) {
    return res.status(403).json({ error: 'Accès interdit à cette transaction' });
  }
  if (req.client && tx.client_id !== req.client.id) {
    return res.status(403).json({ error: 'Accès interdit à cette transaction' });
  }

  // Vérifier qu'un litige n'existe pas déjà
  const existing = (await db.query(
    "SELECT id FROM disputes WHERE transaction_id = $1 AND status NOT IN ('resolved', 'rejected')",
    [transaction_id]
  )).rows[0];
  if (existing) {
    return res.status(409).json({ error: 'Un litige actif existe déjà pour cette transaction', disputeId: existing.id });
  }

  const id = uuidv4();
  const initiatedBy = req.admin ? 'admin' : (req.merchant ? 'merchant' : 'client');
  const initiatedById = req.admin?.id || req.merchant?.id || req.client?.id;

  await db.query(`
    INSERT INTO disputes (id, transaction_id, merchant_id, client_id, reason, description,
                          amount_disputed, status, initiated_by, initiated_by_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, NOW())
  `, [
    id, transaction_id, tx.merchant_id, tx.client_id || null,
    reason, description || null,
    amount_disputed ? parseFloat(amount_disputed) : parseFloat(tx.gross_amount),
    initiatedBy, initiatedById,
  ]);

  // Log historique
  await db.query(`
    INSERT INTO dispute_history (id, dispute_id, action, performed_by, performed_by_id, note, created_at)
    VALUES ($1, $2, 'opened', $3, $4, $5, NOW())
  `, [uuidv4(), id, initiatedBy, initiatedById, `Litige ouvert: ${reason}`]);

  // Log audit
  await db.query(`
    INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
    VALUES ($1, $2, $3, 'dispute_opened', 'dispute', $4, $5)
  `, [uuidv4(), initiatedBy, initiatedById, id, req.ip]);

  const dispute = (await db.query('SELECT * FROM disputes WHERE id = $1', [id])).rows[0];
  res.status(201).json({ dispute, message: 'Litige déclaré avec succès' });
});

// ─── PATCH /api/v1/disputes/:id — mettre à jour le statut d'un litige (admin) ──
router.patch('/:id', requireAdmin, async (req, res) => {
  const { status, resolution_note, refund_initiated } = req.body;

  const validStatuses = ['investigating', 'resolved', 'rejected'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Statut invalide. Valeurs: ${validStatuses.join(', ')}` });
  }

  const dispute = (await db.query('SELECT * FROM disputes WHERE id = $1', [req.params.id])).rows[0];
  if (!dispute) return res.status(404).json({ error: 'Litige non trouvé' });
  if (['resolved', 'rejected'].includes(dispute.status)) {
    return res.status(400).json({ error: 'Le litige est déjà clôturé' });
  }

  const now = new Date().toISOString();
  await db.query(`
    UPDATE disputes SET
      status = $1,
      resolution_note = COALESCE($2, resolution_note),
      resolved_by = $3,
      resolved_at = CASE WHEN $1 IN ('resolved', 'rejected') THEN NOW() ELSE resolved_at END,
      updated_at = NOW()
    WHERE id = $4
  `, [status, resolution_note || null, req.admin.id, req.params.id]);

  // Log historique
  await db.query(`
    INSERT INTO dispute_history (id, dispute_id, action, performed_by, performed_by_id, note, created_at)
    VALUES ($1, $2, $3, 'admin', $4, $5, NOW())
  `, [uuidv4(), req.params.id, `status_changed_to_${status}`, req.admin.id, resolution_note || null]);

  // Log audit
  await db.query(`
    INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload, ip_address)
    VALUES ($1, 'admin', $2, 'dispute_updated', 'dispute', $3, $4, $5)
  `, [uuidv4(), req.admin.id, req.params.id, JSON.stringify({ status, resolution_note }), req.ip]);

  const updated = (await db.query('SELECT * FROM disputes WHERE id = $1', [req.params.id])).rows[0];
  res.json({ dispute: updated, message: `Litige mis à jour → ${status}` });
});

// ─── GET /api/v1/disputes/merchant/mine — litiges d'un marchand (API key) ───
router.get('/merchant/mine', requireApiKey, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  let sql = `
    SELECT d.*, t.reference as tx_reference, t.gross_amount, t.currency
    FROM disputes d
    LEFT JOIN transactions t ON d.transaction_id = t.id
    WHERE d.merchant_id = $1
  `;
  const params = [req.merchant.id];
  let idx = 2;

  if (status) { sql += ` AND d.status = $${idx++}`; params.push(status); }
  sql += ` ORDER BY d.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const disputes = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query(
    'SELECT COUNT(*) as c FROM disputes WHERE merchant_id = $1', [req.merchant.id]
  )).rows[0].c);

  res.json({ disputes, total, page: parseInt(page), limit: parseInt(limit) });
});

module.exports = router;
