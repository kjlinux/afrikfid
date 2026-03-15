'use strict';

/**
 * Reset complet de la base de données :
 * 1. Supprime toutes les tables (DROP SCHEMA public CASCADE)
 * 2. Recrée le schéma public
 * 3. Relance les migrations
 * 4. Insère les données de seed
 *
 * Usage : npm run reset
 * ⚠️  DÉTRUIT toutes les données existantes !
 */

require('dotenv').config();

const { pool } = require('./lib/db');
const { runMigrations } = require('./lib/migrations');

async function reset() {
  const client = await pool.connect();
  try {
    console.log('⚠️  Réinitialisation de la base de données…');

    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO PUBLIC');
    console.log('✅ Schéma supprimé et recréé');
  } finally {
    client.release();
  }

  await runMigrations();
  console.log('✅ Migrations appliquées');

  // Seed
  require('./seed');
}

reset().catch(err => {
  console.error('❌ Erreur lors du reset :', err.message);
  process.exit(1);
});
