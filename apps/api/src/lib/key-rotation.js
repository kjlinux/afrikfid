'use strict';

/**
 * Rotation automatique des clés de chiffrement AES-256-GCM — PCI-DSS)
 *
 * Principe :
 *  - Les clés sont versionnées en base (table encryption_keys)
 *  - Chaque enregistrement chiffré stocke un préfixe de version : "v{N}:ivHex:authTagHex:dataHex"
 *  - La rotation crée une nouvelle clé active et re-chiffre progressivement les données existantes
 *  - Une clé expire 90 jours après sa création (configurable via KEY_ROTATION_DAYS)
 *
 * Utilisation :
 *  - `encrypt(plaintext)` — chiffre avec la clé active courante
 *  - `decrypt(ciphertext)` — déchiffre en détectant la version de clé
 *  - `rotateKey()` — crée une nouvelle clé (appelé par cron ou manuellement)
 *  - `reencryptPendingRecords()` — re-chiffre les enregistrements avec l'ancienne clé
 */

const crypto = require('crypto');
const db = require('./db');

const ALGORITHM = 'aes-256-gcm';
const KEY_ROTATION_DAYS = parseInt(process.env.KEY_ROTATION_DAYS || '90', 10);

// Cache clé active en mémoire pour éviter des requêtes BDD à chaque chiffrement
let _activeKey = null;
let _activeKeyVersion = null;
let _keyCacheExpiry = 0;

/**
 * Retourne la clé de chiffrement active (depuis la BDD ou l'env).
 * Met en cache pour 5 minutes.
 */
async function getActiveKey() {
  const now = Date.now();
  if (_activeKey && now < _keyCacheExpiry) {
    return { key: _activeKey, version: _activeKeyVersion };
  }

  try {
    const res = await db.query(
      "SELECT id, version, key_hex FROM encryption_keys WHERE is_active = TRUE ORDER BY version DESC LIMIT 1"
    );

    if (res.rows.length > 0) {
      const row = res.rows[0];
      _activeKey = Buffer.from(row.key_hex, 'hex');
      _activeKeyVersion = row.version;
      _keyCacheExpiry = now + 5 * 60 * 1000; // cache 5 min
      return { key: _activeKey, version: _activeKeyVersion };
    }
  } catch {
    // BDD non disponible ou table absente — fallback sur ENCRYPTION_KEY env
  }

  // Fallback : clé depuis variable d'environnement (version 0)
  const hex = process.env.ENCRYPTION_KEY;
  if (hex && hex.length >= 64) {
    _activeKey = Buffer.from(hex.slice(0, 64), 'hex');
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('[key-rotation] ENCRYPTION_KEY manquant en production');
  } else {
    _activeKey = Buffer.from('afrikfid-dev-encryption-key-00000afrikfid-dev-encryption-key-0000', 'utf8').slice(0, 32);
  }
  _activeKeyVersion = 0;
  _keyCacheExpiry = now + 5 * 60 * 1000;
  return { key: _activeKey, version: _activeKeyVersion };
}

/**
 * Récupère une clé par son numéro de version.
 */
async function getKeyByVersion(version) {
  if (version === 0) {
    // Version 0 = clé depuis env (rétrocompatibilité)
    const hex = process.env.ENCRYPTION_KEY;
    if (hex && hex.length >= 64) return Buffer.from(hex.slice(0, 64), 'hex');
    return Buffer.from('afrikfid-dev-encryption-key-00000afrikfid-dev-encryption-key-0000', 'utf8').slice(0, 32);
  }

  const res = await db.query(
    'SELECT key_hex FROM encryption_keys WHERE version = $1',
    [version]
  );
  if (!res.rows[0]) throw new Error(`[key-rotation] Clé version ${version} introuvable`);
  return Buffer.from(res.rows[0].key_hex, 'hex');
}

/**
 * Chiffre une valeur avec la clé active.
 * Format : "v{version}:{ivHex}:{authTagHex}:{ciphertextHex}"
 */
async function encrypt(plaintext) {
  if (plaintext == null) return null;
  const { key, version } = await getActiveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `v${version}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Déchiffre une valeur. Supporte :
 *  - Nouveau format : "v{N}:{iv}:{authTag}:{data}"
 *  - Ancien format (crypto.js) : "{iv}:{authTag}:{data}" (version 0 implicite)
 *  - Non chiffré : retourné tel quel
 */
async function decrypt(ciphertext) {
  if (ciphertext == null) return null;

  let version = 0;
  let parts;

  if (ciphertext.startsWith('v') && /^v\d+:/.test(ciphertext)) {
    // Nouveau format versionné
    const colonIdx = ciphertext.indexOf(':');
    version = parseInt(ciphertext.slice(1, colonIdx), 10);
    parts = ciphertext.slice(colonIdx + 1).split(':');
  } else {
    // Ancien format ou non chiffré
    parts = ciphertext.split(':');
  }

  if (parts.length !== 3) return ciphertext; // non chiffré, rétrocompat

  const [ivHex, authTagHex, dataHex] = parts;
  try {
    const key = await getKeyByVersion(version);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return ciphertext;
  }
}

/**
 * Crée une nouvelle clé de chiffrement et la marque active.
 * Désactive les clés expirées (> KEY_ROTATION_DAYS jours).
 * @returns {Promise<{version: number, keyId: string}>}
 */
async function rotateKey() {
  const { v4: uuidv4 } = require('uuid');

  // Obtenir la version courante
  const vRes = await db.query('SELECT COALESCE(MAX(version), 0) as max_v FROM encryption_keys');
  const newVersion = (parseInt(vRes.rows[0].max_v) || 0) + 1;

  // Générer une nouvelle clé 256 bits
  const newKeyHex = crypto.randomBytes(32).toString('hex');
  const keyId = uuidv4();
  const expiresAt = new Date(Date.now() + KEY_ROTATION_DAYS * 24 * 3600 * 1000);

  await db.query(`
    INSERT INTO encryption_keys (id, version, key_hex, is_active, expires_at, created_at)
    VALUES ($1, $2, $3, TRUE, $4, NOW())
  `, [keyId, newVersion, newKeyHex, expiresAt]);

  // Désactiver l'ancienne clé active (mais ne pas la supprimer — nécessaire pour déchiffrer)
  await db.query(`
    UPDATE encryption_keys SET is_active = FALSE
    WHERE version < $1 AND is_active = TRUE
  `, [newVersion]);

  // Invalider le cache mémoire
  _activeKey = null;
  _keyCacheExpiry = 0;

  console.log(`[key-rotation] Nouvelle clé v${newVersion} activée, expire le ${expiresAt.toISOString().slice(0, 10)}`);
  return { version: newVersion, keyId };
}

/**
 * Re-chiffre les enregistrements clients et marchands qui utilisent
 * une version de clé inférieure à la version active.
 * Traite par batch de 50 pour éviter la surcharge.
 *
 * @returns {Promise<{reencrypted: number}>}
 */
async function reencryptPendingRecords() {
  const { version: activeVersion } = await getActiveKey();
  if (activeVersion === 0) return { reencrypted: 0 }; // Pas de rotation effectuée

  let reencrypted = 0;

  // Re-chiffrer clients (phone, email)
  const clientRes = await db.query(`
    SELECT id, phone, email FROM clients
    WHERE anonymized_at IS NULL
      AND (
        phone NOT LIKE $1
        OR (email IS NOT NULL AND email NOT LIKE $1)
      )
    LIMIT 50
  `, [`v${activeVersion}:%`]);

  for (const row of clientRes.rows) {
    const updates = {};
    if (row.phone && !row.phone.startsWith(`v${activeVersion}:`)) {
      const plain = await decrypt(row.phone);
      if (plain && plain !== row.phone) updates.phone = await encrypt(plain);
    }
    if (row.email && !row.email.startsWith(`v${activeVersion}:`)) {
      const plain = await decrypt(row.email);
      if (plain && plain !== row.email) updates.email = await encrypt(plain);
    }
    if (Object.keys(updates).length > 0) {
      const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
      await db.query(`UPDATE clients SET ${sets} WHERE id = $1`, [row.id, ...Object.values(updates)]);
      reencrypted++;
    }
  }

  // Re-chiffrer marchands (bank_account)
  const merchantRes = await db.query(`
    SELECT id, bank_account FROM merchants
    WHERE bank_account IS NOT NULL AND bank_account NOT LIKE $1
    LIMIT 50
  `, [`v${activeVersion}:%`]);

  for (const row of merchantRes.rows) {
    const plain = await decrypt(row.bank_account);
    if (plain && plain !== row.bank_account) {
      const newCiphertext = await encrypt(plain);
      await db.query('UPDATE merchants SET bank_account = $1 WHERE id = $2', [newCiphertext, row.id]);
      reencrypted++;
    }
  }

  if (reencrypted > 0) {
    console.log(`[key-rotation] ${reencrypted} enregistrements re-chiffrés avec la clé v${activeVersion}`);
  }

  return { reencrypted };
}

/**
 * Vérifie si la clé active doit être renouvelée (proche de l'expiration).
 * Utilisé par le cron pour déclencher la rotation automatique.
 * @returns {Promise<boolean>}
 */
async function isRotationDue() {
  try {
    const res = await db.query(`
      SELECT expires_at FROM encryption_keys
      WHERE is_active = TRUE
      ORDER BY version DESC LIMIT 1
    `);
    if (!res.rows[0]) return true; // Pas de clé en BDD → rotation requise

    const expiresAt = new Date(res.rows[0].expires_at);
    const daysLeft = (expiresAt - Date.now()) / (24 * 3600 * 1000);
    return daysLeft <= 7; // Rotation 7 jours avant expiration
  } catch {
    return false;
  }
}

module.exports = { encrypt, decrypt, rotateKey, reencryptPendingRecords, isRotationDue };
