'use strict';

/**
 * Tests d'intégration — Rapports (overview, transactions, exchange-rates)
 */

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));
jest.mock('../../src/workers/webhook-dispatcher', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue({}),
  processRetryQueue: jest.fn().mockResolvedValue(0),
  WebhookEvents: { PAYMENT_COMPLETED: 'payment.completed', PAYMENT_FAILED: 'payment.failed', PAYMENT_REFUNDED: 'payment.refunded' },
}));

const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../src/index');
const db = require('../../src/lib/db');
const { clearAll } = require('../helpers/test-db');

async function clearData() {
  await db.query('DELETE FROM distributions');
  await db.query('DELETE FROM transactions');
  await db.query('DELETE FROM clients');
  await db.query('DELETE FROM merchants');
  await db.query('DELETE FROM admins');
}

async function getAdminToken() {
  const hash = await bcrypt.hash('admin123', 8);
  await db.query(
    "INSERT INTO admins (id, email, password_hash, role, full_name) VALUES ($1, $2, $3, $4, $5)",
    ['adm-rep', 'admin@reports.ci', hash, 'super_admin', 'Admin Test']
  );
  const res = await request(app).post('/api/v1/auth/admin/login').send({ email: 'admin@reports.ci', password: 'admin123' });
  return res.body.accessToken;
}

async function seedMerchantAndTx() {
  await db.query(`
    INSERT INTO merchants (id, name, email, phone, country_id, rebate_percent, rebate_mode, status,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret, is_active, currency)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13)
  `, ['mrc-rep', 'Marchand Reports', 'rep@test.ci', '+2250700002', 'CI', 8, 'cashback', 'active',
      'k1', 'k2', 'k3', 'k4', 'XOF']);

  // 3 transactions complétées
  for (let i = 0; i < 3; i++) {
    await db.query(`
      INSERT INTO transactions (id, reference, merchant_id, gross_amount, merchant_rebate_percent,
        client_rebate_percent, platform_commission_percent, merchant_rebate_amount,
        client_rebate_amount, platform_commission_amount, merchant_receives,
        net_client_amount, client_loyalty_status, rebate_mode, payment_method, status, currency)
      VALUES ($1, $2, 'mrc-rep', 10000, 8, 5, 3, 800, 500, 300, 9200, 9500, 'LIVE', 'cashback', 'mobile_money', 'completed', 'XOF')
    `, [`tx-rep-${i}`, `AFD-REP-${i}`]);
  }

  // 1 transaction échouée
  await db.query(`
    INSERT INTO transactions (id, reference, merchant_id, gross_amount, merchant_rebate_percent,
      client_rebate_percent, platform_commission_percent, merchant_rebate_amount,
      client_rebate_amount, platform_commission_amount, merchant_receives,
      net_client_amount, client_loyalty_status, rebate_mode, payment_method, status, currency)
    VALUES ($1, $2, 'mrc-rep', 5000, 8, 0, 8, 400, 0, 400, 4600, 5000, 'OPEN', 'cashback', 'mobile_money', 'failed', 'XOF')
  `, ['tx-rep-fail', 'AFD-REP-FAIL']);
}

describe('Rapports — Overview global (admin)', () => {
  let adminToken;

  beforeEach(async () => {
    await clearData();
    adminToken = await getAdminToken();
    await seedMerchantAndTx();
  });

  test('GET /reports/overview — retourne les KPIs', async () => {
    const res = await request(app)
      .get('/api/v1/reports/overview?period=30d')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.kpis).toBeDefined();
    expect(res.body.kpis.completed).toBe(3);
    expect(res.body.kpis.total_volume).toBe(30000);
    expect(res.body.kpis.platform_revenue).toBe(900);
    expect(res.body.kpis.client_rebates).toBe(1500);
    expect(res.body.topMerchants).toBeInstanceOf(Array);
    expect(res.body.dailyVolume).toBeInstanceOf(Array);
    expect(res.body.loyaltyDistribution).toBeInstanceOf(Array);
  });

  test('GET /reports/overview — 401 sans token', async () => {
    const res = await request(app).get('/api/v1/reports/overview');
    expect(res.status).toBe(401);
  });

  test('GET /reports/overview — période par défaut 30 jours', async () => {
    const res = await request(app)
      .get('/api/v1/reports/overview')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('30d');
  });
});

describe('Rapports — Transactions (admin)', () => {
  let adminToken;

  beforeEach(async () => {
    await clearData();
    adminToken = await getAdminToken();
    await seedMerchantAndTx();
  });

  test('GET /reports/transactions — liste paginée', async () => {
    const res = await request(app)
      .get('/api/v1/reports/transactions?page=1&limit=20')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions).toBeInstanceOf(Array);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
  });

  test('GET /reports/transactions — filtre par statut completed', async () => {
    const res = await request(app)
      .get('/api/v1/reports/transactions?status=completed')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions.every(t => t.status === 'completed')).toBe(true);
  });

  test('GET /reports/transactions — filtre par loyalty_status', async () => {
    const res = await request(app)
      .get('/api/v1/reports/transactions?loyalty_status=LIVE')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.transactions.every(t => t.client_loyalty_status === 'LIVE')).toBe(true);
  });
});

describe('Rapports — Taux de change (admin)', () => {
  let adminToken;

  beforeEach(async () => {
    await clearData();
    adminToken = await getAdminToken();
  });

  test('GET /reports/exchange-rates — retourne les taux', async () => {
    const res = await request(app)
      .get('/api/v1/reports/exchange-rates')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rates).toBeInstanceOf(Array);
    // Les taux initiaux sont seedés dans la migration 003
    expect(res.body.rates.length).toBeGreaterThan(0);
  });

  test('PUT /reports/exchange-rates — met à jour un taux', async () => {
    const res = await request(app)
      .put('/api/v1/reports/exchange-rates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ from_currency: 'XOF', to_currency: 'EUR', rate: 0.00155 });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('mis à jour');
  });

  test('PUT /reports/exchange-rates — 400 si rate manquant', async () => {
    const res = await request(app)
      .put('/api/v1/reports/exchange-rates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ from_currency: 'XOF', to_currency: 'EUR' });

    expect(res.status).toBe(400);
  });

  test('PUT /reports/exchange-rates — 400 si rate <= 0', async () => {
    const res = await request(app)
      .put('/api/v1/reports/exchange-rates')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ from_currency: 'XOF', to_currency: 'EUR', rate: -1 });

    expect(res.status).toBe(400);
  });

  test('GET /reports/overview-normalized — retourne volume normalisé EUR', async () => {
    await clearData();
    adminToken = await getAdminToken();
    await seedMerchantAndTx();

    const res = await request(app)
      .get('/api/v1/reports/overview-normalized?period=30d')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.bycurrency).toBeInstanceOf(Array);
    expect(res.body.totalVolumeEUR).toBeGreaterThanOrEqual(0);
  });
});
