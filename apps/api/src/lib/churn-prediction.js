'use strict';

/**
 * Churn Prediction — CDC v3 §6.1 (Growth+ package)
 *
 * Modèle statistique basé sur 4 signaux RFM :
 *   1. Déclin de récence (R passe de 5→4, 4→3, 3→2)
 *   2. Déclin de fréquence sur 90j vs 90j précédents
 *   3. Déclin de montant moyen sur 90j vs 90j précédents
 *   4. Score RFM actuel (< 9 = signal faible)
 *
 * Score churn : 0.0 (aucun risque) → 1.0 (churn quasi-certain)
 * Niveau : low (< 0.3), medium (0.3-0.6), high (0.6-0.8), critical (> 0.8)
 */

const { pool } = require('./db');

/**
 * Calcule le score de churn pour un client chez un marchand donné
 * @param {string} clientId
 * @param {string} merchantId
 * @returns {Promise<{score: number, level: string, signals: string[], recommendation: string}>}
 */
async function predictChurn(clientId, merchantId) {
  // Récupérer les données transactionnelles du client sur 12 mois
  const txRes = await pool.query(`
    SELECT
      -- Récence
      EXTRACT(DAY FROM NOW() - MAX(completed_at))::int AS days_since_last,
      -- Transactions 90j récents vs 90j précédents
      COUNT(CASE WHEN completed_at >= NOW() - INTERVAL '90 days' THEN 1 END) AS tx_recent_90,
      COUNT(CASE WHEN completed_at >= NOW() - INTERVAL '180 days'
                  AND completed_at < NOW() - INTERVAL '90 days' THEN 1 END) AS tx_prev_90,
      -- Montant moyen 90j récents vs 90j précédents
      AVG(CASE WHEN completed_at >= NOW() - INTERVAL '90 days' THEN gross_amount END) AS avg_recent,
      AVG(CASE WHEN completed_at >= NOW() - INTERVAL '180 days'
               AND completed_at < NOW() - INTERVAL '90 days' THEN gross_amount END) AS avg_prev,
      COUNT(*) AS total_tx
    FROM transactions
    WHERE client_id = $1
      AND merchant_id = $2
      AND status = 'completed'
      AND completed_at >= NOW() - INTERVAL '12 months'
  `, [clientId, merchantId]);

  // Récupérer le score RFM actuel
  const rfmRes = await pool.query(`
    SELECT r_score, f_score, m_score, rfm_total, segment
    FROM rfm_scores
    WHERE client_id = $1 AND merchant_id = $2
    ORDER BY calculated_at DESC LIMIT 1
  `, [clientId, merchantId]);

  // Récupérer l'historique RFM (2 derniers calculs) pour détecter déclin
  const rfmHistRes = await pool.query(`
    SELECT r_score, f_score, m_score, rfm_total, calculated_at
    FROM rfm_scores
    WHERE client_id = $1 AND merchant_id = $2
    ORDER BY calculated_at DESC LIMIT 2
  `, [clientId, merchantId]);

  const tx = txRes.rows[0] || {};
  const rfm = rfmRes.rows[0] || {};
  const rfmHistory = rfmHistRes.rows;

  const signals = [];
  let score = 0;

  // ── Signal 1 : Récence dégradée ────────────────────────────────────────────
  const daysSince = Number(tx.days_since_last || 999);
  if (daysSince > 180) {
    score += 0.35;
    signals.push(`Inactif depuis ${daysSince} jours (> 180j)`);
  } else if (daysSince > 90) {
    score += 0.20;
    signals.push(`Inactif depuis ${daysSince} jours (> 90j)`);
  } else if (daysSince > 45) {
    score += 0.10;
    signals.push(`Inactif depuis ${daysSince} jours (> 45j)`);
  }

  // ── Signal 2 : Déclin de fréquence ────────────────────────────────────────
  const txRecent = Number(tx.tx_recent_90 || 0);
  const txPrev   = Number(tx.tx_prev_90 || 0);
  if (txPrev > 0 && txRecent < txPrev) {
    const decline = (txPrev - txRecent) / txPrev;
    if (decline >= 0.5) {
      score += 0.25;
      signals.push(`Fréquence en baisse de ${Math.round(decline * 100)}% (${txRecent} vs ${txPrev} tx/90j)`);
    } else if (decline >= 0.25) {
      score += 0.12;
      signals.push(`Légère baisse de fréquence (${Math.round(decline * 100)}%)`);
    }
  } else if (txPrev === 0 && txRecent === 0 && Number(tx.total_tx || 0) > 0) {
    score += 0.20;
    signals.push('Aucune transaction dans les 180 derniers jours');
  }

  // ── Signal 3 : Déclin du montant moyen ────────────────────────────────────
  const avgRecent = Number(tx.avg_recent || 0);
  const avgPrev   = Number(tx.avg_prev || 0);
  if (avgPrev > 0 && avgRecent > 0 && avgRecent < avgPrev) {
    const decline = (avgPrev - avgRecent) / avgPrev;
    if (decline >= 0.4) {
      score += 0.15;
      signals.push(`Panier moyen en baisse de ${Math.round(decline * 100)}%`);
    } else if (decline >= 0.2) {
      score += 0.08;
      signals.push(`Légère baisse du panier moyen (${Math.round(decline * 100)}%)`);
    }
  }

  // ── Signal 4 : Score RFM bas + déclin ────────────────────────────────────
  const rfmTotal = Number(rfm.rfm_total || 0);
  if (rfmTotal > 0 && rfmTotal <= 6) {
    score += 0.15;
    signals.push(`Score RFM faible : ${rfmTotal}/15`);
  }

  // Déclin du score RFM entre les 2 derniers calculs
  if (rfmHistory.length === 2) {
    const diff = Number(rfmHistory[1].rfm_total) - Number(rfmHistory[0].rfm_total);
    if (diff >= 3) {
      score += 0.15;
      signals.push(`Score RFM en forte baisse (-${diff} pts depuis le dernier calcul)`);
    } else if (diff >= 1) {
      score += 0.07;
      signals.push(`Score RFM en légère baisse (-${diff} pts)`);
    }
  }

  // ── Signal 5 : Segment critique ─────────────────────────────────────────
  if (rfm.segment === 'PERDUS') {
    score = Math.max(score, 0.85);
    signals.push('Segment PERDUS — churn avéré');
  } else if (rfm.segment === 'A_RISQUE') {
    score = Math.max(score, 0.65);
    signals.push('Segment À RISQUE');
  } else if (rfm.segment === 'HIBERNANTS') {
    score = Math.max(score, 0.45);
    signals.push('Segment HIBERNANTS');
  }

  // Clamp 0–1
  score = Math.min(1, Math.round(score * 100) / 100);

  // Niveau de risque
  let level, recommendation;
  if (score >= 0.8) {
    level = 'critical';
    recommendation = 'Campagne WIN_BACK urgente — offre choc -30% ou points x3';
  } else if (score >= 0.6) {
    level = 'high';
    recommendation = 'Alerte équipe commerciale — offre personnalisée forte à envoyer sous 48h';
  } else if (score >= 0.3) {
    level = 'medium';
    recommendation = 'SMS de rappel avec incentive — points x2 ou remise -15%';
  } else {
    level = 'low';
    recommendation = 'Surveiller. Maintenir engagement via newsletters et offres régulières';
  }

  return {
    client_id: clientId,
    merchant_id: merchantId,
    churn_score: score,
    churn_level: level,
    signals,
    recommendation,
    rfm_context: rfm.segment
      ? { segment: rfm.segment, r: rfm.r_score, f: rfm.f_score, m: rfm.m_score, total: rfm.rfm_total }
      : null,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Calcule les scores de churn pour tous les clients à risque d'un marchand
 * Retourne les clients triés par churn_score DESC, filtrés par level minimum
 * @param {string} merchantId
 * @param {string} minLevel  'medium' | 'high' | 'critical' (défaut: 'medium')
 * @param {number} limit     (défaut: 50)
 */
async function getMerchantChurnRisk(merchantId, minLevel = 'medium', limit = 50) {
  const minScores = { low: 0, medium: 0.3, high: 0.6, critical: 0.8 };
  const minScore = minScores[minLevel] ?? 0.3;

  // Récupérer les clients à risque potentiel (segments RFM défavorables)
  const candidates = await pool.query(`
    SELECT DISTINCT rs.client_id, rs.segment, rs.rfm_total, rs.r_score, rs.f_score, rs.m_score,
      c.full_name, c.phone
    FROM rfm_scores rs
    JOIN clients c ON c.id = rs.client_id
    WHERE rs.merchant_id = $1
      AND rs.segment IN ('A_RISQUE', 'HIBERNANTS', 'PERDUS', 'PROMETTEURS')
      AND rs.calculated_at >= NOW() - INTERVAL '35 days'
    ORDER BY rs.rfm_total ASC
    LIMIT $2
  `, [merchantId, Math.min(limit * 3, 200)]);  // sur-requête pour filtrer ensuite

  const results = [];
  for (const row of candidates.rows) {
    try {
      const prediction = await predictChurn(row.client_id, merchantId);
      if (prediction.churn_score >= minScore) {
        results.push({
          ...prediction,
          client_name: row.full_name,
        });
      }
    } catch {
      // Ignorer les erreurs individuelles
    }
  }

  results.sort((a, b) => b.churn_score - a.churn_score);
  return results.slice(0, limit);
}

/**
 * Résumé des risques churn pour le dashboard marchand
 */
async function getChurnSummary(merchantId) {
  const allRisk = await getMerchantChurnRisk(merchantId, 'low', 500);

  const summary = {
    total_at_risk: allRisk.length,
    by_level: { low: 0, medium: 0, high: 0, critical: 0 },
    avg_churn_score: 0,
    top_at_risk: [],
  };

  let totalScore = 0;
  for (const r of allRisk) {
    summary.by_level[r.churn_level]++;
    totalScore += r.churn_score;
  }

  if (allRisk.length > 0) {
    summary.avg_churn_score = Math.round(totalScore / allRisk.length * 100) / 100;
    summary.top_at_risk = allRisk.slice(0, 5).map(r => ({
      client_id: r.client_id,
      client_name: r.client_name,
      churn_score: r.churn_score,
      churn_level: r.churn_level,
      recommendation: r.recommendation,
    }));
  }

  return summary;
}

module.exports = { predictChurn, getMerchantChurnRisk, getChurnSummary };
