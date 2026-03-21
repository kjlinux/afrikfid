/**
 * Moteur de Fidélité Afrik'Fid — CDC v3.0
 *
 * Points statut (1 pt = 500 FCFA) : qualification aux niveaux
 * Points récompense (1 pt = 100 FCFA) : dépensables par le client
 * Statuts : OPEN → LIVE → GOLD → ROYAL → ROYAL_ELITE
 * Soft Landing : max -1 niveau par période
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { notifyLoyaltyUpgrade, notifyLoyaltyDowngrade } = require('./notifications');
const { decrypt } = require('./crypto');
const { triggerPalier } = require('./campaign-engine');
const {
  LOYALTY_POINTS_THRESHOLDS,
  POINTS_PER_STATUS_UNIT,
  POINTS_PER_REWARD_UNIT,
} = require('../config/constants');

const STATUS_ORDER = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];

// ─── Config ─────────────────────────────────────────────────────────────────

async function getLoyaltyConfig() {
  const res = await db.query('SELECT * FROM loyalty_config ORDER BY sort_order');
  return res.rows;
}

/**
 * Retourne le taux Y% pour un statut donné.
 * Priorité : catégorie marchand > pays > global
 */
async function getClientRebatePercent(loyaltyStatus, countryId = null, merchantCategory = null) {
  // ROYAL_ELITE utilise le même taux que ROYAL (maximum)
  const effectiveStatus = loyaltyStatus === 'ROYAL_ELITE' ? 'ROYAL' : loyaltyStatus;

  if (merchantCategory) {
    const catOverride = await db.query(
      'SELECT client_rebate_percent FROM loyalty_config_category WHERE status = $1 AND category = $2',
      [effectiveStatus, merchantCategory]
    );
    if (catOverride.rows[0]) return parseFloat(catOverride.rows[0].client_rebate_percent);
  }
  if (countryId) {
    const override = await db.query(
      'SELECT client_rebate_percent FROM loyalty_config_country WHERE status = $1 AND country_id = $2',
      [effectiveStatus, countryId]
    );
    if (override.rows[0]) return parseFloat(override.rows[0].client_rebate_percent);
  }
  const res = await db.query('SELECT client_rebate_percent FROM loyalty_config WHERE status = $1', [effectiveStatus]);
  return res.rows[0] ? parseFloat(res.rows[0].client_rebate_percent) : 0;
}

// ─── Distribution X/Y/Z ────────────────────────────────────────────────────

async function calculateDistribution(grossAmount, merchantRebatePercent, clientLoyaltyStatus = 'OPEN', countryId = null, merchantCategory = null, merchantId = null) {
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

// ─── Calcul des points (CDC v3 §2.3) ───────────────────────────────────────

/**
 * Calcule les points statut et récompense pour un montant donné.
 * @param {number} grossAmount - Montant brut en FCFA
 * @returns {{ statusPoints: number, rewardPoints: number }}
 */
function calculatePoints(grossAmount) {
  const statusPoints = Math.floor(grossAmount / POINTS_PER_STATUS_UNIT);
  const rewardPoints = Math.floor(grossAmount / POINTS_PER_REWARD_UNIT);
  return { statusPoints, rewardPoints };
}

/**
 * Attribue les points après un paiement complété.
 */
async function awardPoints(clientId, transactionId, grossAmount) {
  const { statusPoints, rewardPoints } = calculatePoints(grossAmount);

  await db.query(
    `UPDATE clients SET
       status_points = COALESCE(status_points, 0) + $1,
       status_points_12m = COALESCE(status_points_12m, 0) + $1,
       lifetime_status_points = COALESCE(lifetime_status_points, 0) + $1,
       reward_points = COALESCE(reward_points, 0) + $2,
       total_purchases = total_purchases + 1,
       total_amount = total_amount + $3,
       updated_at = NOW()
     WHERE id = $4`,
    [statusPoints, rewardPoints, grossAmount, clientId]
  );

  await db.query(
    `UPDATE transactions SET status_points_earned = $1, reward_points_earned = $2 WHERE id = $3`,
    [statusPoints, rewardPoints, transactionId]
  );

  return { statusPoints, rewardPoints };
}

// ─── Évaluation de statut (CDC v3 §2.2, §2.4) ─────────────────────────────

async function evaluateClientStatus(clientId) {
  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientRes.rows[0];
  if (!client) return null;

  const currentStatus = client.loyalty_status;

  // Lire la config fidélité pour le statut courant (inactivity_months)
  const configRes = await db.query(
    'SELECT inactivity_months FROM loyalty_config WHERE status = $1',
    [currentStatus === 'ROYAL_ELITE' ? 'ROYAL' : currentStatus]
  );
  const inactivityMonths = configRes.rows[0]?.inactivity_months || 12;

  // Vérifier l'inactivité : si aucun achat dans les inactivity_months, rétrograder
  const inactivityCutoff = new Date();
  inactivityCutoff.setMonth(inactivityCutoff.getMonth() - inactivityMonths);
  const lastPurchaseRes = await db.query(
    `SELECT MAX(initiated_at) as last_at FROM transactions
     WHERE client_id = $1 AND status = 'completed'`,
    [clientId]
  );
  const lastPurchaseAt = lastPurchaseRes.rows[0]?.last_at;
  const isInactive = currentStatus !== 'OPEN' && (!lastPurchaseAt || new Date(lastPurchaseAt) < inactivityCutoff);

  // Recalculer status_points_12m : somme des points statut des 12 derniers mois
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const pointsRes = await db.query(
    `SELECT COALESCE(SUM(status_points_earned), 0) as pts
     FROM transactions WHERE client_id = $1 AND status = 'completed' AND initiated_at >= $2`,
    [clientId, twelveMonthsAgo.toISOString()]
  );
  const statusPoints12m = parseInt(pointsRes.rows[0].pts);

  // Mettre à jour le champ recalculé
  await db.query(
    'UPDATE clients SET status_points_12m = $1 WHERE id = $2',
    [statusPoints12m, clientId]
  );

  const lifetimePoints = parseInt(client.lifetime_status_points) || 0;
  const consecutiveRoyalYears = parseInt(client.consecutive_royal_years) || 0;

  // ── Vérifier ROYAL ELITE ──
  // Condition: 3 ans ROYAL consécutifs OU 50 000 pts historiques
  const isRoyalEliteEligible =
    consecutiveRoyalYears >= 3 ||
    lifetimePoints >= LOYALTY_POINTS_THRESHOLDS.ROYAL_ELITE;

  // ── Déterminer le statut mérité par les points 12m ──
  let meritedStatus = 'OPEN';
  if (statusPoints12m >= LOYALTY_POINTS_THRESHOLDS.ROYAL) {
    meritedStatus = 'ROYAL';
  } else if (statusPoints12m >= LOYALTY_POINTS_THRESHOLDS.GOLD) {
    meritedStatus = 'GOLD';
  } else if (statusPoints12m >= LOYALTY_POINTS_THRESHOLDS.LIVE) {
    meritedStatus = 'LIVE';
  }

  // Si le client est inactif depuis inactivity_months, forcer la rétrogradation d'un niveau
  let newStatus = isInactive ? STATUS_ORDER[Math.max(0, STATUS_ORDER.indexOf(currentStatus) - 1)] : meritedStatus;

  // Promotion vers ROYAL ELITE (non applicable si inactif)
  if (!isInactive && isRoyalEliteEligible && (meritedStatus === 'ROYAL' || currentStatus === 'ROYAL_ELITE')) {
    newStatus = 'ROYAL_ELITE';
  }

  // ── Soft Landing (CDC v3 §2.4.2) : max -1 niveau par période ──
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  const newIdx = STATUS_ORDER.indexOf(newStatus);

  if (newIdx < currentIdx) {
    // Déclassement : max 1 niveau
    // ROYAL_ELITE → ROYAL (avec 6 mois supplémentaires de conservation)
    if (currentStatus === 'ROYAL_ELITE') {
      // Vérifier si les 6 mois de conservation sont écoulés
      const royalSince = client.royal_since ? new Date(client.royal_since) : null;
      if (royalSince) {
        const sixMonthsAfterLoss = new Date(royalSince);
        // On laisse 6 mois de grâce après la perte de qualification ROYAL_ELITE
        sixMonthsAfterLoss.setMonth(sixMonthsAfterLoss.getMonth() + 6);
        if (new Date() < sixMonthsAfterLoss) {
          newStatus = 'ROYAL_ELITE'; // Conservation pendant 6 mois
        } else {
          newStatus = 'ROYAL'; // Déclassement vers ROYAL uniquement
        }
      } else {
        newStatus = 'ROYAL';
      }
    } else {
      // Max -1 niveau : ROYAL→GOLD, GOLD→LIVE, LIVE→OPEN
      newStatus = STATUS_ORDER[currentIdx - 1];
    }
  }

  return {
    clientId,
    currentStatus,
    newStatus,
    changed: currentStatus !== newStatus,
    statusPoints12m,
    lifetimePoints,
    consecutiveRoyalYears,
  };
}

// ─── Application du changement de statut ────────────────────────────────────

async function applyStatusChange(clientId, newStatus, { reason = 'manual', changedBy = 'admin', stats = null } = {}) {
  const clientRes = await db.query('SELECT loyalty_status, royal_since FROM clients WHERE id = $1', [clientId]);
  const oldStatus = clientRes.rows[0]?.loyalty_status || 'OPEN';

  // Mettre à jour royal_since si on accède à ROYAL
  let royalSinceUpdate = '';
  const params = [newStatus, clientId];
  if (newStatus === 'ROYAL' && oldStatus !== 'ROYAL' && oldStatus !== 'ROYAL_ELITE') {
    royalSinceUpdate = ', royal_since = NOW(), consecutive_royal_years = 0';
  }
  if (newStatus === 'ROYAL_ELITE' && oldStatus !== 'ROYAL_ELITE') {
    // Garde royal_since existant
  }
  // Si on descend de ROYAL/ROYAL_ELITE, reset
  if (newStatus !== 'ROYAL' && newStatus !== 'ROYAL_ELITE' && (oldStatus === 'ROYAL' || oldStatus === 'ROYAL_ELITE')) {
    royalSinceUpdate = ', royal_since = NULL, consecutive_royal_years = 0';
  }

  await db.query(
    `UPDATE clients SET loyalty_status = $1, status_since = NOW(), qualification_deadline = NOW() + INTERVAL '12 months', updated_at = NOW()${royalSinceUpdate} WHERE id = $2`,
    params
  );

  await db.query(
    `INSERT INTO loyalty_status_history (id, client_id, old_status, new_status, reason, changed_by, stats, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [uuidv4(), clientId, oldStatus, newStatus, reason, changedBy, stats ? JSON.stringify(stats) : null]
  );
}

// ─── Batch mensuel de réévaluation (CDC v3 §2.4.1) ─────────────────────────

// Verrou applicatif pour éviter les doubles exécutions (race condition si cron + appel manuel)
let batchRunning = false;

async function runLoyaltyBatch() {
  if (batchRunning) {
    console.warn('[BATCH] Batch de fidélité déjà en cours — exécution ignorée');
    return [];
  }
  batchRunning = true;
  try {
    return await _runLoyaltyBatch();
  } finally {
    batchRunning = false;
  }
}

async function _runLoyaltyBatch() {
  const clientsRes = await db.query('SELECT id FROM clients WHERE is_active = TRUE');
  const results = [];

  for (const row of clientsRes.rows) {
    const evaluation = await evaluateClientStatus(row.id);
    if (evaluation && evaluation.changed) {
      await applyStatusChange(row.id, evaluation.newStatus, {
        reason: evaluation.reason || 'batch_evaluation',
        changedBy: 'batch',
        stats: {
          statusPoints12m: evaluation.statusPoints12m,
          lifetimePoints: evaluation.lifetimePoints,
          consecutiveRoyalYears: evaluation.consecutiveRoyalYears,
        },
      });
      const client = (await db.query('SELECT * FROM clients WHERE id = $1', [row.id])).rows[0];
      if (client) {
        let phone = null, email = null;
        try { phone = client.phone ? decrypt(client.phone) : null; } catch { /* ignore */ }
        try { email = client.email ? decrypt(client.email) : null; } catch { /* ignore */ }
        const clientForNotif = { ...client, phone, email };

        const isUpgrade = STATUS_ORDER.indexOf(evaluation.newStatus) > STATUS_ORDER.indexOf(evaluation.currentStatus);
        const isDowngrade = STATUS_ORDER.indexOf(evaluation.newStatus) < STATUS_ORDER.indexOf(evaluation.currentStatus);

        if (isUpgrade) {
          notifyLoyaltyUpgrade({ client: clientForNotif, oldStatus: evaluation.currentStatus, newStatus: evaluation.newStatus });
        } else if (isDowngrade) {
          notifyLoyaltyDowngrade({
            client: clientForNotif,
            oldStatus: evaluation.currentStatus,
            newStatus: evaluation.newStatus,
          });
        }

        // Trigger PALIER (CDC v3 §5.4) — notification de changement de statut
        const merchantIds = (await db.query(
          "SELECT DISTINCT merchant_id FROM transactions WHERE client_id = $1 AND status = 'completed'",
          [row.id]
        )).rows.map(r => r.merchant_id);
        for (const mid of merchantIds) {
          triggerPalier(mid, clientForNotif, evaluation.currentStatus, evaluation.newStatus).catch(() => {});
        }
      }
      results.push(evaluation);
    }
  }

  // Incrémenter consecutive_royal_years pour les clients ROYAL dont le compteur est
  // inférieur au nombre d'années complètes écoulées depuis royal_since.
  // Ex : royal_since il y a 2 ans et 3 mois → FLOOR = 2 → si consecutive_royal_years < 2 on incrémente.
  await db.query(`
    UPDATE clients
    SET consecutive_royal_years = FLOOR(EXTRACT(EPOCH FROM NOW() - royal_since) / 31536000)::INTEGER
    WHERE loyalty_status IN ('ROYAL', 'ROYAL_ELITE')
      AND royal_since IS NOT NULL
      AND FLOOR(EXTRACT(EPOCH FROM NOW() - royal_since) / 31536000) > consecutive_royal_years
  `);

  return results;
}

// ─── Starter Boost : calcul réduction recrutement (CDC v3 §2.6) ────────────

const { STARTER_BOOST_TIERS } = require('../config/constants');

async function calculateStarterBoostDiscount(merchantId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const res = await db.query(
    `SELECT COUNT(*) as count FROM clients
     WHERE recruited_by_merchant_id = $1 AND recruited_at >= $2`,
    [merchantId, thirtyDaysAgo.toISOString()]
  );
  const recruitedCount = parseInt(res.rows[0].count);

  const tier = STARTER_BOOST_TIERS.find(t => recruitedCount >= t.minClients);
  return {
    recruitedCount,
    discountPercent: tier ? tier.discountPercent : 0,
  };
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

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
  calculatePoints,
  awardPoints,
  calculateStarterBoostDiscount,
  STATUS_ORDER,
};
