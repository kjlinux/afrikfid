'use strict';

const db = require('./db');

const CURRENCY_META = {
  XOF: { symbol: 'FCFA', name: 'Franc CFA UEMOA', zone: 'UEMOA', decimals: 0 },
  XAF: { symbol: 'FCFA', name: 'Franc CFA CEMAC', zone: 'CEMAC', decimals: 0 },
  KES: { symbol: 'KSh',  name: 'Shilling kenyan', zone: 'EAST_AFRICA', decimals: 2 },
  EUR: { symbol: '€',    name: 'Euro', zone: 'INTL', decimals: 2 },
};

async function getExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;
  const res = await db.query(
    'SELECT rate FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2',
    [fromCurrency, toCurrency]
  );
  return res.rows[0] ? parseFloat(res.rows[0].rate) : null;
}

async function convertAmount(amount, fromCurrency, toCurrency) {
  const rate = await getExchangeRate(fromCurrency, toCurrency);
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}

async function toEUR(amount, fromCurrency) {
  return convertAmount(amount, fromCurrency, 'EUR');
}

async function updateExchangeRate(fromCurrency, toCurrency, rate, source = 'manual') {
  const { v4: uuidv4 } = require('uuid');
  await db.query(
    `INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (from_currency, to_currency) DO UPDATE SET
       rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = NOW()`,
    [`er-${fromCurrency.toLowerCase()}-${toCurrency.toLowerCase()}`, fromCurrency, toCurrency, rate, source]
  );
}

async function getAllRates() {
  const res = await db.query('SELECT * FROM exchange_rates ORDER BY from_currency, to_currency');
  return res.rows;
}

function getCurrencyMeta(currency) {
  return CURRENCY_META[currency] || null;
}

function formatAmount(amount, currency) {
  const meta = getCurrencyMeta(currency);
  if (!meta) return `${amount} ${currency}`;
  const formatted = amount.toFixed(meta.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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
