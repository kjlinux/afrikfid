'use strict';

const { Router } = require('express');
const { pool } = require('../lib/db');
const { v4: uuidv4 } = require('uuid');
const { calculateMerchantRFM, getMerchantRFMStats } = require('../lib/rfm-engine');
const { RFM_SEGMENTS, MERCHANT_SECTORS } = require('../config/constants');

const router = Router();

// GET /rfm/merchant/:merchantId — scores RFM d'un marchand
router.get('/merchant/:merchantId', async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    const { segment, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let where = 'WHERE rs.merchant_id = $1';
    const params = [merchantId];
    if (segment && RFM_SEGMENTS.includes(segment)) {
      where += ` AND rs.segment = $${params.length + 1}`;
      params.push(segment);
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM rfm_scores rs ${where}`, params
    );

    params.push(limit, offset);
    const scores = await pool.query(
      `SELECT rs.*, c.full_name, c.phone, c.afrikfid_id
       FROM rfm_scores rs JOIN clients c ON c.id = rs.client_id
       ${where} ORDER BY rs.rfm_total DESC, rs.total_amount DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params
    );

    const stats = await getMerchantRFMStats(merchantId);

    res.json({
      scores: scores.rows,
      total: Number(countRes.rows[0].total),
      stats,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) { next(err); }
});

// POST /rfm/merchant/:merchantId/calculate — recalcul RFM manuel
router.post('/merchant/:merchantId/calculate', async (req, res, next) => {
  try {
    const count = await calculateMerchantRFM(req.params.merchantId);
    res.json({ message: `${count} clients scorés`, count });
  } catch (err) { next(err); }
});

// GET /rfm/stats — stats globales RFM (admin)
router.get('/stats', async (req, res, next) => {
  try {
    const segments = await pool.query(
      `SELECT segment, COUNT(*) AS count FROM rfm_scores GROUP BY segment ORDER BY count DESC`
    );
    const totals = await pool.query(
      `SELECT COUNT(DISTINCT client_id) AS total_clients, COUNT(DISTINCT merchant_id) AS total_merchants FROM rfm_scores`
    );
    res.json({
      segments: segments.rows,
      total_clients: Number(totals.rows[0]?.total_clients || 0),
      total_merchants: Number(totals.rows[0]?.total_merchants || 0),
    });
  } catch (err) { next(err); }
});

// GET /rfm/thresholds — seuils RFM par secteur
router.get('/thresholds', async (req, res, next) => {
  try {
    const rows = await pool.query('SELECT * FROM rfm_sector_thresholds ORDER BY sector, dimension');
    res.json({ thresholds: rows.rows });
  } catch (err) { next(err); }
});

// PUT /rfm/thresholds/:sector — configurer seuils RFM pour un secteur
router.put('/thresholds/:sector', async (req, res, next) => {
  try {
    const { sector } = req.params;
    const { recency, frequency, monetary } = req.body;
    if (!recency || !frequency || !monetary) {
      return res.status(400).json({ error: 'recency, frequency, monetary requis' });
    }

    for (const [dim, vals] of Object.entries({ recency, frequency, monetary })) {
      await pool.query(
        `INSERT INTO rfm_sector_thresholds (id, sector, dimension, score_5, score_4, score_3, score_2, score_1, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (sector, dimension) DO UPDATE SET
           score_5 = $4, score_4 = $5, score_3 = $6, score_2 = $7, score_1 = $8, updated_at = NOW()`,
        [uuidv4(), sector, dim, vals[5] || vals.score_5, vals[4] || vals.score_4, vals[3] || vals.score_3, vals[2] || vals.score_2, vals[1] || vals.score_1 || 0]
      );
    }

    res.json({ message: `Seuils RFM mis à jour pour ${sector}` });
  } catch (err) { next(err); }
});

module.exports = router;
