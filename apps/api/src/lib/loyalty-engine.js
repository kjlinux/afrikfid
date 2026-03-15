/**
 * Moteur de Fidélité Afrik'Fid
 * Gère le calcul X/Y/Z et les transitions de statut
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { notifyLoyaltyUpgrade, notifyLoyaltyDowngrade } = require('./notifications');

async function getLoyaltyConfig() {
  const res = await db.query('SELECT * FROM loyalty_config ORDER BY sort_order');
  return res.rows;
}

/**
 * Retourne le taux Y% pour un statut donné.
 * Priorité : catégorie marchand > pays > global
 * @param {string} loyaltyStatus
 * @param {string|null} countryId
 * @param {string|null} merchantCategory
 */
async function getClientRebatePercent(loyaltyStatus, countryId = null, merchantCategory = null) {
  // Priorité 1 : surcharge par catégorie marchand
  if (merchantCategory) {
    const catOverride = await db.query(
      'SELECT client_rebate_percent FROM loyalty_config_category WHERE status = $1 AND category = $2',
      [loyaltyStatus, merchantCategory]
    );
    if (catOverride.rows[0]) return parseFloat(catOverride.rows[0].client_rebate_percent);
  }
  // Priorité 2 : surcharge par pays
  if (countryId) {
    const override = await db.query(
      'SELECT client_rebate_percent FROM loyalty_config_country WHERE status = $1 AND country_id = $2',
      [loyaltyStatus, countryId]
    );
    if (override.rows[0]) return parseFloat(override.rows[0].client_rebate_percent);
  }
  // Priorité 3 : taux global
  const res = await db.query('SELECT client_rebate_percent FROM loyalty_config WHERE status = $1', [loyaltyStatus]);
  return res.rows[0] ? parseFloat(res.rows[0].client_rebate_percent) : 0;
}

async function calculateDistribution(grossAmount, merchantRebatePercent, clientLoyaltyStatus = 'OPEN', countryId = null, merchantCategory = null, merchantId = null) {
  // Priorité X% : taux par catégorie produit marchand > taux global marchand 
  let effectiveX = merchantRebatePercent;
  if (merchantId && merchantCategory) {
    const catRate = await db.query(
      'SELECT discount_rate FROM merchant_category_rates WHERE merchant_id = $1 AND category = $2',
      [merchantId, merchantCategory]
    );
    if (catRate.rows[0]) effectiveX = parseFloat(catRate.rows[0].discount_rate);
  }
  const X = effectiveX;
  const Y = await getClientRebatePercent(clientLoyaltyStatus, countryId, merchantCategory);

  const effectiveY = Math.min(Y, X);
  const Z = X - effectiveY;

  const merchantRebateAmount = (grossAmount * X) / 100;
  const clientRebateAmount = (grossAmount * effectiveY) / 100;
  const platformCommissionAmount = (grossAmount * Z) / 100;
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
    isValid: effectiveY <= X,
    yExceedsX: Y > X,
  };
}

async function evaluateClientStatus(clientId) {
  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientRes.rows[0];
  if (!client) return null;

  const configsRes = await db.query('SELECT * FROM loyalty_config ORDER BY sort_order DESC');
  const configs = configsRes.rows;

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const recentRes = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
     FROM transactions WHERE client_id = $1 AND status = 'completed' AND initiated_at >= $2`,
    [clientId, threeMonthsAgo.toISOString()]
  );
  const recentStats = { count: parseInt(recentRes.rows[0].count), total: parseFloat(recentRes.rows[0].total) };

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixRes = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
     FROM transactions WHERE client_id = $1 AND status = 'completed' AND initiated_at >= $2`,
    [clientId, sixMonthsAgo.toISOString()]
  );
  const sixMonthStats = { count: parseInt(sixRes.rows[0].count), total: parseFloat(sixRes.rows[0].total) };

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const twelveRes = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
     FROM transactions WHERE client_id = $1 AND status = 'completed' AND initiated_at >= $2`,
    [clientId, twelveMonthsAgo.toISOString()]
  );
  const twelveMonthStats = { count: parseInt(twelveRes.rows[0].count), total: parseFloat(twelveRes.rows[0].total) };

  const currentStatus = client.loyalty_status;
  let newStatus = 'OPEN';

  // Rétrogradation par inactivité  : si aucune transaction dans inactivity_months
  const currentConfig = configs.find(c => c.status === currentStatus);
  if (currentConfig && currentConfig.inactivity_months > 0 && currentStatus !== 'OPEN') {
    const inactivityCutoff = new Date();
    inactivityCutoff.setMonth(inactivityCutoff.getMonth() - currentConfig.inactivity_months);
    const activityRes = await db.query(
      `SELECT COUNT(*) as count FROM transactions WHERE client_id = $1 AND status = 'completed' AND initiated_at >= $2`,
      [clientId, inactivityCutoff.toISOString()]
    );
    if (parseInt(activityRes.rows[0].count) === 0) {
      return {
        clientId,
        currentStatus,
        newStatus: 'OPEN',
        changed: currentStatus !== 'OPEN',
        reason: 'inactivity',
        stats: { recentStats, sixMonthStats, twelveMonthStats },
      };
    }
  }

  const royalConfig = configs.find(c => c.status === 'ROYAL');
  if (royalConfig && twelveMonthStats.count >= royalConfig.min_purchases &&
    twelveMonthStats.total >= royalConfig.min_cumulative_amount) {
    newStatus = 'ROYAL';
  } else {
    const goldConfig = configs.find(c => c.status === 'GOLD');
    if (goldConfig && sixMonthStats.count >= goldConfig.min_purchases &&
      sixMonthStats.total >= goldConfig.min_cumulative_amount) {
      newStatus = 'GOLD';
    } else {
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
    stats: { recentStats, sixMonthStats, twelveMonthStats },
  };
}

async function applyStatusChange(clientId, newStatus, { reason = 'manual', changedBy = 'admin', stats = null } = {}) {
  const clientRes = await db.query('SELECT loyalty_status FROM clients WHERE id = $1', [clientId]);
  const oldStatus = clientRes.rows[0]?.loyalty_status || 'OPEN';

  await db.query(
    `UPDATE clients SET loyalty_status = $1, status_since = NOW(), updated_at = NOW() WHERE id = $2`,
    [newStatus, clientId]
  );

  // Enregistrer dans l'historique (CDC §4.3.1)
  await db.query(
    `INSERT INTO loyalty_status_history (id, client_id, old_status, new_status, reason, changed_by, stats, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [uuidv4(), clientId, oldStatus, newStatus, reason, changedBy, stats ? JSON.stringify(stats) : null]
  );
}

async function runLoyaltyBatch() {
  const clientsRes = await db.query('SELECT id FROM clients WHERE is_active = TRUE');
  const results = [];

  for (const row of clientsRes.rows) {
    const evaluation = await evaluateClientStatus(row.id);
    if (evaluation && evaluation.changed) {
      await applyStatusChange(row.id, evaluation.newStatus, {
        reason: evaluation.reason || 'batch_evaluation',
        changedBy: 'batch',
        stats: evaluation.stats,
      });
      const client = (await db.query('SELECT * FROM clients WHERE id = $1', [row.id])).rows[0];
      if (client) {
        const statusOrder = ['OPEN', 'LIVE', 'GOLD', 'ROYAL'];
        const isUpgrade = statusOrder.indexOf(evaluation.newStatus) > statusOrder.indexOf(evaluation.currentStatus);
        const isDowngrade = statusOrder.indexOf(evaluation.newStatus) < statusOrder.indexOf(evaluation.currentStatus);

        if (isUpgrade) {
          notifyLoyaltyUpgrade({ client, oldStatus: evaluation.currentStatus, newStatus: evaluation.newStatus });
        } else if (isDowngrade) {
          // CDC §2.6 — Notifier le client lors d'une rétrogradation par inactivité
          const inactivityMonths = evaluation.inactivityMonths ||
            (await db.query('SELECT inactivity_months FROM loyalty_config WHERE status = $1', [evaluation.currentStatus])).rows[0]?.inactivity_months;
          notifyLoyaltyDowngrade({
            client,
            oldStatus: evaluation.currentStatus,
            newStatus: evaluation.newStatus,
            inactivityMonths,
          });
        }
      }
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
