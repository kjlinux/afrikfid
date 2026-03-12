'use strict';

/**
 * Détection de Fraude — Règles configurables + blacklist + score de risque
 */

const db = require('./db');

// ─── Types de règles supportés ────────────────────────────────────────────────
const RULE_TYPES = {
  MAX_AMOUNT_PER_TX: 'max_amount_per_tx',       // Montant max par transaction
  MAX_TX_PER_HOUR:   'max_tx_per_hour',          // Nb max de transactions par client/heure
  MAX_TX_PER_DAY:    'max_tx_per_day',           // Nb max de transactions par client/jour
  MAX_AMOUNT_PER_DAY:'max_amount_per_day',       // Volume max par client/jour
  MAX_FAILED_ATTEMPTS: 'max_failed_attempts',    // Nb tentatives échouées avant blocage
};

// Règles par défaut (appliquées si aucune règle en DB)
const DEFAULT_RULES = {
  [RULE_TYPES.MAX_AMOUNT_PER_TX]:    { value: 5000000,  desc: '5 000 000 XOF par transaction' },
  [RULE_TYPES.MAX_TX_PER_HOUR]:      { value: 10,       desc: '10 transactions par heure' },
  [RULE_TYPES.MAX_TX_PER_DAY]:       { value: 30,       desc: '30 transactions par jour' },
  [RULE_TYPES.MAX_AMOUNT_PER_DAY]:   { value: 10000000, desc: '10 000 000 XOF par jour' },
  [RULE_TYPES.MAX_FAILED_ATTEMPTS]:  { value: 5,        desc: '5 tentatives échouées' },
};

// ─── Chargement des règles actives ────────────────────────────────────────────

function getActiveRules() {
  try {
    const dbRules = db.prepare("SELECT rule_type, value FROM fraud_rules WHERE is_active = 1").all();
    const rules = { ...Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, v.value])) };
    for (const r of dbRules) {
      rules[r.rule_type] = parseFloat(r.value);
    }
    return rules;
  } catch {
    return Object.fromEntries(Object.entries(DEFAULT_RULES).map(([k, v]) => [k, v.value]));
  }
}

// ─── Vérification de la blacklist ─────────────────────────────────────────────

function isPhoneBlocked(phone) {
  if (!phone) return false;
  try {
    return !!db.prepare('SELECT 1 FROM blocked_phones WHERE phone = ?').get(phone);
  } catch {
    return false;
  }
}

// ─── Calcul du score de risque ────────────────────────────────────────────────

function computeRiskScore({ amount, clientId, clientPhone, merchantId }) {
  let score = 0;
  const reasons = [];
  const rules = getActiveRules();

  // Règle 1: montant élevé
  const maxAmount = rules[RULE_TYPES.MAX_AMOUNT_PER_TX] || DEFAULT_RULES[RULE_TYPES.MAX_AMOUNT_PER_TX].value;
  if (amount > maxAmount * 0.8) { score += 20; reasons.push('Montant proche ou au-dessus du seuil max'); }
  if (amount > maxAmount)       { score += 40; reasons.push('Montant dépasse le seuil max'); }

  if (clientId) {
    const now = new Date().toISOString();
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const oneDayAgo  = new Date(Date.now() - 86400_000).toISOString();

    // Règle 2: fréquence horaire
    const txLastHour = db.prepare(`
      SELECT COUNT(*) as c FROM transactions
      WHERE client_id = ? AND initiated_at >= ? AND initiated_at <= ?
    `).get(clientId, oneHourAgo, now).c;
    const maxPerHour = rules[RULE_TYPES.MAX_TX_PER_HOUR];
    if (txLastHour >= maxPerHour * 0.8) { score += 15; reasons.push(`${txLastHour} transactions cette heure`); }
    if (txLastHour >= maxPerHour)        { score += 35; reasons.push(`Limite horaire dépassée (${txLastHour})`); }

    // Règle 3: volume journalier
    const dayStats = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total
      FROM transactions
      WHERE client_id = ? AND initiated_at >= ? AND initiated_at <= ?
    `).get(clientId, oneDayAgo, now);
    const maxPerDay    = rules[RULE_TYPES.MAX_TX_PER_DAY];
    const maxAmountDay = rules[RULE_TYPES.MAX_AMOUNT_PER_DAY];
    if (dayStats.count >= maxPerDay)        { score += 25; reasons.push(`Limite quotidienne de transactions dépassée (${dayStats.count})`); }
    if (dayStats.total >= maxAmountDay)     { score += 25; reasons.push(`Volume journalier dépassé (${dayStats.total})`); }

    // Règle 4: tentatives échouées récentes
    const failedRecent = db.prepare(`
      SELECT COUNT(*) as c FROM transactions
      WHERE client_id = ? AND status = 'failed' AND initiated_at >= ?
    `).get(clientId, oneDayAgo).c;
    const maxFailed = rules[RULE_TYPES.MAX_FAILED_ATTEMPTS];
    if (failedRecent >= maxFailed) { score += 30; reasons.push(`${failedRecent} tentatives échouées aujourd'hui`); }
  }

  // Score cappé à 100
  return { score: Math.min(score, 100), reasons };
}

// ─── API principale: vérification complète ────────────────────────────────────

/**
 * Vérifie si une transaction doit être bloquée.
 * @returns {{ blocked: boolean, reason: string|null, riskScore: number, reasons: string[] }}
 */
function checkTransaction({ amount, clientId, clientPhone, merchantId }) {
  // 1. Blacklist téléphone
  if (clientPhone && isPhoneBlocked(clientPhone)) {
    return {
      blocked: true,
      reason: 'Numéro de téléphone sur liste noire',
      riskScore: 100,
      reasons: ['Numéro blacklisté'],
    };
  }

  const rules = getActiveRules();

  // 2. Montant max absolu
  const maxAmount = rules[RULE_TYPES.MAX_AMOUNT_PER_TX];
  if (amount > maxAmount) {
    return {
      blocked: true,
      reason: `Montant ${amount} dépasse le seuil maximum autorisé (${maxAmount})`,
      riskScore: 100,
      reasons: ['Montant dépasse le seuil max'],
    };
  }

  // 3. Score de risque
  const { score, reasons } = computeRiskScore({ amount, clientId, clientPhone, merchantId });

  // Bloquer si score >= 70
  if (score >= 70) {
    return {
      blocked: true,
      reason: `Score de risque élevé (${score}/100): ${reasons.join(', ')}`,
      riskScore: score,
      reasons,
    };
  }

  return { blocked: false, reason: null, riskScore: score, reasons };
}

// ─── Administration ───────────────────────────────────────────────────────────

function getAllRules() {
  try {
    return db.prepare('SELECT * FROM fraud_rules ORDER BY created_at DESC').all();
  } catch {
    return [];
  }
}

function createRule({ name, rule_type, value }) {
  const { v4: uuidv4 } = require('uuid');
  if (!RULE_TYPES[rule_type.toUpperCase()] && !Object.values(RULE_TYPES).includes(rule_type)) {
    throw new Error(`Type de règle invalide: ${rule_type}`);
  }
  const id = uuidv4();
  db.prepare('INSERT INTO fraud_rules (id, name, rule_type, value) VALUES (?, ?, ?, ?)').run(id, name, rule_type, String(value));
  return db.prepare('SELECT * FROM fraud_rules WHERE id = ?').get(id);
}

function toggleRule(id, isActive) {
  const result = db.prepare('UPDATE fraud_rules SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
  return result.changes > 0;
}

function deleteRule(id) {
  const result = db.prepare('DELETE FROM fraud_rules WHERE id = ?').run(id);
  return result.changes > 0;
}

function blockPhone(phone, reason, blockedBy) {
  db.prepare('INSERT OR REPLACE INTO blocked_phones (phone, reason, blocked_by) VALUES (?, ?, ?)').run(phone, reason || null, blockedBy || null);
}

function unblockPhone(phone) {
  const result = db.prepare('DELETE FROM blocked_phones WHERE phone = ?').run(phone);
  return result.changes > 0;
}

function getBlockedPhones() {
  try {
    return db.prepare('SELECT * FROM blocked_phones ORDER BY blocked_at DESC').all();
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
