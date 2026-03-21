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
      -- Taux Y% personnalisés par pays 
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
  {
    version: 8,
    name: '008_transaction_retry_and_kyc_fields',
    up: `
      -- Retry opérateur avant expiration finale (CDC §4.1.4)
      -- retry_until : horodatage jusqu'auquel le worker doit interroger l'opérateur
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS retry_until TIMESTAMPTZ DEFAULT NULL;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS last_operator_check TIMESTAMPTZ DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_tx_retry_until ON transactions(retry_until) WHERE status = 'pending';

      -- KYC workflow marchand
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_reviewed_by TEXT DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_documents JSONB DEFAULT NULL;
    `,
  },
  {
    version: 9,
    name: '009_wallet_caps_and_refund_details',
    up: `
      -- Plafond configurable du solde cashback 
      ALTER TABLE wallets ADD COLUMN IF NOT EXISTS max_balance NUMERIC DEFAULT NULL;
      ALTER TABLE wallets ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'XOF';

      -- Détail du remboursement proportionnel X/Y/Z 
      ALTER TABLE refunds ADD COLUMN IF NOT EXISTS merchant_rebate_refunded NUMERIC DEFAULT 0;
      ALTER TABLE refunds ADD COLUMN IF NOT EXISTS client_rebate_refunded NUMERIC DEFAULT 0;
      ALTER TABLE refunds ADD COLUMN IF NOT EXISTS platform_commission_refunded NUMERIC DEFAULT 0;
      ALTER TABLE refunds ADD COLUMN IF NOT EXISTS refund_ratio NUMERIC DEFAULT 1;

      -- Plafond global du wallet (config admin)
      CREATE TABLE IF NOT EXISTS wallet_config (
        id TEXT PRIMARY KEY DEFAULT 'global',
        default_max_balance NUMERIC DEFAULT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      INSERT INTO wallet_config (id) VALUES ('global') ON CONFLICT DO NOTHING;
    `,
  },
  {
    version: 10,
    name: '010_security_rgpd_2fa',
    up: `
      -- Chiffrement bank_account marchand (CDC §5.4.1)
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS bank_account_hash TEXT DEFAULT NULL;

      -- RGPD — champ anonymisation pour les clients (CDC §RGPD)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS gdpr_deletion_requested_at TIMESTAMPTZ DEFAULT NULL;

      -- 2FA TOTP pour admins (CDC §5.4 sécurité renforcée)
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT DEFAULT NULL;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;
      ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT DEFAULT NULL;

      -- Export données RGPD demandées par les clients
      CREATE TABLE IF NOT EXISTS gdpr_export_requests (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id),
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        export_url TEXT,
        status TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_gdpr_requests_client ON gdpr_export_requests(client_id);
    `,
  },
  {
    version: 11,
    name: '011_disbursements',
    up: `
      -- Table de règlement automatique vers les marchands (CDC §4.1.3 — distribution fonds)
      CREATE TABLE IF NOT EXISTS disbursements (
        id TEXT PRIMARY KEY,
        beneficiary_type TEXT NOT NULL DEFAULT 'merchant',
        beneficiary_id TEXT NOT NULL REFERENCES merchants(id),
        transaction_id TEXT REFERENCES transactions(id),
        amount NUMERIC NOT NULL,
        currency TEXT NOT NULL DEFAULT 'XOF',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'pending_manual', 'completed', 'failed')),
        operator TEXT,
        operator_ref TEXT,
        executed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_disbursements_beneficiary ON disbursements(beneficiary_type, beneficiary_id);
      CREATE INDEX IF NOT EXISTS idx_disbursements_status ON disbursements(status);
      CREATE INDEX IF NOT EXISTS idx_disbursements_created ON disbursements(created_at);

      -- Colonne settlement_frequency sur merchants si absente
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS settlement_frequency TEXT DEFAULT 'daily'
        CHECK (settlement_frequency IN ('instant', 'daily', 'weekly', 'monthly'));

      -- Colonnes mobile money paiement sortant pour les marchands
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS mm_phone TEXT DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS mm_operator TEXT DEFAULT NULL;
    `,
  },
  {
    version: 12,
    name: '012_loyalty_config_category',
    up: `
      -- Taux Y% par catégorie marchand (CDC §2.5 — taux configurables par pays et catégorie)
      CREATE TABLE IF NOT EXISTS loyalty_config_category (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        status TEXT NOT NULL,
        client_rebate_percent NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (category, status)
      );

      CREATE INDEX IF NOT EXISTS idx_loyalty_config_category ON loyalty_config_category(category, status);
    `,
  },
  {
    version: 14,
    name: '014_seed_countries',
    up: `
      -- Seed des pays couverts par la passerelle (CDC §1.3 — zones UEMOA, CEMAC, Est-Afrique)
      INSERT INTO countries (id, name, currency, zone) VALUES
        -- Zone UEMOA (XOF)
        ('CI', 'Côte d''Ivoire',  'XOF', 'UEMOA'),
        ('SN', 'Sénégal',         'XOF', 'UEMOA'),
        ('BF', 'Burkina Faso',    'XOF', 'UEMOA'),
        ('ML', 'Mali',            'XOF', 'UEMOA'),
        ('NE', 'Niger',           'XOF', 'UEMOA'),
        ('TG', 'Togo',            'XOF', 'UEMOA'),
        ('BJ', 'Bénin',           'XOF', 'UEMOA'),
        ('GW', 'Guinée-Bissau',   'XOF', 'UEMOA'),
        -- Zone CEMAC (XAF)
        ('CM', 'Cameroun',        'XAF', 'CEMAC'),
        ('TD', 'Tchad',           'XAF', 'CEMAC'),
        ('GQ', 'Guinée Équatoriale', 'XAF', 'CEMAC'),
        ('GA', 'Gabon',           'XAF', 'CEMAC'),
        ('CG', 'Congo',           'XAF', 'CEMAC'),
        ('CF', 'RCA',             'XAF', 'CEMAC'),
        -- Afrique de l'Est
        ('KE', 'Kenya',           'KES', 'EAC')
      ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    version: 17,
    name: '017_disputes',
    up: `
      -- Gestion des litiges (CDC §4.6.1 — Refunds & Disputes Management)
      CREATE TABLE IF NOT EXISTS disputes (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id),
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        client_id TEXT REFERENCES clients(id),
        reason TEXT NOT NULL,
        description TEXT,
        amount_disputed NUMERIC,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'investigating', 'resolved', 'rejected')),
        resolution_note TEXT,
        initiated_by TEXT NOT NULL DEFAULT 'merchant',
        initiated_by_id TEXT,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dispute_history (
        id TEXT PRIMARY KEY,
        dispute_id TEXT NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        performed_by TEXT NOT NULL,
        performed_by_id TEXT,
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_disputes_merchant ON disputes(merchant_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_disputes_tx ON disputes(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_dispute_history_dispute ON dispute_history(dispute_id, created_at DESC);
    `,
  },
  {
    version: 16,
    name: '016_loyalty_status_history',
    up: `
      -- Historique complet des changements de statut fidélité (CDC §4.3.1)
      CREATE TABLE IF NOT EXISTS loyalty_status_history (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        old_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        reason TEXT,
        changed_by TEXT DEFAULT 'batch',
        stats JSONB,
        changed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_loyalty_history_client ON loyalty_status_history(client_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_loyalty_history_status ON loyalty_status_history(new_status, changed_at DESC);
    `,
  },
  {
    version: 13,
    name: '013_encryption_key_rotation',
    up: `
      -- Versioning des clés AES-256-GCM (CDC §5.4.1 — rotation tous les 90j, PCI-DSS)
      CREATE TABLE IF NOT EXISTS encryption_keys (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL UNIQUE,
        key_hex TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys(is_active, version DESC);
    `,
  },
  {
    version: 15,
    name: '015_refund_overdue_and_disbursements_table',
    up: `
      -- Statut 'overdue' pour les remboursements dépassant le SLA 72h 
      -- (pas de contrainte ENUM en PG natif, le statut est un TEXT libre)
      -- Index pour le worker de surveillance
      CREATE INDEX IF NOT EXISTS idx_refunds_status_created ON refunds(status, created_at) WHERE status = 'pending';

      -- Table disbursements (si inexistante — certaines migrations antérieures l'ont créée différemment)
      CREATE TABLE IF NOT EXISTS disbursements (
        id TEXT PRIMARY KEY,
        beneficiary_type TEXT NOT NULL,
        beneficiary_id TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        currency TEXT DEFAULT 'XOF',
        status TEXT DEFAULT 'pending',
        operator TEXT,
        operator_ref TEXT,
        transaction_id TEXT REFERENCES transactions(id),
        executed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_disbursements_beneficiary ON disbursements(beneficiary_type, beneficiary_id);
    `,
  },
  {
    version: 18,
    name: '018_merchant_category_rates',
    up: `
      -- Taux X% par catégorie de produit par marchand (CDC §2.1 — X% variable par catégorie)
      CREATE TABLE IF NOT EXISTS merchant_category_rates (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        discount_rate NUMERIC NOT NULL CHECK (discount_rate >= 0 AND discount_rate <= 100),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(merchant_id, category)
      );

      CREATE INDEX IF NOT EXISTS idx_merchant_category_rates ON merchant_category_rates(merchant_id, category);

      -- Catégorie produit sur la transaction (pour traçabilité du taux appliqué)
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS product_category TEXT;
    `,
  },
  {
    version: 19,
    name: '019_api_key_rotation',
    up: `
      -- Date de création des clés API marchands pour rotation automatique (CDC §5.4.1 — rotation 90j)
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ DEFAULT NOW();
      UPDATE merchants SET api_key_created_at = created_at WHERE api_key_created_at IS NULL;
    `,
  },
  {
    version: 21,
    name: '021_transaction_sandbox_flag',
    up: `
      -- Distinguer les transactions sandbox des transactions réelles (CDC §dev)
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_sandbox BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE INDEX IF NOT EXISTS idx_transactions_sandbox ON transactions(merchant_id, is_sandbox, initiated_at DESC);
    `,
  },
  {
    version: 20,
    name: '020_merchant_2fa',
    up: `
      -- 2FA TOTP pour marchands (CDC §5.4.2 — authentification forte multi-acteurs)
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_secret TEXT DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT DEFAULT NULL;
    `,
  },
  {
    version: 22,
    name: '022_cdc_v3_points_royal_elite_subscriptions',
    up: `
      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Points Statut / Récompense séparés (§2.3)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- Points statut : 1 pt = 500 FCFA d'achat, servent à la qualification
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS status_points INTEGER DEFAULT 0;
      -- Points statut sur 12 mois glissants (recalculé par batch)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS status_points_12m INTEGER DEFAULT 0;
      -- Points récompense : 1 pt = 100 FCFA, dépensables librement
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS reward_points INTEGER DEFAULT 0;
      -- Points historiques cumulés (ne décroît jamais, pour ROYAL ELITE)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS lifetime_status_points INTEGER DEFAULT 0;
      -- Date anniversaire client (pour trigger ANNIVERSAIRE)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date DATE DEFAULT NULL;

      -- Points attribués par transaction
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status_points_earned INTEGER DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reward_points_earned INTEGER DEFAULT 0;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Statut ROYAL ELITE (§2.2)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- Seuil points statut pour qualification (remplace min_purchases + min_cumulative_amount)
      ALTER TABLE loyalty_config ADD COLUMN IF NOT EXISTS min_status_points INTEGER DEFAULT 0;
      -- Conversion points statut : montant en FCFA pour 1 point (défaut 500)
      ALTER TABLE loyalty_config ADD COLUMN IF NOT EXISTS points_per_unit_amount INTEGER DEFAULT 500;
      -- Conversion points récompense : montant en FCFA pour 1 point (défaut 100)
      ALTER TABLE loyalty_config ADD COLUMN IF NOT EXISTS reward_points_per_unit INTEGER DEFAULT 100;

      -- Compteur d'années consécutives en ROYAL (pour ROYAL ELITE: 3 ans)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS consecutive_royal_years INTEGER DEFAULT 0;
      -- Date d'accession au statut ROYAL (pour calcul des années consécutives)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS royal_since TIMESTAMPTZ DEFAULT NULL;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Packages Marchands & Subscriptions (§1.4, §3.3)
      -- ═══════════════════════════════════════════════════════════════════════════

      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS package TEXT DEFAULT 'STARTER_BOOST'
        CHECK (package IN ('STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM'));
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'general';

      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        package TEXT NOT NULL CHECK (package IN ('STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM')),
        base_monthly_fee NUMERIC NOT NULL DEFAULT 25000,
        effective_monthly_fee NUMERIC NOT NULL DEFAULT 25000,
        recruitment_discount_percent NUMERIC DEFAULT 0,
        recruited_clients_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        next_billing_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant ON subscriptions(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status, next_billing_at);

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Success Fee (§3.5)
      -- ═══════════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS success_fees (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        reference_avg_basket NUMERIC DEFAULT 0,
        current_avg_basket NUMERIC DEFAULT 0,
        growth_amount NUMERIC DEFAULT 0,
        fee_percent NUMERIC DEFAULT 3,
        fee_amount NUMERIC DEFAULT 0,
        total_revenue_period NUMERIC DEFAULT 0,
        total_transactions_period INTEGER DEFAULT 0,
        status TEXT DEFAULT 'calculated' CHECK (status IN ('calculated', 'invoiced', 'paid', 'waived')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_success_fees_merchant ON success_fees(merchant_id, period_start DESC);

      -- Panier moyen de référence (calculé sur les 3 premiers mois)
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reference_avg_basket NUMERIC DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS reference_basket_calculated_at TIMESTAMPTZ DEFAULT NULL;
      ALTER TABLE merchants ADD COLUMN IF NOT EXISTS success_fee_percent NUMERIC DEFAULT 3;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Starter Boost Recrutement (§2.6)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- Tracking du recrutement client par marchand (quel marchand a recruté quel client)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS recruited_by_merchant_id TEXT REFERENCES merchants(id) DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS recruited_at TIMESTAMPTZ DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_clients_recruited_by ON clients(recruited_by_merchant_id, recruited_at);
    `,
  },
  {
    version: 23,
    name: '023_rfm_triggers_campaigns',
    up: `
      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Scores RFM (§5.1-5.3)
      -- ═══════════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS rfm_scores (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        r_score INTEGER NOT NULL DEFAULT 1 CHECK (r_score BETWEEN 1 AND 5),
        f_score INTEGER NOT NULL DEFAULT 1 CHECK (f_score BETWEEN 1 AND 5),
        m_score INTEGER NOT NULL DEFAULT 1 CHECK (m_score BETWEEN 1 AND 5),
        rfm_total INTEGER GENERATED ALWAYS AS (r_score + f_score + m_score) STORED,
        segment TEXT NOT NULL DEFAULT 'PERDUS',
        last_purchase_at TIMESTAMPTZ,
        purchase_count INTEGER DEFAULT 0,
        total_amount NUMERIC DEFAULT 0,
        calculated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(merchant_id, client_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rfm_scores_segment ON rfm_scores(merchant_id, segment);
      CREATE INDEX IF NOT EXISTS idx_rfm_scores_client ON rfm_scores(client_id);

      -- Seuils RFM configurables par secteur
      CREATE TABLE IF NOT EXISTS rfm_sector_thresholds (
        id TEXT PRIMARY KEY,
        sector TEXT NOT NULL,
        dimension TEXT NOT NULL CHECK (dimension IN ('recency', 'frequency', 'monetary')),
        score_5 NUMERIC NOT NULL,
        score_4 NUMERIC NOT NULL,
        score_3 NUMERIC NOT NULL,
        score_2 NUMERIC NOT NULL,
        score_1 NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(sector, dimension)
      );

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Triggers automatiques (§5.4)
      -- ═══════════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS triggers (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        trigger_type TEXT NOT NULL,
        target_segment TEXT,
        channel TEXT DEFAULT 'sms',
        message_template TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        cooldown_hours INTEGER DEFAULT 24,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_triggers_merchant ON triggers(merchant_id, trigger_type);

      CREATE TABLE IF NOT EXISTS trigger_logs (
        id TEXT PRIMARY KEY,
        trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        merchant_id TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_trigger_logs_client ON trigger_logs(client_id, trigger_type, created_at DESC);

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Campagnes (§5.5)
      -- ═══════════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_segment TEXT NOT NULL,
        channel TEXT DEFAULT 'sms',
        message_template TEXT NOT NULL,
        scheduled_at TIMESTAMPTZ,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'completed', 'cancelled')),
        total_targeted INTEGER DEFAULT 0,
        total_sent INTEGER DEFAULT 0,
        total_converted INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaign_actions (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'converted', 'failed')),
        sent_at TIMESTAMPTZ,
        converted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_actions_campaign ON campaign_actions(campaign_id, status);

      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 — Historique statuts fidélité (si pas déjà créé)
      -- ═══════════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS loyalty_status_history (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        old_status TEXT NOT NULL,
        new_status TEXT NOT NULL,
        reason TEXT,
        changed_by TEXT DEFAULT 'batch',
        stats JSONB,
        changed_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_loyalty_history_client ON loyalty_status_history(client_id, changed_at DESC);
    `,
  },
  {
    version: 24,
    name: '024_abandon_protocol_tracking',
    up: `
      -- ═══════════════════════════════════════════════════════════════════════════
      -- CDC v3.0 §5.5 — Protocole d'abandon (suivi automatisé 5 étapes)
      -- ═══════════════════════════════════════════════════════════════════════════

      CREATE TABLE IF NOT EXISTS abandon_tracking (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
        step_started_at TIMESTAMPTZ DEFAULT NOW(),
        next_step_at TIMESTAMPTZ,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'reactivated', 'lost', 'cancelled')),
        reactivated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(client_id, merchant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_abandon_tracking_status ON abandon_tracking(status, next_step_at);
      CREATE INDEX IF NOT EXISTS idx_abandon_tracking_client ON abandon_tracking(client_id);

      -- Deadline de requalification fidélité (12 mois glissants depuis dernière évaluation)
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS qualification_deadline TIMESTAMPTZ;

      -- Initialiser la deadline pour les clients existants (12 mois après status_since)
      UPDATE clients SET qualification_deadline = status_since + INTERVAL '12 months'
        WHERE qualification_deadline IS NULL AND status_since IS NOT NULL AND loyalty_status != 'OPEN';
    `,
  },
  {
    version: 25,
    name: '025_disbursement_tracking_and_notification_dedup',
    up: `
      -- ═══════════════════════════════════════════════════════════════════════════
      -- Fix idempotency payments: statut 'processing' comme verrou atomique
      -- Permet d'UPDATE status='processing' WHERE status='pending' pour éviter
      -- les doubles traitements lors de webhooks simultanés (race condition)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- Supprimer la contrainte CHECK existante sur status pour ajouter 'processing'
      ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
      ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded', 'expired'));

      -- ═══════════════════════════════════════════════════════════════════════════
      -- Fix bug disbursement: marquer les transactions réglées (évite NOT IN NULL)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- Colonne pour marquer les transactions déjà incluses dans un disbursement
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ;

      -- Index partiel pour accélérer la recherche de transactions non réglées
      CREATE INDEX IF NOT EXISTS idx_transactions_not_disbursed
        ON transactions(merchant_id, status) WHERE disbursed_at IS NULL;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- Fix bug status-notifications J+1: éviter les doublons de notifications
      -- ═══════════════════════════════════════════════════════════════════════════

      -- Colonne pour tracker la notification J+1 déjà envoyée
      ALTER TABLE loyalty_status_history ADD COLUMN IF NOT EXISTS notified_j1 TIMESTAMPTZ;
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
    console.log(`[DB] Base de données à jour (version ${currentVersion})`);
    return;
  }

  for (const migration of pending) {
    console.log(`[DB] Migration ${migration.version}: ${migration.name}...`);
    await pool.query(migration.up);
    await pool.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name]
    );
    console.log(`[DB] Migration ${migration.version} appliquée`);
  }

  const finalVersion = await getCurrentVersion();
  console.log(`[DB] Base de données mise à jour (version ${finalVersion})`);
}

module.exports = { runMigrations, getCurrentVersion };
