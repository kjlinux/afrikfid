'use strict';

/**
 * Tests d'intégration — Marchands (admin CRUD + profil marchand)
 */

jest.mock('../../src/lib/db');
jest.mock('../../src/lib/migrations', () => ({ runMigrations: () => {} }));
jest.mock('../../src/workers/webhook-dispatcher', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue({}),
  processRetryQueue: jest.fn().mockResolvedValue(0),
  WebhookEvents: { PAYMENT_COMPLETED: 'payment.completed', PAYMENT_FAILED: 'payment.failed', PAYMENT_REFUNDED: 'payment.refunded' },
}));

const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../src/index');
const db = require('../../src/lib/db');

function clearData() {
  db.exec([
    'DELETE FROM transactions',
    'DELETE FROM payment_links',
    'DELETE FROM clients',
    'DELETE FROM merchants',
    'DELETE FROM admins',
  ].join('; '));
}

async function getAdminToken() {
  const hash = await bcrypt.hash('admin123', 8);
  db.prepare("INSERT INTO admins (id, email, password_hash, role, full_name) VALUES ('adm-01', 'admin@test.ci', ?, 'super_admin', 'Admin Test')").run(hash);
  const res = await request(app).post('/api/v1/auth/admin/login').send({ email: 'admin@test.ci', password: 'admin123' });
  return res.body.accessToken;
}

async function getMerchantToken(email = 'marchand@test.ci', password = 'pass123') {
  const hash = await bcrypt.hash(password, 8);
  db.prepare(`
    INSERT INTO merchants (id, name, email, phone, country_id, rebate_percent, rebate_mode, status, kyc_status,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      password_hash, is_active, currency)
    VALUES ('mrc-01', 'Chez Koffi', ?, '+2250701001', 'CI', 5, 'cashback', 'active', 'approved',
      'af_live_pub_001', 'af_live_sec_001', 'af_sandbox_pub_001', 'af_sandbox_sec_001', ?, 1, 'XOF')
  `).run(email, hash);
  const res = await request(app).post('/api/v1/auth/merchant/login').send({ email, password });
  return res.body.accessToken;
}

describe('Marchands — Admin CRUD', () => {
  let adminToken;

  beforeEach(async () => {
    clearData();
    adminToken = await getAdminToken();
  });

  test('POST /merchants — crée un marchand', async () => {
    const res = await request(app)
      .post('/api/v1/merchants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Boutique Test',
        email: 'boutique@test.ci',
        phone: '+2250702000',
        country_id: 'CI',
        rebate_percent: 8,
        rebate_mode: 'cashback',
        category: 'retail',
        password: 'Boutique@2026',
      });

    expect(res.status).toBe(201);
    expect(res.body.merchant).toBeDefined();
    expect(res.body.merchant.name).toBe('Boutique Test');
    expect(res.body.merchant.apiKeyPublic).toBeTruthy();
    expect(res.body.merchant.sandboxKeyPublic).toBeTruthy();
  });

  test('POST /merchants — 400 si email invalide', async () => {
    const res = await request(app)
      .post('/api/v1/merchants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X', email: 'not-an-email', phone: '+2250702001', country_id: 'CI', rebate_percent: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('POST /merchants — 409 si email déjà utilisé', async () => {
    const payload = {
      name: 'M1', email: 'dup@test.ci', phone: '+2250703001', country_id: 'CI', rebate_percent: 5, rebate_mode: 'cashback', password: 'Pass@2026',
    };
    await request(app).post('/api/v1/merchants').set('Authorization', `Bearer ${adminToken}`).send(payload);
    const res = await request(app).post('/api/v1/merchants').set('Authorization', `Bearer ${adminToken}`).send({ ...payload, name: 'M2' });

    expect(res.status).toBe(409);
  });

  test('GET /merchants — liste paginée', async () => {
    // Créer 2 marchands
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/v1/merchants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `Mrc ${i}`, email: `mrc${i}@test.ci`, phone: `+225070200${i}`, country_id: 'CI', rebate_percent: 5, rebate_mode: 'cashback', password: 'Aa@12345' });
    }

    const res = await request(app)
      .get('/api/v1/merchants?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.merchants.length).toBeGreaterThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  test('PATCH /merchants/:id — active un marchand', async () => {
    const createRes = await request(app)
      .post('/api/v1/merchants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Pending Mrc', email: 'pending@test.ci', phone: '+2250705001', country_id: 'CI', rebate_percent: 5, rebate_mode: 'cashback', password: 'Aa@12345' });

    const id = createRes.body.merchant.id;

    const res = await request(app)
      .patch(`/api/v1/merchants/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
  });

  test('GET /merchants — 401 sans token admin', async () => {
    const res = await request(app).get('/api/v1/merchants');
    expect(res.status).toBe(401);
  });
});

describe('Marchands — Profil et stats (marchand connecté)', () => {
  let merchantToken;

  beforeEach(async () => {
    clearData();
    merchantToken = await getMerchantToken();
  });

  test('GET /merchants/me/profile — retourne le profil', async () => {
    const res = await request(app)
      .get('/api/v1/merchants/me/profile')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.merchant).toBeDefined();
    expect(res.body.merchant.name).toBe('Chez Koffi');
    expect(res.body.merchant.rebatePercent).toBe(5);
    // Les clés secrètes ne doivent pas être exposées
    expect(res.body.merchant.apiKeySecret).toBeUndefined();
  });

  test('GET /merchants/me/stats — retourne les stats', async () => {
    const res = await request(app)
      .get('/api/v1/merchants/me/stats')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats).toHaveProperty('total_volume');
    expect(res.body.stats).toHaveProperty('completed_count');
  });

  test('GET /merchants/me/profile — 401 sans token', async () => {
    const res = await request(app).get('/api/v1/merchants/me/profile');
    expect(res.status).toBe(401);
  });
});
