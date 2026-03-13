'use strict';

/**
 * Jest globalTeardown — ferme le pool de connexions PostgreSQL.
 * Exécuté UNE fois après tous les tests.
 */

module.exports = async function globalTeardown() {
  try {
    const { pool } = require('../../src/lib/db');
    await pool.end();
  } catch {
    // pool déjà fermé ou non initialisé
  }
};
