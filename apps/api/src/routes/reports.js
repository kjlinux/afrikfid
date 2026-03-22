const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin } = require('../middleware/auth');
const { getAllRates, updateExchangeRate, toEUR } = require('../lib/currency');

// GET /api/v1/reports/daily
router.get('/daily', requireAdmin, async (req, res) => {
  const { date = new Date().toISOString().split('T')[0], merchant_id } = req.query;
  // Utiliser des timestamps UTC explicites pour éviter les décalages timezone
  const startDate = new Date(date + 'T00:00:00.000Z');
  const endDate = new Date(date + 'T00:00:00.000Z');
  endDate.setUTCDate(endDate.getUTCDate() + 1);

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
  const params = [startDate.toISOString(), endDate.toISOString()];
  let idx = 3;

  if (merchant_id) { sql += ` AND merchant_id = $${idx++}`; params.push(merchant_id); }

  const summary = (await db.query(sql, params)).rows[0];

  const methodParams = [startDate.toISOString(), endDate.toISOString()];
  let methodSql = `
    SELECT payment_method, payment_operator,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume
    FROM transactions
    WHERE initiated_at >= $1 AND initiated_at < $2
  `;
  if (merchant_id) { methodSql += ` AND merchant_id = $3`; methodParams.push(merchant_id); }
  methodSql += ` GROUP BY payment_method, payment_operator`;
  const byMethod = (await db.query(methodSql, methodParams)).rows;

  const loyaltyParams = [startDate.toISOString(), endDate.toISOString()];
  let loyaltySql = `
    SELECT client_loyalty_status,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN gross_amount ELSE 0 END), 0) as volume,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN client_rebate_amount ELSE 0 END), 0) as rebates
    FROM transactions
    WHERE initiated_at >= $1 AND initiated_at < $2
  `;
  if (merchant_id) { loyaltySql += ` AND merchant_id = $3`; loyaltyParams.push(merchant_id); }
  loyaltySql += ` GROUP BY client_loyalty_status`;
  const byLoyaltyStatus = (await db.query(loyaltySql, loyaltyParams)).rows;

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

  // KPI taux de conversion OPEN→ROYAL (CDC §4.6.1 Analytics)
  const conversionStats = (await db.query(`
    SELECT
      COUNT(*) as total_clients,
      COUNT(CASE WHEN loyalty_status = 'OPEN'         THEN 1 END) as open_count,
      COUNT(CASE WHEN loyalty_status = 'LIVE'         THEN 1 END) as live_count,
      COUNT(CASE WHEN loyalty_status = 'GOLD'         THEN 1 END) as gold_count,
      COUNT(CASE WHEN loyalty_status = 'ROYAL'        THEN 1 END) as royal_count,
      COUNT(CASE WHEN loyalty_status = 'ROYAL_ELITE'  THEN 1 END) as royal_elite_count,
      COUNT(CASE WHEN loyalty_status != 'OPEN' THEN 1 END) as converted_count
    FROM clients WHERE is_active = TRUE
  `)).rows[0];

  const royalTotal = parseInt(conversionStats.royal_count) + parseInt(conversionStats.royal_elite_count);
  const conversionRates = {
    openToAny: conversionStats.total_clients > 0
      ? Math.round((conversionStats.converted_count / conversionStats.total_clients) * 100 * 100) / 100
      : 0,
    openToLive: conversionStats.total_clients > 0
      ? Math.round(((parseInt(conversionStats.live_count) + parseInt(conversionStats.gold_count) + royalTotal) / conversionStats.total_clients) * 100 * 100) / 100
      : 0,
    openToGold: conversionStats.total_clients > 0
      ? Math.round(((parseInt(conversionStats.gold_count) + royalTotal) / conversionStats.total_clients) * 100 * 100) / 100
      : 0,
    openToRoyal: conversionStats.total_clients > 0
      ? Math.round((royalTotal / conversionStats.total_clients) * 100 * 100) / 100
      : 0,
    counts: {
      open: parseInt(conversionStats.open_count),
      live: parseInt(conversionStats.live_count),
      gold: parseInt(conversionStats.gold_count),
      royal: parseInt(conversionStats.royal_count),
      royal_elite: parseInt(conversionStats.royal_elite_count),
      total: parseInt(conversionStats.total_clients),
    },
  };

  // KPIs RFM globaux (CDC v3 §6.2) — % Champions, % À Risque, taux réactivation win-back
  const rfmKpis = (await db.query(`
    SELECT
      COUNT(*) as total_scored,
      COUNT(CASE WHEN segment = 'CHAMPIONS'   THEN 1 END) as champions,
      COUNT(CASE WHEN segment = 'FIDELES'     THEN 1 END) as fideles,
      COUNT(CASE WHEN segment = 'PROMETTEURS' THEN 1 END) as prometteurs,
      COUNT(CASE WHEN segment = 'A_RISQUE'    THEN 1 END) as a_risque,
      COUNT(CASE WHEN segment = 'HIBERNANTS'  THEN 1 END) as hibernants,
      COUNT(CASE WHEN segment = 'PERDUS'      THEN 1 END) as perdus
    FROM rfm_scores
  `)).rows[0];

  const totalScored = parseInt(rfmKpis.total_scored) || 0;
  const rfmSummary = {
    totalScored,
    champions:   { count: parseInt(rfmKpis.champions),   pct: totalScored > 0 ? Math.round(parseInt(rfmKpis.champions)   / totalScored * 100 * 10) / 10 : 0 },
    fideles:     { count: parseInt(rfmKpis.fideles),     pct: totalScored > 0 ? Math.round(parseInt(rfmKpis.fideles)     / totalScored * 100 * 10) / 10 : 0 },
    prometteurs: { count: parseInt(rfmKpis.prometteurs), pct: totalScored > 0 ? Math.round(parseInt(rfmKpis.prometteurs) / totalScored * 100 * 10) / 10 : 0 },
    aRisque:     { count: parseInt(rfmKpis.a_risque),    pct: totalScored > 0 ? Math.round(parseInt(rfmKpis.a_risque)    / totalScored * 100 * 10) / 10 : 0 },
    hibernants:  { count: parseInt(rfmKpis.hibernants),  pct: totalScored > 0 ? Math.round(parseInt(rfmKpis.hibernants)  / totalScored * 100 * 10) / 10 : 0 },
    perdus:      { count: parseInt(rfmKpis.perdus),      pct: totalScored > 0 ? Math.round(parseInt(rfmKpis.perdus)      / totalScored * 100 * 10) / 10 : 0 },
  };

  // Taux de réactivation win-back : clients passés de PERDUS/HIBERNANTS → autre segment dans les 30 derniers jours
  const winBackRes = (await db.query(`
    SELECT COUNT(DISTINCT at2.client_id) as reactivated
    FROM abandon_tracking at2
    WHERE at2.status = 'reactivated'
      AND at2.reactivated_at >= NOW() - INTERVAL '30 days'
  `)).rows[0];
  const winBackRate = totalScored > 0
    ? Math.round((parseInt(winBackRes.reactivated) || 0) / totalScored * 100 * 10) / 10
    : 0;

  rfmSummary.winBackRate = winBackRate;
  rfmSummary.winBackCount = parseInt(winBackRes.reactivated) || 0;

  // Churn mensuel estimé : clients A_RISQUE + PERDUS / total scorés
  rfmSummary.churnRisk = totalScored > 0
    ? Math.round((rfmSummary.aRisque.count + rfmSummary.perdus.count) / totalScored * 100 * 10) / 10
    : 0;

  res.json({ kpis, topMerchants, loyaltyDistribution, dailyVolume, merchantCount, clientCount, conversionRates, rfmSummary, period: `${days}d` });
});

// GET /api/v1/reports/transactions
router.get('/transactions', requireAdmin, async (req, res) => {
  const { from, to, merchant_id, status, loyalty_status, page = 1, limit = 100 } = req.query;

  let sql = `
    SELECT t.*, m.name as merchant_name, c.full_name as client_name, c.afrikfid_id,
      rs.segment as client_rfm_segment
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    LEFT JOIN clients c ON t.client_id = c.id
    LEFT JOIN LATERAL (
      SELECT segment FROM rfm_scores WHERE client_id = c.id ORDER BY calculated_at DESC LIMIT 1
    ) rs ON TRUE
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
  // COUNT avec les mêmes filtres que la requête principale (sans LIMIT/OFFSET)
  const countParams = params.slice(0, params.length - 2); // enlever limit et offset
  let countSql = `SELECT COUNT(*) as c FROM transactions t JOIN merchants m ON t.merchant_id = m.id LEFT JOIN clients c ON t.client_id = c.id WHERE 1=1`;
  let cidx = 1;
  if (from) { countSql += ` AND t.initiated_at >= $${cidx++}`; }
  if (to) { countSql += ` AND t.initiated_at <= $${cidx++}`; }
  if (merchant_id) { countSql += ` AND t.merchant_id = $${cidx++}`; }
  if (status) { countSql += ` AND t.status = $${cidx++}`; }
  if (loyalty_status) { countSql += ` AND t.client_loyalty_status = $${cidx++}`; }
  const total = parseInt((await db.query(countSql, countParams)).rows[0].c);

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
  const reportPeriod = from && to ? `${from}_${to}` : new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${reportPeriod}.pdf"`);
  doc.pipe(res);

  // En-tête
  doc.fontSize(18).fillColor('#1a1a5e').text("Afrik'Fid — Rapport de Transactions", { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('#666').text(
    `Généré le ${new Date().toLocaleString('fr-FR')} | Période : ${from || 'début'} → ${to || 'fin'} | ${transactions.length} transactions`,
    { align: 'center' }
  );
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

// GET /api/v1/reports/by-merchant — Rapport détaillé par marchand (CDC §4.6.1)
router.get('/by-merchant', requireAdmin, async (req, res) => {
  const { period = '30d', merchant_id, page = 1, limit = 20 } = req.query;
  const days = parseInt(period) || 30;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString();

  let countSql = `
    SELECT COUNT(DISTINCT m.id) as c
    FROM merchants m
    WHERE m.is_active = TRUE
  `;
  let sql = `
    SELECT
      m.id as merchant_id,
      m.name as merchant_name,
      m.country_id,
      co.name as country_name,
      co.currency,
      m.merchant_rebate_percent as rebate_x,
      COUNT(t.id) as total_transactions,
      COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_transactions,
      COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_transactions,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.gross_amount ELSE 0 END), 0) as gross_volume,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.merchant_receives ELSE 0 END), 0) as merchant_net,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.client_rebate_amount ELSE 0 END), 0) as client_rebates,
      COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.platform_commission_amount ELSE 0 END), 0) as platform_revenue,
      COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN t.client_id END) as unique_clients,
      COUNT(DISTINCT CASE WHEN t.client_loyalty_status = 'ROYAL' AND t.status = 'completed' THEN t.client_id END) as royal_clients,
      COUNT(DISTINCT CASE WHEN t.client_loyalty_status = 'GOLD' AND t.status = 'completed' THEN t.client_id END) as gold_clients,
      COUNT(DISTINCT CASE WHEN t.client_loyalty_status = 'LIVE' AND t.status = 'completed' THEN t.client_id END) as live_clients,
      COUNT(DISTINCT CASE WHEN t.client_loyalty_status = 'OPEN' AND t.status = 'completed' THEN t.client_id END) as open_clients
    FROM merchants m
    LEFT JOIN countries co ON m.country_id = co.id
    LEFT JOIN transactions t ON t.merchant_id = m.id AND t.initiated_at >= $1
    WHERE m.is_active = TRUE
  `;
  const params = [fromStr];
  let idx = 2;

  if (merchant_id) {
    sql += ` AND m.id = $${idx}`;
    countSql += ` AND m.id = $${idx}`;
    params.push(merchant_id);
    idx++;
  }

  const total = parseInt((await db.query(countSql, params.slice(1))).rows[0]?.c || 0);

  sql += `
    GROUP BY m.id, m.name, m.country_id, co.name, co.currency, m.merchant_rebate_percent
    ORDER BY gross_volume DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `;
  params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

  const merchants = (await db.query(sql, params)).rows;

  res.json({
    merchants,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    period: `${days}d`,
    from: fromStr,
  });
});

// GET /api/v1/reports/loyalty-funnel — Funnel de conversion statuts fidélité (CDC §4.6.1)
router.get('/loyalty-funnel', requireAdmin, async (req, res, next) => {
  try {
    const { days = 90 } = req.query;
    const periodDays = Math.min(parseInt(days) || 90, 365);
    const from = new Date(Date.now() - periodDays * 86400000).toISOString();

    // Distribution actuelle des clients par statut
    const currentRes = await db.query(
      `SELECT loyalty_status as status, COUNT(*) as count
       FROM clients WHERE is_active = TRUE GROUP BY loyalty_status`
    );
    const currentByStatus = {};
    for (const row of currentRes.rows) {
      currentByStatus[row.status] = parseInt(row.count);
    }

    // Transitions dans la période (upgrades uniquement)
    const transitionsRes = await db.query(
      `SELECT old_status, new_status, COUNT(DISTINCT client_id) as count
       FROM loyalty_status_history
       WHERE changed_at >= $1
       GROUP BY old_status, new_status`,
      [from]
    );

    const STATUSES = ['OPEN', 'LIVE', 'GOLD', 'ROYAL'];
    const totalClients = STATUSES.reduce((s, st) => s + (currentByStatus[st] || 0), 0);

    const funnel = STATUSES.map((status, idx) => {
      const count = currentByStatus[status] || 0;
      const conversionRate = totalClients > 0 ? parseFloat((count / totalClients * 100).toFixed(1)) : 0;

      // Upgrades depuis le statut précédent dans la période
      let upgradesIn = 0;
      if (idx > 0) {
        const prevStatus = STATUSES[idx - 1];
        const trans = transitionsRes.rows.find(r => r.old_status === prevStatus && r.new_status === status);
        upgradesIn = trans ? parseInt(trans.count) : 0;
      }

      return { status, count, conversion_rate: conversionRate, upgrades_in_period: upgradesIn };
    });

    // Taux de conversion global Open → Royal
    const openCount = currentByStatus['OPEN'] || 0;
    const royalCount = currentByStatus['ROYAL'] || 0;
    const openToRoyalRate = totalClients > 0 ? parseFloat((royalCount / totalClients * 100).toFixed(2)) : 0;

    res.json({
      funnel,
      total_clients: totalClients,
      open_to_royal_rate: openToRoyalRate,
      period_days: periodDays,
      from,
      generated_at: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// GET /api/v1/reports/contact-priority — CDC §6.4 10h00
// Liste des clients à contacter en priorité aujourd'hui (A RISQUE + abandon proche + échéance statut imminente)
router.get('/contact-priority', requireAdmin, async (req, res, next) => {
  try {
    const { merchant_id, limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);

    // 1. Clients À RISQUE selon RFM (priorité URGENTE selon CDC §5.3)
    let rfmSql = `
      SELECT rs.client_id, rs.segment, rs.r_score, rs.f_score, rs.m_score, rs.calculated_at,
             c.full_name, c.loyalty_status, c.phone, c.email,
             m.id as merchant_id, m.name as merchant_name
      FROM rfm_scores rs
      JOIN clients c ON c.id = rs.client_id
      LEFT JOIN merchants m ON m.id = rs.merchant_id
      WHERE rs.segment IN ('A_RISQUE', 'HIBERNANTS')
        AND c.is_active = TRUE AND c.anonymized_at IS NULL
    `;
    const rfmParams = [];
    let idx = 1;
    if (merchant_id) { rfmSql += ` AND rs.merchant_id = $${idx++}`; rfmParams.push(merchant_id); }
    rfmSql += ` ORDER BY rs.segment ASC, rs.r_score ASC LIMIT $${idx}`;
    rfmParams.push(Math.floor(lim * 0.5)); // 50% de slots pour A_RISQUE/HIBERNANTS
    const rfmRows = (await db.query(rfmSql, rfmParams)).rows;

    // 2. Clients avec échéance statut dans les 7 prochains jours (J-7)
    let deadlineSql = `
      SELECT c.id as client_id, 'REQUALIFICATION' as segment,
             c.full_name, c.loyalty_status, c.phone, c.email,
             c.qualification_deadline, c.status_points_12m,
             NULL as merchant_id, NULL as merchant_name
      FROM clients c
      WHERE c.is_active = TRUE AND c.anonymized_at IS NULL
        AND c.loyalty_status != 'OPEN'
        AND c.qualification_deadline IS NOT NULL
        AND c.qualification_deadline BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    `;
    const deadlineRows = (await db.query(deadlineSql)).rows;

    // 3. Clients en abandon step 1-3 (protocole d'abandon CDC §5.5)
    let abandonSql = `
      SELECT at2.client_id, 'ABANDON_PROTOCOLE' as segment,
             c.full_name, c.loyalty_status, c.phone, c.email,
             at2.current_step, at2.next_action_at,
             m.id as merchant_id, m.name as merchant_name
      FROM abandon_tracking at2
      JOIN clients c ON c.id = at2.client_id
      LEFT JOIN merchants m ON m.id = at2.merchant_id
      WHERE at2.status IN ('step_1', 'step_2', 'step_3')
        AND at2.next_action_at <= NOW() + INTERVAL '24 hours'
        AND c.is_active = TRUE AND c.anonymized_at IS NULL
    `;
    const abandonParams2 = [];
    let aidx = 1;
    if (merchant_id) { abandonSql += ` AND at2.merchant_id = $${aidx++}`; abandonParams2.push(merchant_id); }
    abandonSql += ` ORDER BY at2.next_action_at ASC LIMIT $${aidx}`;
    abandonParams2.push(Math.floor(lim * 0.3));
    const abandonRows = (await db.query(abandonSql, abandonParams2)).rows;

    // Fusion et déduplication par client_id
    const seen = new Set();
    const contacts = [];

    const addRows = (rows, priority) => {
      rows.forEach(row => {
        if (!seen.has(row.client_id)) {
          seen.add(row.client_id);
          contacts.push({ ...row, contact_priority: priority });
        }
      });
    };

    addRows(rfmRows.filter(r => r.segment === 'A_RISQUE'), 'URGENTE');
    addRows(deadlineRows, 'HAUTE');
    addRows(abandonRows, 'HAUTE');
    addRows(rfmRows.filter(r => r.segment === 'HIBERNANTS'), 'MOYENNE');

    res.json({
      generated_at: new Date().toISOString(),
      total: contacts.length,
      contacts: contacts.slice(0, lim),
      summary: {
        a_risque: rfmRows.filter(r => r.segment === 'A_RISQUE').length,
        requalification_urgente: deadlineRows.length,
        abandon_protocole: abandonRows.length,
        hibernants: rfmRows.filter(r => r.segment === 'HIBERNANTS').length,
      },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/reports/success-fees — Agrégats success fees (CDC §3.5)
router.get('/success-fees', requireAdmin, async (req, res, next) => {
  try {
    const { period = '30d', merchant_id } = req.query;
    const days = parseInt(period) || 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().split('T')[0];

    let params = [fromStr];
    let idx = 2;
    let merchantFilter = '';
    if (merchant_id) { merchantFilter = ` AND sf.merchant_id = $${idx++}`; params.push(merchant_id); }

    const kpis = (await db.query(`
      SELECT
        COUNT(*) as total_records,
        COALESCE(SUM(CASE WHEN sf.status = 'paid' THEN sf.fee_amount ELSE 0 END), 0) as total_collected,
        COALESCE(SUM(CASE WHEN sf.status = 'calculated' THEN sf.fee_amount ELSE 0 END), 0) as total_pending,
        COALESCE(SUM(CASE WHEN sf.status = 'invoiced' THEN sf.fee_amount ELSE 0 END), 0) as total_invoiced,
        COALESCE(SUM(sf.fee_amount), 0) as total_calculated,
        COALESCE(AVG(sf.fee_percent), 0) as avg_fee_percent,
        COALESCE(SUM(sf.growth_amount), 0) as total_growth_basis
      FROM success_fees sf
      WHERE sf.period_start >= $1${merchantFilter}
    `, params)).rows[0];

    const topMerchants = (await db.query(`
      SELECT sf.merchant_id, m.name as merchant_name,
        COALESCE(SUM(sf.fee_amount), 0) as total_fees,
        COALESCE(SUM(CASE WHEN sf.status = 'paid' THEN sf.fee_amount ELSE 0 END), 0) as paid_fees,
        COUNT(*) as periods_count,
        COALESCE(AVG(sf.fee_percent), 0) as avg_fee_percent
      FROM success_fees sf
      JOIN merchants m ON m.id = sf.merchant_id
      WHERE sf.period_start >= $1${merchantFilter}
      GROUP BY sf.merchant_id, m.name
      ORDER BY total_fees DESC
      LIMIT 10
    `, params)).rows;

    const byStatus = (await db.query(`
      SELECT sf.status, COUNT(*) as count, COALESCE(SUM(sf.fee_amount), 0) as total
      FROM success_fees sf
      WHERE sf.period_start >= $1${merchantFilter}
      GROUP BY sf.status
    `, params)).rows;

    const recent = (await db.query(`
      SELECT sf.*, m.name as merchant_name
      FROM success_fees sf
      JOIN merchants m ON m.id = sf.merchant_id
      WHERE sf.period_start >= $1${merchantFilter}
      ORDER BY sf.created_at DESC
      LIMIT 20
    `, params)).rows;

    res.json({ kpis, topMerchants, byStatus, recent, period: `${days}d` });
  } catch (err) { next(err); }
});

// GET /api/v1/reports/subscriptions — Métriques abonnements (CDC §2.5)
router.get('/subscriptions', requireAdmin, async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;
    const days = parseInt(period) || 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().split('T')[0];

    const kpis = (await db.query(`
      SELECT
        COUNT(*) as total_active,
        COALESCE(SUM(effective_monthly_fee), 0) as mrr,
        COALESCE(AVG(recruitment_discount_percent), 0) as avg_discount,
        COUNT(CASE WHEN package = 'STARTER_BOOST' THEN 1 END) as starter_boost_count,
        COUNT(CASE WHEN package = 'STARTER_PLUS' THEN 1 END) as starter_plus_count,
        COUNT(CASE WHEN package = 'GROWTH' THEN 1 END) as growth_count,
        COUNT(CASE WHEN package = 'PREMIUM' THEN 1 END) as premium_count
      FROM subscriptions WHERE status = 'active'
    `)).rows[0];

    const payments = (await db.query(`
      SELECT
        COUNT(*) as total_payments,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN effective_amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN effective_amount ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN effective_amount ELSE 0 END), 0) as failed_amount,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
        COALESCE(SUM(base_amount - effective_amount), 0) as total_discounts_given
      FROM subscription_payments
      WHERE period_start >= $1
    `, [fromStr])).rows[0];

    const byPackage = (await db.query(`
      SELECT s.package,
        COUNT(DISTINCT s.id) as active_count,
        COALESCE(SUM(s.effective_monthly_fee), 0) as mrr,
        COALESCE(AVG(s.recruitment_discount_percent), 0) as avg_discount
      FROM subscriptions s WHERE s.status = 'active'
      GROUP BY s.package
      ORDER BY mrr DESC
    `)).rows;

    const recentPayments = (await db.query(`
      SELECT sp.*, m.name as merchant_name, s.package
      FROM subscription_payments sp
      JOIN merchants m ON m.id = sp.merchant_id
      JOIN subscriptions s ON s.id = sp.subscription_id
      WHERE sp.period_start >= $1
      ORDER BY sp.created_at DESC
      LIMIT 20
    `, [fromStr])).rows;

    res.json({ kpis, payments, byPackage, recentPayments, period: `${days}d` });
  } catch (err) { next(err); }
});

// GET /api/v1/reports/triggers — Performance des triggers automatiques (CDC §5.4)
router.get('/triggers', requireAdmin, async (req, res, next) => {
  try {
    const { period = '30d', merchant_id } = req.query;
    const days = parseInt(period) || 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString();

    let params = [fromStr];
    let idx = 2;
    let merchantFilter = '';
    if (merchant_id) { merchantFilter = ` AND tl.merchant_id = $${idx++}`; params.push(merchant_id); }

    const byType = (await db.query(`
      SELECT tl.trigger_type,
        COUNT(*) as total_sent,
        COUNT(CASE WHEN tl.status = 'sent' THEN 1 END) as delivered,
        COUNT(CASE WHEN tl.status = 'failed' THEN 1 END) as failed
      FROM trigger_logs tl
      WHERE tl.created_at >= $1${merchantFilter}
      GROUP BY tl.trigger_type
      ORDER BY total_sent DESC
    `, params)).rows;

    const kpis = (await db.query(`
      SELECT
        COUNT(*) as total_triggers,
        COUNT(CASE WHEN tl.status = 'sent' THEN 1 END) as delivered,
        COUNT(CASE WHEN tl.status = 'failed' THEN 1 END) as failed,
        COUNT(DISTINCT tl.client_id) as unique_clients_targeted
      FROM trigger_logs tl
      WHERE tl.created_at >= $1${merchantFilter}
    `, params)).rows[0];

    const abandonStats = (await db.query(`
      SELECT
        COUNT(*) as total_active,
        COUNT(CASE WHEN status = 'reactivated' THEN 1 END) as reactivated,
        COUNT(CASE WHEN status = 'lost' THEN 1 END) as lost,
        COUNT(CASE WHEN current_step = 1 THEN 1 END) as step_1,
        COUNT(CASE WHEN current_step = 2 THEN 1 END) as step_2,
        COUNT(CASE WHEN current_step = 3 THEN 1 END) as step_3,
        COUNT(CASE WHEN current_step = 4 THEN 1 END) as step_4,
        COUNT(CASE WHEN current_step = 5 THEN 1 END) as step_5
      FROM abandon_tracking
      ${merchant_id ? 'WHERE merchant_id = $1' : ''}
    `, merchant_id ? [merchant_id] : [])).rows[0];

    const reactivationRate = abandonStats.total_active > 0
      ? Math.round(parseInt(abandonStats.reactivated) / parseInt(abandonStats.total_active) * 100 * 10) / 10
      : 0;

    res.json({ kpis, byType, abandonStats: { ...abandonStats, reactivationRate }, period: `${days}d` });
  } catch (err) { next(err); }
});

// GET /api/v1/reports/recruitment-bonuses — Bonus recrutement Starter Boost par marchand (CDC §2.6)
router.get('/recruitment-bonuses', requireAdmin, async (req, res, next) => {
  try {
    const { period = '30d', merchant_id } = req.query;
    const days = parseInt(period) || 30;
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().split('T')[0];

    let params = [fromStr];
    let idx = 2;
    let merchantFilter = '';
    if (merchant_id) { merchantFilter = ` AND sp.merchant_id = $${idx++}`; params.push(merchant_id); }

    const byMerchant = (await db.query(`
      SELECT
        sp.merchant_id, m.name as merchant_name, s.package,
        sp.recruited_clients_count,
        sp.discount_percent,
        sp.base_amount,
        sp.effective_amount,
        sp.base_amount - sp.effective_amount as discount_amount,
        sp.period_start, sp.status
      FROM subscription_payments sp
      JOIN merchants m ON m.id = sp.merchant_id
      JOIN subscriptions s ON s.id = sp.subscription_id
      WHERE sp.period_start >= $1
        AND s.package = 'STARTER_BOOST'${merchantFilter}
      ORDER BY sp.recruited_clients_count DESC, sp.period_start DESC
    `, params)).rows;

    const kpis = (await db.query(`
      SELECT
        COUNT(DISTINCT sp.merchant_id) as merchants_with_bonus,
        COALESCE(SUM(sp.base_amount - sp.effective_amount), 0) as total_discounts,
        COALESCE(AVG(sp.discount_percent), 0) as avg_discount_pct,
        COALESCE(SUM(sp.recruited_clients_count), 0) as total_clients_recruited,
        COALESCE(AVG(sp.recruited_clients_count), 0) as avg_recruited_per_merchant
      FROM subscription_payments sp
      JOIN subscriptions s ON s.id = sp.subscription_id
      WHERE sp.period_start >= $1
        AND s.package = 'STARTER_BOOST'
        AND sp.discount_percent > 0${merchantFilter.replace(/\$2/, '$' + (params.length + 1))}
    `, params)).rows[0];

    const distribution = [
      { range: '0-9 clients', min: 0, max: 9, discount: 0 },
      { range: '10-24 clients', min: 10, max: 24, discount: 10 },
      { range: '25-49 clients', min: 25, max: 49, discount: 20 },
      { range: '50-99 clients', min: 50, max: 99, discount: 35 },
      { range: '100+ clients', min: 100, max: null, discount: 50 },
    ].map(tier => ({
      ...tier,
      count: byMerchant.filter(m => m.recruited_clients_count >= tier.min && (tier.max === null || m.recruited_clients_count <= tier.max)).length,
    }));

    res.json({ kpis, byMerchant, distribution, period: `${days}d` });
  } catch (err) { next(err); }
});

module.exports = router;
