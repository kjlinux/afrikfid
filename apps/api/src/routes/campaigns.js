'use strict';

const { Router } = require('express');
const { pool } = require('../lib/db');
const { v4: uuidv4 } = require('uuid');
const { executeCampaign } = require('../lib/campaign-engine');
const { RFM_SEGMENTS, TRIGGER_TYPES } = require('../config/constants');

const router = Router();

// ═══════════════════════ TRIGGERS ═══════════════════════

// GET /campaigns/triggers — liste triggers d'un marchand
router.get('/triggers', async (req, res, next) => {
  try {
    const { merchant_id, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];
    if (merchant_id) {
      params.push(merchant_id);
      where = `t.merchant_id = $${params.length}`;
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

// POST /campaigns/triggers — créer un trigger
router.post('/triggers', async (req, res, next) => {
  try {
    const { merchant_id, trigger_type, target_segment, channel, message_template, cooldown_hours } = req.body;
    if (!merchant_id || !trigger_type || !message_template) {
      return res.status(400).json({ error: 'merchant_id, trigger_type, message_template requis' });
    }
    if (!TRIGGER_TYPES.includes(trigger_type)) {
      return res.status(400).json({ error: `trigger_type invalide. Valides: ${TRIGGER_TYPES.join(', ')}` });
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

// PATCH /campaigns/triggers/:id — activer/désactiver
router.patch('/triggers/:id', async (req, res, next) => {
  try {
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

// DELETE /campaigns/triggers/:id
router.delete('/triggers/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM triggers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Trigger supprimé' });
  } catch (err) { next(err); }
});

// GET /campaigns/triggers/:id/logs — historique d'un trigger
router.get('/triggers/:id/logs', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const countRes = await pool.query('SELECT COUNT(*) AS total FROM trigger_logs WHERE trigger_id = $1', [req.params.id]);
    const rows = await pool.query(
      `SELECT tl.*, c.full_name, c.phone FROM trigger_logs tl
       JOIN clients c ON c.id = tl.client_id
       WHERE tl.trigger_id = $1 ORDER BY tl.created_at DESC LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    res.json({ logs: rows.rows, total: Number(countRes.rows[0].total) });
  } catch (err) { next(err); }
});

// ═══════════════════════ CAMPAGNES ═══════════════════════

// GET /campaigns — liste campagnes
router.get('/', async (req, res, next) => {
  try {
    const { merchant_id, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '1=1';
    const params = [];
    if (merchant_id) { params.push(merchant_id); where += ` AND ca.merchant_id = $${params.length}`; }
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

// POST /campaigns — créer une campagne
router.post('/', async (req, res, next) => {
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

// POST /campaigns/:id/execute — lancer une campagne
router.post('/:id/execute', async (req, res, next) => {
  try {
    const sent = await executeCampaign(req.params.id);
    res.json({ message: `Campagne exécutée: ${sent} messages envoyés`, sent });
  } catch (err) { next(err); }
});

// PATCH /campaigns/:id — modifier statut
router.patch('/:id', async (req, res, next) => {
  try {
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

module.exports = router;
