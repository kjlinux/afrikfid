'use strict';

/**
 * Circuit Breaker pour opérateurs Mobile Money 
 * États : CLOSED (normal) → OPEN (bloqué) → HALF_OPEN (test)
 *
 * Règles :
 * - CLOSED → OPEN : après FAILURE_THRESHOLD échecs consécutifs (défaut: 3)
 * - OPEN → HALF_OPEN : après RESET_TIMEOUT_MS (défaut: 5 min)
 * - HALF_OPEN → CLOSED : si le test réussit
 * - HALF_OPEN → OPEN : si le test échoue
 *
 * Stockage in-process (Map) avec TTL — suffit pour un mono-process.
 * En multi-instance, remplacer par Redis (lib/redis.js).
 */

const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD) || 3;
const RESET_TIMEOUT_MS = parseInt(process.env.CB_RESET_TIMEOUT_MS) || 5 * 60 * 1000; // 5 min

const CB_STATES = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

// Map<operatorKey, { state, failureCount, lastFailureAt, openedAt }>
const circuits = new Map();

function getCircuit(operator) {
  if (!circuits.has(operator)) {
    circuits.set(operator, { state: CB_STATES.CLOSED, failureCount: 0, lastFailureAt: null, openedAt: null });
  }
  return circuits.get(operator);
}

/**
 * Vérifie si un opérateur est disponible (circuit non OPEN).
 * Si OPEN et TTL écoulé, passe en HALF_OPEN pour permettre un test.
 * @param {string} operator  Identifiant opérateur (ex: 'orange_money', 'mtn_momo')
 * @returns {{ allowed: boolean, state: string }}
 */
function isOperatorAvailable(operator) {
  const cb = getCircuit(operator);

  if (cb.state === CB_STATES.CLOSED) return { allowed: true, state: CB_STATES.CLOSED };

  if (cb.state === CB_STATES.OPEN) {
    const elapsed = Date.now() - (cb.openedAt || 0);
    if (elapsed >= RESET_TIMEOUT_MS) {
      cb.state = CB_STATES.HALF_OPEN;
      console.info(`[circuit-breaker] ${operator}: OPEN → HALF_OPEN après ${Math.round(elapsed / 1000)}s`);
      return { allowed: true, state: CB_STATES.HALF_OPEN };
    }
    const remainingSec = Math.ceil((RESET_TIMEOUT_MS - elapsed) / 1000);
    console.warn(`[circuit-breaker] ${operator}: OPEN — retry dans ${remainingSec}s`);
    return { allowed: false, state: CB_STATES.OPEN };
  }

  // HALF_OPEN — laisser passer un test
  return { allowed: true, state: CB_STATES.HALF_OPEN };
}

/**
 * Signale un succès sur un opérateur → ferme le circuit si ouvert
 */
function recordSuccess(operator) {
  const cb = getCircuit(operator);
  if (cb.state !== CB_STATES.CLOSED) {
    console.info(`[circuit-breaker] ${operator}: ${cb.state} → CLOSED (succès)`);
    cb.state = CB_STATES.CLOSED;
    cb.failureCount = 0;
    cb.lastFailureAt = null;
    cb.openedAt = null;
  }
}

/**
 * Signale un échec sur un opérateur → ouvre le circuit si seuil atteint
 */
function recordFailure(operator) {
  const cb = getCircuit(operator);
  cb.failureCount++;
  cb.lastFailureAt = Date.now();

  if (cb.state === CB_STATES.HALF_OPEN) {
    cb.state = CB_STATES.OPEN;
    cb.openedAt = Date.now();
    console.warn(`[circuit-breaker] ${operator}: HALF_OPEN → OPEN (échec test)`);
    return;
  }

  if (cb.failureCount >= FAILURE_THRESHOLD) {
    cb.state = CB_STATES.OPEN;
    cb.openedAt = Date.now();
    console.warn(`[circuit-breaker] ${operator}: CLOSED → OPEN après ${cb.failureCount} échecs`);
  }
}

/**
 * Retourne l'état de tous les circuits (pour monitoring / health check)
 */
function getAllCircuitStates() {
  const result = {};
  for (const [op, cb] of circuits.entries()) {
    result[op] = {
      state: cb.state,
      failure_count: cb.failureCount,
      last_failure_at: cb.lastFailureAt ? new Date(cb.lastFailureAt).toISOString() : null,
      opened_at: cb.openedAt ? new Date(cb.openedAt).toISOString() : null,
    };
  }
  return result;
}

/**
 * Vérifie la présence des variables d'environnement des opérateurs de paiement.
 * Appelé au démarrage de l'application (hors mode test).
 * Ne bloque jamais le démarrage — affiche uniquement des warnings/errors.
 */
function checkOperatorCredentials() {
  if (process.env.NODE_ENV === 'test') return;

  const isProduction = process.env.NODE_ENV === 'production';
  const log = isProduction ? console.warn : console.info;

  const checks = [
    // Opérateurs Mobile Money
    { name: 'Orange Money', vars: ['ORANGE_CLIENT_ID', 'ORANGE_CLIENT_SECRET', 'ORANGE_MERCHANT_KEY'] },
    { name: 'Orange Webhook', vars: ['ORANGE_WEBHOOK_SECRET'], security: true },
    { name: 'MTN MoMo', vars: ['MTN_SUBSCRIPTION_KEY', 'MTN_API_USER', 'MTN_API_KEY'] },
    { name: 'MTN Callback', vars: ['MTN_CALLBACK_API_KEY'], security: true },
    { name: 'M-Pesa Daraja', vars: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY'] },
    { name: 'M-Pesa Webhook', vars: ['MPESA_WEBHOOK_SECRET'], security: true },
    { name: 'Airtel Money', vars: ['AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET'] },
    { name: 'Airtel Webhook', vars: ['AIRTEL_WEBHOOK_SECRET'], security: true },
    { name: 'Wave', vars: ['WAVE_API_KEY'] },
    { name: 'Moov Money', vars: ['MOOV_CLIENT_ID', 'MOOV_CLIENT_SECRET'] },
    // Paiement par carte
    { name: 'CinetPay', vars: ['CINETPAY_SITE_ID', 'CINETPAY_API_KEY'] },
    { name: 'CinetPay Webhook', vars: ['CINETPAY_SECRET_KEY'], security: true },
    { name: 'Flutterwave', vars: ['FLUTTERWAVE_SECRET_KEY'] },
    { name: 'Flutterwave Webhook', vars: ['FLUTTERWAVE_WEBHOOK_HASH'], security: true },
  ];

  let configured = 0;
  let missing = 0;

  for (const check of checks) {
    const missingVars = check.vars.filter(v => !process.env[v]);
    if (missingVars.length === 0) {
      configured++;
      continue;
    }

    missing++;
    const mode = check.vars.length === missingVars.length ? 'sandbox actif' : 'partiel';
    const level = check.security && isProduction ? console.error : log;
    level(`[operator-health] ${check.name}: ${missingVars.join(', ')} manquant(s) — ${mode}`);
  }

  if (isProduction) {
    console.info(`[operator-health] ${configured}/${checks.length} opérateurs/secrets configurés`);
  }
}

module.exports = {
  checkOperatorCredentials,
  isOperatorAvailable,
  recordSuccess,
  recordFailure,
  getAllCircuitStates,
  CB_STATES,
};
