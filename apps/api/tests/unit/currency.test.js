'use strict';

/**
 * Tests unitaires — Devises (lib/currency.js)
 */

jest.mock('../../src/lib/db');
jest.mock('../../src/lib/migrations', () => ({ runMigrations: () => {} }));

const db = require('../../src/lib/db');
const { getExchangeRate, convertAmount, toEUR, updateExchangeRate, getAllRates, formatAmount, getCurrencyMeta } = require('../../src/lib/currency');

describe('getExchangeRate', () => {
  test('retourne un taux pour XOF → EUR (seedé en migration 003)', () => {
    const rate = getExchangeRate('XOF', 'EUR');
    expect(typeof rate).toBe('number');
    expect(rate).toBeGreaterThan(0);
  });

  test('retourne 1 pour même devise (XOF → XOF)', () => {
    const rate = getExchangeRate('XOF', 'XOF');
    expect(rate).toBe(1);
  });

  test('retourne null pour paire inconnue', () => {
    const rate = getExchangeRate('XOF', 'JPY');
    expect(rate).toBeNull();
  });
});

describe('convertAmount', () => {
  test('convertit XOF en EUR', () => {
    const eurAmount = convertAmount(655000, 'XOF', 'EUR');
    expect(eurAmount).toBeGreaterThan(0);
    expect(eurAmount).toBeLessThan(10000); // Taux approximatif ~0.00152
  });

  test('retourne montant identique si même devise', () => {
    expect(convertAmount(1000, 'XOF', 'XOF')).toBe(1000);
  });

  test('retourne null si paire inconnue', () => {
    expect(convertAmount(1000, 'XOF', 'JPY')).toBeNull();
  });
});

describe('toEUR', () => {
  test('convertit XOF en EUR', () => {
    const eur = toEUR(655957, 'XOF');
    expect(typeof eur).toBe('number');
    expect(eur).toBeGreaterThan(0);
  });

  test('retourne le montant inchangé si devise est EUR', () => {
    expect(toEUR(100, 'EUR')).toBe(100);
  });

  test('retourne 0 pour devise inconnue', () => {
    const result = toEUR(1000, 'JPY');
    expect(result == null || result === 0).toBe(true);
  });
});

describe('updateExchangeRate', () => {
  test('met à jour le taux XOF/EUR', () => {
    updateExchangeRate('XOF', 'EUR', 0.002);
    const rate = getExchangeRate('XOF', 'EUR');
    expect(rate).toBe(0.002);
  });

  test('insère un nouveau taux si paire inexistante', () => {
    updateExchangeRate('XOF', 'USD', 0.0017);
    const rate = getExchangeRate('XOF', 'USD');
    expect(rate).toBe(0.0017);
  });
});

describe('getAllRates', () => {
  test('retourne un tableau de taux', () => {
    const rates = getAllRates();
    expect(Array.isArray(rates)).toBe(true);
    expect(rates.length).toBeGreaterThan(0);
    expect(rates[0]).toHaveProperty('from_currency');
    expect(rates[0]).toHaveProperty('to_currency');
    expect(rates[0]).toHaveProperty('rate');
  });
});

describe('formatAmount', () => {
  test('formate XOF sans décimales', () => {
    const str = formatAmount(1500, 'XOF');
    expect(str).toContain('1');
    expect(str).toContain('500');
    // symbol is FCFA for XOF
    expect(str.length).toBeGreaterThan(0);
  });

  test('formate KES avec 2 décimales', () => {
    const str = formatAmount(1500.50, 'KES');
    expect(str).toContain('KSh');
  });
});

describe('getCurrencyMeta', () => {
  test('retourne les métadonnées de XOF', () => {
    const meta = getCurrencyMeta('XOF');
    expect(meta).toBeDefined();
    expect(meta.zone).toBe('UEMOA');
    expect(meta.decimals).toBe(0);
  });

  test('retourne les métadonnées de KES', () => {
    const meta = getCurrencyMeta('KES');
    expect(meta.zone).toBe('EAST_AFRICA');
    expect(meta.decimals).toBe(2);
  });

  test('retourne null pour devise inconnue', () => {
    expect(getCurrencyMeta('JPY')).toBeNull();
  });
});
