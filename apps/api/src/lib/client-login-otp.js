'use strict';

/**
 * OTP éphémère pour le login client passerelle.
 *
 * Différent de lib/link-card-otp : ici l'OTP n'est pas lié à un client local
 * (qui peut ne pas exister encore avant provisioning). On le clé par
 * (consommateur_id business-api, channel) pour permettre plusieurs essais sans
 * rejouer l'envoi.
 */

const crypto = require('crypto');
const redis = require('./redis');

const OTP_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;

function key(consommateurId, channel) {
  return `client-login:otp:${consommateurId}:${channel}`;
}
function cooldownKey(consommateurId, channel) {
  return `client-login:cd:${consommateurId}:${channel}`;
}

function generateCode() {
  let n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, '0');
}

async function isOnCooldown(consommateurId, channel) {
  return Boolean(await redis.exists(cooldownKey(consommateurId, channel)));
}

async function issueOtp(consommateurId, channel) {
  const code = generateCode();
  const payload = JSON.stringify({ code, attempts: 0, issuedAt: Date.now() });
  await redis.setEx(key(consommateurId, channel), OTP_TTL_SECONDS, payload);
  await redis.setEx(cooldownKey(consommateurId, channel), RESEND_COOLDOWN_SECONDS, '1');
  return code;
}

async function verifyOtp(consommateurId, channel, provided) {
  const k = key(consommateurId, channel);
  const raw = await redis.get(k);
  if (!raw) return { ok: false, reason: 'expired_or_missing' };

  let state;
  try { state = JSON.parse(raw); } catch { return { ok: false, reason: 'corrupt' }; }

  if ((state.attempts || 0) >= MAX_ATTEMPTS) {
    await redis.del(k);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const a = Buffer.from(String(state.code).padStart(6, '0'));
  const b = Buffer.from(String(provided || '').padStart(6, '0'));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) {
    state.attempts = (state.attempts || 0) + 1;
    await redis.setEx(k, OTP_TTL_SECONDS, JSON.stringify(state));
    return { ok: false, reason: 'invalid_code', remaining: MAX_ATTEMPTS - state.attempts };
  }

  await redis.del(k);
  return { ok: true };
}

module.exports = {
  issueOtp,
  verifyOtp,
  isOnCooldown,
  OTP_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
  MAX_ATTEMPTS,
};
