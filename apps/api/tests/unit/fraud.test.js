'use strict';

/**
 * Tests unitaires — Détection de fraude (lib/fraud.js)
 */

jest.mock('../../src/lib/db');
jest.mock('../../src/lib/migrations', () => ({ runMigrations: () => {} }));

const db = require('../../src/lib/db');
const { checkTransaction, computeRiskScore, isPhoneBlocked, createRule, getAllRules, blockPhone, getBlockedPhones } = require('../../src/lib/fraud');

function clearFraudData() {
  db.exec('DELETE FROM fraud_rules; DELETE FROM blocked_phones; DELETE FROM transactions');
}

describe('checkTransaction — Blacklist téléphone', () => {
  beforeEach(clearFraudData);

  test('bloque si téléphone est dans la blacklist', () => {
    blockPhone('+2250700000001', 'Test');
    const result = checkTransaction({ amount: 1000, clientPhone: '+2250700000001' });
    expect(result.blocked).toBe(true);
    expect(result.riskScore).toBe(100);
    expect(result.reason).toMatch(/liste noire/i);
  });

  test('autorise si téléphone n\'est pas bloqué', () => {
    const result = checkTransaction({ amount: 1000, clientPhone: '+2250700000002' });
    expect(result.blocked).toBe(false);
  });

  test('autorise si phone est null', () => {
    const result = checkTransaction({ amount: 1000, clientPhone: null });
    expect(result.blocked).toBe(false);
  });
});

describe('checkTransaction — Montant maximum', () => {
  beforeEach(clearFraudData);

  test('bloque si montant dépasse le seuil par défaut (5 000 000)', () => {
    const result = checkTransaction({ amount: 6000000, clientPhone: '+2250700003' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/seuil/i);
  });

  test('autorise si montant en dessous du seuil', () => {
    const result = checkTransaction({ amount: 4999999, clientPhone: '+2250700004' });
    expect(result.blocked).toBe(false);
  });

  test('utilise la règle DB si elle existe (seuil réduit à 100 000)', () => {
    createRule({ name: 'Petit seuil', rule_type: 'max_amount_per_tx', value: 100000 });
    const result = checkTransaction({ amount: 200000, clientPhone: '+2250700005' });
    expect(result.blocked).toBe(true);
  });
});

describe('computeRiskScore — Score de risque', () => {
  beforeEach(clearFraudData);

  test('score = 0 pour transaction normale sans historique', () => {
    const { score } = computeRiskScore({ amount: 5000, clientId: null });
    expect(score).toBe(0);
  });

  test('score augmente si montant proche du seuil max (80%+)', () => {
    const { score } = computeRiskScore({ amount: 4200000, clientId: null }); // 84% de 5M
    expect(score).toBeGreaterThan(0);
  });

  test('score cappé à 100', () => {
    blockPhone('+2250700010', 'Test score cap');
    // forcer un score max
    const { score } = computeRiskScore({ amount: 9999999, clientId: null });
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('isPhoneBlocked', () => {
  beforeEach(clearFraudData);

  test('retourne false pour numéro non bloqué', () => {
    expect(isPhoneBlocked('+2250700100')).toBe(false);
  });

  test('retourne true après blocage', () => {
    blockPhone('+2250700200', 'Suspicious');
    expect(isPhoneBlocked('+2250700200')).toBe(true);
  });

  test('retourne false pour null', () => {
    expect(isPhoneBlocked(null)).toBe(false);
  });
});

describe('Gestion des règles', () => {
  beforeEach(clearFraudData);

  test('createRule crée une règle active', () => {
    const rule = createRule({ name: 'Règle test', rule_type: 'max_tx_per_hour', value: 5 });
    expect(rule.name).toBe('Règle test');
    expect(rule.is_active).toBe(1);
    expect(parseFloat(rule.value)).toBe(5);
  });

  test('getAllRules retourne toutes les règles', () => {
    createRule({ name: 'R1', rule_type: 'max_tx_per_day', value: 10 });
    createRule({ name: 'R2', rule_type: 'max_amount_per_day', value: 500000 });
    const rules = getAllRules();
    expect(rules.length).toBe(2);
  });

  test('getBlockedPhones retourne la liste des numéros bloqués', () => {
    blockPhone('+22500001', 'R1');
    blockPhone('+22500002', 'R2');
    const phones = getBlockedPhones();
    expect(phones.length).toBe(2);
    expect(phones.some(p => p.phone === '+22500001')).toBe(true);
  });
});
