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

/**
 * Récupère les taux de change depuis un fournisseur externe et met à jour la DB.
 *
 * Fournisseurs supportés :
 *   - Open Exchange Rates (OPENEXCHANGERATES_APP_ID)
 *   - Fixer.io (FIXER_API_KEY)
 *
 * Les paires XOF/XAF sont maintenues à 1:1 (zone franc CFA).
 *
 * @returns {Promise<{updated: number, source: string}>}
 */
async function refreshExchangeRates() {
  const PAIRS = [
    { from: 'XOF', to: 'EUR' },
    { from: 'XAF', to: 'EUR' },
    { from: 'KES', to: 'EUR' },
    { from: 'EUR', to: 'XOF' },
    { from: 'EUR', to: 'XAF' },
    { from: 'EUR', to: 'KES' },
  ];

  let fetchedRates = null;
  let source = 'manual';

  // Tenter Open Exchange Rates
  if (process.env.OPENEXCHANGERATES_APP_ID) {
    try {
      const axios = require('axios');
      const resp = await axios.get(
        `https://openexchangerates.org/api/latest.json?app_id=${process.env.OPENEXCHANGERATES_APP_ID}&symbols=XOF,XAF,KES,EUR`,
        { timeout: 10000 }
      );
      if (resp.data?.rates) {
        fetchedRates = resp.data.rates; // Base USD
        source = 'openexchangerates';
      }
    } catch (e) {
      console.warn('[currency] Open Exchange Rates unavailable:', e.message);
    }
  }

  // Tenter Fixer.io comme fallback
  if (!fetchedRates && process.env.FIXER_API_KEY) {
    try {
      const axios = require('axios');
      const resp = await axios.get(
        `https://api.fixer.io/latest?access_key=${process.env.FIXER_API_KEY}&symbols=XOF,XAF,KES,USD`,
        { timeout: 10000 }
      );
      if (resp.data?.rates) {
        // Fixer base EUR — convertir en USD base pour uniformité
        const ratesFromEUR = resp.data.rates;
        fetchedRates = {};
        for (const [cur, rate] of Object.entries(ratesFromEUR)) {
          fetchedRates[cur] = rate;
        }
        fetchedRates['EUR'] = 1;
        source = 'fixer';
      }
    } catch (e) {
      console.warn('[currency] Fixer.io unavailable:', e.message);
    }
  }

  if (!fetchedRates) {
    console.info('[currency] Aucun fournisseur de taux disponible, taux manuels conservés');
    return { updated: 0, source: 'none' };
  }

  let updated = 0;

  if (source === 'openexchangerates') {
    // Base USD → calculer EUR/XOF/XAF/KES croisés
    const usdToEUR = 1 / fetchedRates['EUR'] || 0.92;
    const usdToXOF = fetchedRates['XOF'] || 655.957;
    const usdToXAF = fetchedRates['XAF'] || 655.957;
    const usdToKES = fetchedRates['KES'] || 145.0;

    const crossRates = [
      { from: 'XOF', to: 'EUR', rate: usdToEUR / usdToXOF * usdToXOF / usdToXOF * usdToEUR },
      { from: 'XAF', to: 'EUR', rate: usdToEUR / usdToXAF * usdToXAF / usdToXAF * usdToEUR },
      { from: 'KES', to: 'EUR', rate: usdToEUR / usdToKES * usdToKES / usdToKES * usdToEUR },
      { from: 'EUR', to: 'XOF', rate: usdToXOF / (usdToEUR * usdToXOF) * usdToXOF },
      { from: 'EUR', to: 'XAF', rate: usdToXAF / (usdToEUR * usdToXAF) * usdToXAF },
      { from: 'EUR', to: 'KES', rate: usdToKES / (usdToEUR * usdToKES) * usdToKES },
    ];

    // Calcul simplifié correct
    const xofToEur = (1 / usdToXOF) * (1 / usdToEUR) * 1;
    const simplePairs = [
      { from: 'XOF', to: 'EUR', rate: usdToEUR / usdToXOF },
      { from: 'XAF', to: 'EUR', rate: usdToEUR / usdToXAF },
      { from: 'KES', to: 'EUR', rate: usdToEUR / usdToKES },
      { from: 'EUR', to: 'XOF', rate: usdToXOF / usdToEUR },
      { from: 'EUR', to: 'XAF', rate: usdToXAF / usdToEUR },
      { from: 'EUR', to: 'KES', rate: usdToKES / usdToEUR },
    ];

    for (const p of simplePairs) {
      await updateExchangeRate(p.from, p.to, p.rate, source);
      updated++;
    }
  } else if (source === 'fixer') {
    // Base EUR
    const eurToXOF = fetchedRates['XOF'] || 655.957;
    const eurToXAF = fetchedRates['XAF'] || 655.957;
    const eurToKES = fetchedRates['KES'] || 145.0;

    const pairs = [
      { from: 'XOF', to: 'EUR', rate: 1 / eurToXOF },
      { from: 'XAF', to: 'EUR', rate: 1 / eurToXAF },
      { from: 'KES', to: 'EUR', rate: 1 / eurToKES },
      { from: 'EUR', to: 'XOF', rate: eurToXOF },
      { from: 'EUR', to: 'XAF', rate: eurToXAF },
      { from: 'EUR', to: 'KES', rate: eurToKES },
    ];

    for (const p of pairs) {
      await updateExchangeRate(p.from, p.to, p.rate, source);
      updated++;
    }
  }

  // XOF ↔ XAF toujours 1:1 (zone franc CFA)
  await updateExchangeRate('XOF', 'XAF', 1.0, 'fixed');
  await updateExchangeRate('XAF', 'XOF', 1.0, 'fixed');

  console.log(`✅ [currency] ${updated} taux mis à jour depuis ${source}`);
  return { updated, source };
}

module.exports = {
  getExchangeRate,
  convertAmount,
  toEUR,
  updateExchangeRate,
  getAllRates,
  getCurrencyMeta,
  formatAmount,
  refreshExchangeRates,
  CURRENCY_META,
};
