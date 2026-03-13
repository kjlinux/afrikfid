'use strict';

/**
 * Tests d'integration -- Routes Paiements
 */

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));
jest.mock('../../src/lib/adapters/mobile-money', () => ({
  initiatePayment: jest.fn(),
}));

const request = require('supertest');
const app = require('../../src/index');
const mobileMoney = require('../../src/lib/adapters/mobile-money');
const db = require('../../src/lib/db');
const { clearAll } = require('../helpers/test-db');

const SANDBOX_KEY = 'af_sandbox_pub_pay_test';
const SANDBOX_HEADERS = { 'X-API-Key': SANDBOX_KEY, 'X-Sandbox': 'true' };

async function clearData() {
  await db.query('DELETE FROM wallet_movements');
  await db.query('DELETE FROM wallets');
  await db.query('DELETE FROM distributions');
  await db.query('DELETE FROM refunds');
  await db.query('DELETE FROM transactions');
  await db.query('DELETE FROM payment_links');
  await db.query('DELETE FROM clients');
}

beforeAll(async () => {
  await clearAll();
  await db.query(`
    INSERT INTO merchants (id, name, email, rebate_percent, rebate_mode, api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret, status, kyc_status, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
    ON CONFLICT DO NOTHING
  `, ['merch-pay', 'Pay Shop', 'pay@test.af', 10, 'cashback',
      'af_pub_pay_test', 'af_sec_pay_test', SANDBOX_KEY, 'af_sandbox_sec_pay_test', 'active', 'approved']);
});

// ─── POST /initiate ──────────────────────────────────────────────────────────

describe('POST /api/v1/payments/initiate', () => {
  beforeEach(async () => {
    await clearData();
    mobileMoney.initiatePayment.mockResolvedValue({
      success: true,
      operatorRef: 'OP-REF-123',
      message: 'OK',
    });
  });

  test('amount manquant => 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set(SANDBOX_HEADERS)
      .send({ payment_method: 'mobile_money' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('amount negatif => 400', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set(SANDBOX_HEADERS)
      .send({ amount: -1000, payment_method: 'mobile_money' });
    expect(res.status).toBe(400);
  });

  test('paiement sans client (mode invite) => 201', async () => {
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set(SANDBOX_HEADERS)
      .send({ amount: 50000, payment_method: 'mobile_money', currency: 'XOF' });
    expect(res.status).toBe(201);
    expect(res.body.transaction).toHaveProperty('id');
    expect(res.body.transaction.status).toBe('pending');
    expect(res.body.transaction.grossAmount).toBe(50000);
    expect(res.body.distribution.clientRebatePercent).toBe(0);
  });

  test('client ROYAL (Y=10%, Z=0%) => distributions correctes', async () => {
    await db.query(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
      ['cl-royal', 'AFD-ROYAL', 'Client Royal', '+22500000001', 'ROYAL']
    );

    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set(SANDBOX_HEADERS)
      .send({ amount: 100000, payment_method: 'mobile_money', client_afrikfid_id: 'AFD-ROYAL', currency: 'XOF' });
    expect(res.status).toBe(201);
    expect(res.body.distribution.clientRebatePercent).toBe(10);
    expect(res.body.distribution.platformCommissionPercent).toBe(0);
    expect(res.body.distribution.clientRebateAmount).toBe(10000);
    expect(res.body.distribution.merchantReceives).toBe(90000);
  });

  test('idempotence: meme cle => meme transaction', async () => {
    const body = { amount: 25000, payment_method: 'mobile_money', idempotency_key: 'idem-001', currency: 'XOF' };
    const res1 = await request(app).post('/api/v1/payments/initiate').set(SANDBOX_HEADERS).send(body);
    const res2 = await request(app).post('/api/v1/payments/initiate').set(SANDBOX_HEADERS).send(body);
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(200);
    expect(res1.body.transaction.id).toBe(res2.body.transaction.id);
  });

  test('echec Mobile Money => 422', async () => {
    mobileMoney.initiatePayment.mockResolvedValueOnce({
      success: false,
      error: 'MM_ERROR',
      message: 'Solde insuffisant',
    });
    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set(SANDBOX_HEADERS)
      .send({ amount: 50000, payment_method: 'mobile_money', payment_operator: 'ORANGE', client_phone: '+22500000002', currency: 'XOF' });
    expect(res.status).toBe(422);
  });
});

// ─── Cycle de vie d'une transaction ─────────────────────────────────────────

describe('Cycle de vie transaction (initiate -> confirm -> refund)', () => {
  let txId;

  beforeAll(async () => {
    mobileMoney.initiatePayment.mockResolvedValue({
      success: true,
      operatorRef: 'OP-LIFECYCLE',
      message: 'OK',
    });

    await db.query(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE) ON CONFLICT DO NOTHING',
      ['cl-lifecycle', 'AFD-LIFECYCLE', 'Client Lifecycle', '+22500000010', 'LIVE']
    );

    const res = await request(app)
      .post('/api/v1/payments/initiate')
      .set(SANDBOX_HEADERS)
      .send({ amount: 80000, payment_method: 'mobile_money', client_afrikfid_id: 'AFD-LIFECYCLE', currency: 'XOF' });
    txId = res.body.transaction.id;
  });

  test('GET /:id/status => pending', async () => {
    const res = await request(app)
      .get('/api/v1/payments/' + txId + '/status')
      .set(SANDBOX_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('pending');
  });

  test('POST /:id/confirm => completed + distributions', async () => {
    const res = await request(app)
      .post('/api/v1/payments/' + txId + '/confirm')
      .set(SANDBOX_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('completed');
  });

  test('GET /:id/status apres confirm => completed avec distributions', async () => {
    const res = await request(app)
      .get('/api/v1/payments/' + txId + '/status')
      .set(SANDBOX_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('completed');
    expect(res.body.distributions.length).toBeGreaterThan(0);
  });

  test('double confirm => 400', async () => {
    const res = await request(app)
      .post('/api/v1/payments/' + txId + '/confirm')
      .set(SANDBOX_HEADERS);
    expect(res.status).toBe(400);
  });

  test('POST /:id/refund => 200 avec refundId', async () => {
    const res = await request(app)
      .post('/api/v1/payments/' + txId + '/refund')
      .set(SANDBOX_HEADERS)
      .send({ reason: 'Test', refund_type: 'full' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('refundId');
    expect(res.body.amount).toBe(80000);
  });
});

// ─── Validation refund ───────────────────────────────────────────────────────

describe('POST /api/v1/payments/:id/refund -- validation', () => {
  test('refund_type invalide => 400', async () => {
    const res = await request(app)
      .post('/api/v1/payments/any-id/refund')
      .set(SANDBOX_HEADERS)
      .send({ refund_type: 'invalid' });
    expect(res.status).toBe(400);
  });

  test('transaction inexistante => 404', async () => {
    const res = await request(app)
      .post('/api/v1/payments/nonexistent-id/refund')
      .set(SANDBOX_HEADERS)
      .send({ refund_type: 'full' });
    expect(res.status).toBe(404);
  });
});
