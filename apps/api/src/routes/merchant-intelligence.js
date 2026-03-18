'use strict';

const { Router } = require('express');
const { pool } = require('../lib/db');
const { getMerchantRFMStats } = require('../lib/rfm-engine');
const { MERCHANT_PACKAGES } = require('../config/constants');

const router = Router();

/**
 * GET /merchant-intelligence/:merchantId
 * Dashboard intelligence conditionnel par package (CDC v3 §6.1-6.3)
 * STARTER_BOOST: KPIs basiques uniquement
 * STARTER_PLUS: + segmentation RFM simplifiée
 * GROWTH: + segmentation RFM détaillée + actions recommandées
 * PREMIUM: + analytics avancés LTV/élasticité
 */
router.get('/:merchantId', async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    const merchant = await pool.query(
      'SELECT id, name, package, sector FROM merchants WHERE id = $1', [merchantId]
    );
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });

    const pkg = merchant.rows[0].package || 'STARTER_BOOST';
    const pkgIndex = MERCHANT_PACKAGES.indexOf(pkg);

    // Base: KPIs basiques (tous packages)
    const kpis = await pool.query(`
      SELECT
        COUNT(*) AS total_transactions,
        SUM(gross_amount) AS total_revenue,
        AVG(gross_amount) AS avg_basket,
        COUNT(DISTINCT client_id) AS unique_clients
      FROM transactions
      WHERE merchant_id = $1 AND status = 'completed'
    `, [merchantId]);

    const result = {
      package: pkg,
      modules: {
        basic_kpis: true,
        rfm_simple: pkgIndex >= 1,
        rfm_detailed: pkgIndex >= 2,
        campaigns: pkgIndex >= 2,
        analytics_advanced: pkgIndex >= 3,
      },
      kpis: kpis.rows[0],
    };

    // STARTER_PLUS+ : segmentation RFM simplifiée
    if (pkgIndex >= 1) {
      result.rfm_stats = await getMerchantRFMStats(merchantId);
    }

    // GROWTH+ : détail par segment + actions recommandées
    if (pkgIndex >= 2) {
      const segmentDetails = await pool.query(`
        SELECT rs.segment, COUNT(*) AS count,
          ROUND(AVG(rs.total_amount)::numeric, 0) AS avg_amount,
          ROUND(AVG(rs.purchase_count)::numeric, 1) AS avg_purchases
        FROM rfm_scores rs WHERE rs.merchant_id = $1
        GROUP BY rs.segment ORDER BY count DESC
      `, [merchantId]);
      result.rfm_details = segmentDetails.rows;

      // Actions recommandées par segment
      result.recommended_actions = {
        A_RISQUE: 'Lancer une campagne WIN_BACK avec offre incentive',
        HIBERNANTS: 'Envoi SMS personnalisé avec remise exclusive',
        PERDUS: 'Protocole d\'abandon en 5 étapes',
        PROMETTEURS: 'Programme de bienvenue renforcé',
        FIDELES: 'Programme de fidélisation premium',
        CHAMPIONS: 'Offres VIP et accès anticipé',
      };

      // Campagnes actives
      const campaigns = await pool.query(
        "SELECT id, name, target_segment, status, total_sent, total_converted FROM campaigns WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 5",
        [merchantId]
      );
      result.recent_campaigns = campaigns.rows;
    }

    // PREMIUM : analytics avancés
    if (pkgIndex >= 3) {
      // LTV estimé par segment
      const ltv = await pool.query(`
        SELECT rs.segment,
          ROUND(AVG(rs.total_amount)::numeric, 0) AS avg_ltv,
          ROUND(AVG(rs.purchase_count)::numeric, 1) AS avg_frequency
        FROM rfm_scores rs WHERE rs.merchant_id = $1
        GROUP BY rs.segment
      `, [merchantId]);
      result.ltv_by_segment = ltv.rows;

      // Tendance mensuelle
      const trend = await pool.query(`
        SELECT TO_CHAR(completed_at, 'YYYY-MM') AS month,
          COUNT(*) AS transactions,
          SUM(gross_amount) AS revenue,
          COUNT(DISTINCT client_id) AS unique_clients
        FROM transactions
        WHERE merchant_id = $1 AND status = 'completed' AND completed_at >= NOW() - INTERVAL '12 months'
        GROUP BY TO_CHAR(completed_at, 'YYYY-MM')
        ORDER BY month
      `, [merchantId]);
      result.monthly_trend = trend.rows;
    }

    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
