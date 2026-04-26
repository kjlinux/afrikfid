'use strict';

/**
 * Provisioning et synchronisation des comptes marchands de la passerelle
 * depuis les Users Laravel (via business-api).
 *
 * Cas d'usage :
 *   1. Login marchand : la passerelle reçoit email+password. Si le hash local
 *      n'est pas valide (ou absent), on demande à Laravel. Si Laravel valide,
 *      on s'assure que le merchant local existe et est lié.
 *   2. SSO : on reçoit un JWT signé contenant déjà les claims user. Pas de
 *      vérif password — l'auth a été faite côté Laravel. On provisionne pareil.
 *
 * Le merchant local conserve ses propres champs (rebate_percent, status,
 * api_keys, etc.) — Laravel n'écrase que l'identité (email, name, business_api_marchand_id).
 */

const { v4: uuidv4 } = require('uuid');
const { randomBytes } = require('crypto');
const db = require('./db');

/**
 * Trouve ou crée un merchant local correspondant à un user Laravel.
 *
 * @param {object} bapiUser — payload renvoyé par /external/auth/verify-password
 *                            ou claims SSO. Doit contenir au minimum :
 *                            { id, email, role, marchand_id, marchand_designation }
 * @returns {Promise<{ merchant: object, created: boolean }>}
 */
async function findOrCreateMerchantFromBapiUser(bapiUser) {
  if (!bapiUser?.email) {
    const err = new Error('email manquant');
    err.code = 'MISSING_EMAIL';
    throw err;
  }
  if (!['merchant', 'cashier'].includes(bapiUser.role)) {
    const err = new Error(`role non éligible: ${bapiUser.role}`);
    err.code = 'ROLE_NOT_ELIGIBLE';
    throw err;
  }
  if (!bapiUser.marchand_id) {
    const err = new Error('marchand_id manquant côté business-api');
    err.code = 'MISSING_MARCHAND';
    throw err;
  }

  // 1) Match déjà fait via business_api_marchand_id ?
  let row = (await db.query(
    `SELECT * FROM merchants WHERE business_api_marchand_id = $1 AND is_active = TRUE`,
    [bapiUser.marchand_id]
  )).rows[0];

  // 2) Sinon, match par email (legacy → on rattache et on stamp business_api_marchand_id)
  if (!row) {
    row = (await db.query(
      `SELECT * FROM merchants WHERE email = $1 AND is_active = TRUE`,
      [bapiUser.email]
    )).rows[0];
    if (row) {
      await db.query(
        `UPDATE merchants
            SET business_api_marchand_id = $1,
                updated_at = NOW()
          WHERE id = $2 AND business_api_marchand_id IS NULL`,
        [bapiUser.marchand_id, row.id]
      );
      row.business_api_marchand_id = bapiUser.marchand_id;
      return { merchant: row, created: false };
    }
  } else {
    return { merchant: row, created: false };
  }

  // 3) Provisioning au vol — création minimaliste, le marchand pourra compléter
  //    son profil ensuite (KYC, méthodes de paiement, etc.).
  const id = uuidv4();
  const apiKeyPublic = `pk_${randomBytes(12).toString('hex')}`;
  const apiKeySecret = `sk_${randomBytes(24).toString('hex')}`;
  const sandboxKeyPublic = `pk_sandbox_${randomBytes(12).toString('hex')}`;
  const sandboxKeySecret = `sk_sandbox_${randomBytes(24).toString('hex')}`;

  await db.query(
    `INSERT INTO merchants (
       id, name, email, business_api_marchand_id,
       rebate_percent, rebate_mode, settlement_frequency,
       api_key_public, api_key_secret,
       sandbox_key_public, sandbox_key_secret,
       status, kyc_status, is_active,
       password_hash, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, 5, 'cashback', 'daily',
       $5, $6, $7, $8,
       'pending', 'pending', TRUE,
       NULL, NOW(), NOW()
     )`,
    [
      id,
      bapiUser.marchand_designation || bapiUser.email,
      bapiUser.email,
      bapiUser.marchand_id,
      apiKeyPublic, apiKeySecret,
      sandboxKeyPublic, sandboxKeySecret,
    ]
  );

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload)
     VALUES ($1, 'system', 'sso-provisioning', 'merchant_provisioned_from_bapi', 'merchant', $2, $3)`,
    [uuidv4(), id, JSON.stringify({ source: 'sso', bapi_user_id: bapiUser.id, bapi_marchand_id: bapiUser.marchand_id })]
  );

  const created = (await db.query('SELECT * FROM merchants WHERE id = $1', [id])).rows[0];
  return { merchant: created, created: true };
}

module.exports = { findOrCreateMerchantFromBapiUser };
