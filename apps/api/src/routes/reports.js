const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const { getAllRates, updateExchangeRate, toEUR } = require('../lib/currency');

// GET /api/v1/reports/daily
router.get('/daily', requireAdmin, (req, res) => {
  const { date = new Date().toISOString().split('T')[0], merchant_id } = req.query;
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  let query = `
    SELECT
      COUNT(*) as total_transactions,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN platform_commission_amount ELSE 0 END), 0) as platform_revenue,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN client_rebate_amount ELSE 0 END), 0) as total_rebates_given,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN merchant_receives ELSE 0 END), 0) as merchants_received
    FROM transactions
    WHERE initiated_at >= ? AND initiated_at < ?
  `;
  const params = [date, nextDay.toISOString().split('T')[0]];

  if (merchant_id) { query += ' AND merchant_id = ?'; params.push(merchant_id); }

  const summary = db.prepare(query).get(...params);

  const byMethod = db.prepare(`
    SELECT payment_method, payment_operator,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume
    FROM transactions
    WHERE initiated_at >= ? AND initiated_at < ?
    GROUP BY payment_method, payment_operator
  `).all(date, nextDay.toISOString().split('T')[0]);

  const byLoyaltyStatus = db.prepare(`
    SELECT client_loyalty_status,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN client_rebate_amount ELSE 0 END), 0) as rebates
    FROM transactions
    WHERE initiated_at >= ? AND initiated_at < ?
    GROUP BY client_loyalty_status
  `).all(date, nextDay.toISOString().split('T')[0]);

  res.json({ date, summary, byMethod, byLoyaltyStatus });
});

// GET /api/v1/reports/overview (admin — KPIs globaux)
router.get('/overview', requireAdmin, (req, res) => {
  const { period = '30d' } = req.query;
  const days = parseInt(period) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString();

  const kpis = db.prepare(`
    SELECT
      COUNT(*) as total_transactions,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN platform_commission_amount ELSE 0 END), 0) as platform_revenue,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN client_rebate_amount ELSE 0 END), 0) as client_rebates,
      ROUND(CAST(COUNT(CASE WHEN status = 'completed' THEN 1 END) AS REAL) / NULLIF(COUNT(*), 0) * 100, 2) as success_rate
    FROM transactions WHERE initiated_at >= ?
  `).get(fromStr);

  const topMerchants = db.prepare(`
    SELECT m.id, m.name,
      COUNT(t.id) as tx_count,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.gross_amount ELSE 0 END), 0) as volume
    FROM merchants m
    JOIN transactions t ON m.id = t.merchant_id
    WHERE t.initiated_at >= ?
    GROUP BY m.id ORDER BY volume DESC LIMIT 5
  `).all(fromStr);

  const loyaltyDistribution = db.prepare(`
    SELECT loyalty_status, COUNT(*) as count
    FROM clients WHERE is_active = 1
    GROUP BY loyalty_status
  `).all();

  const dailyVolume = db.prepare(`
    SELECT DATE(initiated_at) as day,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as count
    FROM transactions WHERE initiated_at >= ?
    GROUP BY DATE(initiated_at) ORDER BY day
  `).all(fromStr);

  const merchantCount = db.prepare("SELECT COUNT(*) as c FROM merchants WHERE is_active = 1").get().c;
  const clientCount = db.prepare("SELECT COUNT(*) as c FROM clients WHERE is_active = 1").get().c;

  res.json({ kpis, topMerchants, loyaltyDistribution, dailyVolume, merchantCount, clientCount, period: `${days}d` });
});

// GET /api/v1/reports/transactions (admin — export)
router.get('/transactions', requireAdmin, (req, res) => {
  const { from, to, merchant_id, status, loyalty_status, page = 1, limit = 100 } = req.query;

  let query = `
    SELECT t.*, m.name as merchant_name, c.full_name as client_name, c.afrikfid_id
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (from) { query += ' AND t.initiated_at >= ?'; params.push(from); }
  if (to) { query += ' AND t.initiated_at <= ?'; params.push(to); }
  if (merchant_id) { query += ' AND t.merchant_id = ?'; params.push(merchant_id); }
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  if (loyalty_status) { query += ' AND t.client_loyalty_status = ?'; params.push(loyalty_status); }

  query += ' ORDER BY t.initiated_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as c FROM transactions').get().c;

  res.json({ transactions, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── Devises & Taux de change ────────────────────────────────────────────────

// GET /api/v1/reports/exchange-rates (admin)
router.get('/exchange-rates', requireAdmin, (req, res) => {
  res.json({ rates: getAllRates() });
});

// PUT /api/v1/reports/exchange-rates (admin — mettre à jour un taux)
router.put('/exchange-rates', requireAdmin, (req, res) => {
  const { from_currency, to_currency, rate } = req.body;
  if (!from_currency || !to_currency || !rate) {
    return res.status(400).json({ error: 'from_currency, to_currency et rate requis' });
  }
  if (typeof rate !== 'number' || rate <= 0) {
    return res.status(400).json({ error: 'rate doit être un nombre positif' });
  }
  updateExchangeRate(from_currency.toUpperCase(), to_currency.toUpperCase(), rate);
  res.json({ message: 'Taux mis à jour', rates: getAllRates() });
});

// GET /api/v1/reports/overview-normalized (admin — KPIs normalisés en EUR)
router.get('/overview-normalized', requireAdmin, (req, res) => {
  const { period = '30d' } = req.query;
  const days = parseInt(period) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString();

  // Volume par devise
  const bycurrency = db.prepare(`
    SELECT currency,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as tx_count
    FROM transactions WHERE initiated_at >= ?
    GROUP BY currency
  `).all(fromStr);

  // Normaliser en EUR
  const normalizedVolume = bycurrency.map(row => ({
    ...row,
    volumeEUR: toEUR(row.volume, row.currency),
  }));

  const totalVolumeEUR = normalizedVolume.reduce((sum, r) => sum + (r.volumeEUR || 0), 0);

  res.json({ bycurrency: normalizedVolume, totalVolumeEUR: Math.round(totalVolumeEUR * 100) / 100, period: `${days}d` });
});

module.exports = router;
