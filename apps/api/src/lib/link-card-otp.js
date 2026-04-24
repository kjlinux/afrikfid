'use strict';

/**
 * OTP éphémère pour le flux "lier une carte fidélité" côté panel client.
 *
 * Stocké en Redis (fallback in-memory) avec TTL court. L'OTP est envoyé sur le
 * téléphone du consommateur renvoyé par business-api — jamais saisi par le
 * client dans l'UI, ce qui prouve qu'il possède bien la carte.
 */

const crypto = require('crypto');
const redis = require('./redis');

const OTP_TTL_SECONDS = 10 * 60; // 10 min
const MAX_ATTEMPTS = 5;

function keyFor(clientId, numeroCarte) {
  return `link-card:otp:${clientId}:${numeroCarte}`;
}

function generateCode() {
  // 6 chiffres, uniforme (pas de biais modulo)
  let n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, '0');
}

/**
 * Crée et stocke un OTP pour (clientId, numeroCarte). Retourne le code en clair
 * à destination du canal d'envoi (SMS). Un nouvel appel écrase l'OTP précédent.
 */
async function issueOtp(clientId, numeroCarte) {
  const code = generateCode();
  const payload = JSON.stringify({ code, attempts: 0, issuedAt: Date.now() });
  await redis.setEx(keyFor(clientId, numeroCarte), OTP_TTL_SECONDS, payload);
  return code;
}

/**
 * Vérifie un OTP. Incrémente le compteur de tentatives et consomme le code si
 * correct (un OTP ne sert qu'une fois).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function verifyOtp(clientId, numeroCarte, provided) {
  const key = keyFor(clientId, numeroCarte);
  const raw = await redis.get(key);
  if (!raw) return { ok: false, reason: 'expired_or_missing' };

  let state;
  try { state = JSON.parse(raw); } catch { return { ok: false, reason: 'corrupt' }; }

  if ((state.attempts || 0) >= MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(String(state.code).padStart(6, '0')),
    Buffer.from(String(provided || '').padStart(6, '0'))
  );
  if (!match) {
    state.attempts = (state.attempts || 0) + 1;
    await redis.setEx(key, OTP_TTL_SECONDS, JSON.stringify(state));
    return { ok: false, reason: 'invalid_code', remaining: MAX_ATTEMPTS - state.attempts };
  }

  await redis.del(key);
  return { ok: true };
}

module.exports = { issueOtp, verifyOtp, OTP_TTL_SECONDS, MAX_ATTEMPTS };
