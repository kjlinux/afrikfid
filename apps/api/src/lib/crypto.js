'use strict';

/**
 * Chiffrement AES-256-GCM des données sensibles au repos (CDC §5.4.1)
 *
 * Variables d'environnement requises en production :
 *   ENCRYPTION_KEY  — 64 caractères hexadécimaux (= 32 octets)
 *   HMAC_SECRET     — chaîne secrète pour les hachages recherchables
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[crypto] ENCRYPTION_KEY doit être une chaîne hexadécimale de 64 caractères en production');
    }
    // Clé déterministe pour dev/test uniquement
    return Buffer.from('afrikfid-dev-encryption-key-00000afrikfid-dev-encryption-key-0000', 'utf8').slice(0, 32);
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/**
 * Chiffre une valeur avec AES-256-GCM.
 * Retourne une chaîne base64 au format "ivHex:authTagHex:ciphertextHex"
 * @param {string|null} plaintext
 * @returns {string|null}
 */
function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12); // IV 96 bits recommandé pour GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Déchiffre une valeur chiffrée par encrypt().
 * Si la valeur n'est pas au format attendu, la retourne telle quelle (rétrocompat).
 * @param {string|null} ciphertext
 * @returns {string|null}
 */
function decrypt(ciphertext) {
  if (ciphertext == null) return null;
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext; // non chiffré, rétrocompat
  const [ivHex, authTagHex, dataHex] = parts;
  try {
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return ciphertext; // retourner tel quel si déchiffrement impossible
  }
}

/**
 * Hachage HMAC-SHA256 déterministe pour les champs recherchables (téléphone, email).
 * Le même input avec le même secret produit toujours le même hash.
 * @param {string|null} value
 * @returns {string|null}
 */
function hashField(value) {
  if (value == null) return null;
  const secret = process.env.HMAC_SECRET || process.env.ENCRYPTION_KEY || 'afrikfid-hmac-dev-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

module.exports = { encrypt, decrypt, hashField };
