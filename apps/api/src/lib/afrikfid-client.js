'use strict';

/**
 * Client HTTP vers business-api (Laravel) — source de vérité des cartes fidélité 2014xxxxxxx.
 *
 * Contrat :
 *   - lookupCard(numero)    — cherche la carte + consommateur rattaché
 *   - creditTransaction(..) — remonte une transaction afrikid pour crédit points
 *   - getWallet(numero)     — solde wallet lié à la carte
 *
 * Sécurité : chaque requête est signée HMAC-SHA256 sur (timestamp + path + body)
 * via BUSINESS_API_HMAC_SECRET, et porte un Bearer BUSINESS_API_TOKEN (Sanctum).
 *
 * Fail-open sur lookup (paiement autorisé sans rebate si l'API tombe),
 * fail-closed sur crédit (on retente via le worker).
 */

const crypto = require('crypto');
const axios = require('axios');

const CARD_NUMERO_RE = /^2014\d{8}$/;

// Audit fire-and-forget : traçabilité latence + statut de chaque appel business-api.
// Never throws — un échec d'insert audit ne doit jamais casser un paiement.
function auditCall({ method, path, status, latencyMs, error }) {
  try {
    const db = require('./db');
    const { v4: uuidv4 } = require('uuid');
    const payload = JSON.stringify({
      method,
      path,
      status: status ?? null,
      latency_ms: latencyMs,
      error: error || null,
    });
    db.query(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload)
       VALUES ($1, 'system', 'afrikfid-client', $2, 'business_api', $3, $4)`,
      [uuidv4(), error ? 'business_api_call_failed' : 'business_api_call', path, payload]
    ).catch(() => {});
  } catch {
    /* no-op */
  }
}

function config() {
  return {
    baseURL: process.env.BUSINESS_API_URL || '',
    token: process.env.BUSINESS_API_TOKEN || '',
    hmacSecret: process.env.BUSINESS_API_HMAC_SECRET || '',
    timeout: parseInt(process.env.BUSINESS_API_TIMEOUT_MS || '5000', 10),
    enabled: (process.env.AFRIKFID_UNIFIED_ID || 'true').toLowerCase() === 'true',
  };
}

function sign(path, body, secret) {
  const timestamp = Date.now().toString();
  const payload = `${timestamp}.${path}.${body || ''}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { timestamp, signature };
}

function isValidCardNumero(numero) {
  return typeof numero === 'string' && CARD_NUMERO_RE.test(numero);
}

async function request(method, path, { body, retries = 2 } = {}) {
  const cfg = config();
  if (!cfg.enabled) {
    const err = new Error('afrikfid_integration_disabled');
    err.code = 'INTEGRATION_DISABLED';
    throw err;
  }
  if (!cfg.baseURL) {
    const err = new Error('BUSINESS_API_URL non configuré');
    err.code = 'CONFIG_MISSING';
    throw err;
  }

  const rawBody = body ? JSON.stringify(body) : '';
  const { timestamp, signature } = sign(path, rawBody, cfg.hmacSecret);
  const url = cfg.baseURL.replace(/\/+$/, '') + path;

  let lastErr;
  const start = Date.now();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios({
        method,
        url,
        data: rawBody || undefined,
        timeout: cfg.timeout,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: cfg.token ? `Bearer ${cfg.token}` : undefined,
          'X-AfrikFid-Timestamp': timestamp,
          'X-AfrikFid-Signature': signature,
        },
        validateStatus: (s) => s < 500,
      });
      if (res.status === 404) {
        auditCall({ method, path, status: 404, latencyMs: Date.now() - start });
        return { status: 404, data: null };
      }
      if (res.status >= 400) {
        const err = new Error(`business-api ${res.status}`);
        err.status = res.status;
        err.data = res.data;
        throw err;
      }
      auditCall({ method, path, status: res.status, latencyMs: Date.now() - start });
      return { status: res.status, data: res.data };
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500) break;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
  }
  auditCall({
    method,
    path,
    status: lastErr?.status ?? null,
    latencyMs: Date.now() - start,
    error: lastErr?.message || 'unknown_error',
  });
  throw lastErr;
}

/**
 * Recherche une carte fidélité par son numéro 12-chars (format 2014xxxxxxx).
 * Retourne null si la carte n'existe pas, ou si l'intégration est coupée (fail-open).
 * Jette une erreur uniquement sur problème de configuration.
 */
async function lookupCard(numero) {
  if (!isValidCardNumero(numero)) return null;
  try {
    const { status, data } = await request('GET', `/info/carte-fidelite/${encodeURIComponent(numero)}`);
    if (status === 404 || !data) return null;
    return normalizeCard(data);
  } catch (e) {
    if (e.code === 'INTEGRATION_DISABLED' || e.code === 'CONFIG_MISSING') throw e;
    // fail-open : on ne veut pas bloquer un paiement si business-api est indisponible
    return null;
  }
}

/**
 * Récupère le solde wallet attaché à la carte. null si indisponible.
 */
async function getWallet(numero) {
  if (!isValidCardNumero(numero)) return null;
  try {
    const { status, data } = await request('GET', `/info/wallet/${encodeURIComponent(numero)}`);
    if (status === 404 || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Pousse une transaction afrikid vers business-api pour crédit points/wallet.
 * Idempotence via reference_afrikid (UNIQUE côté Laravel).
 * Fail-closed : on propage l'erreur, le worker de sync retentera.
 */
async function creditTransaction({ numero, montant_total_xof, marchand_id, reference_afrikid, occurred_at }) {
  if (!isValidCardNumero(numero)) {
    const err = new Error('numero carte invalide');
    err.code = 'INVALID_CARD';
    throw err;
  }
  const { data } = await request('POST', '/external/transactions', {
    body: {
      numero_carte: numero,
      montant_total_xof,
      marchand_id,
      reference_afrikid,
      occurred_at: occurred_at || new Date().toISOString(),
    },
    retries: 1,
  });
  return data;
}

function normalizeCard(payload) {
  // Le payload Laravel peut encapsuler dans { data: {...} } ou être plat.
  const src = payload && payload.data ? payload.data : payload;
  if (!src) return null;
  const consommateur = src.consommateur || {};
  // Transactions multi-enseignes (30 dernières) retournées par InfoController
  const transactions = Array.isArray(src.transactions) ? src.transactions.map(t => ({
    merchant: t.marchand || null,
    logo: t.logo || null,
    amountXof: Number(t.montant) || 0,
    pointsEarned: Number(t.points_obtenus) || 0,
    date: t.date || null,
  })) : [];
  return {
    numero: src.numero,
    points_cumules: src.points_cumules || src.points || 0,
    reduction: src.reduction || null,
    consommateur: {
      id: consommateur.id,
      nom: consommateur.nom,
      prenom: consommateur.prenom,
      email: consommateur.email || null,
      telephone: consommateur.telephone || null,
      whatsapp: consommateur.whatsapp || null,
      pays_id: consommateur.pays_id || null,
      ville: consommateur.ville || null,
      sexe: consommateur.sexe || null,
      date_naissance: consommateur.date_naissance || null,
    },
    transactions,
  };
}

/**
 * Débite le wallet d'une carte fidélité via l'endpoint /external/wallet/debit.
 * Idempotent sur reference_afrikid (UNIQUE côté Laravel).
 * Fail-closed : propagation des erreurs pour que l'appelant invalide la transaction
 * passerelle en cas d'échec (solde insuffisant, carte introuvable, etc.).
 *
 * @returns {Promise<{ success: boolean, solde_apres?: number, error?: string, solde_disponible?: number, transaction_id?: number, reference?: string }>}
 */
async function debitWallet({ numero, montant_xof, marchand_id, reference_afrikid }) {
  if (!isValidCardNumero(numero)) {
    const err = new Error('numero carte invalide');
    err.code = 'INVALID_CARD';
    throw err;
  }
  try {
    const { status, data } = await request('POST', '/external/wallet/debit', {
      body: { numero_carte: numero, montant_xof, marchand_id, reference_afrikid },
      retries: 0, // pas de retry : un débit doit être strictement contrôlé
    });
    return { status, ...(data || {}) };
  } catch (e) {
    // 404/422 remontent via request() avec err.status/err.data
    if (e.status === 404 || e.status === 422) {
      return { status: e.status, success: false, ...(e.data || {}) };
    }
    throw e;
  }
}

/**
 * Récupère l'agrégat fidélité d'un marchand (par id business-api).
 * null si indisponible.
 */
async function getMerchantLoyaltySummary(marchandId) {
  if (!marchandId) return null;
  try {
    const { data } = await request('GET', `/external/merchant/${encodeURIComponent(marchandId)}/loyalty-summary`);
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Récupère l'agrégat quotidien vu côté business-api (transactions reçues d'afrikid),
 * pour croisement avec les données locales dans le job de reconciliation.
 * @param {string} isoDate YYYY-MM-DD
 */
async function getDailyReconciliation(isoDate) {
  try {
    const { data } = await request('GET', `/external/reconciliation/daily?date=${encodeURIComponent(isoDate)}`);
    return data || null;
  } catch {
    return null;
  }
}

module.exports = {
  lookupCard,
  getWallet,
  creditTransaction,
  debitWallet,
  getMerchantLoyaltySummary,
  getDailyReconciliation,
  isValidCardNumero,
  // exposé pour tests
  _sign: sign,
};
