'use strict';

const crypto = require('crypto');

/**
 * Vérifie une signature HMAC-SHA256 à temps constant.
 * @param {string} secret     - Clé secrète
 * @param {string} payload    - Corps brut de la requête (string ou Buffer)
 * @param {string} received   - Valeur reçue (header de signature)
 * @param {string} [encoding] - 'hex' (défaut) ou 'base64'
 * @returns {boolean}
 */
function verifyHmac(secret, payload, received, encoding = 'hex') {
  if (!secret || !received) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest(encoding);
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false; // longueurs différentes = invalide
  }
}

/**
 * Vérifie un hash SHA-256 simple (non-HMAC, ex: CinetPay cpm_signature).
 * @param {string} input    - Chaîne à hasher
 * @param {string} received - Hash reçu (hex)
 * @returns {boolean}
 */
function verifySha256(input, received) {
  if (!received) return false;
  const expected = crypto.createHash('sha256').update(input).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = { verifyHmac, verifySha256 };
