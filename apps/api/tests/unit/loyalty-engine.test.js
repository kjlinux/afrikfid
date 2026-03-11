'use strict';

jest.mock('../../src/lib/db');

const db = require('../../src/lib/db');
const {
  calculateDistribution,
  getClientRebatePercent,
  evaluateClientStatus,
  applyStatusChange,
  runLoyaltyBatch,
} = require('../../src/lib/loyalty-engine');

function clearData() {
  db.exec([
    'DELETE FROM wallet_movements',
    'DELETE FROM wallets',
    'DELETE FROM distributions',
    'DELETE FROM transactions',
    'DELETE FROM clients',
    'DELETE FROM merchants',
    'DELETE FROM admins',
  ].join('; '));
}

// ─── calculateDistribution ───────────────────────────────────────────────────

describe('calculateDistribution', () => {
  test('OPEN: Y=0%, Z=X%', () => {
    const r = calculateDistribution(100000, 10, 'OPEN');
    expect(r.clientRebatePercent).toBe(0);
    expect(r.platformCommissionPercent).toBe(10);
    expect(r.merchantReceives).toBe(90000);
    expect(r.isValid).toBe(true);
  });

  test('LIVE: Y=5%, Z=5%', () => {
    const r = calculateDistribution(100000, 10, 'LIVE');
    expect(r.clientRebatePercent).toBe(5);
    expect(r.platformCommissionPercent).toBe(5);
    expect(r.merchantReceives).toBe(90000);
  });

  test('GOLD: Y=8%, Z=2%', () => {
    const r = calculateDistribution(100000, 10, 'GOLD');
    expect(r.clientRebatePercent).toBe(8);
    expect(r.platformCommissionPercent).toBe(2);
    expect(r.merchantReceives).toBe(90000);
  });

  test('ROYAL: Y=10%, Z=0%', () => {
    const r = calculateDistribution(100000, 10, 'ROYAL');
    expect(r.clientRebatePercent).toBe(10);
    expect(r.platformCommissionPercent).toBe(0);
    expect(r.merchantReceives).toBe(90000);
  });

  test('merchantReceives identique pour tous les statuts', () => {
    const statuses = ['OPEN', 'LIVE', 'GOLD', 'ROYAL'];
    const receives = statuses.map((s) => calculateDistribution(150000, 8, s).merchantReceives);
    expect(new Set(receives).size).toBe(1);
  });

  test('Plafonnement Y<=X: ROYAL avec X=5%', () => {
    const r = calculateDistribution(100000, 5, 'ROYAL');
    expect(r.clientRebatePercent).toBe(5);
    expect(r.platformCommissionPercent).toBe(0);
    expect(r.yExceedsX).toBe(true);
  });

  test('Arrondi 2 decimales', () => {
    const r = calculateDistribution(33333, 7, 'LIVE');
    expect(r.merchantRebateAmount).toBe(2333.31);
    expect(r.clientRebateAmount).toBe(1666.65);
  });

  test('X=0% => merchantReceives = grossAmount', () => {
    const r = calculateDistribution(100000, 0, 'ROYAL');
    expect(r.clientRebatePercent).toBe(0);
    expect(r.merchantReceives).toBe(100000);
  });

  test('Statut inconnu => Y=0%', () => {
    expect(calculateDistribution(100000, 10, 'UNKNOWN').clientRebatePercent).toBe(0);
  });
});

// ─── getClientRebatePercent ──────────────────────────────────────────────────

describe('getClientRebatePercent', () => {
  test.each([
    ['OPEN', 0],
    ['LIVE', 5],
    ['GOLD', 8],
    ['ROYAL', 10],
    ['INCONNU', 0],
  ])('statut %s => %i%', (s, expected) => {
    expect(getClientRebatePercent(s)).toBe(expected);
  });
});

// ─── evaluateClientStatus ────────────────────────────────────────────────────

describe('evaluateClientStatus', () => {
  beforeEach(() => clearData());

  function createClient(id, status) {
    const st = status || 'OPEN';
    const phone = '+225990' + String(id.charCodeAt(0)).slice(-3).padStart(3, '0') + id.slice(-2).padStart(2, '0');
    db.prepare(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(id, 'AFD-' + id, 'Test ' + id, phone, st);
  }

  function addTx(clientId, amount, daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - (daysAgo || 5));
    db.prepare(
      'INSERT INTO transactions (id, reference, merchant_id, client_id, gross_amount, net_client_amount, merchant_rebate_percent, client_rebate_percent, platform_commission_percent, merchant_rebate_amount, client_rebate_amount, platform_commission_amount, merchant_receives, rebate_mode, payment_method, status, initiated_at) VALUES (?, ?, ?, ?, ?, ?, 10, 5, 5, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'tx-' + Math.random().toString(36).slice(2),
      'REF-' + Math.random().toString(36).slice(2),
      'mx', clientId, amount, amount * 0.95,
      amount * 0.1, amount * 0.05, amount * 0.05, amount * 0.9,
      'cashback', 'mobile_money', 'completed', d.toISOString()
    );
  }

  test('Client inexistant => null', () => {
    expect(evaluateClientStatus('nobody')).toBeNull();
  });

  test('Aucun achat => reste OPEN, changed=false', () => {
    createClient('c1');
    const r = evaluateClientStatus('c1');
    expect(r.newStatus).toBe('OPEN');
    expect(r.changed).toBe(false);
  });

  test('3 achats en 3 mois => OPEN vers LIVE', () => {
    createClient('c2', 'OPEN');
    addTx('c2', 20000, 5);
    addTx('c2', 20000, 10);
    addTx('c2', 20000, 15);
    const r = evaluateClientStatus('c2');
    expect(r.newStatus).toBe('LIVE');
    expect(r.changed).toBe(true);
  });

  test('10 achats >= 200K en 6 mois => GOLD', () => {
    createClient('c3', 'LIVE');
    for (let i = 0; i < 10; i++) addTx('c3', 25000, i * 15 + 1);
    expect(evaluateClientStatus('c3').newStatus).toBe('GOLD');
  });

  test('Statut deja correct => changed=false', () => {
    createClient('c4', 'LIVE');
    addTx('c4', 20000, 5);
    addTx('c4', 20000, 10);
    addTx('c4', 20000, 15);
    expect(evaluateClientStatus('c4').changed).toBe(false);
  });
});

// ─── applyStatusChange ───────────────────────────────────────────────────────

describe('applyStatusChange', () => {
  beforeEach(() => clearData());

  test('Met a jour loyalty_status en base', () => {
    db.prepare(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run('asc1', 'AFD-ASC1', 'Alice', '+22599000201', 'OPEN');
    applyStatusChange('asc1', 'GOLD');
    const c = db.prepare('SELECT loyalty_status FROM clients WHERE id = ?').get('asc1');
    expect(c.loyalty_status).toBe('GOLD');
  });
});

// ─── runLoyaltyBatch ─────────────────────────────────────────────────────────

describe('runLoyaltyBatch', () => {
  beforeEach(() => clearData());

  test('Aucun changement => tableau vide', () => {
    db.prepare(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run('rb1', 'AFD-RB1', 'Bob', '+22599000202', 'OPEN');
    expect(runLoyaltyBatch()).toEqual([]);
  });

  test('Client eligible => changement persiste', () => {
    db.prepare(
      'INSERT INTO clients (id, afrikfid_id, full_name, phone, loyalty_status, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run('rb2', 'AFD-RB2', 'Charlie', '+22599000203', 'OPEN');

    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - (i + 1));
      db.prepare(
        'INSERT INTO transactions (id, reference, merchant_id, client_id, gross_amount, net_client_amount, merchant_rebate_percent, client_rebate_percent, platform_commission_percent, merchant_rebate_amount, client_rebate_amount, platform_commission_amount, merchant_receives, rebate_mode, payment_method, status, initiated_at) VALUES (?, ?, ?, ?, ?, ?, 10, 5, 5, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'tx-rb2-' + i, 'REF-rb2-' + i, 'mx', 'rb2',
        20000, 19000, 2000, 1000, 1000, 18000,
        'cashback', 'mobile_money', 'completed', d.toISOString()
      );
    }

    const results = runLoyaltyBatch();
    expect(results.some((r) => r.clientId === 'rb2' && r.newStatus === 'LIVE')).toBe(true);
    expect(
      db.prepare('SELECT loyalty_status FROM clients WHERE id = ?').get('rb2').loyalty_status
    ).toBe('LIVE');
  });
});
