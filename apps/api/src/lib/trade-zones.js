'use strict';

/**
 * Cartographie des Zones de Chalandise — CDC v3 §6.1 (Premium)
 *
 * Analyse la répartition géographique (ville/quartier) des clients
 * et calcule des KPIs par zone : densité clients, CA, fidélité.
 *
 * Données utilisées: clients.city + clients.district (stockés anonymisés, RGPD).
 * Pas de coordonnées GPS nominatives — agrégation ville/quartier uniquement.
 */

const { pool } = require('./db');

/**
 * Calcule les stats par zone chalandise pour un marchand
 * @param {string} merchantId
 * @param {Object} options { months: 6, minClients: 3 }
 */
async function getTradeZoneStats(merchantId, { months = 6, minClients = 3 } = {}) {
  const periodStart = new Date();
  periodStart.setMonth(periodStart.getMonth() - months);

  // Agrégation par ville/quartier
  const zonesRes = await pool.query(`
    SELECT
      COALESCE(c.city, 'Inconnue') AS city,
      COALESCE(c.district, 'N/A') AS district,
      COUNT(DISTINCT c.id) AS client_count,
      COUNT(t.id) AS transaction_count,
      COALESCE(SUM(t.gross_amount), 0) AS total_revenue,
      COALESCE(AVG(t.gross_amount), 0) AS avg_basket,
      COUNT(DISTINCT CASE WHEN c.loyalty_status IN ('LIVE','GOLD','ROYAL','ROYAL_ELITE') THEN c.id END) AS loyal_client_count,
      COUNT(DISTINCT CASE WHEN c.loyalty_status IN ('GOLD','ROYAL','ROYAL_ELITE') THEN c.id END) AS gold_plus_count
    FROM transactions t
    JOIN clients c ON c.id = t.client_id
    WHERE t.merchant_id = $1
      AND t.status = 'completed'
      AND t.completed_at >= $2
      AND c.anonymized_at IS NULL
    GROUP BY c.city, c.district
    HAVING COUNT(DISTINCT c.id) >= $3
    ORDER BY total_revenue DESC
    LIMIT 100
  `, [merchantId, periodStart, minClients]);

  const zones = zonesRes.rows.map(z => {
    const clientCount = Number(z.client_count);
    const loyalCount = Number(z.loyal_client_count);
    const goldPlusCount = Number(z.gold_plus_count);
    const totalRevenue = Number(z.total_revenue);
    const txCount = Number(z.transaction_count);

    return {
      city: z.city,
      district: z.district !== 'N/A' ? z.district : null,
      metrics: {
        client_count: clientCount,
        transaction_count: txCount,
        total_revenue: Math.round(totalRevenue),
        avg_basket: Math.round(Number(z.avg_basket)),
        avg_tx_per_client: clientCount > 0 ? Math.round(txCount / clientCount * 10) / 10 : 0,
      },
      loyalty: {
        loyal_clients: loyalCount,
        loyal_rate: clientCount > 0 ? Math.round(loyalCount / clientCount * 100) : 0,
        gold_plus_clients: goldPlusCount,
        gold_plus_rate: clientCount > 0 ? Math.round(goldPlusCount / clientCount * 100) : 0,
      },
      potential_score: calculateZonePotential(clientCount, totalRevenue, loyalCount / Math.max(clientCount, 1)),
    };
  });

  // Identifier les zones à fort potentiel non exploité
  const highPotentialZones = zones
    .filter(z => z.loyalty.loyal_rate < 30 && z.metrics.client_count >= 10)
    .sort((a, b) => b.metrics.client_count - a.metrics.client_count)
    .slice(0, 3);

  // Top zones par CA
  const topRevenueZones = zones.slice(0, 5);

  // Zones en déclin (faible taux fidélité + petits paniers)
  const atRiskZones = zones
    .filter(z => z.loyalty.loyal_rate < 10 && z.metrics.avg_basket < 10000)
    .slice(0, 3);

  const totalClients = zones.reduce((s, z) => s + z.metrics.client_count, 0);
  const totalRevenue = zones.reduce((s, z) => s + z.metrics.total_revenue, 0);

  return {
    merchant_id: merchantId,
    period_months: months,
    period_start: periodStart,
    total_zones: zones.length,
    total_clients_mapped: totalClients,
    total_revenue_mapped: totalRevenue,
    zones,
    insights: {
      top_revenue_zones: topRevenueZones.map(z => ({ city: z.city, district: z.district, revenue: z.metrics.total_revenue })),
      high_potential_zones: highPotentialZones.map(z => ({
        city: z.city,
        district: z.district,
        client_count: z.metrics.client_count,
        loyal_rate: z.loyalty.loyal_rate,
        recommendation: `${z.metrics.client_count} clients dans cette zone, seulement ${z.loyalty.loyal_rate}% fidélisés — fort potentiel d'activation`,
      })),
      at_risk_zones: atRiskZones.map(z => ({
        city: z.city,
        district: z.district,
        client_count: z.metrics.client_count,
        recommendation: 'Zone à risque — campagne de réactivation recommandée',
      })),
    },
    computed_at: new Date().toISOString(),
  };
}

/**
 * Score de potentiel d'une zone (0-100)
 * Basé sur: volume de clients, CA, taux de fidélité
 */
function calculateZonePotential(clientCount, revenue, loyalRate) {
  const clientScore  = Math.min(clientCount / 100, 1) * 40;
  const revenueScore = Math.min(revenue / 5000000, 1) * 40; // 5M FCFA = max
  const loyalScore   = loyalRate * 20;
  return Math.round(clientScore + revenueScore + loyalScore);
}

/**
 * Met à jour les stats de zones chalandise en base (pour cache)
 */
async function refreshTradeZoneStats(merchantId) {
  const stats = await getTradeZoneStats(merchantId);
  const today = new Date().toISOString().slice(0, 10);

  for (const zone of stats.zones) {
    await pool.query(`
      INSERT INTO trade_zone_stats
        (merchant_id, calculated_date, city, district, client_count, transaction_count,
         total_revenue, avg_basket, loyal_client_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (merchant_id, calculated_date, city, district)
      DO UPDATE SET
        client_count = EXCLUDED.client_count,
        transaction_count = EXCLUDED.transaction_count,
        total_revenue = EXCLUDED.total_revenue,
        avg_basket = EXCLUDED.avg_basket,
        loyal_client_count = EXCLUDED.loyal_client_count
    `, [
      merchantId, today,
      zone.city, zone.district || 'N/A',
      zone.metrics.client_count, zone.metrics.transaction_count,
      zone.metrics.total_revenue, zone.metrics.avg_basket,
      zone.loyalty.loyal_clients,
    ]).catch(() => {});
  }

  return stats;
}

module.exports = { getTradeZoneStats, refreshTradeZoneStats };
