'use strict';

/**
 * Tests d'intégration — Moteur d'abonnements marchands.
 * Couvre : devis (quote), upgrade prorata, paiement avance, downgrade auto à expiration,
 *           rappels idempotents.
 */

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));
jest.mock('../../src/workers/webhook-dispatcher', () => ({
  dispatchWebhook: jest.fn().mockResolvedValue({}),
  processRetryQueue: jest.fn().mockResolvedValue(0),
  WebhookEvents: {},
}));

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../../src/lib/db');
const engine = require('../../src/lib/subscription-engine');
const { PACKAGE_PRICES_FCFA } = require('../../src/config/constants');

async function clearSubData() {
  await db.query('TRUNCATE TABLE subscription_notifications, subscription_package_changes, subscription_periods, subscription_payments, subscriptions, merchants CASCADE');
}

async function makeMerchant(id = 'mrc-sub-01') {
  const hash = await bcrypt.hash('pass123', 8);
  await db.query(`
    INSERT INTO merchants (id, name, email, phone, country_id, rebate_percent, rebate_mode,
      status, kyc_status, api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
      password_hash, is_active, package)
    VALUES ($1,'Sub Test','sub@test.ci','+2250712345678','CI',5,'cashback','active','approved',
      'pub','sec','sb_pub','sb_sec',$2,TRUE,'STARTER_BOOST')
    ON CONFLICT (id) DO NOTHING
  `, [id, hash]);
  return id;
}

beforeAll(async () => {
  // Engine attend les nouvelles colonnes — appliquer la migration manuellement si test pg réel
  // (le mock SQLite l'a déjà via __mocks__/db.js si applicable)
});

beforeEach(async () => {
  await clearSubData();
});

afterAll(async () => {
  if (db.pool && db.pool.end) await db.pool.end();
});

describe('subscription-engine', () => {
  test('getOrCreateSubscription crée une subscription STARTER_BOOST par défaut', async () => {
    const id = await makeMerchant();
    const sub = await engine.getOrCreateSubscription(id);
    expect(sub.package).toBe('STARTER_BOOST');
    expect(sub.billing_cycle).toBe('monthly');
    expect(sub.current_period_end).toBeTruthy();
  });

  test('quoteCheckout — renouvellement annuel = mensuel × 11', async () => {
    const id = await makeMerchant();
    // Forcer aucune période active : on simule un marchand sans période ouverte
    const sub = await engine.getOrCreateSubscription(id);
    await db.query(`UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 day' WHERE id = $1`, [sub.id]);

    const quote = await engine.quoteCheckout(id, { package: 'PREMIUM', billing_cycle: 'annual', mode: 'auto' });
    expect(quote.kind).toBe('renewal');
    expect(quote.amount).toBe(PACKAGE_PRICES_FCFA.PREMIUM * 11);
  });

  test('quoteCheckout — upgrade prorata sur période en cours', async () => {
    const id = await makeMerchant();
    const sub = await engine.getOrCreateSubscription(id);
    // Forcer STARTER_PLUS, période 30j à mi-vie
    await db.query(
      `UPDATE subscriptions SET package='STARTER_PLUS',
         current_period_start = NOW() - INTERVAL '15 days',
         current_period_end   = NOW() + INTERVAL '15 days'
       WHERE id = $1`, [sub.id]
    );
    const quote = await engine.quoteCheckout(id, { package: 'GROWTH', billing_cycle: 'monthly', mode: 'auto' });
    expect(quote.kind).toBe('upgrade_prorata');
    const diff = PACKAGE_PRICES_FCFA.GROWTH - PACKAGE_PRICES_FCFA.STARTER_PLUS;
    // ~50% restants → ~ diff/2 (tolérance large pour le timing)
    expect(quote.amount).toBeGreaterThan(diff * 0.4);
    expect(quote.amount).toBeLessThan(diff * 0.6);
  });

  test('applyPaidPayment — upgrade_prorata met à jour le package sans changer current_period_end', async () => {
    const id = await makeMerchant();
    const sub = await engine.getOrCreateSubscription(id);
    await db.query(
      `UPDATE subscriptions SET package='STARTER_PLUS',
         base_monthly_fee = $1, effective_monthly_fee = $1,
         current_period_start = NOW() - INTERVAL '10 days',
         current_period_end   = NOW() + INTERVAL '20 days'
       WHERE id = $2`,
      [PACKAGE_PRICES_FCFA.STARTER_PLUS, sub.id]
    );
    const fresh = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
    const oldEnd = fresh.current_period_end;
    const payment = await engine.createPendingPayment({
      subscription: fresh, kind: 'upgrade_prorata', package: 'GROWTH', billingCycle: 'monthly',
      amount: 5000, provider: 'stripe', providerRef: 'cs_test_x',
    });
    await engine.applyPaidPayment(payment);
    const after = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
    expect(after.package).toBe('GROWTH');
    expect(new Date(after.current_period_end).getTime()).toBe(new Date(oldEnd).getTime());
    const changes = (await db.query(`SELECT * FROM subscription_package_changes WHERE subscription_id = $1`, [sub.id])).rows;
    expect(changes.find(c => c.changed_by === 'merchant_upgrade')).toBeTruthy();
  });

  test('applyPaidPayment — advance ajoute une période en file', async () => {
    const id = await makeMerchant();
    const sub = await engine.getOrCreateSubscription(id);
    await db.query(
      `UPDATE subscriptions SET package='GROWTH',
         current_period_start = NOW(),
         current_period_end   = NOW() + INTERVAL '30 days'
       WHERE id = $1`, [sub.id]
    );
    const fresh = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
    const payment = await engine.createPendingPayment({
      subscription: fresh, kind: 'advance', package: 'GROWTH', billingCycle: 'monthly',
      amount: PACKAGE_PRICES_FCFA.GROWTH, provider: 'mobile_money', providerRef: 'mm_x',
    });
    await engine.applyPaidPayment(payment);
    const periods = await engine.listQueuedPeriods(sub.id);
    const advance = periods.find(p => p.status === 'paid');
    expect(advance).toBeTruthy();
    expect(advance.package).toBe('GROWTH');
  });

  test('expireAndAdvance — bascule sur période en file, sinon STARTER_BOOST', async () => {
    const id = await makeMerchant();
    const sub = await engine.getOrCreateSubscription(id);
    // Marchand actuellement sur GROWTH expiré, avec une période STARTER_PLUS d'avance
    await db.query(
      `UPDATE subscriptions SET package='GROWTH',
         current_period_start = NOW() - INTERVAL '31 days',
         current_period_end   = NOW() - INTERVAL '1 minute'
       WHERE id = $1`, [sub.id]
    );
    await db.query(
      `INSERT INTO subscription_periods (id, subscription_id, merchant_id, package, billing_cycle,
         period_start, period_end, amount_paid, currency, status)
       VALUES ($1,$2,$3,'STARTER_PLUS','monthly',$4,$5,19900,'XOF','paid')`,
      [uuidv4(), sub.id, id, new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)]
    );
    const fresh = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
    const r = await engine.expireAndAdvance(fresh);
    expect(r.changed).toBe(true);
    expect(r.newPackage).toBe('STARTER_PLUS');

    // Maintenant aucune période → downgrade STARTER_BOOST
    await db.query(
      `UPDATE subscriptions SET current_period_end = NOW() - INTERVAL '1 minute' WHERE id = $1`, [sub.id]
    );
    const fresh2 = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [sub.id])).rows[0];
    const r2 = await engine.expireAndAdvance(fresh2);
    expect(r2.newPackage).toBe('STARTER_BOOST');
    expect(r2.downgraded).toBe(true);
  });

  test('recordReminderSent — idempotent par (sub, kind, channel, period_end_ref)', async () => {
    const id = await makeMerchant();
    const sub = await engine.getOrCreateSubscription(id);
    const ref = new Date('2030-01-01T00:00:00Z');
    expect(await engine.recordReminderSent(sub.id, 'reminder_d10', 'email', ref)).toBe(true);
    const second = await engine.recordReminderSent(sub.id, 'reminder_d10', 'email', ref);
    expect(second).toBe(false);
    expect(await engine.alreadySent(sub.id, 'reminder_d10', 'email', ref)).toBe(true);
  });
});
