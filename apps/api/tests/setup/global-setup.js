'use strict';

/**
 * Jest globalSetup — crée la DB de test PostgreSQL et applique les migrations.
 * Exécuté UNE fois avant tous les tests, dans un contexte Node.js isolé.
 * Utilise directement pg (pas lib/db) pour éviter les problèmes de module cache.
 */

const { Client, Pool } = require('pg');

const TEST_DB = process.env.TEST_DB_NAME || 'afrikfid_test';
const PG_BASE_URL = process.env.PG_BASE_URL || 'postgresql://postgres:@localhost:5432/postgres';

module.exports = async function globalSetup() {
  // 1. Pointer DATABASE_URL vers la DB de test (lu par setup-env.js dans les workers)
  const testUrl = PG_BASE_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  process.env.DATABASE_URL = testUrl;

  // 2. Créer la base de test si elle n'existe pas
  const adminClient = new Client({ connectionString: PG_BASE_URL });
  await adminClient.connect();
  const exists = await adminClient.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [TEST_DB]
  );
  if (exists.rows.length === 0) {
    await adminClient.query(`CREATE DATABASE "${TEST_DB}"`);
    console.log(`[test-setup] Database "${TEST_DB}" created.`);
  }
  await adminClient.end();

  // 3. Appliquer les migrations via un pool dédié
  const pool = new Pool({ connectionString: testUrl });

  // Charger et exécuter les migrations manuellement
  const { runMigrations } = require('../../src/lib/migrations');
  await runMigrations();
  console.log(`[test-setup] Migrations applied on "${TEST_DB}".`);

  // 4. Seed data de base (loyalty_config, countries, exchange_rates)
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO loyalty_config (id, status, client_rebate_percent, label, sort_order, min_purchases, min_cumulative_amount, evaluation_months)
      VALUES
        ('lc-open',  'OPEN',  0,  'Open',  1, 0,  0,       3),
        ('lc-live',  'LIVE',  5,  'Live',  2, 3,  50000,   3),
        ('lc-gold',  'GOLD',  8,  'Gold',  3, 10, 200000,  6),
        ('lc-royal', 'ROYAL', 12, 'Royal', 4, 30, 1000000, 12)
      ON CONFLICT (id) DO UPDATE SET
        client_rebate_percent = EXCLUDED.client_rebate_percent,
        min_purchases = EXCLUDED.min_purchases,
        min_cumulative_amount = EXCLUDED.min_cumulative_amount
    `);

    await client.query(`
      INSERT INTO countries (id, name, currency, zone)
      VALUES ('CI', 'Côte d''Ivoire', 'XOF', 'UEMOA'),
             ('SN', 'Sénégal', 'XOF', 'UEMOA'),
             ('CM', 'Cameroun', 'XAF', 'CEMAC'),
             ('KE', 'Kenya', 'KES', 'EAC')
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO exchange_rates (from_currency, to_currency, rate)
      VALUES ('XOF', 'EUR', 0.00152),
             ('XAF', 'EUR', 0.00152),
             ('KES', 'EUR', 0.0077)
      ON CONFLICT (from_currency, to_currency) DO NOTHING
    `);
  } finally {
    client.release();
    await pool.end();
  }

  console.log('[test-setup] Base data seeded.');
};
