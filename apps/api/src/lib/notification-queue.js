'use strict';

/**
 * Queue de notifications résiliente via Bull (Redis) avec fallback in-memory.
 *
 * - Si Redis est disponible : Bull persiste les jobs et retry automatiquement
 *   en cas d'échec (3 tentatives avec backoff exponentiel).
 * - Si Redis est indisponible : fallback vers la queue in-memory existante
 *   (comportement identique à l'ancien setImmediate).
 *
 * Usage :
 *   const { enqueue } = require('./notification-queue');
 *   enqueue(async () => { await sendSMS(...); });
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'notifications';

// ─── Tentative d'initialisation Bull ─────────────────────────────────────────

let _bull = null;
let _bullReady = false;

function getBullQueue() {
  if (_bull !== null) return _bull;
  if (process.env.NODE_ENV === 'test') return null; // pas de Bull en test

  try {
    const Bull = require('bull');
    const queue = new Bull(QUEUE_NAME, {
      redis: REDIS_URL,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s
        removeOnComplete: 100,   // conserver les 100 derniers jobs terminés
        removeOnFail: 200,       // conserver les 200 derniers jobs échoués
      },
    });

    queue.on('ready', () => {
      _bullReady = true;
      console.log('[NotifQueue] Bull/Redis prêt ✓');
    });

    queue.on('error', (err) => {
      _bullReady = false;
      if (!_bullErrorLogged) {
        console.warn('[NotifQueue] Bull/Redis indisponible — fallback in-memory activé:', err.message);
        _bullErrorLogged = true;
      }
    });

    // Processeur de jobs : chaque job contient { fnSrc } sérialisé en string
    // Comme Bull ne sérialise pas les fonctions, on stocke un identifiant
    // et le job est dispatché via un callback enregistré.
    queue.process(QUEUE_NAME, async (job) => {
      const handler = _handlers.get(job.data.handlerId);
      if (!handler) throw new Error(`Handler ${job.data.handlerId} introuvable`);
      _handlers.delete(job.data.handlerId);
      await handler();
    });

    queue.on('failed', (job, err) => {
      console.error(`[NotifQueue] Job ${job.id} échoué (tentative ${job.attemptsMade}/${job.opts.attempts}):`, err.message);
    });

    _bull = queue;
  } catch (err) {
    console.warn('[NotifQueue] Bull non disponible — fallback in-memory:', err.message);
    _bull = null;
  }

  return _bull;
}

// Map temporaire handler_id → fn (en mémoire, durée de vie = traitement du job)
const _handlers = new Map();
let _handlerCounter = 0;
let _bullErrorLogged = false;

// ─── Fallback in-memory (identique à l'ancienne implémentation) ───────────────

const _memQueue = [];
let _processingMem = false;

async function _processMemQueue() {
  if (_processingMem || _memQueue.length === 0) return;
  _processingMem = true;
  while (_memQueue.length > 0) {
    const job = _memQueue.shift();
    try { await job(); } catch (err) {
      console.error('[NotifQueue/mem] job échoué:', err.message);
    }
  }
  _processingMem = false;
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Enfile une fonction de notification asynchrone.
 * - Avec Redis : Bull persiste et retry automatiquement (3 tentatives).
 * - Sans Redis : exécution via setImmediate (fire-and-forget, comportement legacy).
 *
 * @param {Function} fn - Fonction async sans argument à exécuter
 */
function enqueue(fn) {
  const queue = getBullQueue();

  if (queue && _bullReady) {
    const handlerId = `h_${++_handlerCounter}`;
    _handlers.set(handlerId, fn);

    queue.add(QUEUE_NAME, { handlerId }, {}).catch((err) => {
      // Si l'ajout Bull échoue, fallback in-memory
      console.warn('[NotifQueue] Impossible d\'ajouter dans Bull, fallback:', err.message);
      _handlers.delete(handlerId);
      _memQueue.push(fn);
      setImmediate(_processMemQueue);
    });
  } else {
    // Fallback in-memory
    _memQueue.push(fn);
    setImmediate(_processMemQueue);
  }
}

/**
 * Fermer proprement la queue (utile pour tests et arrêt gracieux).
 */
async function close() {
  if (_bull) {
    await _bull.close();
    _bull = null;
    _bullReady = false;
  }
}

module.exports = { enqueue, close };
