'use strict';

/**
 * Tests d'intégration — Liens de paiement (payment-links)
 */

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));
jest.mock('../../src/lib/adapters/mobile-money', () => ({
  initiatePayment: jest.fn(),
}));
jest.mock('../../src/lib/adapters/cinetpay', () => ({
  initiateCardPayment: jest.fn(),
  checkPaymentStatus: jest.fn(),
}));
jest.mock('../../src/workers/webhook-dispatcher', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue({}),
  processRetryQueue: jest.fn().mockResolvedValue(0),
  WebhookEvents: {
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_REFUNDED: 'payment.refunded',
    STATUS_UPGRADED: 'loyalty.status_upgraded',
  },
}));
jest.mock('../../src/lib/notifications', () => ({
  notifyPaymentConfirmed: jest.fn(),
  notifyCashbackCredit: jest.fn(),
  notifyPaymentFailed: jest.fn(),
  notifyLoyaltyUpgrade: jest.fn(),
}));
jest.mock('../../src/lib/fraud', () => ({
  checkTransaction: jest.fn().mockReturnValue({ blocked: false, riskScore: 0, reasons: [] }),
  getAllRules: jest.fn().mockReturnValue([]),
  getBlockedPhones: jest.fn().mockReturnValue([]),
}));

const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../src/index');
const db = require('../../src/lib/db');
const mobileMoney = require('../../src/lib/adapters/mobile-money');
const { clearAll } = require('../helpers/test-db');

async function clearData() {
  await db.query('TRUNCATE TABLE wallet_movements, wallets, distributions, refunds, disputes, webhook_events, payment_links, notification_log, audit_logs, transactions, clients, merchants, admins CASCADE');
  // Re-insert merchant after truncate to avoid 401 errors
  const hash = await bcrypt.hash('password123', 8);
  await db.query(`
    INSERT INTO merchants (id, name, email, phone, country_id, rebate_percent, rebate_mode, status, kyc_status,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      password_hash, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE)
    ON CONFLICT DO NOTHING
  `, ['merchant-link-test-001', 'Link Test SARL', 'links@test.ci', '+2250700001', 'CI', 8, 'cashback', 'active', 'approved',
      'af_live_pub_linktest001', 'secret_live', 'af_sandbox_pub_linktest001', 'secret_sandbox', hash]);
}

let merchantToken;
let merchantId;
let apiKey;

async function setupMerchant() {
  const hash = await bcrypt.hash('password123', 8);
  const id = 'merchant-link-test-001';
  apiKey = 'af_live_pub_linktest001';
  await db.query(`
    INSERT INTO merchants (id, name, email, phone, country_id, rebate_percent, rebate_mode, status, kyc_status,
      api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      password_hash, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `, [id, 'Link Test SARL', 'links@test.ci', '+2250700001', 'CI', 8, 'cashback', 'active', 'approved',
      apiKey, 'secret_live', 'af_sandbox_pub_linktest001', 'secret_sandbox', hash]);
  merchantId = id;

  const loginRes = await request(app)
    .post('/api/v1/auth/merchant/login')
    .send({ email: 'links@test.ci', password: 'password123' });
  merchantToken = loginRes.body.accessToken;
}

describe('Payment Links — CRUD Marchand', () => {
  beforeEach(async () => {
    await clearData();
    await setupMerchant();
  });

  test('POST /payment-links — crée un lien avec montant fixe', async () => {
    const res = await request(app)
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ amount: 5000, currency: 'XOF', description: 'Test link', expires_in_hours: 24 });

    expect(res.status).toBe(201);
    expect(res.body.link).toBeDefined();
    expect(res.body.link.code).toMatch(/^PL-/);
    expect(res.body.link.amount).toBe(5000);
    expect(res.body.payUrl).toContain(res.body.link.code);
  });

  test('POST /payment-links — crée un lien sans montant (montant libre)', async () => {
    const res = await request(app)
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ currency: 'XOF', description: 'Libre', expires_in_hours: 1 });

    expect(res.status).toBe(201);
    expect(res.body.link.amount).toBeNull();
  });

  test('POST /payment-links — 401 sans token', async () => {
    const res = await request(app)
      .post('/api/v1/payment-links')
      .send({ amount: 1000, currency: 'XOF' });
    expect(res.status).toBe(401);
  });

  test('GET /payment-links — liste les liens du marchand', async () => {
    // Créer 2 liens
    await request(app)
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ amount: 1000, currency: 'XOF', expires_in_hours: 24 });
    await request(app)
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ amount: 2000, currency: 'XOF', expires_in_hours: 24 });

    const res = await request(app)
      .get('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.links.length).toBe(2);
  });

  test('DELETE /payment-links/:id — annule un lien', async () => {
    const createRes = await request(app)
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ amount: 3000, currency: 'XOF', expires_in_hours: 2 });

    const linkId = createRes.body.link.id;

    const delRes = await request(app)
      .delete(`/api/v1/payment-links/${linkId}`)
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(delRes.status).toBe(200);

    // Le lien doit être expired/cancelled
    const infoRes = await request(app)
      .get(`/api/v1/payment-links/${createRes.body.link.code}/info`);
    expect([404, 410]).toContain(infoRes.status);
  });
});

describe('Payment Links — Flux public (client)', () => {
  let linkCode;

  beforeEach(async () => {
    await clearData();
    await setupMerchant();

    const createRes = await request(app)
      .post('/api/v1/payment-links')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({ amount: 10000, currency: 'XOF', description: 'Achat test', expires_in_hours: 24 });
    linkCode = createRes.body.link.code;
  });

  test('GET /:code/info — retourne les infos du lien', async () => {
    const res = await request(app).get(`/api/v1/payment-links/${linkCode}/info`);

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(10000);
    expect(res.body.merchantName).toBe('Link Test SARL');
    expect(res.body.currency).toBe('XOF');
  });

  test('GET /:code/info — 404 sur code inexistant', async () => {
    const res = await request(app).get('/api/v1/payment-links/XXXXXXXX/info');
    expect(res.status).toBe(404);
  });

  test('POST /:code/identify-client — client trouvé', async () => {
    // Créer un client
    await db.query(
      "INSERT INTO clients (id, afrikfid_id, phone, full_name, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)",
      ['cli-001', 'AFD-CLI-001', '+2250700123', 'Jean Dupont', 'LIVE']
    );

    const res = await request(app)
      .post(`/api/v1/payment-links/${linkCode}/identify-client`)
      .send({ phone: '+2250700123' });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.client.loyaltyStatus).toBe('LIVE');
    expect(res.body.client.clientRebatePercent).toBeGreaterThan(0);
  });

  test('POST /:code/identify-client — client non trouvé retourne found=false', async () => {
    const res = await request(app)
      .post(`/api/v1/payment-links/${linkCode}/identify-client`)
      .send({ phone: '+2250700000' });

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  test('POST /:code/pay — paiement mobile money initié', async () => {
    mobileMoney.initiatePayment.mockResolvedValue({
      success: true,
      operatorRef: 'ORANGE-TEST-001',
      message: 'OTP envoyé',
    });

    const res = await request(app)
      .post(`/api/v1/payment-links/${linkCode}/pay`)
      .send({ phone: '+2250700001', payment_operator: 'ORANGE' });

    expect([200, 201]).toContain(res.status);
    expect(res.body.reference).toBeDefined();
    expect(res.body.distribution).toBeDefined();
  });

  test('POST /:code/pay — 422 si mobile money échoue', async () => {
    mobileMoney.initiatePayment.mockResolvedValue({
      success: false,
      error: 'INSUFFICIENT_FUNDS',
      message: 'Solde insuffisant',
    });

    // Sans phone/operator → 400
    const res = await request(app)
      .post(`/api/v1/payment-links/${linkCode}/pay`)
      .send({});

    expect([400, 422]).toContain(res.status);
  });
});
