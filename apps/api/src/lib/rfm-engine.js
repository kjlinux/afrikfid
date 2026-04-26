'use strict';

const { pool } = require('./db');
const { v4: uuidv4 } = require('uuid');
const { RFM_DEFAULT_THRESHOLDS, RFM_SEGMENT_RULES, MERCHANT_SECTORS } = require('../config/constants');

/**
 * Récupère les seuils RFM pour un secteur donné (ou défauts)
 */
async function getThresholds(sector) {
  const res = await pool.query(
    'SELECT dimension, score_5, score_4, score_3, score_2, score_1 FROM rfm_sector_thresholds WHERE sector = $1',
    [sector]
  );
  if (res.rows.length === 3) {
    const t = {};
    for (const row of res.rows) {
      t[row.dimension] = {
        5: Number(row.score_5), 4: Number(row.score_4),
        3: Number(row.score_3), 2: Number(row.score_2), 1: Number(row.score_1),
      };
    }
    return t;
  }
  return RFM_DEFAULT_THRESHOLDS;
}

/**
 * Calcule le score 1-5 pour une valeur donnée et des seuils
 */
function scoreValue(value, thresholds, isRecency) {
  if (isRecency) {
    // Recency: lower days = higher score
    for (const s of [5, 4, 3, 2]) {
      if (value <= thresholds[s]) return s;
    }
    return 1;
  }
  // Frequency/Monetary: higher value = higher score
  for (const s of [5, 4, 3, 2]) {
    if (value >= thresholds[s]) return s;
  }
  return 1;
}

/**
 * Détermine le segment RFM à partir des scores R, F, M
 */
function assignSegment(r, f, m) {
  for (const rule of RFM_SEGMENT_RULES) {
    const rOk = (rule.minR === undefined || r >= rule.minR) && (rule.maxR === undefined || r <= rule.maxR);
    const fOk = (rule.minF === undefined || f >= rule.minF) && (rule.maxF === undefined || f <= rule.maxF);
    const mOk = (rule.minM === undefined || m >= rule.minM) && (rule.maxM === undefined || m <= rule.maxM);
    if (rOk && fOk && mOk) return rule.segment;
  }
  return 'PERDUS';
}

/**
 * Calcule les scores RFM pour tous les clients d'un marchand
 */
async function calculateMerchantRFM(merchantId) {
  const merchant = await pool.query('SELECT sector FROM merchants WHERE id = $1', [merchantId]);
  if (!merchant.rows[0]) return 0;

  const sector = merchant.rows[0].sector || 'general';
  const thresholds = await getThresholds(sector);

  // Données agrégées par client pour ce marchand (transactions complétées)
  const clients = await pool.query(`
    SELECT
      client_id,
      EXTRACT(DAY FROM NOW() - MAX(completed_at)) AS days_since_last,
      COUNT(*) AS purchase_count,
      SUM(gross_amount) AS total_amount,
      MAX(completed_at) AS last_purchase_at
    FROM transactions
    WHERE merchant_id = $1 AND status = 'completed' AND client_id IS NOT NULL
    GROUP BY client_id
  `, [merchantId]);

  // Lire les scores actuels pour détecter les transitions — "Identification des transitions")
  const existingScores = await pool.query(
    'SELECT client_id, segment, r_score, f_score, m_score FROM rfm_scores WHERE merchant_id = $1',
    [merchantId]
  );
  const prevByClient = {};
  for (const row of existingScores.rows) {
    prevByClient[row.client_id] = {
      segment: row.segment,
      r_score: Number(row.r_score),
      f_score: Number(row.f_score),
      m_score: Number(row.m_score),
    };
  }

  let count = 0;
  const transitions = [];

  for (const c of clients.rows) {
    const daysSince = Math.max(0, Math.round(Number(c.days_since_last) || 9999));
    const freq = Number(c.purchase_count) || 0;
    const monetary = Number(c.total_amount) || 0;

    const r = scoreValue(daysSince, thresholds.recency, true);
    const f = scoreValue(freq, thresholds.frequency, false);
    const m = scoreValue(monetary, thresholds.monetary, false);
    const segment = assignSegment(r, f, m);

    // Détecter les transitions de segment et de score R — Workflow 07h00)
    const prev = prevByClient[c.client_id];
    if (prev && (prev.segment !== segment || prev.r_score !== r || prev.f_score !== f || prev.m_score !== m)) {
      transitions.push({
        merchant_id: merchantId,
        client_id: c.client_id,
        old_segment: prev.segment,
        new_segment: segment,
        old_r_score: prev.r_score,
        new_r_score: r,
        old_f_score: prev.f_score,
        new_f_score: f,
        old_m_score: prev.m_score,
        new_m_score: m,
      });
    }

    await pool.query(`
      INSERT INTO rfm_scores (id, merchant_id, client_id, r_score, f_score, m_score, segment, last_purchase_at, purchase_count, total_amount, calculated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (merchant_id, client_id) DO UPDATE SET
        r_score = $4, f_score = $5, m_score = $6, segment = $7,
        last_purchase_at = $8, purchase_count = $9, total_amount = $10, calculated_at = NOW()
    `, [uuidv4(), merchantId, c.client_id, r, f, m, segment, c.last_purchase_at, freq, monetary]);
    count++;
  }

  // Persister les transitions pour le worker 07h00 (trigger-batch.js)
  if (transitions.length > 0) {
    for (const t of transitions) {
      await pool.query(`
        INSERT INTO rfm_transitions
          (id, merchant_id, client_id, old_segment, new_segment,
           old_r_score, new_r_score, old_f_score, new_f_score, old_m_score, new_m_score, transitioned_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT DO NOTHING
      `, [uuidv4(), t.merchant_id, t.client_id, t.old_segment, t.new_segment,
          t.old_r_score, t.new_r_score, t.old_f_score, t.new_f_score, t.old_m_score, t.new_m_score]).catch(() => { });
    }
    console.log(`[RFM] ${transitions.length} transitions détectées pour marchand ${merchantId}`);
  }

  return count;
}

/**
 * Batch RFM : recalcule pour tous les marchands actifs
 */
async function runRFMBatch() {
  console.log('[RFM] Démarrage batch RFM...');
  const merchants = await pool.query("SELECT id, name FROM merchants WHERE is_active = true AND status = 'approved'");
  let total = 0;
  for (const m of merchants.rows) {
    const count = await calculateMerchantRFM(m.id);
    total += count;
    console.log(`[RFM] ${m.name}: ${count} clients scorés`);
  }
  console.log(`[RFM] Batch terminé: ${total} scores calculés pour ${merchants.rows.length} marchands`);
  return total;
}

/**
 * Stats RFM pour un marchand
 */
async function getMerchantRFMStats(merchantId) {
  const segments = await pool.query(`
    SELECT segment, COUNT(*) AS count
    FROM rfm_scores WHERE merchant_id = $1
    GROUP BY segment ORDER BY count DESC
  `, [merchantId]);

  const totals = await pool.query(`
    SELECT COUNT(*) AS total_clients,
      ROUND(AVG(r_score + f_score + m_score), 1) AS avg_rfm
    FROM rfm_scores WHERE merchant_id = $1
  `, [merchantId]);

  return {
    segments: segments.rows,
    total_clients: Number(totals.rows[0]?.total_clients || 0),
    avg_rfm: Number(totals.rows[0]?.avg_rfm || 0),
  };
}

module.exports = {
  calculateMerchantRFM,
  runRFMBatch,
  getMerchantRFMStats,
  assignSegment,
  scoreValue,
  getThresholds,
};
