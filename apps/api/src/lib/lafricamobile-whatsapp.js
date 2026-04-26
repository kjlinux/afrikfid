'use strict';

/**
 * Client minimal pour LAfricaMobile WhatsApp Business API (LAM WABA).
 *
 * Doc : https://waba.lafricamobile.com/api-docs/
 * Auth : header `LAM-API-KEY: <ta-clé>` (config via env LAM_API_KEY)
 * Base URL configurable (LAM_BASE_URL) — défaut https://waba.lafricamobile.com
 *
 * Contraintes WABA / Meta :
 *   - Si l'utilisateur n'a pas initié la conversation dans les 24h, il faut
 *     OBLIGATOIREMENT passer par un message Template approuvé par Meta.
 *   - Pour un OTP login, l'utilisateur n'a pas initié → toujours utiliser un Template.
 *   - Le template doit idéalement être de catégorie AUTHENTICATION ; l'usage d'un
 *     template MARKETING pour des OTPs viole les CGU Meta et peut entraîner la
 *     suspension du numéro WABA. On accepte un fallback configurable (env)
 *     pour permettre l'intégration en dev avant approbation du template prod.
 *
 * Format numéro destinataire : `wa_id` = digits sans + ni espaces.
 *   Ex : "221771234567"
 */

const axios = require('axios');

function config() {
  return {
    baseURL: (process.env.LAM_BASE_URL || 'https://waba.lafricamobile.com').replace(/\/+$/, ''),
    apiKey: process.env.LAM_API_KEY || '',
    timeoutMs: parseInt(process.env.LAM_TIMEOUT_MS || '8000', 10),
    template: {
      name: process.env.LAM_OTP_TEMPLATE_NAME || '',
      namespace: process.env.LAM_OTP_TEMPLATE_NAMESPACE || '',
      languageCode: process.env.LAM_OTP_TEMPLATE_LANGUAGE || 'fr',
      // 'AUTHENTICATION' (recommandé) ou 'MARKETING' (dev temporaire)
      category: (process.env.LAM_OTP_TEMPLATE_CATEGORY || 'AUTHENTICATION').toUpperCase(),
    },
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.apiKey && c.baseURL);
}

function isTemplateConfigured() {
  const c = config();
  return Boolean(c.template.name && c.template.namespace);
}

function toWaId(rawPhone) {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/\D/g, '');
  // Refus court-circuit pour éviter d'envoyer à un numéro tronqué.
  return digits.length >= 8 ? digits : null;
}

/**
 * Normalise un téléphone côté business-api (qui stocke sans indicatif) en wa_id.
 * Si le pays/indicatif est connu, on préfixe.
 *
 * @param {string} phone   — numéro local stocké côté business-api (peut être déjà E.164)
 * @param {string?} indicatif — code pays ex "221" (sans +)
 */
function buildWaId(phone, indicatif = null) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  // Déjà préfixé : on respecte
  if (indicatif && digits.startsWith(String(indicatif))) return digits;
  if (indicatif) return String(indicatif) + digits.replace(/^0+/, '');
  // Sans indicatif connu : on retourne tel quel (l'appelant doit savoir)
  return digits;
}

async function request(method, path, { body = null, query = null, timeoutMs } = {}) {
  if (!isConfigured()) {
    const err = new Error('LAM WABA non configuré (LAM_API_KEY/LAM_BASE_URL)');
    err.code = 'LAM_NOT_CONFIGURED';
    throw err;
  }
  const c = config();
  try {
    const res = await axios.request({
      url: c.baseURL + path,
      method,
      headers: {
        'LAM-API-KEY': c.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: body || undefined,
      params: query || undefined,
      timeout: timeoutMs || c.timeoutMs,
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    const e = new Error(`LAM request failed: ${err.message}`);
    e.cause = err;
    e.code = 'LAM_UNREACHABLE';
    throw e;
  }
}

/**
 * Envoie un OTP par WhatsApp via le template configuré.
 *
 * Selon la catégorie du template :
 *   - AUTHENTICATION : structure body+button (auto-fill / copy-code)
 *   - MARKETING / autres : structure body simple avec le code injecté en {{1}}
 *     (mode dev, transgresse les CGU Meta — voir avertissement en tête de fichier)
 *
 * @returns {Promise<{ ok: boolean, messageId?: string, waId?: string, error?: string, status?: number }>}
 */
async function sendOtpTemplate(waId, code) {
  if (!isTemplateConfigured()) {
    return { ok: false, error: 'template_not_configured' };
  }
  if (!waId) return { ok: false, error: 'invalid_wa_id' };
  if (!/^\d{4,8}$/.test(String(code))) return { ok: false, error: 'invalid_code' };

  const c = config();
  const components = c.template.category === 'AUTHENTICATION'
    ? [
        { type: 'body', parameters: [{ type: 'text', text: String(code) }] },
        { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: String(code) }] },
      ]
    // Fallback MARKETING : un seul placeholder body — fonctionne avec un template
    // contenant {{1}} dans son body, ex: "Votre code Afrik'Fid : {{1}}"
    : [
        { type: 'body', parameters: [{ type: 'text', text: String(code) }] },
      ];

  const body = {
    to: String(waId),
    type: 'template',
    template: {
      namespace: c.template.namespace,
      name: c.template.name,
      language: { policy: 'deterministic', code: c.template.languageCode },
      components,
    },
  };

  const { status, data } = await request('POST', '/messages', { body });
  if (status >= 200 && status < 300) {
    return {
      ok: true,
      messageId: data?.messages?.[0]?.id || null,
      waId: data?.contacts?.[0]?.wa_id || waId,
      status,
    };
  }
  return {
    ok: false,
    status,
    error: data?.errors?.title || data?.meta?.developer_message || 'lam_error',
    raw: data,
  };
}

/**
 * Envoie un template WhatsApp générique (marketing, utility, etc.)
 *
 * @param {string} waId
 * @param {object} opts
 *   - name: nom du template (override LAM_MARKETING_TEMPLATE_NAME)
 *   - namespace: namespace (override LAM_MARKETING_TEMPLATE_NAMESPACE)
 *   - languageCode: code langue (def. LAM_MARKETING_TEMPLATE_LANGUAGE ou 'fr')
 *   - bodyParams: tableau de strings injectés en {{1}}, {{2}}…
 */
async function sendTemplate(waId, opts = {}) {
  if (!waId) return { ok: false, error: 'invalid_wa_id' };
  const name = opts.name || process.env.LAM_MARKETING_TEMPLATE_NAME || '';
  const namespace = opts.namespace || process.env.LAM_MARKETING_TEMPLATE_NAMESPACE || '';
  const languageCode = opts.languageCode || process.env.LAM_MARKETING_TEMPLATE_LANGUAGE || 'fr';
  if (!name || !namespace) return { ok: false, error: 'marketing_template_not_configured' };

  const bodyParams = Array.isArray(opts.bodyParams) ? opts.bodyParams : [];
  const components = bodyParams.length
    ? [{ type: 'body', parameters: bodyParams.map(t => ({ type: 'text', text: String(t) })) }]
    : [];

  const body = {
    to: String(waId),
    type: 'template',
    template: {
      namespace,
      name,
      language: { policy: 'deterministic', code: languageCode },
      components,
    },
  };

  const { status, data } = await request('POST', '/messages', { body });
  if (status >= 200 && status < 300) {
    return { ok: true, messageId: data?.messages?.[0]?.id || null, waId, status };
  }
  return { ok: false, status, error: data?.errors?.title || data?.meta?.developer_message || 'lam_error', raw: data };
}

/**
 * Envoie un message texte libre (uniquement valide dans la fenêtre de 24h
 * après dernier message entrant du client). Hors fenêtre, Meta rejette.
 */
async function sendText(waId, text) {
  if (!waId) return { ok: false, error: 'invalid_wa_id' };
  if (!text) return { ok: false, error: 'empty_text' };
  const body = {
    to: String(waId),
    type: 'text',
    text: { body: String(text).slice(0, 4096) },
  };
  const { status, data } = await request('POST', '/messages', { body });
  if (status >= 200 && status < 300) {
    return { ok: true, messageId: data?.messages?.[0]?.id || null, waId, status };
  }
  return { ok: false, status, error: data?.errors?.title || data?.meta?.developer_message || 'lam_error', raw: data };
}

async function listTemplates() {
  const { status, data } = await request('GET', '/configs/templates');
  if (status !== 200) {
    const err = new Error(`LAM templates fetch failed: ${status}`);
    err.status = status;
    err.data = data;
    throw err;
  }
  return data;
}

async function health() {
  try {
    const { status, data } = await request('GET', '/health', { timeoutMs: 4000 });
    return { ok: status === 200, status, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  isConfigured,
  isTemplateConfigured,
  sendOtpTemplate,
  sendTemplate,
  sendText,
  listTemplates,
  health,
  buildWaId,
  toWaId,
  _config: config,
};
