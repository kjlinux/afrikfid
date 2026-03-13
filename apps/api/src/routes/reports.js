const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const { getAllRates, updateExchangeRate, toEUR } = require('../lib/currency');

// GET /api/v1/reports/daily
router.get('/daily', requireAdmin, async (req, res) => {
  const { date = new Date().toISOString().split('T')[0], merchant_id } = req.query;
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  let sql = `
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
    WHERE initiated_at >= $1 AND initiated_at < $2
  `;
  const params = [date, nextDay.toISOString().split('T')[0]];
  let idx = 3;

  if (merchant_id) { sql += ` AND merchant_id = $${idx++}`; params.push(merchant_id); }

  const summary = (await db.query(sql, params)).rows[0];

  const byMethod = (await db.query(`
    SELECT payment_method, payment_operator,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume
    FROM transactions
    WHERE initiated_at >= $1 AND initiated_at < $2
    GROUP BY payment_method, payment_operator
  `, [date, nextDay.toISOString().split('T')[0]])).rows;

  const byLoyaltyStatus = (await db.query(`
    SELECT client_loyalty_status,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN client_rebate_amount ELSE 0 END), 0) as rebates
    FROM transactions
    WHERE initiated_at >= $1 AND initiated_at < $2
    GROUP BY client_loyalty_status
  `, [date, nextDay.toISOString().split('T')[0]])).rows;

  res.json({ date, summary, byMethod, byLoyaltyStatus });
});

// GET /api/v1/reports/overview
router.get('/overview', requireAdmin, async (req, res) => {
  const { period = '30d' } = req.query;
  const days = parseInt(period) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString();

  const kpis = (await db.query(`
    SELECT
      COUNT(*) as total_transactions,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN platform_commission_amount ELSE 0 END), 0) as platform_revenue,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN client_rebate_amount ELSE 0 END), 0) as client_rebates,
      ROUND(CAST(COUNT(CASE WHEN status = 'completed' THEN 1 END) AS NUMERIC) / NULLIF(COUNT(*), 0) * 100, 2) as success_rate
    FROM transactions WHERE initiated_at >= $1
  `, [fromStr])).rows[0];

  const topMerchants = (await db.query(`
    SELECT m.id, m.name,
      COUNT(t.id) as tx_count,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.gross_amount ELSE 0 END), 0) as volume
    FROM merchants m
    JOIN transactions t ON m.id = t.merchant_id
    WHERE t.initiated_at >= $1
    GROUP BY m.id ORDER BY volume DESC LIMIT 5
  `, [fromStr])).rows;

  const loyaltyDistribution = (await db.query(`
    SELECT loyalty_status, COUNT(*) as count FROM clients WHERE is_active = TRUE GROUP BY loyalty_status
  `)).rows;

  const dailyVolume = (await db.query(`
    SELECT DATE(initiated_at) as day,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as count
    FROM transactions WHERE initiated_at >= $1
    GROUP BY DATE(initiated_at) ORDER BY day
  `, [fromStr])).rows;

  const merchantCount = parseInt((await db.query("SELECT COUNT(*) as c FROM merchants WHERE is_active = TRUE")).rows[0].c);
  const clientCount = parseInt((await db.query("SELECT COUNT(*) as c FROM clients WHERE is_active = TRUE")).rows[0].c);

  res.json({ kpis, topMerchants, loyaltyDistribution, dailyVolume, merchantCount, clientCount, period: `${days}d` });
});

// GET /api/v1/reports/transactions
router.get('/transactions', requireAdmin, async (req, res) => {
  const { from, to, merchant_id, status, loyalty_status, page = 1, limit = 100 } = req.query;

  let sql = `
    SELECT t.*, m.name as merchant_name, c.full_name as client_name, c.afrikfid_id
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (from) { sql += ` AND t.initiated_at >= $${idx++}`; params.push(from); }
  if (to) { sql += ` AND t.initiated_at <= $${idx++}`; params.push(to); }
  if (merchant_id) { sql += ` AND t.merchant_id = $${idx++}`; params.push(merchant_id); }
  if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
  if (loyalty_status) { sql += ` AND t.client_loyalty_status = $${idx++}`; params.push(loyalty_status); }

  sql += ` ORDER BY t.initiated_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const transactions = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions')).rows[0].c);

  res.json({ transactions, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/reports/exchange-rates
router.get('/exchange-rates', requireAdmin, async (req, res) => {
  res.json({ rates: await getAllRates() });
});

// PUT /api/v1/reports/exchange-rates
router.put('/exchange-rates', requireAdmin, async (req, res) => {
  const { from_currency, to_currency, rate } = req.body;
  if (!from_currency || !to_currency || !rate) {
    return res.status(400).json({ error: 'from_currency, to_currency et rate requis' });
  }
  if (typeof rate !== 'number' || rate <= 0) {
    return res.status(400).json({ error: 'rate doit être un nombre positif' });
  }
  await updateExchangeRate(from_currency.toUpperCase(), to_currency.toUpperCase(), rate);
  res.json({ message: 'Taux mis à jour', rates: await getAllRates() });
});

// GET /api/v1/reports/overview-normalized
router.get('/overview-normalized', requireAdmin, async (req, res) => {
  const { period = '30d' } = req.query;
  const days = parseInt(period) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString();

  const bycurrency = (await db.query(`
    SELECT currency,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as tx_count
    FROM transactions WHERE initiated_at >= $1
    GROUP BY currency
  `, [fromStr])).rows;

  const normalizedVolume = await Promise.all(bycurrency.map(async row => ({
    ...row,
    volumeEUR: await toEUR(parseFloat(row.volume), row.currency),
  })));

  const totalVolumeEUR = normalizedVolume.reduce((sum, r) => sum + (r.volumeEUR || 0), 0);

  res.json({ bycurrency: normalizedVolume, totalVolumeEUR: Math.round(totalVolumeEUR * 100) / 100, period: `${days}d` });
});

// GET /api/v1/reports/transactions/pdf — Export PDF serveur des transactions (admin)
router.get('/transactions/pdf', requireAdmin, async (req, res) => {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch {
    return res.status(501).json({ error: 'PDFKit non installé. Exécutez: npm install pdfkit' });
  }

  const { from, to, merchant_id, status } = req.query;

  let sql = `
    SELECT t.reference, t.gross_amount, t.currency, t.status, t.payment_method,
           t.payment_operator, t.initiated_at, t.completed_at,
           m.name as merchant_name, c.full_name as client_name
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;
  if (from) { sql += ` AND t.initiated_at >= $${idx++}`; params.push(from); }
  if (to) { sql += ` AND t.initiated_at <= $${idx++}`; params.push(to); }
  if (merchant_id) { sql += ` AND t.merchant_id = $${idx++}`; params.push(merchant_id); }
  if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
  sql += ` ORDER BY t.initiated_at DESC LIMIT 1000`;

  const transactions = (await db.query(sql, params)).rows;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().split('T')[0]}.pdf"`);
  doc.pipe(res);

  // En-tête
  doc.fontSize(18).fillColor('#1a1a5e').text("Afrik'Fid — Rapport de Transactions", { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666').text(`Généré le ${new Date().toLocaleString('fr-FR')} | ${transactions.length} transactions`, { align: 'center' });
  if (from || to) doc.text(`Période : ${from || '...'} → ${to || '...'}`, { align: 'center' });
  doc.moveDown(1);

  // Tableau
  const colWidths = [110, 65, 45, 55, 60, 75, 100];
  const headers = ['Référence', 'Montant', 'Devise', 'Statut', 'Méthode', 'Marchand', 'Date'];
  const startX = 40;
  let y = doc.y;

  // En-tête tableau
  doc.fontSize(9).fillColor('#fff');
  doc.rect(startX, y, 515, 18).fill('#1a1a5e');
  let x = startX + 4;
  headers.forEach((h, i) => {
    doc.fillColor('#fff').text(h, x, y + 4, { width: colWidths[i] - 4, lineBreak: false });
    x += colWidths[i];
  });
  y += 20;

  // Lignes
  transactions.forEach((tx, rowIdx) => {
    if (y > 760) { doc.addPage(); y = 40; }
    const bg = rowIdx % 2 === 0 ? '#f9fafb' : '#ffffff';
    doc.rect(startX, y, 515, 16).fill(bg);

    const statusColors = { completed: '#16a34a', failed: '#dc2626', pending: '#d97706', expired: '#6b7280' };
    const values = [
      tx.reference?.slice(0, 16) || '',
      parseFloat(tx.gross_amount || 0).toLocaleString('fr-FR'),
      tx.currency || 'XOF',
      tx.status || '',
      tx.payment_operator || tx.payment_method || '',
      (tx.merchant_name || '').slice(0, 14),
      tx.initiated_at ? new Date(tx.initiated_at).toLocaleDateString('fr-FR') : '',
    ];

    x = startX + 4;
    values.forEach((v, i) => {
      const color = i === 3 ? (statusColors[tx.status] || '#111') : '#111';
      doc.fontSize(8).fillColor(color).text(String(v), x, y + 3, { width: colWidths[i] - 4, lineBreak: false });
      x += colWidths[i];
    });
    y += 17;
  });

  // Totaux
  doc.moveDown(1.5);
  const completed = transactions.filter(t => t.status === 'completed');
  const totalVol = completed.reduce((s, t) => s + parseFloat(t.gross_amount || 0), 0);
  doc.fontSize(10).fillColor('#111').text(`Total transactions : ${transactions.length} | Complétées : ${completed.length} | Volume : ${totalVol.toLocaleString('fr-FR')} XOF`);

  doc.end();
});

// GET /api/v1/reports/refunds (admin) — liste paginée des remboursements (CDC §4.6.1)
router.get('/refunds', requireAdmin, async (req, res) => {
  const { page = 1, limit = 20, status, refund_type, q } = req.query;
  let sql = `
    SELECT r.*, t.reference as transaction_reference, t.currency, m.name as merchant_name
    FROM refunds r
    LEFT JOIN transactions t ON r.transaction_id = t.id
    LEFT JOIN merchants m ON t.merchant_id = m.id
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (status) { sql += ` AND r.status = $${idx++}`; params.push(status); }
  if (refund_type) { sql += ` AND r.refund_type = $${idx++}`; params.push(refund_type); }
  if (q) { sql += ` AND (t.reference ILIKE $${idx++} OR m.name ILIKE $${idx++})`; params.push(`%${q}%`, `%${q}%`); }

  const countSql = sql.replace(/SELECT r\.\*.*FROM refunds r/, 'SELECT COUNT(*) as c FROM refunds r');
  const total = parseInt((await db.query(countSql, params)).rows[0]?.c || 0);

  sql += ` ORDER BY r.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const refunds = (await db.query(sql, params)).rows;
  res.json({ refunds, total, page: parseInt(page), limit: parseInt(limit) });
});

module.exports = router;
