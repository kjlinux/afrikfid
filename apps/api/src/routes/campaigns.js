'use strict';

const { Router } = require('express');
const { pool } = require('../lib/db');
const { v4: uuidv4 } = require('uuid');
const { executeCampaign } = require('../lib/campaign-engine');
const { RFM_SEGMENTS, TRIGGER_TYPES } = require('../config/constants');
const { requirePackage } = require('../middleware/require-package');
const { requireAdmin, requireAuth, requireMerchant } = require('../middleware/auth');
const { decrypt } = require('../lib/crypto');

function safeDecrypt(val) {
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

const router = Router();

// Helper : vérifie qu'un marchand n'accède qu'à ses propres données
function assertMerchantOwnership(req, merchantId) {
  if (req.admin) return true; // admin voit tout
  if (req.merchant && req.merchant.id !== merchantId) return false;
  return true;
}

// ═══════════════════════ TRIGGERS ═══════════════════════

// GET /campaigns/triggers — liste triggers (admin: tous; marchand: les siens uniquement)
router.get('/triggers', requireAuth, async (req, res, next) => {
  try {
    const { merchant_id, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = '1=1';

    // Un marchand ne voit que ses propres triggers
    const effectiveMerchantId = req.merchant ? req.merchant.id : merchant_id;
    if (effectiveMerchantId) {
      params.push(effectiveMerchantId);
      where = `t.merchant_id = $${params.length}`;
    } else if (!req.admin) {
      return res.status(403).json({ error: 'merchant_id requis ou authentification marchande nécessaire' });
    }

    const countRes = await pool.query(`SELECT COUNT(*) AS total FROM triggers t WHERE ${where}`, params);
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT t.*, m.name AS merchant_name FROM triggers t JOIN merchants m ON m.id = t.merchant_id
       WHERE ${where} ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
    );
    res.json({ triggers: rows.rows, total: Number(countRes.rows[0].total) });
  } catch (err) { next(err); }
});

// POST /campaigns/triggers — créer un trigger (admin ou marchand propriétaire, GROWTH+ pour segments RFM)
router.post('/triggers', requireAuth, async (req, res, next) => {
  try {
    const { trigger_type, target_segment, channel, message_template, cooldown_hours } = req.body;
    // Le marchand authentifié ne peut créer que pour lui-même
    const merchant_id = req.merchant ? req.merchant.id : req.body.merchant_id;
    if (!merchant_id || !trigger_type || !message_template) {
      return res.status(400).json({ error: 'merchant_id, trigger_type, message_template requis' });
    }
    if (!assertMerchantOwnership(req, merchant_id)) {
      return res.status(403).json({ error: 'Accès interdit : vous ne pouvez créer des triggers que pour votre propre compte' });
    }
    if (!TRIGGER_TYPES.includes(trigger_type)) {
      return res.status(400).json({ error: `trigger_type invalide. Valides: ${TRIGGER_TYPES.join(', ')}` });
    }
    // Triggers basés sur segments RFM (ABSENCE, ALERTE_R, A_RISQUE, WIN_BACK) requièrent GROWTH+
    const rfmTriggers = ['ABSENCE', 'ALERTE_R', 'A_RISQUE', 'WIN_BACK'];
    if (rfmTriggers.includes(trigger_type)) {
      const { requirePackage: checkPkg } = require('../middleware/require-package');
      // Vérification manuelle du package
      const merchantRow = (await pool.query('SELECT package FROM merchants WHERE id = $1', [merchant_id])).rows[0];
      const pkgOrder = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM'];
      if (!merchantRow || pkgOrder.indexOf(merchantRow.package) < pkgOrder.indexOf('GROWTH')) {
        return res.status(403).json({
          error: 'Les triggers RFM (segments) nécessitent le package Growth ou supérieur',
          required: 'GROWTH',
          current: merchantRow?.package || 'STARTER_BOOST',
          upgrade_needed: true,
        });
      }
    }
    const id = uuidv4();
    await pool.query(
      `INSERT INTO triggers (id, merchant_id, trigger_type, target_segment, channel, message_template, cooldown_hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, merchant_id, trigger_type, target_segment || null, channel || 'sms', message_template, cooldown_hours || 24]
    );
    res.status(201).json({ id, message: 'Trigger créé' });
  } catch (err) { next(err); }
});

// PATCH /campaigns/triggers/:id — activer/désactiver (admin ou marchand propriétaire)
router.patch('/triggers/:id', requireAuth, async (req, res, next) => {
  try {
    const trigger = (await pool.query('SELECT merchant_id FROM triggers WHERE id = $1', [req.params.id])).rows[0];
    if (!trigger) return res.status(404).json({ error: 'Trigger non trouvé' });
    if (!assertMerchantOwnership(req, trigger.merchant_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { is_active, message_template, cooldown_hours } = req.body;
    const sets = [];
    const params = [];
    if (typeof is_active === 'boolean') { params.push(is_active); sets.push(`is_active = $${params.length}`); }
    if (message_template) { params.push(message_template); sets.push(`message_template = $${params.length}`); }
    if (cooldown_hours) { params.push(cooldown_hours); sets.push(`cooldown_hours = $${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    await pool.query(`UPDATE triggers SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ message: 'Trigger mis à jour' });
  } catch (err) { next(err); }
});

// DELETE /campaigns/triggers/:id (admin ou marchand propriétaire)
router.delete('/triggers/:id', requireAuth, async (req, res, next) => {
  try {
    const trigger = (await pool.query('SELECT merchant_id FROM triggers WHERE id = $1', [req.params.id])).rows[0];
    if (!trigger) return res.status(404).json({ error: 'Trigger non trouvé' });
    if (!assertMerchantOwnership(req, trigger.merchant_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    await pool.query('DELETE FROM triggers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Trigger supprimé' });
  } catch (err) { next(err); }
});

// GET /campaigns/triggers/:id/logs — historique (admin ou marchand propriétaire)
router.get('/triggers/:id/logs', requireAuth, async (req, res, next) => {
  try {
    const trigger = (await pool.query('SELECT merchant_id FROM triggers WHERE id = $1', [req.params.id])).rows[0];
    if (!trigger) return res.status(404).json({ error: 'Trigger non trouvé' });
    if (!assertMerchantOwnership(req, trigger.merchant_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const countRes = await pool.query('SELECT COUNT(*) AS total FROM trigger_logs WHERE trigger_id = $1', [req.params.id]);
    const rows = await pool.query(
      `SELECT tl.*, c.full_name, c.phone FROM trigger_logs tl
       JOIN clients c ON c.id = tl.client_id
       WHERE tl.trigger_id = $1 ORDER BY tl.created_at DESC LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json({
      logs: rows.rows.map(r => ({ ...r, phone: safeDecrypt(r.phone) })),
      total: Number(countRes.rows[0].total),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════ CAMPAGNES ═══════════════════════

// GET /campaigns — liste campagnes (admin: toutes; marchand: les siennes)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const effectiveMerchantId = req.merchant ? req.merchant.id : req.query.merchant_id;
    const params = [];
    let where = '1=1';
    if (effectiveMerchantId) { params.push(effectiveMerchantId); where += ` AND ca.merchant_id = $${params.length}`; }
    else if (!req.admin) return res.status(403).json({ error: 'Accès réservé aux marchands et administrateurs' });
    if (status) { params.push(status); where += ` AND ca.status = $${params.length}`; }
    const countRes = await pool.query(`SELECT COUNT(*) AS total FROM campaigns ca WHERE ${where}`, params);
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT ca.*, m.name AS merchant_name FROM campaigns ca JOIN merchants m ON m.id = ca.merchant_id
       WHERE ${where} ORDER BY ca.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params
    );
    res.json({ campaigns: rows.rows, total: Number(countRes.rows[0].total) });
  } catch (err) { next(err); }
});

// POST /campaigns — créer une campagne (GROWTH+ requis — CDC v3 §6.1)
router.post('/', requireAuth, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const { merchant_id, name, target_segment, channel, message_template, scheduled_at } = req.body;
    if (!merchant_id || !name || !target_segment || !message_template) {
      return res.status(400).json({ error: 'merchant_id, name, target_segment, message_template requis' });
    }
    if (!RFM_SEGMENTS.includes(target_segment)) {
      return res.status(400).json({ error: `Segment invalide. Valides: ${RFM_SEGMENTS.join(', ')}` });
    }
    const id = uuidv4();
    await pool.query(
      `INSERT INTO campaigns (id, merchant_id, name, target_segment, channel, message_template, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, merchant_id, name, target_segment, channel || 'sms', message_template, scheduled_at || null, scheduled_at ? 'scheduled' : 'draft']
    );
    res.status(201).json({ id, message: 'Campagne créée' });
  } catch (err) { next(err); }
});

// POST /campaigns/:id/execute — lancer une campagne (GROWTH+ requis)
router.post('/:id/execute', requireAuth, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const sent = await executeCampaign(req.params.id);
    res.json({ message: `Campagne exécutée: ${sent} messages envoyés`, sent });
  } catch (err) { next(err); }
});

// PATCH /campaigns/:id — modifier statut (admin ou marchand propriétaire)
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const campaign = (await pool.query('SELECT merchant_id FROM campaigns WHERE id = $1', [req.params.id])).rows[0];
    if (!campaign) return res.status(404).json({ error: 'Campagne non trouvée' });
    if (!assertMerchantOwnership(req, campaign.merchant_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { status, name, message_template } = req.body;
    const sets = [];
    const params = [];
    if (status) { params.push(status); sets.push(`status = $${params.length}`); }
    if (name) { params.push(name); sets.push(`name = $${params.length}`); }
    if (message_template) { params.push(message_template); sets.push(`message_template = $${params.length}`); }
    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    await pool.query(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ message: 'Campagne mise à jour' });
  } catch (err) { next(err); }
});

// ═══════════════════════ CAMPAGNES DÉMOGRAPHIQUES ═══════════════════════

// POST /campaigns/demographic/preview — compte l'audience sans créer la campagne
router.post('/demographic/preview', requireAuth, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const { merchant_id, filter } = req.body;
    const effectiveMerchantId = req.merchant ? req.merchant.id : merchant_id;
    if (!effectiveMerchantId) return res.status(400).json({ error: 'merchant_id requis' });
    if (!assertMerchantOwnership(req, effectiveMerchantId)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const { buildDemographicQuery } = require('../lib/campaign-engine');
    const { sql, params } = buildDemographicQuery(effectiveMerchantId, filter || {});

    // Count via wrap pour éviter de tirer 10 000 lignes inutilement
    const countSql = `SELECT COUNT(*)::int AS total FROM (${sql}) sub`;
    const { rows } = await pool.query(countSql, params);

    // Sample de 5 clients pour preview UI (noms masqués)
    const sampleRes = await pool.query(sql, params);
    const sample = sampleRes.rows.slice(0, 5).map(c => {
      const fn = c.full_name || '';
      const parts = fn.split(' ');
      const masked = parts.map((p, i) => i === 0 ? p : (p.slice(0, 1) + '.')).join(' ');
      return {
        afrikfidId: c.afrikfid_id,
        name: masked || '—',
        city: c.city || null,
        gender: c.gender || null,
        birthMonth: c.birth_date ? new Date(c.birth_date).getMonth() + 1 : null,
        loyaltyStatus: c.loyalty_status,
      };
    });

    res.json({ total: rows[0]?.total || 0, sample });
  } catch (err) { next(err); }
});

// POST /campaigns/demographic — crée une campagne démographique
router.post('/demographic', requireAuth, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const { merchant_id, name, filter, channel, message_template, scheduled_at } = req.body;
    const effectiveMerchantId = req.merchant ? req.merchant.id : merchant_id;
    if (!effectiveMerchantId) return res.status(400).json({ error: 'merchant_id requis' });
    if (!assertMerchantOwnership(req, effectiveMerchantId)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    if (!name || !message_template) {
      return res.status(400).json({ error: 'name et message_template requis' });
    }
    if (!filter || typeof filter !== 'object') {
      return res.status(400).json({ error: 'filter (objet JSON) requis' });
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO campaigns
         (id, merchant_id, name, target_segment, audience_type, audience_filter,
          channel, message_template, scheduled_at, status)
       VALUES ($1, $2, $3, 'DEMOGRAPHIC', 'DEMOGRAPHIC', $4::jsonb, $5, $6, $7, $8)`,
      [id, effectiveMerchantId, name, JSON.stringify(filter),
       channel || 'sms', message_template, scheduled_at || null,
       scheduled_at ? 'scheduled' : 'draft']
    );
    res.status(201).json({ id, message: 'Campagne démographique créée' });
  } catch (err) { next(err); }
});

// ═══════════════════════ ABANDON PROTOCOL ═══════════════════════

// GET /campaigns/abandon — protocole d'abandon (admin ou marchand propriétaire, GROWTH+)
router.get('/abandon', requireAuth, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const { status = 'active', page = 1, limit = 20 } = req.query;
    // Marchand ne voit que ses propres données ; admin peut filtrer par merchant_id
    const effectiveMerchantId = req.merchant ? req.merchant.id : req.query.merchant_id;
    if (!req.admin && !effectiveMerchantId) {
      return res.status(403).json({ error: 'Accès réservé aux marchands et administrateurs' });
    }
    const offset = (page - 1) * limit;
    const params = [status];
    let where = 'at.status = $1';
    if (effectiveMerchantId) { params.push(effectiveMerchantId); where += ` AND at.merchant_id = $${params.length}`; }
    params.push(limit, offset);

    const total = await pool.query(
      `SELECT COUNT(*) as c FROM abandon_tracking at WHERE ${where}`,
      params.slice(0, -2)
    );
    const rows = await pool.query(
      `SELECT at.*, c.full_name, c.phone, m.name AS merchant_name,
              rs.segment, rs.r_score, rs.f_score, rs.m_score
       FROM abandon_tracking at
       JOIN clients c ON c.id = at.client_id
       JOIN merchants m ON m.id = at.merchant_id
       LEFT JOIN rfm_scores rs ON rs.client_id = at.client_id AND rs.merchant_id = at.merchant_id
       WHERE ${where}
       ORDER BY at.next_step_at ASC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: rows.rows.map(r => ({ ...r, phone: safeDecrypt(r.phone) })),
      pagination: { page: +page, limit: +limit, total: +total.rows[0].c },
    });
  } catch (err) { next(err); }
});

// GET /campaigns/abandon/stats — stats du protocole d'abandon (admin uniquement)
router.get('/abandon/stats', requireAdmin, async (req, res, next) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'reactivated') AS reactivated,
        COUNT(*) FILTER (WHERE status = 'lost') AS lost,
        COUNT(*) FILTER (WHERE status = 'active' AND current_step = 1) AS step_1,
        COUNT(*) FILTER (WHERE status = 'active' AND current_step = 2) AS step_2,
        COUNT(*) FILTER (WHERE status = 'active' AND current_step = 3) AS step_3,
        COUNT(*) FILTER (WHERE status = 'active' AND current_step = 4) AS step_4,
        COUNT(*) FILTER (WHERE status = 'active' AND current_step = 5) AS step_5
      FROM abandon_tracking
    `);
    res.json(stats.rows[0]);
  } catch (err) { next(err); }
});

// ═══════════════════════ CHURN ALERTS ═══════════════════════

// GET /campaigns/churn-alerts — clients à risque (admin ou marchand propriétaire, GROWTH+)
router.get('/churn-alerts', requireAuth, requirePackage('GROWTH'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const effectiveMerchantId = req.merchant ? req.merchant.id : req.query.merchant_id;
    if (!req.admin && !effectiveMerchantId) {
      return res.status(403).json({ error: 'Accès réservé aux marchands et administrateurs' });
    }
    const offset = (page - 1) * limit;
    const params = [];
    let where = "rs.segment IN ('A_RISQUE', 'HIBERNANTS') AND c.is_active = true";
    if (effectiveMerchantId) { params.push(effectiveMerchantId); where += ` AND rs.merchant_id = $${params.length}`; }
    params.push(limit, offset);

    const total = await pool.query(
      `SELECT COUNT(*) as c FROM rfm_scores rs JOIN clients c ON c.id = rs.client_id WHERE ${where}`,
      params.slice(0, -2)
    );
    const rows = await pool.query(
      `SELECT rs.*, c.full_name, c.phone, c.loyalty_status, m.name AS merchant_name,
              at.current_step AS abandon_step, at.status AS abandon_status
       FROM rfm_scores rs
       JOIN clients c ON c.id = rs.client_id
       JOIN merchants m ON m.id = rs.merchant_id
       LEFT JOIN abandon_tracking at ON at.client_id = rs.client_id AND at.merchant_id = rs.merchant_id
       WHERE ${where}
       ORDER BY rs.r_score ASC, rs.rfm_total ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: rows.rows.map(r => ({ ...r, phone: safeDecrypt(r.phone) })),
      pagination: { page: +page, limit: +limit, total: +total.rows[0].c },
    });
  } catch (err) { next(err); }
});

// ═══════════════════════ DAILY WORKFLOW STATUS ═══════════════════════

// GET /campaigns/workflow-status — statut opérations quotidiennes (admin uniquement)
router.get('/workflow-status', requireAdmin, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [rfmCount, triggersCount, notifCount, abandonCount, txCount] = await Promise.all([
      pool.query("SELECT COUNT(*) as c FROM rfm_scores WHERE calculated_at::date = $1", [today]),
      pool.query("SELECT COUNT(*) as c FROM trigger_logs WHERE created_at::date = $1", [today]),
      pool.query("SELECT COUNT(*) as c FROM notification_log WHERE created_at::date = $1", [today]),
      pool.query("SELECT COUNT(*) as c FROM abandon_tracking WHERE updated_at::date = $1", [today]),
      pool.query("SELECT COUNT(*) as c, COALESCE(SUM(gross_amount), 0) as volume FROM transactions WHERE initiated_at::date = $1 AND status = 'completed'", [today]),
    ]);

    res.json({
      date: today,
      operations: [
        { time: '06h00', label: 'Calcul scores RFM', count: +rfmCount.rows[0].c, status: +rfmCount.rows[0].c > 0 ? 'completed' : 'pending' },
        { time: '07h00', label: 'Génération alertes & triggers', count: +triggersCount.rows[0].c, status: +triggersCount.rows[0].c > 0 ? 'completed' : 'pending' },
        { time: '07h00', label: 'Protocole d\'abandon', count: +abandonCount.rows[0].c, status: +abandonCount.rows[0].c > 0 ? 'completed' : 'pending' },
        { time: '08h00', label: 'Notifications statut', count: +notifCount.rows[0].c, status: +notifCount.rows[0].c > 0 ? 'completed' : 'pending' },
        { time: 'Continu', label: 'Transactions du jour', count: +txCount.rows[0].c, status: 'running', extra: { volume: +txCount.rows[0].volume } },
      ],
    });
  } catch (err) { next(err); }
});

module.exports = router;
