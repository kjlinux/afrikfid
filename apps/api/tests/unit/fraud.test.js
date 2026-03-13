'use strict';

/**
 * Tests unitaires — Détection de fraude (lib/fraud.js)
 */

jest.mock('../../src/lib/migrations', () => ({ runMigrations: jest.fn().mockResolvedValue() }));

const db = require('../../src/lib/db');
const { checkTransaction, computeRiskScore, isPhoneBlocked, createRule, getAllRules, blockPhone, getBlockedPhones } = require('../../src/lib/fraud');

async function clearFraudData() {
  await db.query('DELETE FROM fraud_rules');
  await db.query('DELETE FROM blocked_phones');
  await db.query('DELETE FROM transactions');
}

describe('checkTransaction — Blacklist téléphone', () => {
  beforeEach(async () => {
    await clearFraudData();
  });

  test('bloque si téléphone est dans la blacklist', async () => {
    await blockPhone('+2250700000001', 'Test');
    const result = await checkTransaction({ amount: 1000, clientPhone: '+2250700000001' });
    expect(result.blocked).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.reason).toMatch(/liste noire/i);
  });

  test('autorise si téléphone n\'est pas bloqué', async () => {
    const result = await checkTransaction({ amount: 1000, clientPhone: '+2250700000002' });
    expect(result.blocked).toBe(false);
  });

  test('autorise si phone est null', async () => {
    const result = await checkTransaction({ amount: 1000, clientPhone: null });
    expect(result.blocked).toBe(false);
  });
});

describe('checkTransaction — Montant maximum', () => {
  beforeEach(async () => {
    await clearFraudData();
  });

  test('bloque si montant dépasse le seuil par défaut (5 000 000)', async () => {
    const result = await checkTransaction({ amount: 6000000, clientPhone: '+2250700003' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/seuil/i);
  });

  test('autorise si montant en dessous du seuil', async () => {
    const result = await checkTransaction({ amount: 4999999, clientPhone: '+2250700004' });
    expect(result.blocked).toBe(false);
  });

  test('utilise la règle DB si elle existe (seuil réduit à 100 000)', async () => {
    await createRule({ name: 'Petit seuil', rule_type: 'max_amount_per_tx', value: 100000 });
    const result = await checkTransaction({ amount: 200000, clientPhone: '+2250700005' });
    expect(result.blocked).toBe(true);
  });
});

describe('computeRiskScore — Score de risque', () => {
  beforeEach(async () => {
    await clearFraudData();
  });

  test('score = 0 pour transaction normale sans historique', async () => {
    const { score } = await computeRiskScore({ amount: 5000, clientId: null });
    expect(score).toBe(0);
  });

  test('score augmente si montant proche du seuil max (80%+)', async () => {
    const { score } = await computeRiskScore({ amount: 4200000, clientId: null }); // 84% de 5M
    expect(score).toBeGreaterThan(0);
  });

  test('score cappé à 100', async () => {
    await blockPhone('+2250700010', 'Test score cap');
    // forcer un score max
    const { score } = await computeRiskScore({ amount: 9999999, clientId: null });
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('isPhoneBlocked', () => {
  beforeEach(async () => {
    await clearFraudData();
  });

  test('retourne false pour numéro non bloqué', async () => {
    expect(await isPhoneBlocked('+2250700100')).toBe(false);
  });

  test('retourne true après blocage', async () => {
    await blockPhone('+2250700200', 'Suspicious');
    expect(await isPhoneBlocked('+2250700200')).toBe(true);
  });

  test('retourne false pour null', async () => {
    expect(await isPhoneBlocked(null)).toBe(false);
  });
});

describe('Gestion des règles', () => {
  beforeEach(async () => {
    await clearFraudData();
  });

  test('createRule crée une règle active', async () => {
    const rule = await createRule({ name: 'Règle test', rule_type: 'max_tx_per_hour', value: 5 });
    expect(rule.name).toBe('Règle test');
    expect(rule.is_active).toBe(true);
    expect(parseFloat(rule.value)).toBe(5);
  });

  test('getAllRules retourne toutes les règles', async () => {
    await createRule({ name: 'R1', rule_type: 'max_tx_per_day', value: 10 });
    await createRule({ name: 'R2', rule_type: 'max_amount_per_day', value: 500000 });
    const rules = await getAllRules();
    expect(rules.length).toBe(2);
  });

  test('getBlockedPhones retourne la liste des numéros bloqués', async () => {
    await blockPhone('+22500001', 'R1');
    await blockPhone('+22500002', 'R2');
    const phones = await getBlockedPhones();
    expect(phones.length).toBe(2);
    expect(phones.some(p => p.phone === '+22500001')).toBe(true);
  });
});
