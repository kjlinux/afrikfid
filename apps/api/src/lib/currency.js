'use strict';

/**
 * Module de gestion multi-devises
 * Fournit conversion, normalisation et symboles pour XOF, XAF, KES
 */

const db = require('./db');

const CURRENCY_META = {
  XOF: { symbol: 'FCFA', name: 'Franc CFA UEMOA', zone: 'UEMOA', decimals: 0 },
  XAF: { symbol: 'FCFA', name: 'Franc CFA CEMAC', zone: 'CEMAC', decimals: 0 },
  KES: { symbol: 'KSh',  name: 'Shilling kenyan', zone: 'EAST_AFRICA', decimals: 2 },
  EUR: { symbol: '€',    name: 'Euro', zone: 'INTL', decimals: 2 },
};

/**
 * Retourne le taux de change entre deux devises
 * Retourne 1 si même devise, null si taux introuvable
 */
function getExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;

  const row = db.prepare(
    'SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ?'
  ).get(fromCurrency, toCurrency);

  return row ? row.rate : null;
}

/**
 * Convertit un montant d'une devise vers une autre
 * @returns {number|null} montant converti ou null si taux introuvable
 */
function convertAmount(amount, fromCurrency, toCurrency) {
  const rate = getExchangeRate(fromCurrency, toCurrency);
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}

/**
 * Normalise un montant vers EUR pour les rapports globaux multi-devises
 */
function toEUR(amount, fromCurrency) {
  return convertAmount(amount, fromCurrency, 'EUR');
}

/**
 * Met à jour un taux de change
 */
function updateExchangeRate(fromCurrency, toCurrency, rate, source = 'manual') {
  const { v4: uuidv4 } = require('uuid');
  db.prepare(`
    INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(from_currency, to_currency) DO UPDATE SET
      rate = excluded.rate,
      source = excluded.source,
      updated_at = datetime('now')
  `).run(`er-${fromCurrency.toLowerCase()}-${toCurrency.toLowerCase()}`, fromCurrency, toCurrency, rate, source);
}

/**
 * Retourne tous les taux de change
 */
function getAllRates() {
  return db.prepare('SELECT * FROM exchange_rates ORDER BY from_currency, to_currency').all();
}

/**
 * Retourne les métadonnées d'une devise
 */
function getCurrencyMeta(currency) {
  return CURRENCY_META[currency] || null;
}

/**
 * Formate un montant avec son symbole monétaire
 */
function formatAmount(amount, currency) {
  const meta = getCurrencyMeta(currency);
  if (!meta) return `${amount} ${currency}`;
  const decimals = meta.decimals;
  const formatted = amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ${meta.symbol}`;
}

module.exports = {
  getExchangeRate,
  convertAmount,
  toEUR,
  updateExchangeRate,
  getAllRates,
  getCurrencyMeta,
  formatAmount,
  CURRENCY_META,
};
