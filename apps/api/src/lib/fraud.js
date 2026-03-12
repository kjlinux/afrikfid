'use strict';

const db = require('./db');

const RULE_TYPES = {
  MAX_AMOUNT_PER_TX:   'max_amount_per_tx',
  MAX_TX_PER_HOUR:     'max_tx_per_hour',
  MAX_TX_PER_DAY:      'max_tx_per_day',
  MAX_AMOUNT_PER_DAY:  'max_amount_per_day',
  MAX_FAILED_ATTEMPTS: 'max_failed_attempts',
};

const DEFAULT_RULES = {
  [RULE_TYPES.MAX_AMOUNT_PER_TX]:    { value: 5000000,  desc: '5 000 000 XOF par transaction' },
  [RULE_TYPES.MAX_TX_PER_HOUR]:      { value: 10,       desc: '10 transactions par heure' },
  [RULE_TYPES.MAX_TX_PER_DAY]:       { value: 30,       desc: '30 transactions par jour' },
  [RULE_TYPES.MAX_AMOUNT_PER_DAY]:   { value: 10000000, desc: '10 000 000 XOF par jour' },
  [RULE_TYPES.MAX_FAILED_ATTEMPTS]:  { value: 5,        desc: '5 tentatives échouées' },
};

async function getActiveRules() {
  try {
    const res = await db.query('SELECT rule_type, value FROM fraud_rules WHERE is_active = TRUE');
    const rules = { ...Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, v.value])) };
    for (const r of res.rows) {
      rules[r.rule_type] = parseFloat(r.value);
    }
    return rules;
  } catch {
    return Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, v.value]));
  }
}

async function isPhoneBlocked(phone) {
  if (!phone) return false;
  try {
    const res = await db.query('SELECT 1 FROM blocked_phones WHERE phone = $1', [phone]);
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

async function computeRiskScore({ amount, clientId, clientPhone, merchantId }) {
  let score = 0;
  const reasons = [];
  const rules = await getActiveRules();

  const maxAmount = rules[RULE_TYPES.MAX_AMOUNT_PER_TX] || DEFAULT_RULES[RULE_TYPES.MAX_AMOUNT_PER_TX].value;
  if (amount > maxAmount * 0.8) { score += 20; reasons.push('Montant proche ou au-dessus du seuil max'); }
  if (amount > maxAmount)       { score += 40; reasons.push('Montant dépasse le seuil max'); }

  if (clientId) {
    const now = new Date().toISOString();
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const oneDayAgo  = new Date(Date.now() - 86400_000).toISOString();

    const hourRes = await db.query(
      `SELECT COUNT(*) as c FROM transactions WHERE client_id = $1 AND initiated_at >= $2 AND initiated_at <= $3`,
      [clientId, oneHourAgo, now]
    );
    const txLastHour = parseInt(hourRes.rows[0].c);
    const maxPerHour = rules[RULE_TYPES.MAX_TX_PER_HOUR];
    if (txLastHour >= maxPerHour * 0.8) { score += 15; reasons.push(`${txLastHour} transactions cette heure`); }
    if (txLastHour >= maxPerHour)        { score += 35; reasons.push(`Limite horaire dépassée (${txLastHour})`); }

    const dayRes = await db.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
       FROM transactions WHERE client_id = $1 AND initiated_at >= $2 AND initiated_at <= $3`,
      [clientId, oneDayAgo, now]
    );
    const dayStats = { count: parseInt(dayRes.rows[0].count), total: parseFloat(dayRes.rows[0].total) };
    const maxPerDay    = rules[RULE_TYPES.MAX_TX_PER_DAY];
    const maxAmountDay = rules[RULE_TYPES.MAX_AMOUNT_PER_DAY];
    if (dayStats.count >= maxPerDay)    { score += 25; reasons.push(`Limite quotidienne de transactions dépassée (${dayStats.count})`); }
    if (dayStats.total >= maxAmountDay) { score += 25; reasons.push(`Volume journalier dépassé (${dayStats.total})`); }

    const failRes = await db.query(
      `SELECT COUNT(*) as c FROM transactions WHERE client_id = $1 AND status = 'failed' AND initiated_at >= $2`,
      [clientId, oneDayAgo]
    );
    const failedRecent = parseInt(failRes.rows[0].c);
    const maxFailed = rules[RULE_TYPES.MAX_FAILED_ATTEMPTS];
    if (failedRecent >= maxFailed) { score += 30; reasons.push(`${failedRecent} tentatives échouées aujourd'hui`); }
  }

  return { score: Math.min(score, 100), reasons };
}

async function checkTransaction({ amount, clientId, clientPhone, merchantId }) {
  if (clientPhone && await isPhoneBlocked(clientPhone)) {
    return { blocked: true, reason: 'Numéro de téléphone sur liste noire', riskScore: 100, reasons: ['Numéro blacklisté'] };
  }

  const rules = await getActiveRules();
  const maxAmount = rules[RULE_TYPES.MAX_AMOUNT_PER_TX];
  if (amount > maxAmount) {
    return { blocked: true, reason: `Montant ${amount} dépasse le seuil maximum autorisé (${maxAmount})`, riskScore: 100, reasons: ['Montant dépasse le seuil max'] };
  }

  const { score, reasons } = await computeRiskScore({ amount, clientId, clientPhone, merchantId });

  if (score >= 70) {
    return { blocked: true, reason: `Score de risque élevé (${score}/100): ${reasons.join(', ')}`, riskScore: score, reasons };
  }

  return { blocked: false, reason: null, riskScore: score, reasons };
}

async function getAllRules() {
  try {
    const res = await db.query('SELECT * FROM fraud_rules ORDER BY created_at DESC');
    return res.rows;
  } catch {
    return [];
  }
}

async function createRule({ name, rule_type, value }) {
  const { v4: uuidv4 } = require('uuid');
  if (!RULE_TYPES[rule_type.toUpperCase()] && !Object.values(RULE_TYPES).includes(rule_type)) {
    throw new Error(`Type de règle invalide: ${rule_type}`);
  }
  const id = uuidv4();
  await db.query('INSERT INTO fraud_rules (id, name, rule_type, value) VALUES ($1, $2, $3, $4)', [id, name, rule_type, String(value)]);
  const res = await db.query('SELECT * FROM fraud_rules WHERE id = $1', [id]);
  return res.rows[0];
}

async function toggleRule(id, isActive) {
  const res = await db.query('UPDATE fraud_rules SET is_active = $1 WHERE id = $2', [isActive, id]);
  return res.rowCount > 0;
}

async function deleteRule(id) {
  const res = await db.query('DELETE FROM fraud_rules WHERE id = $1', [id]);
  return res.rowCount > 0;
}

async function blockPhone(phone, reason, blockedBy) {
  await db.query(
    'INSERT INTO blocked_phones (phone, reason, blocked_by) VALUES ($1, $2, $3) ON CONFLICT (phone) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by',
    [phone, reason || null, blockedBy || null]
  );
}

async function unblockPhone(phone) {
  const res = await db.query('DELETE FROM blocked_phones WHERE phone = $1', [phone]);
  return res.rowCount > 0;
}

async function getBlockedPhones() {
  try {
    const res = await db.query('SELECT * FROM blocked_phones ORDER BY blocked_at DESC');
    return res.rows;
  } catch {
    return [];
  }
}

module.exports = {
  RULE_TYPES,
  checkTransaction,
  computeRiskScore,
  isPhoneBlocked,
  getAllRules,
  createRule,
  toggleRule,
  deleteRule,
  blockPhone,
  unblockPhone,
  getBlockedPhones,
};
