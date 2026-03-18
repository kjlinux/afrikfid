'use strict';

/**
 * Mock automatique de db.js pour les tests Jest.
 * Fournit une base de données SQLite en mémoire isolée.
 * Jest l'utilise automatiquement quand jest.mock('../../src/lib/db') est appelé.
 */

const { DatabaseSync } = require('node:sqlite');

const testDb = new DatabaseSync(':memory:');
testDb.exec("PRAGMA journal_mode = WAL");
testDb.exec("PRAGMA foreign_keys = ON");

function toPlain(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(toPlain);
  return Object.assign({}, obj);
}

const origPrepare = testDb.prepare.bind(testDb);
testDb.prepare = (sql) => {
  const stmt = origPrepare(sql);
  const origGet = stmt.get.bind(stmt);
  const origAll = stmt.all.bind(stmt);
  stmt.get = (...args) => toPlain(origGet(...args));
  stmt.all = (...args) => toPlain(origAll(...args));
  return stmt;
};

// Schéma complet
testDb.exec(`
  CREATE TABLE IF NOT EXISTS countries (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
    zone TEXT NOT NULL, is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loyalty_config (
    id TEXT PRIMARY KEY, status TEXT NOT NULL UNIQUE,
    client_rebate_percent REAL NOT NULL DEFAULT 0, label TEXT NOT NULL,
    color TEXT DEFAULT '#6B7280', sort_order INTEGER DEFAULT 0,
    min_purchases INTEGER DEFAULT 0, min_cumulative_amount REAL DEFAULT 0,
    evaluation_months INTEGER DEFAULT 3, inactivity_months INTEGER DEFAULT 12,
    min_status_points INTEGER DEFAULT 0,
    points_per_unit_amount INTEGER DEFAULT 500,
    reward_points_per_unit INTEGER DEFAULT 100,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, full_name TEXT NOT NULL,
    role TEXT DEFAULT 'admin', is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), last_login TEXT
  );
  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT, country_id TEXT, category TEXT DEFAULT 'general',
    business_registration TEXT, address TEXT, website TEXT,
    rebate_percent REAL NOT NULL DEFAULT 5, rebate_mode TEXT NOT NULL DEFAULT 'cashback',
    settlement_frequency TEXT DEFAULT 'daily',
    mm_operator TEXT, mm_phone TEXT, bank_name TEXT, bank_account TEXT,
    api_key_public TEXT UNIQUE, api_key_secret TEXT,
    sandbox_key_public TEXT UNIQUE, sandbox_key_secret TEXT,
    webhook_url TEXT, status TEXT DEFAULT 'pending', kyc_status TEXT DEFAULT 'pending',
    password_hash TEXT, is_active INTEGER DEFAULT 1,
    currency TEXT DEFAULT 'XOF',
    package TEXT DEFAULT 'STARTER_BOOST',
    sector TEXT DEFAULT 'general',
    reference_avg_basket REAL DEFAULT NULL,
    reference_basket_calculated_at TEXT DEFAULT NULL,
    success_fee_percent REAL DEFAULT 3,
    max_transaction_amount REAL DEFAULT NULL,
    daily_volume_limit REAL DEFAULT NULL,
    allow_guest_mode INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY, afrikfid_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL, email TEXT, phone TEXT UNIQUE NOT NULL,
    country_id TEXT, loyalty_status TEXT DEFAULT 'OPEN',
    status_since TEXT DEFAULT (datetime('now')),
    total_purchases INTEGER DEFAULT 0, total_amount REAL DEFAULT 0,
    wallet_balance REAL DEFAULT 0, password_hash TEXT,
    status_points INTEGER DEFAULT 0,
    status_points_12m INTEGER DEFAULT 0,
    reward_points INTEGER DEFAULT 0,
    lifetime_status_points INTEGER DEFAULT 0,
    consecutive_royal_years INTEGER DEFAULT 0,
    royal_since TEXT DEFAULT NULL,
    birth_date TEXT DEFAULT NULL,
    recruited_by_merchant_id TEXT DEFAULT NULL,
    recruited_at TEXT DEFAULT NULL,
    anonymized_at TEXT DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, reference TEXT UNIQUE NOT NULL,
    merchant_id TEXT NOT NULL, client_id TEXT,
    gross_amount REAL NOT NULL, net_client_amount REAL NOT NULL,
    merchant_rebate_percent REAL NOT NULL, client_rebate_percent REAL NOT NULL,
    platform_commission_percent REAL NOT NULL,
    merchant_rebate_amount REAL NOT NULL, client_rebate_amount REAL NOT NULL,
    platform_commission_amount REAL NOT NULL, merchant_receives REAL NOT NULL,
    client_loyalty_status TEXT, rebate_mode TEXT NOT NULL DEFAULT 'cashback',
    payment_method TEXT NOT NULL, payment_operator TEXT, payment_phone TEXT,
    status TEXT DEFAULT 'pending', failure_reason TEXT, operator_ref TEXT,
    currency TEXT DEFAULT 'XOF', country_id TEXT, description TEXT,
    idempotency_key TEXT UNIQUE,
    status_points_earned INTEGER DEFAULT 0,
    reward_points_earned INTEGER DEFAULT 0,
    product_category TEXT,
    initiated_at TEXT DEFAULT (datetime('now')), completed_at TEXT, expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS distributions (
    id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL,
    beneficiary_type TEXT NOT NULL, beneficiary_id TEXT NOT NULL,
    amount REAL NOT NULL, currency TEXT DEFAULT 'XOF',
    status TEXT DEFAULT 'pending', operator TEXT, operator_ref TEXT,
    executed_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY, client_id TEXT UNIQUE NOT NULL,
    balance REAL DEFAULT 0, total_earned REAL DEFAULT 0,
    total_spent REAL DEFAULT 0, currency TEXT DEFAULT 'XOF',
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS wallet_movements (
    id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, transaction_id TEXT,
    type TEXT NOT NULL, amount REAL NOT NULL,
    balance_before REAL NOT NULL, balance_after REAL NOT NULL,
    description TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL,
    amount REAL NOT NULL, refund_type TEXT NOT NULL DEFAULT 'full',
    reason TEXT, status TEXT DEFAULT 'pending',
    initiated_by TEXT, processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS payment_links (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL, amount REAL, currency TEXT DEFAULT 'XOF',
    description TEXT, expires_at TEXT, max_uses INTEGER DEFAULT 1,
    uses_count INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL,
    event_type TEXT NOT NULL, payload TEXT NOT NULL, url TEXT NOT NULL,
    status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
    next_retry_at TEXT, last_response_code INTEGER, last_error TEXT,
    created_at TEXT DEFAULT (datetime('now')), sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
    action TEXT NOT NULL, resource_type TEXT, resource_id TEXT,
    payload TEXT, ip_address TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS fraud_rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, rule_type TEXT NOT NULL,
    value TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS blocked_phones (
    phone TEXT PRIMARY KEY, reason TEXT, blocked_at TEXT DEFAULT (datetime('now')), blocked_by TEXT
  );
  CREATE TABLE IF NOT EXISTS exchange_rates (
    id TEXT PRIMARY KEY, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
    rate REAL NOT NULL, source TEXT DEFAULT 'manual', updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(from_currency, to_currency)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    package TEXT NOT NULL,
    base_monthly_fee REAL NOT NULL DEFAULT 25000,
    effective_monthly_fee REAL NOT NULL DEFAULT 25000,
    recruitment_discount_percent REAL DEFAULT 0,
    recruited_clients_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    started_at TEXT DEFAULT (datetime('now')),
    next_billing_at TEXT,
    cancelled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS success_fees (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    reference_avg_basket REAL DEFAULT 0,
    current_avg_basket REAL DEFAULT 0,
    growth_amount REAL DEFAULT 0,
    fee_percent REAL DEFAULT 3,
    fee_amount REAL DEFAULT 0,
    total_revenue_period REAL DEFAULT 0,
    total_transactions_period INTEGER DEFAULT 0,
    status TEXT DEFAULT 'calculated',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loyalty_status_history (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    old_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    reason TEXT,
    changed_by TEXT DEFAULT 'batch',
    stats TEXT,
    changed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS loyalty_config_country (
    id TEXT PRIMARY KEY,
    country_id TEXT NOT NULL,
    status TEXT NOT NULL,
    client_rebate_percent REAL NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(country_id, status)
  );
  CREATE TABLE IF NOT EXISTS notification_log (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, recipient TEXT NOT NULL,
    channel TEXT NOT NULL, status TEXT DEFAULT 'pending', error TEXT, sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS rfm_scores (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    r_score INTEGER NOT NULL DEFAULT 1,
    f_score INTEGER NOT NULL DEFAULT 1,
    m_score INTEGER NOT NULL DEFAULT 1,
    rfm_total INTEGER DEFAULT 3,
    segment TEXT NOT NULL DEFAULT 'PERDUS',
    last_purchase_at TEXT,
    purchase_count INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    calculated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(merchant_id, client_id)
  );
  CREATE TABLE IF NOT EXISTS rfm_sector_thresholds (
    id TEXT PRIMARY KEY,
    sector TEXT NOT NULL,
    dimension TEXT NOT NULL,
    score_5 REAL NOT NULL,
    score_4 REAL NOT NULL,
    score_3 REAL NOT NULL,
    score_2 REAL NOT NULL,
    score_1 REAL NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(sector, dimension)
  );
  CREATE TABLE IF NOT EXISTS triggers (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    target_segment TEXT,
    channel TEXT DEFAULT 'sms',
    message_template TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    cooldown_hours INTEGER DEFAULT 24,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS trigger_logs (
    id TEXT PRIMARY KEY,
    trigger_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    merchant_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    target_segment TEXT NOT NULL,
    channel TEXT DEFAULT 'sms',
    message_template TEXT NOT NULL,
    scheduled_at TEXT,
    status TEXT DEFAULT 'draft',
    total_targeted INTEGER DEFAULT 0,
    total_sent INTEGER DEFAULT 0,
    total_converted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS campaign_actions (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    converted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed loyalty config initial
testDb.exec(`
  INSERT OR IGNORE INTO loyalty_config (id, status, client_rebate_percent, label, sort_order, min_purchases, min_cumulative_amount, evaluation_months, min_status_points)
  VALUES
    ('lc-open',        'OPEN',        0,  'Open',        0, 0,  0,       12, 0),
    ('lc-live',        'LIVE',        5,  'Live',        1, 3,  50000,   12, 1000),
    ('lc-gold',        'GOLD',        8,  'Gold',        2, 10, 200000,  12, 5000),
    ('lc-royal',       'ROYAL',       12, 'Royal',       3, 30, 1000000, 12, 15000),
    ('lc-royal_elite', 'ROYAL_ELITE', 12, 'Royal Élite', 4, 0,  0,      12, 50000);
`);

testDb.exec(`
  INSERT OR IGNORE INTO countries (id, name, currency, zone)
  VALUES ('CI', 'Côte d''Ivoire', 'XOF', 'UEMOA');
`);

// Seed taux de change initiaux (migration 003)
testDb.exec(`
  INSERT OR IGNORE INTO exchange_rates (id, from_currency, to_currency, rate, source)
  VALUES
    ('er-xof-eur', 'XOF', 'EUR', 0.00152449, 'manual'),
    ('er-xaf-eur', 'XAF', 'EUR', 0.00152449, 'manual'),
    ('er-kes-eur', 'KES', 'EUR', 0.00694444, 'manual'),
    ('er-eur-xof', 'EUR', 'XOF', 655.957,    'manual'),
    ('er-eur-xaf', 'EUR', 'XAF', 655.957,    'manual'),
    ('er-eur-kes', 'EUR', 'KES', 144.0,      'manual');
`);

module.exports = testDb;
