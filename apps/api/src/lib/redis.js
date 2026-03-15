'use strict';

/**
 * Client Redis avec fallback in-memory pour les sessions/tokens 
 *
 * Variable d'environnement :
 *   REDIS_URL — ex. "redis://localhost:6379" ou "rediss://user:pass@host:6380"
 *
 * Si Redis est indisponible, un store in-memory est utilisé automatiquement.
 * En production, Redis est fortement recommandé pour la réplication des sessions
 * entre plusieurs instances.
 */

let _client = null;
let _useRedis = false;

function getClient() {
  if (_client !== null) return _client;

  try {
    const Redis = require('ioredis');
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const client = new Redis(url, {
      lazyConnect: false,
      enableReadyCheck: true,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('[Redis] Impossible de se connecter après 3 tentatives — fallback in-memory activé');
          return null; // arrêter les reconnexions
        }
        return Math.min(times * 200, 1000);
      },
      maxRetriesPerRequest: 1,
    });

    client.on('ready', () => {
      _useRedis = true;
      console.log('[Redis] Connecté ✓');
    });

    client.on('error', (err) => {
      _useRedis = false;
      console.warn('[Redis] Erreur:', err.message);
    });

    client.on('close', () => { _useRedis = false; });

    _client = client;
  } catch {
    console.warn('[Redis] ioredis non disponible — fallback in-memory activé');
    _client = null;
  }

  return _client;
}

// ─── Fallback in-memory ───────────────────────────────────────────────────────
const _mem = new Map();

function _memSet(key, ttlSeconds, value) {
  _mem.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

function _memGet(key) {
  const entry = _mem.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _mem.delete(key); return null; }
  return entry.value;
}

// Nettoyage périodique du store in-memory (toutes les 5 minutes)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _mem.entries()) {
      if (now > v.expires) _mem.delete(k);
    }
  }, 5 * 60 * 1000);
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Stocker une valeur avec TTL (secondes).
 */
async function setEx(key, ttlSeconds, value) {
  const client = getClient();
  if (client && _useRedis) {
    try { await client.setex(key, ttlSeconds, value); return; } catch { /* fallback */ }
  }
  _memSet(key, ttlSeconds, value);
}

/**
 * Lire une valeur.
 */
async function get(key) {
  const client = getClient();
  if (client && _useRedis) {
    try { return await client.get(key); } catch { /* fallback */ }
  }
  return _memGet(key);
}

/**
 * Supprimer une clé.
 */
async function del(key) {
  const client = getClient();
  if (client && _useRedis) {
    try { await client.del(key); return; } catch { /* fallback */ }
  }
  _mem.delete(key);
}

/**
 * Vérifier si une clé existe.
 */
async function exists(key) {
  const val = await get(key);
  return val !== null;
}

/**
 * Incrémenter un compteur (crée la clé à 1 si inexistante). Retourne la nouvelle valeur.
 */
async function incr(key) {
  const client = getClient();
  if (client && _useRedis) {
    try { return await client.incr(key); } catch { /* fallback */ }
  }
  const entry = _mem.get(key);
  const now = Date.now();
  if (!entry || now > entry.expires) {
    _mem.set(key, { value: 1, expires: Infinity });
    return 1;
  }
  entry.value = (parseInt(entry.value) || 0) + 1;
  return entry.value;
}

/**
 * Définir un TTL (secondes) sur une clé existante.
 */
async function expire(key, ttlSeconds) {
  const client = getClient();
  if (client && _useRedis) {
    try { await client.expire(key, ttlSeconds); return; } catch { /* fallback */ }
  }
  const entry = _mem.get(key);
  if (entry) entry.expires = Date.now() + ttlSeconds * 1000;
}

module.exports = { setEx, get, del, exists, incr, expire, getClient };
