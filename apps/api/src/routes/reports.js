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

// GET /api/v1/reports/transactions/excel — Export Excel transactions (CDC §4.6.1)
router.get('/transactions/excel', requireAdmin, async (req, res) => {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch {
    return res.status(501).json({ error: 'exceljs non installé. Exécutez: npm install exceljs' });
  }

  const { from, to, merchant_id, status } = req.query;
  let sql = `
    SELECT t.reference, t.gross_amount, t.currency, t.status,
           t.merchant_rebate_percent, t.client_rebate_percent, t.platform_commission_percent,
           t.client_rebate_amount, t.platform_commission_amount, t.merchant_receives,
           t.client_loyalty_status, t.rebate_mode, t.payment_method, t.payment_operator,
           t.initiated_at, t.completed_at,
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
  sql += ` ORDER BY t.initiated_at DESC LIMIT 10000`;

  const transactions = (await db.query(sql, params)).rows;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Afrik'Fid";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Référence',         key: 'reference',                   width: 26 },
    { header: 'Marchand',          key: 'merchant_name',               width: 22 },
    { header: 'Client',            key: 'client_name',                 width: 22 },
    { header: 'Statut fidélité',   key: 'client_loyalty_status',       width: 14 },
    { header: 'Montant brut',      key: 'gross_amount',                width: 14 },
    { header: 'Devise',            key: 'currency',                    width: 8  },
    { header: 'X% marchand',       key: 'merchant_rebate_percent',     width: 12 },
    { header: 'Y% client',         key: 'client_rebate_percent',       width: 10 },
    { header: 'Z% Afrik\'Fid',     key: 'platform_commission_percent', width: 12 },
    { header: 'Remise client',     key: 'client_rebate_amount',        width: 14 },
    { header: 'Commission Z',      key: 'platform_commission_amount',  width: 14 },
    { header: 'Marchand reçoit',   key: 'merchant_receives',           width: 14 },
    { header: 'Mode remise',       key: 'rebate_mode',                 width: 12 },
    { header: 'Méthode',           key: 'payment_method',              width: 12 },
    { header: 'Opérateur',         key: 'payment_operator',            width: 12 },
    { header: 'Statut',            key: 'status',                      width: 12 },
    { header: 'Initié le',         key: 'initiated_at',                width: 20 },
    { header: 'Complété le',       key: 'completed_at',                width: 20 },
  ];

  // Style en-tête
  const headerRow = sheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A5E' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFF59E0B' } } };
  });
  headerRow.height = 20;

  // Couleurs statut
  const STATUS_FILL = {
    completed: 'FFD1FAE5',
    failed: 'FFFEE2E2',
    pending: 'FFFEF3C7',
    refunded: 'FFEDE9FE',
  };

  transactions.forEach((tx, i) => {
    const row = sheet.addRow({
      ...tx,
      gross_amount: parseFloat(tx.gross_amount),
      merchant_rebate_percent: parseFloat(tx.merchant_rebate_percent),
      client_rebate_percent: parseFloat(tx.client_rebate_percent),
      platform_commission_percent: parseFloat(tx.platform_commission_percent),
      client_rebate_amount: parseFloat(tx.client_rebate_amount),
      platform_commission_amount: parseFloat(tx.platform_commission_amount),
      merchant_receives: parseFloat(tx.merchant_receives),
      initiated_at: tx.initiated_at ? new Date(tx.initiated_at).toLocaleString('fr-FR') : '',
      completed_at: tx.completed_at ? new Date(tx.completed_at).toLocaleString('fr-FR') : '',
    });
    const bg = i % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { vertical: 'middle' };
    });
    // Colonne statut colorée
    const statusCell = row.getCell('status');
    const statusBg = STATUS_FILL[tx.status] || 'FFFFFFFF';
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusBg } };
    statusCell.font = { bold: true };
  });

  // Feuille résumé
  const summary = workbook.addWorksheet('Résumé');
  summary.columns = [
    { header: 'Indicateur', key: 'label', width: 30 },
    { header: 'Valeur', key: 'value', width: 20 },
  ];
  const completed = transactions.filter(t => t.status === 'completed');
  const totalVol = completed.reduce((s, t) => s + parseFloat(t.gross_amount || 0), 0);
  const totalZ = completed.reduce((s, t) => s + parseFloat(t.platform_commission_amount || 0), 0);
  const totalRebates = completed.reduce((s, t) => s + parseFloat(t.client_rebate_amount || 0), 0);
  [
    ['Généré le', new Date().toLocaleString('fr-FR')],
    ['Total transactions', transactions.length],
    ['Transactions complétées', completed.length],
    ['Taux de succès', `${Math.round((completed.length / (transactions.length || 1)) * 100)}%`],
    ['Volume total (complétées)', totalVol.toLocaleString('fr-FR')],
    ['Commissions Afrik\'Fid (Z)', totalZ.toLocaleString('fr-FR')],
    ['Remises clients (Y)', totalRebates.toLocaleString('fr-FR')],
  ].forEach(([label, value]) => summary.addRow({ label, value }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().split('T')[0]}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// GET /api/v1/reports/by-country — Revenus Afrik'Fid par pays (CDC §4.6.1)
router.get('/by-country', requireAdmin, async (req, res) => {
  const { period = '30d' } = req.query;
  const days = parseInt(period) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString();

  const byCountry = (await db.query(`
    SELECT
      co.id as country_id,
      co.name as country_name,
      co.currency,
      co.zone,
      COUNT(t.id) as total_transactions,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.platform_commission_amount ELSE 0 END), 0) as platform_revenue,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.client_rebate_amount ELSE 0 END), 0) as client_rebates,
      COUNT(DISTINCT t.merchant_id) as active_merchants,
      COUNT(DISTINCT t.client_id) as unique_clients
    FROM countries co
    LEFT JOIN merchants m ON m.country_id = co.id
    LEFT JOIN transactions t ON t.merchant_id = m.id AND t.initiated_at >= $1
    WHERE co.is_active = TRUE
    GROUP BY co.id, co.name, co.currency, co.zone
    ORDER BY total_volume DESC
  `, [fromStr])).rows;

  const byZone = (await db.query(`
    SELECT
      co.zone,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.gross_amount ELSE 0 END), 0) as total_volume,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.platform_commission_amount ELSE 0 END), 0) as platform_revenue,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed
    FROM countries co
    LEFT JOIN merchants m ON m.country_id = co.id
    LEFT JOIN transactions t ON t.merchant_id = m.id AND t.initiated_at >= $1
    WHERE co.is_active = TRUE
    GROUP BY co.zone ORDER BY total_volume DESC
  `, [fromStr])).rows;

  res.json({ byCountry, byZone, period: `${days}d` });
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
