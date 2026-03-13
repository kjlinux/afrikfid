'use strict';

/**
 * Système de migrations versionné pour PostgreSQL
 */

const { pool } = require('./db');

const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS countries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        currency TEXT NOT NULL,
        zone TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS loyalty_config (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL UNIQUE,
        client_rebate_percent NUMERIC NOT NULL DEFAULT 0,
        label TEXT NOT NULL,
        color TEXT DEFAULT '#6B7280',
        sort_order INTEGER DEFAULT 0,
        min_purchases INTEGER DEFAULT 0,
        min_cumulative_amount NUMERIC DEFAULT 0,
        evaluation_months INTEGER DEFAULT 3,
        inactivity_months INTEGER DEFAULT 12,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admins (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT DEFAULT 'admin',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
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
        rebate_percent NUMERIC NOT NULL DEFAULT 5,
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
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        afrikfid_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        phone TEXT UNIQUE NOT NULL,
        country_id TEXT REFERENCES countries(id),
        loyalty_status TEXT DEFAULT 'OPEN',
        status_since TIMESTAMPTZ DEFAULT NOW(),
        total_purchases INTEGER DEFAULT 0,
        total_amount NUMERIC DEFAULT 0,
        wallet_balance NUMERIC DEFAULT 0,
        password_hash TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        reference TEXT UNIQUE NOT NULL,
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        client_id TEXT REFERENCES clients(id),
        gross_amount NUMERIC NOT NULL,
        net_client_amount NUMERIC NOT NULL,
        merchant_rebate_percent NUMERIC NOT NULL,
        client_rebate_percent NUMERIC NOT NULL,
        platform_commission_percent NUMERIC NOT NULL,
        merchant_rebate_amount NUMERIC NOT NULL,
        client_rebate_amount NUMERIC NOT NULL,
        platform_commission_amount NUMERIC NOT NULL,
        merchant_receives NUMERIC NOT NULL,
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
        initiated_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS distributions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id),
        beneficiary_type TEXT NOT NULL,
        beneficiary_id TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        currency TEXT DEFAULT 'XOF',
        status TEXT DEFAULT 'pending',
        operator TEXT,
        operator_ref TEXT,
        executed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        client_id TEXT UNIQUE NOT NULL REFERENCES clients(id),
        balance NUMERIC DEFAULT 0,
        total_earned NUMERIC DEFAULT 0,
        total_spent NUMERIC DEFAULT 0,
        currency TEXT DEFAULT 'XOF',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_movements (
        id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL REFERENCES wallets(id),
        transaction_id TEXT REFERENCES transactions(id),
        type TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        balance_before NUMERIC NOT NULL,
        balance_after NUMERIC NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS refunds (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id),
        amount NUMERIC NOT NULL,
        refund_type TEXT NOT NULL DEFAULT 'full',
        reason TEXT,
        status TEXT DEFAULT 'pending',
        initiated_by TEXT,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payment_links (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        code TEXT UNIQUE NOT NULL,
        amount NUMERIC,
        currency TEXT DEFAULT 'XOF',
        description TEXT,
        expires_at TIMESTAMPTZ,
        max_uses INTEGER DEFAULT 1,
        uses_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        next_retry_at TIMESTAMPTZ,
        last_response_code INTEGER,
        last_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        sent_at TIMESTAMPTZ
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions(client_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(initiated_at);
      CREATE INDEX IF NOT EXISTS idx_distributions_tx ON distributions(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_movements_wallet ON wallet_movements(wallet_id);
    `,
  },
  {
    version: 2,
    name: '002_add_fraud_detection',
    up: `
      CREATE TABLE IF NOT EXISTS fraud_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        value TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS blocked_phones (
        phone TEXT PRIMARY KEY,
        reason TEXT,
        blocked_at TIMESTAMPTZ DEFAULT NOW(),
        blocked_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_type, actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status, next_retry_at);
    `,
  },
  {
    version: 3,
    name: '003_multi_currency',
    up: `
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id TEXT PRIMARY KEY,
        from_currency TEXT NOT NULL,
        to_currency TEXT NOT NULL,
        rate NUMERIC NOT NULL,
        source TEXT DEFAULT 'manual',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(from_currency, to_currency)
      );

      INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source) VALUES
        ('er-xof-eur', 'XOF', 'EUR', 0.001524, 'initial'),
        ('er-xaf-eur', 'XAF', 'EUR', 0.001524, 'initial'),
        ('er-kes-eur', 'KES', 'EUR', 0.006897, 'initial'),
        ('er-eur-xof', 'EUR', 'XOF', 655.957,  'initial'),
        ('er-eur-xaf', 'EUR', 'XAF', 655.957,  'initial'),
        ('er-eur-kes', 'EUR', 'KES', 145.0,    'initial'),
        ('er-xof-xaf', 'XOF', 'XAF', 1.0,      'initial'),
        ('er-xaf-xof', 'XAF', 'XOF', 1.0,      'initial')
      ON CONFLICT (id) DO NOTHING;

      CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(from_currency, to_currency);
    `,
  },
  {
    version: 4,
    name: '004_notifications',
    up: `
      CREATE TABLE IF NOT EXISTS notification_log (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        recipient TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        error TEXT,
        sent_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notification_log(recipient, sent_at);
    `,
  },
  {
    version: 5,
    name: '005_loyalty_config_per_country',
    up: `
      -- Taux Y% personnalisés par pays (CDC §2.5)
      -- Surcharge les taux globaux de loyalty_config pour un pays donné.
      CREATE TABLE IF NOT EXISTS loyalty_config_country (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        client_rebate_percent NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(country_id, status)
      );

      CREATE INDEX IF NOT EXISTS idx_loyalty_cfg_country ON loyalty_config_country(country_id, status);
    `,
  },
  {
    version: 6,
    name: '006_merchant_alert_thresholds',
    up: `
      -- Seuils d'alerte par marchand (CDC §4.2.2)
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS max_transaction_amount NUMERIC DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS daily_volume_limit NUMERIC DEFAULT NULL;

      -- Mode invité configurable par marchand (CDC §4.1.4)
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS allow_guest_mode BOOLEAN DEFAULT TRUE;
    `,
  },
  {
    version: 7,
    name: '007_encryption_hash_fields',
    up: `
      -- Champs de hachage pour la recherche sur données chiffrées (CDC §5.4.1)
      -- Les valeurs phone/email dans clients seront chiffrées AES-256-GCM.
      -- Ces colonnes _hash (HMAC-SHA256) permettent la recherche sans déchiffrer.
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_hash TEXT DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_hash TEXT DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_clients_phone_hash ON clients(phone_hash);
      CREATE INDEX IF NOT EXISTS idx_clients_email_hash ON clients(email_hash);

      -- Hachage du numéro de paiement sur les transactions pour audit sécurisé
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_phone_hash TEXT DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_tx_payment_phone_hash ON transactions(payment_phone_hash);
    `,
  },
];

async function getCurrentVersion() {
  const res = await pool.query('SELECT MAX(version) as v FROM schema_migrations');
  return res.rows[0] && res.rows[0].v ? parseInt(res.rows[0].v) : 0;
}

async function runMigrations() {
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const currentVersion = await getCurrentVersion();
  const pending = MIGRATIONS.filter(m => m.version > currentVersion);

  if (pending.length === 0) {
    console.log(`✅ Base de données à jour (version ${currentVersion})`);
    return;
  }

  for (const migration of pending) {
    console.log(`🔄 Migration ${migration.version}: ${migration.name}...`);
    await pool.query(migration.up);
    await pool.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name]
    );
    console.log(`✅ Migration ${migration.version} appliquée`);
  }

  const finalVersion = await getCurrentVersion();
  console.log(`✅ Base de données mise à jour (version ${finalVersion})`);
}

module.exports = { runMigrations, getCurrentVersion };
