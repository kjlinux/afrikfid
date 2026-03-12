'use strict';

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
  getAllRules, createRule, toggleRule, deleteRule,
  getBlockedPhones, blockPhone, unblockPhone,
  RULE_TYPES,
} = require('../lib/fraud');

// GET /api/v1/fraud/rules
router.get('/rules', requireAdmin, async (req, res) => {
  res.json({ rules: await getAllRules(), ruleTypes: Object.values(RULE_TYPES) });
});

// POST /api/v1/fraud/rules
router.post('/rules', requireAdmin, async (req, res) => {
  const { name, rule_type, value } = req.body;
  if (!name || !rule_type || value === undefined) {
    return res.status(400).json({ error: 'name, rule_type et value sont requis' });
  }
  if (isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
    return res.status(400).json({ error: 'value doit être un nombre positif' });
  }
  try {
    const rule = await createRule({ name, rule_type, value });
    res.status(201).json({ rule });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/v1/fraud/rules/:id/toggle
router.patch('/rules/:id/toggle', requireAdmin, async (req, res) => {
  const { is_active } = req.body;
  if (is_active === undefined) return res.status(400).json({ error: 'is_active requis' });
  const updated = await toggleRule(req.params.id, is_active);
  if (!updated) return res.status(404).json({ error: 'Règle non trouvée' });
  res.json({ message: `Règle ${is_active ? 'activée' : 'désactivée'}` });
});

// DELETE /api/v1/fraud/rules/:id
router.delete('/rules/:id', requireAdmin, async (req, res) => {
  const deleted = await deleteRule(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Règle non trouvée' });
  res.json({ message: 'Règle supprimée' });
});

// GET /api/v1/fraud/blocked-phones
router.get('/blocked-phones', requireAdmin, async (req, res) => {
  res.json({ phones: await getBlockedPhones() });
});

// POST /api/v1/fraud/blocked-phones
router.post('/blocked-phones', requireAdmin, async (req, res) => {
  const { phone, reason } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone requis' });
  await blockPhone(phone, reason, req.admin?.id || null);
  res.status(201).json({ message: 'Numéro bloqué', phone });
});

// DELETE /api/v1/fraud/blocked-phones/:phone
router.delete('/blocked-phones/:phone', requireAdmin, async (req, res) => {
  const removed = await unblockPhone(decodeURIComponent(req.params.phone));
  if (!removed) return res.status(404).json({ error: 'Numéro non trouvé dans la liste noire' });
  res.json({ message: 'Numéro débloqué' });
});

module.exports = router;
