'use strict';

/**
 * Tests d'integration -- Authentification (Admin + Marchand)
 * Utilise PostgreSQL réel via src/lib/db
 */

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));

const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../src/index');
const db = require('../../src/lib/db');
const { clearAll } = require('../helpers/test-db');

describe('Auth -- Admin Login', () => {
  beforeAll(async () => {
    await clearAll();
    const hash = await bcrypt.hash('Admin@2026!', 10);
    await db.query(
      'INSERT INTO admins (id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
      ['admin-1', 'admin@test.af', hash, 'Admin Test', 'admin']
    );
  });

  test('succes login admin', async () => {
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@test.af', password: 'Admin@2026!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.admin.email).toBe('admin@test.af');
  });

  test('mauvais mdp => 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@test.af', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('email inconnu => 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'ghost@test.af', password: 'Admin@2026!' });
    expect(res.status).toBe(401);
  });

  test('email invalide => 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'pas-un-email', password: 'Admin@2026!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('password manquant => 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin@test.af' });
    expect(res.status).toBe(400);
  });
});

describe('Auth -- Middleware requireAdmin', () => {
  let adminToken;

  beforeAll(async () => {
    const hash = await bcrypt.hash('Admin@2026!', 10);
    await db.query(
      'INSERT INTO admins (id, email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5, TRUE) ON CONFLICT DO NOTHING',
      ['admin-2', 'admin2@test.af', hash, 'Admin 2', 'admin']
    );

    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'admin2@test.af', password: 'Admin@2026!' });
    adminToken = res.body.accessToken;
  });

  test('sans token => 401', async () => {
    const res = await request(app).get('/api/v1/merchants');
    expect(res.status).toBe(401);
  });

  test('token invalide => 401', async () => {
    const res = await request(app)
      .get('/api/v1/merchants')
      .set('Authorization', 'Bearer invalide.token.ici');
    expect(res.status).toBe(401);
  });

  test('token valide => 200 avec liste marchands', async () => {
    const res = await request(app)
      .get('/api/v1/merchants')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('merchants');
  });
});

describe('Auth -- requireApiKey', () => {
  beforeAll(async () => {
    await db.query(`
      INSERT INTO merchants (id, name, email, rebate_percent, rebate_mode, api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret, status, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
      ON CONFLICT DO NOTHING
    `, ['merch-test', 'Test Shop', 'shop@test.af', 10, 'cashback',
        'af_pub_testkey123', 'af_sec_testkey123',
        'af_sandbox_pub_testkey123', 'af_sandbox_sec_testkey123', 'active']);
  });

  test('sans cle API => 401', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .send({ amount: 10000, payment_method: 'mobile_money' });
    expect(res.status).toBe(401);
  });

  test('cle API invalide => 401', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set('X-API-Key', 'cle_invalide')
      .send({ amount: 10000, payment_method: 'mobile_money' });
    expect(res.status).toBe(401);
  });

  test('cle sandbox valide => pas 401', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set('X-API-Key', 'af_sandbox_pub_testkey123')
      .set('X-Sandbox', 'true')
      .send({ amount: 10000, payment_method: 'mobile_money', currency: 'XOF' });
    expect(res.status).not.toBe(401);
  });
});

describe('Auth -- Merchant Login', () => {
  beforeAll(async () => {
    const hash = await bcrypt.hash('Merchant@2026!', 10);
    await db.query(`
      INSERT INTO merchants (id, name, email, rebate_percent, rebate_mode, api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret, status, is_active, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
      ON CONFLICT DO NOTHING
    `, ['merch-auth', 'Auth Shop', 'auth@test.af', 8, 'cashback',
        'af_pub_auth', 'af_sec_auth', 'af_sandbox_pub_auth', 'af_sandbox_sec_auth', 'active', hash]);
  });

  test('succes login marchand', async () => {
    const res = await request(app)
      .post('/api/v1/auth/merchant/login')
      .send({ email: 'auth@test.af', password: 'Merchant@2026!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body.merchant.email).toBe('auth@test.af');
  });

  test('mauvais mdp => 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/merchant/login')
      .send({ email: 'auth@test.af', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('email invalide => 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/merchant/login')
      .send({ email: 'pas-un-email', password: 'Merchant@2026!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
