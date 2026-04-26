'use strict';

/**
 * Vérifie un JWT HS256 émis par business-api SsoController.
 *
 * Format : header.payload.signature (base64url) signé avec AFRIKID_SSO_SECRET.
 *
 * Le secret partagé (env AFRIKID_SSO_SECRET) doit être identique à
 * config('afrikid.sso_secret') côté Laravel.
 *
 * On accepte :
 *   - aud == 'afrikid-gateway'
 *   - iss == 'business-api'
 *   - exp dans le futur (avec 30s de skew clock toléré)
 *   - role ∈ { 'merchant', 'cashier' }
 *
 * Le `jti` n'est PAS persisté ici (one-shot replay protection optionnelle).
 * Si un attaquant capture le token, il a 90s pour l'utiliser ; un check Redis
 * sur jti pourrait être ajouté plus tard si on veut empêcher le rejeu.
 */

const crypto = require('crypto');

const ALLOWED_ROLES = new Set(['merchant', 'cashier']);
const CLOCK_SKEW_SECONDS = 30;

function getSecret() {
  return process.env.AFRIKID_SSO_SECRET || '';
}

function b64urlDecode(str) {
  const pad = 4 - (str.length % 4 || 4);
  const padded = str + '='.repeat(pad === 4 ? 0 : pad);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * @param {string} token
 * @returns {{ ok: true, claims: object } | { ok: false, error: string }}
 */
function verifySsoToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'missing_token' };
  const secret = getSecret();
  if (!secret) return { ok: false, error: 'sso_not_configured' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed' };
  const [h, p, s] = parts;

  // Recompute signature en timing-safe
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest();
  let provided;
  try { provided = b64urlDecode(s); } catch { return { ok: false, error: 'bad_signature_encoding' }; }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, error: 'bad_signature' };
  }

  let header, claims;
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
    claims = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch { return { ok: false, error: 'bad_payload' }; }

  if (header.alg !== 'HS256') return { ok: false, error: 'bad_algorithm' };
  if (claims.aud !== 'afrikid-gateway') return { ok: false, error: 'bad_audience' };
  if (claims.iss !== 'business-api') return { ok: false, error: 'bad_issuer' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < now) {
    return { ok: false, error: 'expired' };
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > now) {
    return { ok: false, error: 'issued_in_future' };
  }
  if (!ALLOWED_ROLES.has(claims.role)) {
    return { ok: false, error: 'role_not_allowed' };
  }
  if (!claims.email) return { ok: false, error: 'missing_email' };

  return { ok: true, claims };
}

module.exports = { verifySsoToken };
