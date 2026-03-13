'use strict';

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));

const db = require('../../src/lib/db');
const {
  calculateDistribution,
  getClientRebatePercent,
  evaluateClientStatus,
  applyStatusChange,
  runLoyaltyBatch,
} = require('../../src/lib/loyalty-engine');

async function clearData() {
  await db.query('DELETE FROM wallet_movements');
  await db.query('DELETE FROM wallets');
  await db.query('DELETE FROM distributions');
  await db.query('DELETE FROM transactions');
  await db.query('DELETE FROM clients');
  await db.query('DELETE FROM merchants');
  await db.query('DELETE FROM admins');
}

// ─── calculateDistribution ───────────────────────────────────────────────────

describe('calculateDistribution', () => {
  test('OPEN: Y=0%, Z=X%', async () => {
    const r = await calculateDistribution(100000, 10, 'OPEN');
    expect(r.clientRebatePercent).toBe(0);
    expect(r.platformCommissionPercent).toBe(10);
    expect(r.merchantReceives).toBe(90000);
    expect(r.isValid).toBe(true);
  });

  test('LIVE: Y=5%, Z=5%', async () => {
    const r = await calculateDistribution(100000, 10, 'LIVE');
    expect(r.clientRebatePercent).toBe(5);
    expect(r.platformCommissionPercent).toBe(5);
    expect(r.merchantReceives).toBe(90000);
  });

  test('GOLD: Y=8%, Z=2%', async () => {
    const r = await calculateDistribution(100000, 10, 'GOLD');
    expect(r.clientRebatePercent).toBe(8);
    expect(r.platformCommissionPercent).toBe(2);
    expect(r.merchantReceives).toBe(90000);
  });

  test('ROYAL: Y=10%, Z=0%', async () => {
    const r = await calculateDistribution(100000, 10, 'ROYAL');
    expect(r.clientRebatePercent).toBe(10);
    expect(r.platformCommissionPercent).toBe(0);
    expect(r.merchantReceives).toBe(90000);
  });

  test('merchantReceives identique pour tous les statuts', async () => {
    const statuses = ['OPEN', 'LIVE', 'GOLD', 'ROYAL'];
    const receives = await Promise.all(
      statuses.map((s) => calculateDistribution(150000, 8, s).then(r => r.merchantReceives))
    );
    expect(new Set(receives).size).toBe(1);
  });

  test('Plafonnement Y<=X: ROYAL avec X=5%', async () => {
    const r = await calculateDistribution(100000, 5, 'ROYAL');
    expect(r.clientRebatePercent).toBe(5);
    expect(r.platformCommissionPercent).toBe(0);
    expect(r.yExceedsX).toBe(true);
  });

  test('Arrondi 2 decimales', async () => {
    const r = await calculateDistribution(33333, 7, 'LIVE');
    expect(r.merchantRebateAmount).toBe(2333.31);
    expect(r.clientRebateAmount).toBe(1666.65);
  });

  test('X=0% => merchantReceives = grossAmount', async () => {
    const r = await calculateDistribution(100000, 0, 'ROYAL');
    expect(r.clientRebatePercent).toBe(0);
    expect(r.merchantReceives).toBe(100000);
  });

  test('Statut inconnu => Y=0%', async () => {
    expect((await calculateDistribution(100000, 10, 'UNKNOWN')).clientRebatePercent).toBe(0);
  });
});

// ─── getClientRebatePercent ──────────────────────────────────────────────────

describe('getClientRebatePercent', () => {
  test.each([
    ['OPEN', 0],
    ['LIVE', 5],
    ['GOLD', 8],
    ['ROYAL', 12],
    ['INCONNU', 0],
  ])('statut %s => %i%', async (s, expected) => {
    expect(await getClientRebatePercent(s)).toBe(expected);
  });
});

// ─── evaluateClientStatus ────────────────────────────────────────────────────

describe('evaluateClientStatus', () => {
  beforeEach(async () => {
    await clearData();
  });

  async function createClient(id, status) {
    const st = status || 'OPEN';
    const phone = '+225990' + String(id.charCodeAt(0)).slice(-3).padStart(3, '0') + id.slice(-2).padStart(2, '0');
    await db.query(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
      [id, 'AFD-' + id, 'Test ' + id, phone, st]
    );
  }

  async function addTx(clientId, amount, daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - (daysAgo || 5));
    await db.query(
      'INSERT INTO transactions (id, reference, merchant_id, client_id, gross_amount, net_client_amount, merchant_rebate_percent, client_rebate_percent, platform_commission_percent, merchant_rebate_amount, client_rebate_amount, platform_commission_amount, merchant_receives, rebate_mode, payment_method, status, initiated_at) VALUES ($1, $2, $3, $4, $5, $6, 10, 5, 5, $7, $8, $9, $10, $11, $12, $13, $14)',
      [
        'tx-' + Math.random().toString(36).slice(2),
        'REF-' + Math.random().toString(36).slice(2),
        'mx', clientId, amount, amount * 0.95,
        amount * 0.1, amount * 0.05, amount * 0.05, amount * 0.9,
        'cashback', 'mobile_money', 'completed', d.toISOString()
      ]
    );
  }

  test('Client inexistant => null', async () => {
    expect(await evaluateClientStatus('nobody')).toBeNull();
  });

  test('Aucun achat => reste OPEN, changed=false', async () => {
    await createClient('c1');
    const r = await evaluateClientStatus('c1');
    expect(r.newStatus).toBe('OPEN');
    expect(r.changed).toBe(false);
  });

  test('3 achats en 3 mois => OPEN vers LIVE', async () => {
    await createClient('c2', 'OPEN');
    await addTx('c2', 20000, 5);
    await addTx('c2', 20000, 10);
    await addTx('c2', 20000, 15);
    const r = await evaluateClientStatus('c2');
    expect(r.newStatus).toBe('LIVE');
    expect(r.changed).toBe(true);
  });

  test('10 achats >= 200K en 6 mois => GOLD', async () => {
    await createClient('c3', 'LIVE');
    for (let i = 0; i < 10; i++) await addTx('c3', 25000, i * 15 + 1);
    expect((await evaluateClientStatus('c3')).newStatus).toBe('GOLD');
  });

  test('Statut deja correct => changed=false', async () => {
    await createClient('c4', 'LIVE');
    await addTx('c4', 20000, 5);
    await addTx('c4', 20000, 10);
    await addTx('c4', 20000, 15);
    expect((await evaluateClientStatus('c4')).changed).toBe(false);
  });
});

// ─── applyStatusChange ───────────────────────────────────────────────────────

describe('applyStatusChange', () => {
  beforeEach(async () => {
    await clearData();
  });

  test('Met a jour loyalty_status en base', async () => {
    await db.query(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
      ['asc1', 'AFD-ASC1', 'Alice', '+22599000201', 'OPEN']
    );
    await applyStatusChange('asc1', 'GOLD');
    const c = (await db.query('SELECT loyalty_status FROM clients WHERE id = $1', ['asc1'])).rows[0];
    expect(c.loyalty_status).toBe('GOLD');
  });
});

// ─── runLoyaltyBatch ─────────────────────────────────────────────────────────

describe('runLoyaltyBatch', () => {
  beforeEach(async () => {
    await clearData();
  });

  test('Aucun changement => tableau vide', async () => {
    await db.query(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
      ['rb1', 'AFD-RB1', 'Bob', '+22599000202', 'OPEN']
    );
    expect(await runLoyaltyBatch()).toEqual([]);
  });

  test('Client eligible => changement persiste', async () => {
    await db.query(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES ($1, $2, $3, $4, $5, TRUE)',
      ['rb2', 'AFD-RB2', 'Charlie', '+22599000203', 'OPEN']
    );

    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - (i + 1));
      await db.query(
        'INSERT INTO transactions (id, reference, merchant_id, client_id, gross_amount, net_client_amount, merchant_rebate_percent, client_rebate_percent, platform_commission_percent, merchant_rebate_amount, client_rebate_amount, platform_commission_amount, merchant_receives, rebate_mode, payment_method, status, initiated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
        [
          'tx-rb2-' + i, 'REF-rb2-' + i, 'mx', 'rb2',
          20000, 19000, 10, 5, 5, 2000, 1000, 1000, 18000,
          'cashback', 'mobile_money', 'completed', d.toISOString()
        ]
      );
    }

    const results = await runLoyaltyBatch();
    expect(results.some((r) => r.clientId === 'rb2' && r.newStatus === 'LIVE')).toBe(true);
    const row = (await db.query('SELECT loyalty_status FROM clients WHERE id = $1', ['rb2'])).rows[0];
    expect(row.loyalty_status).toBe('LIVE');
  });
});
