'use strict';

/**
 * Worker de rotation automatique des clés API marchands (CDC §5.4.1)
 * Rotation tous les 90 jours — cron quotidien à 03h00
 */

const { CronJob } = require('cron');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../lib/db');
const { notifyApiKeyRotated } = require('../lib/notifications');

const ROTATION_DAYS = parseInt(process.env.API_KEY_ROTATION_DAYS || '90');

function generateApiKeyPair() {
  const apiKeyPublic = `afk_pub_${uuidv4().replace(/-/g, '')}`;
  const apiKeySecret = `afk_sec_${crypto.randomBytes(32).toString('hex')}`;
  return { apiKeyPublic, apiKeySecret };
}

async function rotateExpiredApiKeys() {
  const cutoff = new Date(Date.now() - ROTATION_DAYS * 86400000).toISOString();

  const merchants = (await db.query(
    `SELECT id, name, email FROM merchants
     WHERE is_active = TRUE AND status = 'active'
     AND (api_key_created_at IS NULL OR api_key_created_at < $1)`,
    [cutoff]
  )).rows;

  if (merchants.length === 0) return { rotated: 0 };

  let rotated = 0;
  for (const merchant of merchants) {
    try {
      const { apiKeyPublic, apiKeySecret } = generateApiKeyPair();
      const secretHash = crypto.createHash('sha256').update(apiKeySecret).digest('hex');

      await db.query(
        `UPDATE merchants
         SET api_key_public = $1, api_key_secret = $2, api_key_created_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [apiKeyPublic, secretHash, merchant.id]
      );

      // Audit log
      await db.query(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, created_at)
         VALUES ($1, 'system', 'key-rotation-worker', 'api_key_rotated', 'merchant', $2, NOW())`,
        [uuidv4(), merchant.id]
      );

      // Notifier le marchand par email
      notifyApiKeyRotated({ merchant, newApiKeyPublic: apiKeyPublic });

      rotated++;
      console.log(`[key-rotation] Clés API renouvelées pour le marchand ${merchant.id} (${merchant.email})`);
    } catch (err) {
      console.error(`[key-rotation] Erreur rotation marchand ${merchant.id}:`, err.message);
    }
  }

  return { rotated };
}

function startKeyRotationWorker() {
  // Cron quotidien à 03h00
  const job = new CronJob('0 3 * * *', async () => {
    console.log('[key-rotation] Démarrage rotation clés API marchands...');
    try {
      const result = await rotateExpiredApiKeys();
      console.log(`[key-rotation] Terminé: ${result.rotated} clé(s) renouvelée(s)`);
    } catch (err) {
      console.error('[key-rotation] Erreur:', err.message);
    }
  }, null, true, 'UTC');

  console.log(`[key-rotation] Worker démarré (rotation tous les ${ROTATION_DAYS} jours, cron 03h00 UTC)`);
  return job;
}

module.exports = { startKeyRotationWorker, rotateExpiredApiKeys };
