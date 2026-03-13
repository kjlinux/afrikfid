'use strict';

/**
 * Route GET /api/v1/distributions/:id
 * Retourne le détail d'une distribution individuelle (CDC §4.5.1)
 * Accès : marchand propriétaire (via clé API) ou admin
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireApiKey, requireAdmin } = require('../middleware/auth');

// GET /api/v1/distributions/:id (marchand)
router.get('/:id', requireApiKey, async (req, res) => {
  const dist = (await db.query(
    `SELECT d.*, t.reference, t.merchant_id, t.gross_amount, t.currency as tx_currency,
            t.client_loyalty_status, t.status as tx_status
     FROM distributions d
     JOIN transactions t ON t.id = d.transaction_id
     WHERE d.id = $1 AND t.merchant_id = $2`,
    [req.params.id, req.merchant.id]
  )).rows[0];

  if (!dist) return res.status(404).json({ error: 'Distribution non trouvée' });
  res.json({ distribution: dist });
});

// GET /api/v1/distributions/:id/admin (admin) — accès sans restriction marchand
router.get('/:id/admin', requireAdmin, async (req, res) => {
  const dist = (await db.query(
    `SELECT d.*, t.reference, t.merchant_id, t.gross_amount, t.currency as tx_currency,
            t.client_loyalty_status, t.status as tx_status,
            m.name as merchant_name
     FROM distributions d
     JOIN transactions t ON t.id = d.transaction_id
     JOIN merchants m ON m.id = t.merchant_id
     WHERE d.id = $1`,
    [req.params.id]
  )).rows[0];

  if (!dist) return res.status(404).json({ error: 'Distribution non trouvée' });
  res.json({ distribution: dist });
});

module.exports = router;
