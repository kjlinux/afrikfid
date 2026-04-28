'use strict';

/**
 * Routes admin pour surveiller la passerelle afrikid ↔ business-api.
 *
 * Données remontées :
 *   - Config (BUSINESS_API_URL présent ou pas, sandbox on/off)
 *   - Coverage : transactions completed éligibles vs réellement synchronisées
 *   - File d'attente sync (pending / failed / retries épuisés)
 *   - Derniers appels HTTP signés (audit_logs action = business_api_call*)
 *   - Derniers rapports de réconciliation (audit_logs action = business_api_reconciliation_*)
 *   - Outils : relancer la réconciliation d'un jour, relancer les tx failed
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const afrikfidClient = require('../lib/afrikfid-client');
const { runDailyReconciliation } = require('../workers/business-api-reconciliation');

const SYNC_MAX_ATTEMPTS = 6; // doit matcher workers/business-api-sync.js

// GET /api/v1/loyalty-bridge/health
router.get('/health', requireAdmin, async (req, res) => {
  try {
  const enabled = (process.env.AFRIKFID_UNIFIED_ID || 'true').toLowerCase() === 'true';
  const configured = Boolean(process.env.BUSINESS_API_URL && process.env.BUSINESS_API_TOKEN && process.env.BUSINESS_API_HMAC_SECRET);

  // Coverage sync (30 derniers jours)
  const coverageRes = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE eligible)                                    AS eligible_total,
      COUNT(*) FILTER (WHERE eligible AND synced)                         AS synced_total,
      COUNT(*) FILTER (WHERE eligible AND NOT synced
                            AND COALESCE(sync_attempts, 0) < $1)          AS pending_total,
      COUNT(*) FILTER (WHERE eligible AND NOT synced
                            AND COALESCE(sync_attempts, 0) >= $1)         AS exhausted_total,
      COUNT(*) FILTER (WHERE eligible AND NOT synced
                            AND sync_error IS NOT NULL)                   AS error_total
    FROM (
      SELECT
        (t.status = 'completed' AND c.afrikfid_id ~ '^2014[0-9]{8}$'
          AND m.business_api_marchand_id IS NOT NULL)                     AS eligible,
        (t.business_api_synced_at IS NOT NULL)                            AS synced,
        t.business_api_sync_attempts                                      AS sync_attempts,
        t.business_api_sync_error                                         AS sync_error
      FROM transactions t
      LEFT JOIN clients c   ON c.id = t.client_id
      LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE t.initiated_at > NOW() - INTERVAL '30 days'
    ) x
  `, [SYNC_MAX_ATTEMPTS]);
  const coverage = coverageRes.rows[0] || {};

  // Dernière sync réussie, dernière erreur
  const lastOkRes = await db.query(`
    SELECT business_api_synced_at FROM transactions
     WHERE business_api_synced_at IS NOT NULL
     ORDER BY business_api_synced_at DESC LIMIT 1
  `);
  const lastErrRes = await db.query(`
    SELECT id, reference, business_api_sync_error, business_api_sync_attempts, initiated_at
      FROM transactions
     WHERE business_api_sync_error IS NOT NULL
     ORDER BY initiated_at DESC LIMIT 5
  `);

  // Derniers appels HTTP signés (audit)
  const recentCallsRes = await db.query(`
    SELECT action, resource_id AS path, payload, created_at
      FROM audit_logs
     WHERE actor_type = 'system' AND actor_id = 'afrikfid-client'
     ORDER BY created_at DESC LIMIT 20
  `);

  // Derniers rapports de réconciliation
  const recentReconRes = await db.query(`
    SELECT action, resource_id AS day, payload, created_at
      FROM audit_logs
     WHERE actor_type = 'system' AND actor_id = 'reconciliation-worker'
     ORDER BY created_at DESC LIMIT 14
  `);

  // Clients non liés vs liés (indicateur d'adoption)
  const linkageRes = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE afrikfid_id ~ '^2014[0-9]{8}$')  AS linked,
      COUNT(*) FILTER (WHERE afrikfid_id !~ '^2014[0-9]{8}$') AS unlinked
    FROM clients WHERE is_active = TRUE
  `);
  const linkage = linkageRes.rows[0] || { linked: 0, unlinked: 0 };

  res.json({
    config: { enabled, configured, sandbox: process.env.NODE_ENV !== 'production' },
    coverage: {
      window_days: 30,
      eligible: Number(coverage.eligible_total || 0),
      synced: Number(coverage.synced_total || 0),
      pending: Number(coverage.pending_total || 0),
      retry_exhausted: Number(coverage.exhausted_total || 0),
      last_sync_at: lastOkRes.rows[0]?.business_api_synced_at || null,
    },
    linkage: { linked: Number(linkage.linked), unlinked: Number(linkage.unlinked) },
    recentErrors: lastErrRes.rows.map(r => ({
      transactionId: r.id,
      reference: r.reference,
      error: r.business_api_sync_error,
      attempts: r.business_api_sync_attempts,
      at: r.initiated_at,
    })),
    recentCalls: recentCallsRes.rows.map(r => ({
      action: r.action,
      path: r.path,
      at: r.created_at,
      meta: safeParse(r.payload),
    })),
    reconciliation: recentReconRes.rows.map(r => ({
      action: r.action,
      day: r.day,
      at: r.created_at,
      report: safeParse(r.payload),
    })),
  });
  } catch (err) {
    console.error('[loyalty-bridge/health]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/loyalty-bridge/reconcile  { date?: "YYYY-MM-DD" }
router.post('/reconcile', requireAdmin, async (req, res) => {
  const targetIso = req.body?.date;
  let target;
  if (targetIso) {
    const d = new Date(`${targetIso}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'date invalide (YYYY-MM-DD)' });
    target = d;
  }
  try {
    const report = await runDailyReconciliation(target);
    res.json({ ok: true, report });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// POST /api/v1/loyalty-bridge/retry/:txId — force une re-tentative de sync
router.post('/retry/:txId', requireAdmin, async (req, res) => {
  const tx = (await db.query(`
    SELECT t.id, t.gross_amount, t.completed_at, t.initiated_at,
           c.afrikfid_id, m.business_api_marchand_id
      FROM transactions t
      LEFT JOIN clients c   ON c.id = t.client_id
      LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE t.id = $1 AND t.status = 'completed'
  `, [req.params.txId])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée ou non completed.' });
  if (!afrikfidClient.isValidCardNumero(tx.afrikfid_id)) {
    return res.status(409).json({ error: 'Client sans carte fidélité liée.' });
  }
  if (!tx.business_api_marchand_id) {
    return res.status(409).json({ error: 'Marchand sans business_api_marchand_id.' });
  }
  try {
    const result = await afrikfidClient.creditTransaction({
      numero: tx.afrikfid_id,
      montant_total_xof: Math.round(Number(tx.gross_amount) || 0),
      marchand_id: tx.business_api_marchand_id,
      reference_afrikid: tx.id,
      occurred_at: tx.completed_at || tx.initiated_at,
    });
    await db.query(`
      UPDATE transactions
         SET business_api_transaction_id = $1,
             business_api_points_awarded = $2,
             business_api_synced_at = NOW(),
             business_api_sync_error = NULL,
             business_api_sync_attempts = COALESCE(business_api_sync_attempts, 0) + 1
       WHERE id = $3
    `, [result?.transaction_id || null, result?.points_awarded || null, tx.id]);
    res.json({ ok: true, result });
  } catch (err) {
    await db.query(`
      UPDATE transactions
         SET business_api_sync_error = $1,
             business_api_sync_attempts = COALESCE(business_api_sync_attempts, 0) + 1
       WHERE id = $2
    `, [String(err.message).slice(0, 500), tx.id]);
    res.status(502).json({ ok: false, error: err.message });
  }
});

function safeParse(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = router;
