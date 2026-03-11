/**
 * Moteur de Fidélité Afrik'Fid
 * Gère le calcul X/Y/Z et les transitions de statut
 */

const db = require('./db');

/**
 * Récupère la config de fidélité depuis la DB
 */
function getLoyaltyConfig() {
  return db.prepare('SELECT * FROM loyalty_config ORDER BY sort_order').all();
}

/**
 * Récupère le taux Y% pour un statut donné
 */
function getClientRebatePercent(loyaltyStatus) {
  const config = db.prepare('SELECT client_rebate_percent FROM loyalty_config WHERE status = ?').get(loyaltyStatus);
  return config ? config.client_rebate_percent : 0;
}

/**
 * Calcule la distribution X/Y/Z pour une transaction
 *
 * @param {number} grossAmount - Montant brut de la transaction
 * @param {number} merchantRebatePercent - X% négocié avec le marchand
 * @param {string} clientLoyaltyStatus - Statut de fidélité du client (OPEN, LIVE, GOLD, ROYAL)
 * @returns {object} Distribution complète
 */
function calculateDistribution(grossAmount, merchantRebatePercent, clientLoyaltyStatus = 'OPEN') {
  const X = merchantRebatePercent;                        // Remise marchand
  const Y = getClientRebatePercent(clientLoyaltyStatus);  // Remise client

  // Règle fondamentale: Y ne peut pas dépasser X
  const effectiveY = Math.min(Y, X);
  const Z = X - effectiveY;  // Commission Afrik'Fid

  const merchantRebateAmount = (grossAmount * X) / 100;
  const clientRebateAmount = (grossAmount * effectiveY) / 100;
  const platformCommissionAmount = (grossAmount * Z) / 100;

  // Le marchand reçoit: montant brut - remise accordée (X%)
  const merchantReceives = grossAmount - merchantRebateAmount;

  return {
    grossAmount,
    merchantRebatePercent: X,
    clientRebatePercent: effectiveY,
    platformCommissionPercent: Z,
    merchantRebateAmount: round2(merchantRebateAmount),
    clientRebateAmount: round2(clientRebateAmount),
    platformCommissionAmount: round2(platformCommissionAmount),
    merchantReceives: round2(merchantReceives),
    // Validation
    isValid: effectiveY <= X,
    yExceedsX: Y > X,
  };
}

/**
 * Évalue le nouveau statut d'un client basé sur son activité
 */
function evaluateClientStatus(clientId) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
  if (!client) return null;

  const configs = db.prepare('SELECT * FROM loyalty_config ORDER BY sort_order DESC').all();

  // Calculer les achats récents
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const recentStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
    FROM transactions
    WHERE client_id = ? AND status = 'completed'
    AND initiated_at >= ?
  `).get(clientId, threeMonthsAgo.toISOString());

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
    FROM transactions
    WHERE client_id = ? AND status = 'completed'
    AND initiated_at >= ?
  `).get(clientId, sixMonthsAgo.toISOString());

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const twelveMonthStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
    FROM transactions
    WHERE client_id = ? AND status = 'completed'
    AND initiated_at >= ?
  `).get(clientId, twelveMonthsAgo.toISOString());

  // Logique de statut (du plus élevé au plus bas)
  const currentStatus = client.loyalty_status;
  let newStatus = 'OPEN';

  // ROYAL: critères sur 12 mois
  const royalConfig = configs.find(c => c.status === 'ROYAL');
  if (royalConfig && twelveMonthStats.count >= royalConfig.min_purchases &&
      twelveMonthStats.total >= royalConfig.min_cumulative_amount) {
    newStatus = 'ROYAL';
  }
  // GOLD: critères sur 6 mois
  else {
    const goldConfig = configs.find(c => c.status === 'GOLD');
    if (goldConfig && sixMonthStats.count >= goldConfig.min_purchases &&
        sixMonthStats.total >= goldConfig.min_cumulative_amount) {
      newStatus = 'GOLD';
    }
    // LIVE: critères sur 3 mois
    else {
      const liveConfig = configs.find(c => c.status === 'LIVE');
      if (liveConfig && recentStats.count >= liveConfig.min_purchases &&
          recentStats.total >= liveConfig.min_cumulative_amount) {
        newStatus = 'LIVE';
      }
    }
  }

  return {
    clientId,
    currentStatus,
    newStatus,
    changed: currentStatus !== newStatus,
    stats: { recentStats, sixMonthStats, twelveMonthStats }
  };
}

/**
 * Applique un changement de statut de fidélité
 */
function applyStatusChange(clientId, newStatus) {
  db.prepare(`
    UPDATE clients SET loyalty_status = ?, status_since = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, clientId);
}

/**
 * Batch quotidien d'évaluation des statuts
 */
function runLoyaltyBatch() {
  const clients = db.prepare("SELECT id FROM clients WHERE is_active = 1").all();
  const results = [];

  for (const client of clients) {
    const evaluation = evaluateClientStatus(client.id);
    if (evaluation && evaluation.changed) {
      applyStatusChange(client.id, evaluation.newStatus);
      results.push(evaluation);
    }
  }

  return results;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  calculateDistribution,
  getClientRebatePercent,
  getLoyaltyConfig,
  evaluateClientStatus,
  applyStatusChange,
  runLoyaltyBatch,
};
