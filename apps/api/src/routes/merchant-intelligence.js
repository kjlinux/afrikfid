'use strict';

const { Router } = require('express');
const { pool } = require('../lib/db');
const { getMerchantRFMStats } = require('../lib/rfm-engine');
const { getChurnSummary, predictChurn, getMerchantChurnRisk } = require('../lib/churn-prediction');
const { calculatePriceElasticity } = require('../lib/price-elasticity');
const { getTradeZoneStats } = require('../lib/trade-zones');
const { MERCHANT_PACKAGES } = require('../config/constants');
const { requireAuth } = require('../middleware/auth');

const router = Router();

/**
 * GET /merchant-intelligence/:merchantId
 * Dashboard intelligence conditionnel par package (CDC v3 §6.1-6.3)
 * STARTER_BOOST: KPIs basiques uniquement
 * STARTER_PLUS: + segmentation RFM simplifiée
 * GROWTH: + segmentation RFM détaillée + actions recommandées
 * PREMIUM: + analytics avancés LTV/élasticité
 */
router.get('/:merchantId', requireAuth, async (req, res, next) => {
  try {
    const { merchantId } = req.params;

    // Un marchand ne peut consulter que sa propre intelligence — l'admin voit tout
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit : vous ne pouvez consulter que votre propre dashboard' });
    }
    // Les clients n'ont pas accès aux données d'intelligence marchande
    if (req.client) {
      return res.status(403).json({ error: 'Accès réservé aux marchands et administrateurs' });
    }

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

    // Taux de retour clients (CDC §6.3 — Starter Plus+)
    // = % de clients ayant acheté plus d'une fois
    const returnRateRes = await pool.query(`
      SELECT
        COUNT(DISTINCT client_id) AS total_clients,
        COUNT(DISTINCT CASE WHEN tx_count > 1 THEN client_id END) AS returning_clients
      FROM (
        SELECT client_id, COUNT(*) AS tx_count
        FROM transactions
        WHERE merchant_id = $1 AND status = 'completed'
          AND completed_at >= NOW() - INTERVAL '12 months'
        GROUP BY client_id
      ) sub
    `, [merchantId]);
    const rrRow = returnRateRes.rows[0] || {};
    const totalClients = Number(rrRow.total_clients || 0);
    const returningClients = Number(rrRow.returning_clients || 0);
    const returnRate = totalClients > 0
      ? Math.round(returningClients / totalClients * 100 * 10) / 10
      : 0;

    const result = {
      package: pkg,
      modules: {
        basic_kpis: true,
        loyalty_score: true,
        return_rate: pkgIndex >= 1,
        top_clients: pkgIndex >= 1,
        churn_alerts: pkgIndex >= 1,
        rfm_simple: pkgIndex >= 1,
        rfm_detailed: pkgIndex >= 2,
        churn_prediction: pkgIndex >= 2,
        campaigns: pkgIndex >= 2,
        ai_recommendations: pkgIndex >= 2,
        analytics_advanced: pkgIndex >= 3,
        ltv: pkgIndex >= 3,
        price_elasticity: pkgIndex >= 3,
        trade_zone_mapping: pkgIndex >= 3,
      },
      kpis: kpis.rows[0],
    };

    // STARTER_PLUS+ : taux de retour + top clients + alertes churn basiques + RFM simplifié
    if (pkgIndex >= 1) {
      result.return_rate = returnRate;
      result.rfm_stats = await getMerchantRFMStats(merchantId);

      // Top 5 clients fidèles
      const topClients = await pool.query(`
        SELECT c.id, c.full_name, c.loyalty_status,
          COUNT(t.id) AS tx_count,
          SUM(t.gross_amount) AS total_spent,
          MAX(t.completed_at) AS last_purchase
        FROM transactions t
        JOIN clients c ON c.id = t.client_id
        WHERE t.merchant_id = $1 AND t.status = 'completed'
          AND t.completed_at >= NOW() - INTERVAL '12 months'
        GROUP BY c.id, c.full_name, c.loyalty_status
        ORDER BY total_spent DESC LIMIT 5
      `, [merchantId]);
      result.top_clients = topClients.rows;

      // Alertes churn basiques : nombre de clients par niveau de risque
      const churnSummary = await getChurnSummary(merchantId);
      result.churn_alerts = {
        total_at_risk: churnSummary.total_at_risk,
        critical: churnSummary.by_level.critical,
        high: churnSummary.by_level.high,
        medium: churnSummary.by_level.medium,
      };
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

      // Churn prediction détaillé (CDC §6.1 Growth+)
      const churnRisk = await getMerchantChurnRisk(merchantId, 'medium', 10);
      result.churn_predictions = churnRisk.map(r => ({
        client_id: r.client_id,
        client_name: r.client_name,
        churn_score: r.churn_score,
        churn_level: r.churn_level,
        signals: r.signals,
        recommendation: r.recommendation,
      }));

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

      // Élasticité-prix (CDC §6.1 Premium)
      result.price_elasticity = await calculatePriceElasticity(merchantId, { months: 3 }).catch(err => ({
        error: err.message,
        insufficient_data: true,
      }));

      // Cartographie zones chalandise (CDC §6.1 Premium)
      result.trade_zones = await getTradeZoneStats(merchantId, { months: 6 }).catch(err => ({
        error: err.message,
        total_zones: 0,
        zones: [],
      }));
    }

    res.json(result);
  } catch (err) { next(err); }
});

/**
 * GET /merchant-intelligence/:merchantId/churn
 * Prédiction churn détaillée (Growth+ CDC §6.1)
 * Query params: level=medium|high|critical (défaut: medium), limit=50
 */
router.get('/:merchantId/churn', requireAuth, async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    if (req.client) return res.status(403).json({ error: 'Accès réservé aux marchands et administrateurs' });

    const merchant = await pool.query(
      'SELECT id, name, package FROM merchants WHERE id = $1', [merchantId]
    );
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });

    const pkg = merchant.rows[0].package || 'STARTER_BOOST';
    const pkgIndex = MERCHANT_PACKAGES.indexOf(pkg);
    if (pkgIndex < 1) {
      return res.status(403).json({
        error: 'Fonctionnalité réservée aux packages Starter Plus et supérieurs',
        upgrade_to: 'STARTER_PLUS',
      });
    }

    const { level = 'medium', limit = '50' } = req.query;
    const predictions = await getMerchantChurnRisk(merchantId, level, parseInt(limit, 10));
    const summary = await getChurnSummary(merchantId);

    res.json({ merchantId, summary, predictions });
  } catch (err) { next(err); }
});

/**
 * GET /merchant-intelligence/:merchantId/churn/:clientId
 * Prédiction churn pour un client spécifique (Growth+)
 */
router.get('/:merchantId/churn/:clientId', requireAuth, async (req, res, next) => {
  try {
    const { merchantId, clientId } = req.params;
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const merchant = await pool.query(
      'SELECT id, package FROM merchants WHERE id = $1', [merchantId]
    );
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });
    if (MERCHANT_PACKAGES.indexOf(merchant.rows[0].package) < 1) {
      return res.status(403).json({ error: 'Fonctionnalité réservée aux packages Starter Plus et supérieurs', upgrade_to: 'STARTER_PLUS' });
    }

    const prediction = await predictChurn(clientId, merchantId);
    res.json(prediction);
  } catch (err) { next(err); }
});

/**
 * GET /merchant-intelligence/:merchantId/loyalty-score
 * Score fidélité mensuel (CDC §6.1 — tous packages)
 * Calcule un score 0-100 basé sur: tx récentes, taux retour, progression statuts
 */
router.get('/:merchantId/loyalty-score', requireAuth, async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const now = new Date();
    const month = req.query.month || now.toISOString().slice(0, 7); // YYYY-MM
    const monthStart = new Date(month + '-01T00:00:00Z');
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const [txRes, statusRes, returnRes] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS tx_count, COUNT(DISTINCT client_id) AS active_clients,
          COALESCE(SUM(gross_amount), 0) AS revenue
        FROM transactions
        WHERE merchant_id = $1 AND status = 'completed'
          AND completed_at >= $2 AND completed_at < $3
      `, [merchantId, monthStart, monthEnd]),
      pool.query(`
        SELECT loyalty_status, COUNT(*) AS count
        FROM clients c
        JOIN transactions t ON t.client_id = c.id
        WHERE t.merchant_id = $1 AND t.status = 'completed'
          AND t.completed_at >= $2 AND t.completed_at < $3
        GROUP BY loyalty_status
      `, [merchantId, monthStart, monthEnd]),
      pool.query(`
        SELECT COUNT(DISTINCT client_id) AS returning_clients
        FROM transactions
        WHERE merchant_id = $1 AND status = 'completed'
          AND completed_at >= $2 AND completed_at < $3
          AND client_id IN (
            SELECT DISTINCT client_id FROM transactions
            WHERE merchant_id = $1 AND status = 'completed'
              AND completed_at < $2
          )
      `, [merchantId, monthStart, monthEnd]),
    ]);

    const txRow = txRes.rows[0] || {};
    const txCount = Number(txRow.tx_count || 0);
    const activeClients = Number(txRow.active_clients || 0);
    const revenue = Number(txRow.revenue || 0);
    const returningClients = Number(returnRes.rows[0]?.returning_clients || 0);

    // Répartition statuts
    const statusMap = {};
    let loyalClients = 0;
    for (const row of statusRes.rows) {
      statusMap[row.loyalty_status] = Number(row.count);
      if (['LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'].includes(row.loyalty_status)) {
        loyalClients += Number(row.count);
      }
    }

    // Score 0-100 basé sur:
    // - 40 pts: taux de retour (returningClients / activeClients)
    // - 30 pts: % clients fidèles (Live+)
    // - 30 pts: volume transactions (normalisé, plafonné à 100 tx = max)
    const returnScore  = activeClients > 0 ? (returningClients / activeClients) * 40 : 0;
    const loyalScore   = activeClients > 0 ? (loyalClients / activeClients) * 30 : 0;
    const txScore      = Math.min(txCount / 100, 1) * 30;
    const loyaltyScore = Math.round(returnScore + loyalScore + txScore);

    res.json({
      merchant_id: merchantId,
      month,
      loyalty_score: loyaltyScore,
      score_breakdown: {
        return_rate: activeClients > 0 ? Math.round(returningClients / activeClients * 100) : 0,
        loyal_client_rate: activeClients > 0 ? Math.round(loyalClients / activeClients * 100) : 0,
        transaction_volume: txCount,
      },
      stats: {
        active_clients: activeClients,
        returning_clients: returningClients,
        loyal_clients: loyalClients,
        revenue,
        status_distribution: statusMap,
      },
    });
  } catch (err) { next(err); }
});

/**
 * GET /merchant-intelligence/:merchantId/price-elasticity
 * Analyse élasticité-prix (CDC §6.1 — Premium)
 * Query: months=3 (période d'analyse)
 */
router.get('/:merchantId/price-elasticity', requireAuth, async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const merchant = await pool.query('SELECT id, package FROM merchants WHERE id = $1', [merchantId]);
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });

    if (MERCHANT_PACKAGES.indexOf(merchant.rows[0].package) < 3) {
      return res.status(403).json({
        error: 'Fonctionnalité réservée au package Premium',
        upgrade_to: 'PREMIUM',
      });
    }

    const months = Math.min(parseInt(req.query.months) || 3, 12);
    const result = await calculatePriceElasticity(merchantId, { months });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * GET /merchant-intelligence/:merchantId/trade-zones
 * Cartographie zones chalandise (CDC §6.1 — Premium)
 * Query: months=6, min_clients=3
 */
router.get('/:merchantId/trade-zones', requireAuth, async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const merchant = await pool.query('SELECT id, package FROM merchants WHERE id = $1', [merchantId]);
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });

    if (MERCHANT_PACKAGES.indexOf(merchant.rows[0].package) < 3) {
      return res.status(403).json({
        error: 'Fonctionnalité réservée au package Premium',
        upgrade_to: 'PREMIUM',
      });
    }

    const months = Math.min(parseInt(req.query.months) || 6, 24);
    const minClients = Math.max(parseInt(req.query.min_clients) || 3, 1);
    const result = await getTradeZoneStats(merchantId, { months, minClients });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * GET /merchant-intelligence/:merchantId/recommendations
 * Recommandations hebdo basées sur les données RFM + churn réelles (CDC §6.1 — Growth+)
 * Retourne une liste priorisée d'actions concrètes pour la semaine
 */
router.get('/:merchantId/recommendations', requireAuth, async (req, res, next) => {
  try {
    const { merchantId } = req.params;
    if (req.merchant && req.merchant.id !== merchantId) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    if (req.client) return res.status(403).json({ error: 'Accès réservé aux marchands' });

    const merchant = await pool.query('SELECT id, name, package FROM merchants WHERE id = $1', [merchantId]);
    if (!merchant.rows[0]) return res.status(404).json({ error: 'Marchand introuvable' });

    const pkg = merchant.rows[0].package || 'STARTER_BOOST';
    const pkgIndex = MERCHANT_PACKAGES.indexOf(pkg);
    if (pkgIndex < 2) {
      return res.status(403).json({
        error: 'Recommandations IA disponibles à partir du package Growth Intelligent',
        upgrade_to: 'GROWTH',
      });
    }

    // Collecter les données de base
    const [rfmRes, churnRes, abandonsRes, convRes] = await Promise.all([
      pool.query(`
        SELECT segment, COUNT(*) AS count,
          ROUND(AVG(total_amount)::numeric, 0) AS avg_amount
        FROM rfm_scores WHERE merchant_id = $1
        GROUP BY segment ORDER BY count DESC
      `, [merchantId]),
      pool.query(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN last_purchase_days > 60 THEN 1 ELSE 0 END) AS critical
        FROM rfm_scores WHERE merchant_id = $1
      `, [merchantId]),
      pool.query(`
        SELECT COUNT(*) AS count FROM abandon_tracking
        WHERE merchant_id = $1 AND status = 'active' AND current_step < 5
      `, [merchantId]).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(`
        SELECT
          COUNT(*) AS total_tx,
          COUNT(DISTINCT client_id) AS active_clients,
          AVG(gross_amount) AS avg_basket
        FROM transactions
        WHERE merchant_id = $1 AND status = 'completed'
          AND completed_at >= NOW() - INTERVAL '7 days'
      `, [merchantId]),
    ]);

    const segments = Object.fromEntries(rfmRes.rows.map(r => [r.segment, Number(r.count)]));
    const criticalChurn = Number(churnRes.rows[0]?.critical || 0);
    const activeAbandons = Number(abandonsRes.rows[0]?.count || 0);
    const weekTx = Number(convRes.rows[0]?.total_tx || 0);
    const weekClients = Number(convRes.rows[0]?.active_clients || 0);
    const weekBasket = Number(convRes.rows[0]?.avg_basket || 0);

    // Générer des recommandations priorisées basées sur les données réelles
    const recommendations = [];
    const week = new Date().toISOString().slice(0, 10);

    if (criticalChurn > 0) {
      recommendations.push({
        priority: 1,
        type: 'CHURN_PREVENTION',
        title: `${criticalChurn} clients à risque critique de départ`,
        action: 'Lancer une campagne WIN_BACK immédiate avec offre -20% ou points x3',
        segment: 'A_RISQUE',
        client_count: criticalChurn,
        impact: 'HIGH',
        deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }

    if (activeAbandons > 0) {
      recommendations.push({
        priority: 2,
        type: 'ABANDON_PROTOCOL',
        title: `${activeAbandons} protocoles d'abandon en cours`,
        action: 'Vérifier et relancer les clients en étape 3+ du protocole d\'abandon',
        segment: 'HIBERNANTS',
        client_count: activeAbandons,
        impact: 'HIGH',
        deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }

    if ((segments.PROMETTEURS || 0) > 0) {
      recommendations.push({
        priority: 3,
        type: 'FREQUENCY_BOOST',
        title: `${segments.PROMETTEURS} clients Prometteurs à activer`,
        action: 'Envoyer une offre "revenez vite" avec points bonus si retour <15j',
        segment: 'PROMETTEURS',
        client_count: segments.PROMETTEURS,
        impact: 'MEDIUM',
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }

    if ((segments.CHAMPIONS || 0) > 0) {
      recommendations.push({
        priority: 4,
        type: 'VIP_RETENTION',
        title: `${segments.CHAMPIONS} clients Champions à fidéliser`,
        action: 'Proposer un accès VIP prioritaire ou événement exclusif',
        segment: 'CHAMPIONS',
        client_count: segments.CHAMPIONS,
        impact: 'MEDIUM',
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }

    if (weekTx < 5 && weekClients < 3) {
      recommendations.push({
        priority: 5,
        type: 'ACTIVATION',
        title: 'Activité faible cette semaine',
        action: 'Créer un lien de paiement promotionnel et partager via WhatsApp',
        segment: null,
        client_count: null,
        impact: 'MEDIUM',
        deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }

    if ((segments.FIDELES || 0) > 0) {
      recommendations.push({
        priority: 6,
        type: 'UPSELL',
        title: `${segments.FIDELES} clients Fidèles — potentiel upsell panier`,
        action: 'Cross-sell ou challenge fréquence pour augmenter le panier moyen',
        segment: 'FIDELES',
        client_count: segments.FIDELES,
        impact: 'LOW',
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    }

    res.json({
      merchant_id: merchantId,
      week,
      generated_at: new Date().toISOString(),
      context: {
        week_transactions: weekTx,
        week_active_clients: weekClients,
        avg_basket_week: Math.round(weekBasket),
        total_rfm_clients: rfmRes.rows.reduce((s, r) => s + Number(r.count), 0),
      },
      recommendations: recommendations.sort((a, b) => a.priority - b.priority),
    });
  } catch (err) { next(err); }
});

module.exports = router;
