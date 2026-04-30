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

/**
 * Variables d'env :
 *   BUSINESS_API_URL — URL de base business-api, DOIT se terminer par "/api".
 *     Exemples valides :
 *       https://business-api.afrikfid.com/api
 *       https://api.afrikfid.com/api          (si Laravel sert sous /api)
 *     Exemples INVALIDES (les routes /external/... seront en 404) :
 *       https://business-api.afrikfid.com     (manque /api)
 *       https://api.afrikfid.com/api/         (slash final, le code re-strip mais autant être propre)
 *   BUSINESS_API_TOKEN — Bearer Sanctum/HMAC accepté par Laravel sur /external/*
 *   BUSINESS_API_HMAC_SECRET — secret partagé pour signer les requêtes
 */
function config() {
  let baseURL = (process.env.BUSINESS_API_URL || '').replace(/\/+$/, '');
  // Garde-fou : si l'op a oublié /api, on émet un warn une seule fois pour aider
  // au diagnostic. Sans /api, Laravel renverra 404 sur toutes les routes /external/*.
  if (baseURL && !/\/api$/.test(baseURL) && !config._warned) {
    console.warn(`[afrikfid-client] BUSINESS_API_URL="${baseURL}" ne se termine pas par "/api". Les requêtes vers /external/* renverront probablement 404. Voir DEPLOY-OVH.md.`);
    config._warned = true;
  }
  return {
    baseURL,
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
    const src = data && data.data ? data.data : data;
    if (!src || src.success === false) return null;
    return src;
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
 * Débite des points fidélité d'une carte via /external/points/debit.
 * Fail-closed : l'erreur est propagée pour annuler le paiement.
 */
async function debitPoints({ numero, points, reference_afrikid }) {
  if (!isValidCardNumero(numero)) {
    const err = new Error('numero carte invalide');
    err.code = 'INVALID_CARD';
    throw err;
  }
  try {
    const { status, data } = await request('POST', '/external/points/debit', {
      body: { numero_carte: numero, points, reference_afrikid },
      retries: 0,
    });
    return { status, ...(data || {}) };
  } catch (e) {
    if (e.status === 404 || e.status === 422) {
      return { status: e.status, success: false, ...(e.data || {}) };
    }
    throw e;
  }
}

/**
 * Délègue la vérification d'un mot de passe à business-api (source unique
 * pour les comptes marchand/caissier liés à un User Laravel).
 *
 * @returns {Promise<{ ok: true, user: object } | { ok: false, error: string, status: number }>}
 */
async function verifyPassword(email, password) {
  try {
    const { status, data } = await request('POST', '/external/auth/verify-password', {
      body: { email, password },
      retries: 0, // pas de retry sur un échec d'auth (évite les rate-limits côté Laravel)
    });
    if (data && data.ok && data.user) return { ok: true, user: data.user };
    return { ok: false, error: data?.error || 'unknown_error', status };
  } catch (e) {
    if (e.status === 401 || e.status === 404) {
      return { ok: false, error: e.data?.error || 'invalid_credentials', status: e.status };
    }
    throw e; // 5xx / réseau : on laisse l'appelant décider du fallback
  }
}

/**
 * Push une mise à jour de profil vers business-api (route entrante côté Laravel
 * `POST /api/external/sync/profile-updated`, signée HMAC).
 *
 * Anti-boucle : `source: 'gateway'` indique à Laravel de ne pas renotifier.
 *
 * @param {object} params
 * @param {'merchant'|'client'} params.type
 * @param {number} params.business_api_id  — id côté Laravel (consommateur_id ou marchand_id)
 * @param {object} params.changes          — sous-ensemble des champs modifiés
 * @returns {Promise<{ok: boolean}>}
 */
async function pushProfileUpdate({ type, business_api_id, changes }) {
  if (!type || !business_api_id || !changes) {
    const err = new Error('type, business_api_id, changes requis');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  try {
    await request('POST', '/external/sync/profile-updated', {
      body: {
        type,
        business_api_id,
        changes,
        source: 'gateway',
        sent_at: new Date().toISOString(),
      },
      retries: 2,
    });
    return { ok: true };
  } catch (e) {
    // Fail-soft : un push raté ne doit pas casser la mise à jour locale.
    // L'audit_logs côté afrikfid-client suit déjà l'échec.
    return { ok: false, error: e.message };
  }
}

/**
 * Recherche un consommateur côté business-api par identifiant (carte/phone/email).
 * Retourne les canaux OTP disponibles (téléphone/email masqués + valeurs internes
 * pour l'envoi côté passerelle).
 *
 * @returns {Promise<object|null>} le payload Laravel ou null si 404
 */
/**
 * Crée un Consommateur côté business-api (avec carte fidélité + wallet auto).
 *
 * Si un Consommateur existe déjà avec le même téléphone/email, l'API retourne
 * 409 avec `consommateur_id` et `numero_carte` existants — on les remonte tels
 * quels pour que la passerelle puisse rattacher au lieu de dupliquer.
 *
 * @param {object} data — { nom, prenom, sexe, date_naissance?, ville?,
 *                          telephone?, whatsapp?, email?, indicatif?, pays_id? }
 * @returns {Promise<{ ok: boolean, consommateur_id: number, numero_carte: string, error?: string }>}
 */
async function createConsommateur(data) {
  if (!data?.nom || !data?.prenom || !data?.sexe) {
    const err = new Error('nom, prenom, sexe requis');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  try {
    const { status, data: body } = await request('POST', '/external/consommateurs', {
      body: data,
      retries: 0,
    });
    if (status === 201) {
      return { ok: true, consommateur_id: body.consommateur_id, numero_carte: body.numero_carte };
    }
    if (status === 409) {
      // Consommateur existe déjà → rattacher
      return {
        ok: false,
        already_exists: true,
        consommateur_id: body.consommateur_id,
        numero_carte: body.numero_carte,
        error: 'consommateur_already_exists',
      };
    }
    return { ok: false, status, error: body?.error || 'unknown_error', message: body?.message };
  } catch (e) {
    if (e.status === 409 && e.data) {
      return {
        ok: false,
        already_exists: true,
        consommateur_id: e.data.consommateur_id,
        numero_carte: e.data.numero_carte,
        error: 'consommateur_already_exists',
      };
    }
    throw e;
  }
}

async function lookupConsommateurByIdentifier(identifier) {
  if (!identifier) return null;
  try {
    const { status, data } = await request('POST', '/external/consommateurs/lookup-by-identifier', {
      body: { identifier: String(identifier).trim() },
      retries: 1,
    });
    if (status === 404 || !data?.ok) return null;
    return data;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function lookupUserByEmail(email) {
  if (!email) return null;
  try {
    const { status, data } = await request('GET', `/external/auth/user-by-email?email=${encodeURIComponent(email)}`);
    if (status === 404 || !data?.ok) return null;
    return data.user || null;
  } catch {
    return null;
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
 * Récupère les analytics enrichis d'un marchand selon le tier (starter/plus/growth/premium).
 * null si indisponible.
 */
async function getMerchantAnalytics(marchandId, tier = 'starter') {
  if (!marchandId) return null;
  try {
    const { data } = await request('GET', `/external/merchant/${encodeURIComponent(marchandId)}/analytics?tier=${tier}`);
    const src = data && data.data ? data.data : data;
    return src || null;
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

/**
 * Récupère la carte cadeau active d'un consommateur par son ID fidelite-api.
 * Retourne { numero, solde } ou null.
 */
async function getCarteCadeauByConsommateur(consommateurId) {
  if (!consommateurId) return null;
  try {
    const { status, data } = await request('GET', `/info/carte-cadeau-by-consommateur/${consommateurId}`);
    if (status === 404 || !data) return null;
    const src = data && data.data ? data.data : data;
    if (!src || src.success === false) return null;
    return src;
  } catch {
    return null;
  }
}

/**
 * Débite une carte cadeau via /external/carte-cadeau/debit.
 * Fail-closed : l'erreur est propagée pour annuler le paiement.
 */
async function debitCarteCadeau({ numero, montant_xof, marchand_id, reference_afrikid }) {
  try {
    const { status, data } = await request('POST', '/external/carte-cadeau/debit', {
      body: { numero_carte: numero, montant_xof, marchand_id, reference_afrikid },
      retries: 0,
    });
    return { status, ...(data || {}) };
  } catch (e) {
    if (e.status === 404 || e.status === 422) {
      return { status: e.status, success: false, ...(e.data || {}) };
    }
    throw e;
  }
}

/**
 * Trouve ou crée un marchand dans fidelite-api à partir de l'UUID afrikid.
 * Retourne l'ID (int) du marchand côté fidelite-api, ou null si indisponible.
 */
async function findOrCreateMarchand({ afrikid_merchant_id, designation, telephone }) {
  try {
    const { data } = await request('POST', '/external/marchands/find-or-create', {
      body: { afrikid_merchant_id, designation, telephone: telephone || null },
      retries: 1,
    });
    const src = data && data.data ? data.data : data;
    return src?.marchand_id || null;
  } catch {
    return null;
  }
}

async function syncMarchandToFidelite(afrikidMerchantId, { logoUrl, designation } = {}) {
  try {
    const body = {};
    if (logoUrl !== undefined) body.logo_url = logoUrl;
    if (designation !== undefined) body.designation = designation;
    if (!Object.keys(body).length) return;
    await request('PATCH', `/external/merchant/${afrikidMerchantId}/sync`, { body, retries: 0 });
  } catch {
    // fire-and-forget
  }
}

// Envoie le fichier logo binaire vers fidelite-api pour qu'il le stocke localement.
// filePath : chemin absolu sur disque, mimeType : 'image/jpeg' etc.
async function syncLogoFileToFidelite(afrikidMerchantId, filePath, mimeType) {
  try {
    const cfg = config();
    if (!cfg.enabled || !cfg.baseURL) return;

    const fs = require('fs');
    const FormData = require('form-data');

    const form = new FormData();
    form.append('logo', fs.createReadStream(filePath), {
      contentType: mimeType,
      filename: require('path').basename(filePath),
    });
    form.append('afrikid_merchant_id', String(afrikidMerchantId));

    const path = `/external/marchands/sync-logo`;
    const ts = Date.now().toString();
    // Signature sur path uniquement (body multipart non signable en HMAC texte)
    const sig = crypto.createHmac('sha256', cfg.hmacSecret).update(`${ts}.${path}.`).digest('hex');

    await axios.post(cfg.baseURL.replace(/\/+$/, '') + path, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: cfg.token ? `Bearer ${cfg.token}` : undefined,
        'X-AfrikFid-Timestamp': ts,
        'X-AfrikFid-Signature': sig,
      },
      timeout: 10000,
      maxContentLength: 15 * 1024 * 1024,
    });
  } catch {
    // fire-and-forget
  }
}

module.exports = {
  lookupCard,
  getWallet,
  creditTransaction,
  debitWallet,
  debitPoints,
  getCarteCadeauByConsommateur,
  debitCarteCadeau,
  findOrCreateMarchand,
  getMerchantLoyaltySummary,
  getMerchantAnalytics,
  getDailyReconciliation,
  verifyPassword,
  lookupUserByEmail,
  lookupConsommateurByIdentifier,
  createConsommateur,
  pushProfileUpdate,
  syncMarchandToFidelite,
  syncLogoFileToFidelite,
  isValidCardNumero,
  // exposé pour tests
  _sign: sign,
};
