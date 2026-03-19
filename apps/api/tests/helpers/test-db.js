'use strict';

/**
 * Helper PostgreSQL pour les tests d'intégration et unitaires.
 * Fournit clearAll() et des fonctions d'insertion asynchrones.
 */

const db = require('../../src/lib/db');

async function clearAll() {
  // Truncate all data tables but preserve reference data (loyalty_config, countries, exchange_rates)
  await db.query(`
    TRUNCATE TABLE
      campaign_actions, campaigns, trigger_logs, triggers, rfm_scores,
      success_fees, subscriptions, loyalty_status_history,
      audit_logs, notification_log, webhook_events, payment_links,
      refunds, disputes, wallet_movements, wallets, distributions,
      transactions, clients, merchants, admins
    CASCADE
  `);
}

async function insertAdmin({ id = 'adm-01', email = 'admin@test.ci', password_hash, role = 'super_admin', full_name = 'Admin Test' } = {}) {
  await db.query(
    `INSERT INTO admins (id, email, password_hash, role, full_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, password_hash, role, full_name]
  );
}

async function insertMerchant({
  id = 'mrc-01',
  name = 'Chez Koffi',
  email = 'marchand@test.ci',
  phone = '+2250701001',
  country_id = 'CI',
  rebate_percent = 5,
  rebate_mode = 'cashback',
  status = 'active',
  kyc_status = 'approved',
  api_key_public = 'af_live_pub_001',
  api_key_secret = 'af_live_sec_001',
  sandbox_key_public = 'af_sandbox_pub_001',
  sandbox_key_secret = 'af_sandbox_sec_001',
  password_hash = null,
  is_active = true,
} = {}) {
  await db.query(
    `INSERT INTO merchants (id, name, email, phone, country_id, rebate_percent, rebate_mode, status, kyc_status,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      password_hash, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO NOTHING`,
    [id, name, email, phone, country_id, rebate_percent, rebate_mode, status, kyc_status,
     api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
     password_hash, is_active]
  );
}

async function insertClient({
  id = 'cli-01',
  afrikfid_id = 'AFK-CLI-001',
  full_name = 'Client Test',
  email = null,
  phone = '+2250700000001',
  phone_hash = null,
  email_hash = null,
  country_id = 'CI',
  loyalty_status = 'OPEN',
  is_active = true,
} = {}) {
  await db.query(
    `INSERT INTO clients (id, afrikfid_id, full_name, email, phone, phone_hash, email_hash, country_id, loyalty_status, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [id, afrikfid_id, full_name, email, phone, phone_hash, email_hash, country_id, loyalty_status, is_active]
  );
}

async function insertTransaction({
  id,
  reference,
  merchant_id = 'mrc-01',
  client_id = null,
  gross_amount = 10000,
  net_client_amount = 9500,
  merchant_rebate_percent = 8,
  client_rebate_percent = 5,
  platform_commission_percent = 3,
  merchant_rebate_amount = 800,
  client_rebate_amount = 500,
  platform_commission_amount = 300,
  merchant_receives = 9200,
  client_loyalty_status = 'LIVE',
  rebate_mode = 'cashback',
  payment_method = 'mobile_money',
  status = 'completed',
  currency = 'XOF',
} = {}) {
  const { v4: uuidv4 } = require('uuid');
  const txId = id || uuidv4();
  const txRef = reference || `AFD-TEST-${txId.slice(0, 8)}`;
  await db.query(
    `INSERT INTO transactions (id, reference, merchant_id, client_id, gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode, payment_method, status, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO NOTHING`,
    [txId, txRef, merchant_id, client_id, gross_amount, net_client_amount,
     merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
     merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
     merchant_receives, client_loyalty_status, rebate_mode, payment_method, status, currency]
  );
  return txId;
}

module.exports = { clearAll, insertAdmin, insertMerchant, insertClient, insertTransaction };
