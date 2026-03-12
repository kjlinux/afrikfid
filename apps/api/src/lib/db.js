'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err.message);
});

/**
 * Execute a parameterized query.
 * @param {string} sql
 * @param {any[]} [params=[]]
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(sql, params = []) {
  // Convert SQLite positional params (?) to PostgreSQL ($1, $2, ...)
  let pgSql = sql;
  let i = 0;
  pgSql = pgSql.replace(/\?/g, () => `$${++i}`);

  const client = await pool.connect();
  try {
    return await client.query(pgSql, params);
  } finally {
    client.release();
  }
}

/**
 * Execute multiple statements in a transaction.
 * @param {(client: import('pg').PoolClient) => Promise<void>} fn
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, transaction, pool };
