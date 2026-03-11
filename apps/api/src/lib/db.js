const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/afrikfid.db');
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Pragmas via exec
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ─────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS countries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    currency TEXT NOT NULL,
    zone TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loyalty_config (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL UNIQUE,
    client_rebate_percent REAL NOT NULL DEFAULT 0,
    label TEXT NOT NULL,
    color TEXT DEFAULT '#6B7280',
    sort_order INTEGER DEFAULT 0,
    min_purchases INTEGER DEFAULT 0,
    min_cumulative_amount REAL DEFAULT 0,
    evaluation_months INTEGER DEFAULT 3,
    inactivity_months INTEGER DEFAULT 12,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    country_id TEXT REFERENCES countries(id),
    category TEXT DEFAULT 'general',
    business_registration TEXT,
    address TEXT,
    website TEXT,
    rebate_percent REAL NOT NULL DEFAULT 5,
    rebate_mode TEXT NOT NULL DEFAULT 'cashback',
    settlement_frequency TEXT DEFAULT 'daily',
    mm_operator TEXT,
    mm_phone TEXT,
    bank_name TEXT,
    bank_account TEXT,
    api_key_public TEXT UNIQUE,
    api_key_secret TEXT,
    sandbox_key_public TEXT UNIQUE,
    sandbox_key_secret TEXT,
    webhook_url TEXT,
    status TEXT DEFAULT 'pending',
    kyc_status TEXT DEFAULT 'pending',
    password_hash TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    afrikfid_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT UNIQUE NOT NULL,
    country_id TEXT REFERENCES countries(id),
    loyalty_status TEXT DEFAULT 'OPEN',
    status_since TEXT DEFAULT (datetime('now')),
    total_purchases INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    wallet_balance REAL DEFAULT 0,
    password_hash TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    reference TEXT UNIQUE NOT NULL,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    client_id TEXT REFERENCES clients(id),
    gross_amount REAL NOT NULL,
    net_client_amount REAL NOT NULL,
    merchant_rebate_percent REAL NOT NULL,
    client_rebate_percent REAL NOT NULL,
    platform_commission_percent REAL NOT NULL,
    merchant_rebate_amount REAL NOT NULL,
    client_rebate_amount REAL NOT NULL,
    platform_commission_amount REAL NOT NULL,
    merchant_receives REAL NOT NULL,
    client_loyalty_status TEXT,
    rebate_mode TEXT NOT NULL DEFAULT 'cashback',
    payment_method TEXT NOT NULL,
    payment_operator TEXT,
    payment_phone TEXT,
    status TEXT DEFAULT 'pending',
    failure_reason TEXT,
    operator_ref TEXT,
    currency TEXT DEFAULT 'XOF',
    country_id TEXT REFERENCES countries(id),
    description TEXT,
    idempotency_key TEXT UNIQUE,
    initiated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS distributions (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    beneficiary_type TEXT NOT NULL,
    beneficiary_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'XOF',
    status TEXT DEFAULT 'pending',
    operator TEXT,
    operator_ref TEXT,
    executed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    client_id TEXT UNIQUE NOT NULL REFERENCES clients(id),
    balance REAL DEFAULT 0,
    total_earned REAL DEFAULT 0,
    total_spent REAL DEFAULT 0,
    currency TEXT DEFAULT 'XOF',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet_movements (
    id TEXT PRIMARY KEY,
    wallet_id TEXT NOT NULL REFERENCES wallets(id),
    transaction_id TEXT REFERENCES transactions(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_before REAL NOT NULL,
    balance_after REAL NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    amount REAL NOT NULL,
    refund_type TEXT NOT NULL DEFAULT 'full',
    reason TEXT,
    status TEXT DEFAULT 'pending',
    initiated_by TEXT,
    processed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_links (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    code TEXT UNIQUE NOT NULL,
    amount REAL,
    currency TEXT DEFAULT 'XOF',
    description TEXT,
    expires_at TEXT,
    max_uses INTEGER DEFAULT 1,
    uses_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL REFERENCES merchants(id),
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    next_retry_at TEXT,
    last_response_code INTEGER,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    sent_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    payload TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions(client_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
  CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(initiated_at);
  CREATE INDEX IF NOT EXISTS idx_distributions_tx ON distributions(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_wallet_movements_wallet ON wallet_movements(wallet_id);
`);

// Helper: convert null prototype objects to plain objects
function toPlain(obj) {
  if (!obj) return obj;
  if (Array.isArray(obj)) return obj.map(toPlain);
  return Object.assign({}, obj);
}

// Wrap db.prepare to auto-convert results
const origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = origPrepare(sql);
  const origRun = stmt.run.bind(stmt);
  const origGet = stmt.get.bind(stmt);
  const origAll = stmt.all.bind(stmt);
  stmt.run = (...args) => origRun(...args);
  stmt.get = (...args) => toPlain(origGet(...args));
  stmt.all = (...args) => toPlain(origAll(...args));
  return stmt;
};

module.exports = db;
