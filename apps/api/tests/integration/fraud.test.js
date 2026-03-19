'use strict';

/**
 * Tests d'intégration — Fraude (règles + blacklist + vérification transaction)
 */

jest.mock('../../src/lib/db');
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

async function clearData() {
  await db.query('TRUNCATE TABLE wallet_movements, wallets, distributions, refunds, disputes, webhook_events, payment_links, notification_log, audit_logs, transactions, clients, merchants, admins CASCADE');
}

async function getAdminToken() {
  const hash = await bcrypt.hash('admin123', 8);
  db.prepare("INSERT INTO admins (id, email, password_hash, role, full_name) VALUES ('adm-fraud', 'admin@fraud.ci', ?, 'super_admin', 'Admin Test')").run(hash);
  const res = await request(app).post('/api/v1/auth/admin/login').send({ email: 'admin@fraud.ci', password: 'admin123' });
  return res.body.accessToken;
}

describe('Fraude — Règles anti-fraude', () => {
  let adminToken;

  beforeEach(async () => {
    clearData();
    adminToken = await getAdminToken();
  });

  test('GET /fraud/rules — retourne les règles (liste vide initialement)', async () => {
    const res = await request(app)
      .get('/api/v1/fraud/rules')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rules).toBeInstanceOf(Array);
  });

  test('POST /fraud/rules — crée une règle', async () => {
    const res = await request(app)
      .post('/api/v1/fraud/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Limite CI', rule_type: 'max_amount_per_tx', value: 2000000 });

    expect(res.status).toBe(201);
    expect(res.body.rule.name).toBe('Limite CI');
    expect(res.body.rule.rule_type).toBe('max_amount_per_tx');
    expect(res.body.rule.is_active).toBe(1);
  });

  test('POST /fraud/rules — 400 si value manquante', async () => {
    const res = await request(app)
      .post('/api/v1/fraud/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Manquant', rule_type: 'max_amount_per_tx' });

    expect(res.status).toBe(400);
  });

  test('POST /fraud/rules — 400 si value <= 0', async () => {
    const res = await request(app)
      .post('/api/v1/fraud/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Négatif', rule_type: 'max_tx_per_hour', value: -5 });

    expect(res.status).toBe(400);
  });

  test('PATCH /fraud/rules/:id/toggle — désactive une règle', async () => {
    const createRes = await request(app)
      .post('/api/v1/fraud/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'À désactiver', rule_type: 'max_tx_per_day', value: 20 });

    const id = createRes.body.rule.id;

    const res = await request(app)
      .patch(`/api/v1/fraud/rules/${id}/toggle`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });

    expect(res.status).toBe(200);

    const listRes = await request(app).get('/api/v1/fraud/rules').set('Authorization', `Bearer ${adminToken}`);
    const rule = listRes.body.rules.find(r => r.id === id);
    expect(rule.is_active).toBe(0);
  });

  test('DELETE /fraud/rules/:id — supprime une règle', async () => {
    const createRes = await request(app)
      .post('/api/v1/fraud/rules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'À supprimer', rule_type: 'max_failed_attempts', value: 3 });

    const id = createRes.body.rule.id;

    const res = await request(app)
      .delete(`/api/v1/fraud/rules/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const listRes = await request(app).get('/api/v1/fraud/rules').set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.rules.find(r => r.id === id)).toBeUndefined();
  });

  test('GET /fraud/rules — 401 sans token admin', async () => {
    const res = await request(app).get('/api/v1/fraud/rules');
    expect(res.status).toBe(401);
  });
});

describe('Fraude — Blacklist téléphones', () => {
  let adminToken;

  beforeEach(async () => {
    clearData();
    adminToken = await getAdminToken();
  });

  test('GET /fraud/blocked-phones — liste vide initialement', async () => {
    const res = await request(app)
      .get('/api/v1/fraud/blocked-phones')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.phones).toBeInstanceOf(Array);
    expect(res.body.phones.length).toBe(0);
  });

  test('POST /fraud/blocked-phones — bloque un numéro', async () => {
    const res = await request(app)
      .post('/api/v1/fraud/blocked-phones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '+2250700000001', reason: 'Fraude détectée' });

    expect(res.status).toBe(201);
    expect(res.body.phone).toBe('+2250700000001');
  });

  test('POST /fraud/blocked-phones — 400 si phone manquant', async () => {
    const res = await request(app)
      .post('/api/v1/fraud/blocked-phones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Sans numéro' });

    expect(res.status).toBe(400);
  });

  test('DELETE /fraud/blocked-phones/:phone — débloque un numéro', async () => {
    await request(app)
      .post('/api/v1/fraud/blocked-phones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '+2250700000002' });

    const res = await request(app)
      .delete('/api/v1/fraud/blocked-phones/%2B2250700000002')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    const listRes = await request(app).get('/api/v1/fraud/blocked-phones').set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.body.phones.find(p => p.phone === '+2250700000002')).toBeUndefined();
  });

  test('DELETE /fraud/blocked-phones/:phone — 404 si numéro inconnu', async () => {
    const res = await request(app)
      .delete('/api/v1/fraud/blocked-phones/%2B2250799999999')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
