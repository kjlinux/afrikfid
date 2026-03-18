require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('./lib/db');
const { encrypt, hashField } = require('./lib/crypto');

// ── Helpers ──────────────────────────────────────────────────────────────────
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
const hoursAgo = n => new Date(Date.now() - n * 3600000).toISOString();
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const LOYALTY_RATES = { OPEN: 0, LIVE: 5, GOLD: 8, ROYAL: 12 };
const COUNTRY_CURRENCY = { CI: 'XOF', SN: 'XOF', BF: 'XOF', ML: 'XOF', NE: 'XOF', TG: 'XOF', BJ: 'XOF', CM: 'XAF', TD: 'XAF', CG: 'XAF', GA: 'XAF', KE: 'KES' };

async function seed() {
  console.log("[SEED] Seeding Afrik'Fid database...");

  // ─── Countries ────────────────────────────────────────────────────────────
  const countries = [
    { id: 'CI', name: "Côte d'Ivoire", currency: 'XOF', zone: 'UEMOA' },
    { id: 'SN', name: 'Sénégal',       currency: 'XOF', zone: 'UEMOA' },
    { id: 'BF', name: 'Burkina Faso',  currency: 'XOF', zone: 'UEMOA' },
    { id: 'ML', name: 'Mali',          currency: 'XOF', zone: 'UEMOA' },
    { id: 'NE', name: 'Niger',         currency: 'XOF', zone: 'UEMOA' },
    { id: 'TG', name: 'Togo',          currency: 'XOF', zone: 'UEMOA' },
    { id: 'BJ', name: 'Bénin',         currency: 'XOF', zone: 'UEMOA' },
    { id: 'CM', name: 'Cameroun',      currency: 'XAF', zone: 'CEMAC' },
    { id: 'TD', name: 'Tchad',         currency: 'XAF', zone: 'CEMAC' },
    { id: 'CG', name: 'Congo',         currency: 'XAF', zone: 'CEMAC' },
    { id: 'GA', name: 'Gabon',         currency: 'XAF', zone: 'CEMAC' },
    { id: 'KE', name: 'Kenya',         currency: 'KES', zone: 'EA' },
  ];
  for (const c of countries) {
    await db.query(
      'INSERT INTO countries (id, name, currency, zone) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [c.id, c.name, c.currency, c.zone]
    );
  }
  console.log(`[SEED] ${countries.length} pays`);

  // ─── Loyalty Config ────────────────────────────────────────────────────────
  const loyaltyConfigs = [
    { id: 'LC-OPEN',        status: 'OPEN',        client_rebate_percent: 0,  label: 'Open',        color: '#6B7280', sort_order: 0, min_purchases: 0,  min_cumulative_amount: 0,       evaluation_months: 12, inactivity_months: 12, min_status_points: 0 },
    { id: 'LC-LIVE',        status: 'LIVE',        client_rebate_percent: 5,  label: 'Live',        color: '#3B82F6', sort_order: 1, min_purchases: 3,  min_cumulative_amount: 50000,   evaluation_months: 12, inactivity_months: 12, min_status_points: 1000 },
    { id: 'LC-GOLD',        status: 'GOLD',        client_rebate_percent: 8,  label: 'Gold',        color: '#F59E0B', sort_order: 2, min_purchases: 10, min_cumulative_amount: 200000,  evaluation_months: 12, inactivity_months: 12, min_status_points: 5000 },
    { id: 'LC-ROYAL',       status: 'ROYAL',       client_rebate_percent: 12, label: 'Royal',       color: '#8B5CF6', sort_order: 3, min_purchases: 30, min_cumulative_amount: 1000000, evaluation_months: 12, inactivity_months: 12, min_status_points: 15000 },
    { id: 'LC-ROYAL_ELITE', status: 'ROYAL_ELITE', client_rebate_percent: 12, label: 'Royal Élite', color: '#DC2626', sort_order: 4, min_purchases: 0,  min_cumulative_amount: 0,       evaluation_months: 12, inactivity_months: 12, min_status_points: 50000 },
  ];
  for (const lc of loyaltyConfigs) {
    await db.query(
      `INSERT INTO loyalty_config (id, status, client_rebate_percent, label, color, sort_order, min_purchases, min_cumulative_amount, evaluation_months, inactivity_months, min_status_points)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [lc.id, lc.status, lc.client_rebate_percent, lc.label, lc.color, lc.sort_order, lc.min_purchases, lc.min_cumulative_amount, lc.evaluation_months, lc.inactivity_months, lc.min_status_points]
    );
  }
  console.log('[SEED] Config fidélité (5 statuts dont ROYAL_ELITE)');

  // ─── Admins ────────────────────────────────────────────────────────────────
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@2026!';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const adminIds = {};

  const adminsData = [
    { role: 'superadmin', email: process.env.ADMIN_EMAIL || 'admin@afrikfid.com', full_name: 'Super Admin' },
    { role: 'admin',      email: 'ops@afrikfid.com',     full_name: 'Moussa Diabaté' },
    { role: 'auditor',    email: 'auditor@afrikfid.com', full_name: 'Binta Kouyaté' },
  ];
  for (const a of adminsData) {
    const id = uuidv4();
    adminIds[a.role] = id;
    await db.query(
      `INSERT INTO admins (id, email, password_hash, full_name, role, is_active) VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (email) DO NOTHING`,
      [id, a.email, adminHash, a.full_name, a.role]
    );
    // Fetch the real id in case of conflict
    const row = (await db.query('SELECT id FROM admins WHERE email=$1', [a.email])).rows[0];
    adminIds[a.role] = row.id;
  }
  console.log(`[SEED] ${adminsData.length} admins`);

  // ─── Marchands ─────────────────────────────────────────────────────────────
  const merchantPassword = await bcrypt.hash('Merchant@2026!', 10);

  const merchantsData = [
    { name: 'SuperMarché Abidjan Centre', email: 'supermarche@demo.af',  phone: '+22507000001', country_id: 'CI', category: 'retail',       rebate_percent: 10, rebate_mode: 'cashback',  settlement_frequency: 'daily',   kyc_status: 'approved',  max_tx: 500000,  daily_vol: 2000000, mm_op: 'ORANGE', mm_phone: '+22507100001', bank_account: 'CI45 0001 0011 2345 6789 0001', address: 'Plateau, Abidjan, CI', website: 'https://supermarche-abidjan.ci' },
    { name: 'Pharmacie Latrille Plus',    email: 'pharmacie@demo.af',    phone: '+22507000002', country_id: 'CI', category: 'pharmacy',      rebate_percent: 7,  rebate_mode: 'immediate', settlement_frequency: 'daily',   kyc_status: 'approved',  max_tx: 200000,  daily_vol: null,    mm_op: 'MTN',    mm_phone: '+22505100002', bank_account: 'CI45 0001 0011 2345 6789 0002', address: 'Cocody Latrille, Abidjan, CI', website: null },
    { name: 'Restaurant Chez Maman',      email: 'restaurant@demo.af',   phone: '+22507000003', country_id: 'CI', category: 'restaurant',    rebate_percent: 8,  rebate_mode: 'cashback',  settlement_frequency: 'weekly',  kyc_status: 'approved',  max_tx: null,    daily_vol: null,    mm_op: 'WAVE',   mm_phone: '+22507100003', bank_account: 'CI45 0001 0011 2345 6789 0003', address: 'Yopougon, Abidjan, CI', website: null },
    { name: 'Tech Boutique Dakar',        email: 'tech@demo.af',         phone: '+22177000004', country_id: 'SN', category: 'electronics',   rebate_percent: 5,  rebate_mode: 'cashback',  settlement_frequency: 'daily',   kyc_status: 'approved',  max_tx: 1000000, daily_vol: 5000000, mm_op: 'ORANGE', mm_phone: '+22177100004', bank_account: 'SN45 0001 0011 2345 6789 0004', address: 'Plateau, Dakar, SN', website: 'https://techboutique.sn' },
    { name: 'Boulangerie Ndakaaru',       email: 'bakery@demo.af',       phone: '+22177000005', country_id: 'SN', category: 'food',          rebate_percent: 6,  rebate_mode: 'cashback',  settlement_frequency: 'weekly',  kyc_status: 'pending',   max_tx: null,    daily_vol: null,    mm_op: null,     mm_phone: null,          bank_account: null,                           address: 'Medina, Dakar, SN', website: null },
    { name: 'MediCam Douala',             email: 'medicam@demo.af',      phone: '+23766000001', country_id: 'CM', category: 'pharmacy',      rebate_percent: 9,  rebate_mode: 'cashback',  settlement_frequency: 'monthly', kyc_status: 'approved',  max_tx: 300000,  daily_vol: null,    mm_op: 'MTN',    mm_phone: '+23766100001', bank_account: 'CM45 0001 0011 2345 6789 0006', address: 'Bonanjo, Douala, CM', website: null },
    { name: 'Électro Yaoundé',            email: 'electro@demo.af',      phone: '+23777000002', country_id: 'CM', category: 'electronics',   rebate_percent: 6,  rebate_mode: 'cashback',  settlement_frequency: 'daily',   kyc_status: 'submitted', max_tx: null,    daily_vol: null,    mm_op: null,     mm_phone: null,          bank_account: null,                           address: 'Centre-ville, Yaoundé, CM', website: null },
    { name: 'Nairobi Superstore',         email: 'nairobi@demo.af',      phone: '+254700000001',country_id: 'KE', category: 'retail',        rebate_percent: 8,  rebate_mode: 'cashback',  settlement_frequency: 'weekly',  kyc_status: 'approved',  max_tx: 50000,   daily_vol: 200000,  mm_op: 'MPESA',  mm_phone: '+254700000001',bank_account: 'KE45 0001 0011 2345 6789 0008', address: 'Westlands, Nairobi, KE', website: 'https://nairobisuperstore.co.ke' },
    { name: 'Resto Ouaga Délices',        email: 'ouaga@demo.af',        phone: '+22670000001', country_id: 'BF', category: 'restaurant',    rebate_percent: 7,  rebate_mode: 'immediate', settlement_frequency: 'daily',   kyc_status: 'rejected',  max_tx: null,    daily_vol: null,    mm_op: null,     mm_phone: null,          bank_account: null,                           address: 'Koulouba, Ouagadougou, BF', website: null },
    { name: 'AgriShop Bobo-Dioulasso',    email: 'agrishop@demo.af',     phone: '+22671000002', country_id: 'BF', category: 'agriculture',   rebate_percent: 5,  rebate_mode: 'cashback',  settlement_frequency: 'monthly', kyc_status: 'approved',  max_tx: 150000,  daily_vol: 1000000, mm_op: 'ORANGE', mm_phone: '+22670100002', bank_account: 'BF45 0001 0011 2345 6789 0010', address: 'Secteur 1, Bobo-Dioulasso, BF', website: null },
  ];

  const merchantMap = {}; // email → row
  for (const m of merchantsData) {
    const id = uuidv4();
    const bankEnc = m.bank_account ? encrypt(m.bank_account) : null;
    const bankHash = m.bank_account ? hashField(m.bank_account) : null;
    const kycSubmitted = (m.kyc_status !== 'approved' && m.kyc_status !== 'rejected') ? null : daysAgo(20);
    const kycReviewed = (m.kyc_status === 'approved' || m.kyc_status === 'rejected') ? daysAgo(10) : null;
    const kycRejReason = m.kyc_status === 'rejected' ? 'Document illisible ou non conforme' : null;

    const webhookUrl = m.kyc_status === 'approved' ? `https://hooks.example.com/${id.slice(0,8)}/webhook` : null;
    await db.query(
      `INSERT INTO merchants (
        id, name, email, phone, country_id, category,
        rebate_percent, rebate_mode, settlement_frequency,
        mm_operator, mm_phone, bank_name, bank_account, bank_account_hash,
        api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret,
        webhook_url, status, kyc_status,
        kyc_submitted_at, kyc_reviewed_at, kyc_reviewed_by, kyc_rejection_reason,
        kyc_documents, password_hash, is_active,
        max_transaction_amount, daily_volume_limit, address, website
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,
        $10,$11,$12,$13,$14,
        $15,$16,$17,$18,
        $19,$20,$21,
        $22,$23,$24,$25,
        $26,$27,$28,
        $29,$30,$31,$32
      ) ON CONFLICT (email) DO NOTHING`,
      [
        id, m.name, m.email, m.phone, m.country_id, m.category,
        m.rebate_percent, m.rebate_mode, m.settlement_frequency,
        m.mm_op, m.mm_phone, m.mm_op ? `Banque ${m.country_id}` : null, bankEnc, bankHash,
        `af_pub_${id.replace(/-/g,'').slice(0,24)}`,
        `af_sec_${id.replace(/-/g,'')}`,
        `af_sandbox_pub_${id.replace(/-/g,'').slice(0,20)}`,
        `af_sandbox_sec_${id.replace(/-/g,'')}`,
        webhookUrl, 'active', m.kyc_status,
        kycSubmitted, kycReviewed,
        kycReviewed ? adminIds.admin : null, kycRejReason,
        JSON.stringify({ id_card: true, business_reg: true }),
        merchantPassword, m.kyc_status === 'approved',
        m.max_tx, m.daily_vol, m.address, m.website,
      ]
    );
    const row = (await db.query('SELECT * FROM merchants WHERE email=$1', [m.email])).rows[0];
    merchantMap[m.email] = row;
  }
  const merchantList = Object.values(merchantMap);
  console.log(`[SEED] ${merchantList.length} marchands`);

  // ─── Subscriptions marchands (CDC v3 §1.4) ──────────────────────────────
  const packageAssignments = [
    { email: 'supermarche@demo.af', pkg: 'GROWTH',        fee: 0,     sector: 'epicerie' },
    { email: 'pharmacie@demo.af',   pkg: 'STARTER_PLUS',  fee: 0,     sector: 'pharmacie' },
    { email: 'restaurant@demo.af',  pkg: 'STARTER_BOOST', fee: 25000, sector: 'restaurant' },
    { email: 'tech@demo.af',        pkg: 'PREMIUM',       fee: 0,     sector: 'informatique' },
    { email: 'nairobi@demo.af',     pkg: 'GROWTH',        fee: 0,     sector: 'epicerie' },
    { email: 'agrishop@demo.af',    pkg: 'STARTER_BOOST', fee: 25000, sector: 'general' },
  ];
  for (const pa of packageAssignments) {
    const m = merchantMap[pa.email];
    if (!m) continue;
    await db.query('UPDATE merchants SET package = $1, sector = $2 WHERE id = $3', [pa.pkg, pa.sector, m.id]);
    if (pa.fee > 0) {
      await db.query(
        `INSERT INTO subscriptions (id, merchant_id, package, base_monthly_fee, effective_monthly_fee, status, next_billing_at)
         VALUES ($1, $2, $3, $4, $4, 'active', NOW() + INTERVAL '30 days') ON CONFLICT DO NOTHING`,
        [uuidv4(), m.id, pa.pkg, pa.fee]
      );
    }
  }
  console.log('[SEED] Packages et subscriptions marchands');

  // ─── Loyalty Config Country (overrides Kenya) ──────────────────────────────
  try {
    const countryOverrides = [
      { country_id: 'KE', status: 'LIVE',  client_rebate_percent: 3 },
      { country_id: 'KE', status: 'GOLD',  client_rebate_percent: 6 },
      { country_id: 'KE', status: 'ROYAL', client_rebate_percent: 10 },
    ];
    for (const o of countryOverrides) {
      await db.query(
        `INSERT INTO loyalty_config_country (id, country_id, status, client_rebate_percent) VALUES ($1,$2,$3,$4)
         ON CONFLICT (country_id, status) DO NOTHING`,
        [uuidv4(), o.country_id, o.status, o.client_rebate_percent]
      );
    }
    console.log('[SEED] Config fidélité par pays (Kenya)');
  } catch(e) { console.log('[SEED] loyalty_config_country skip:', e.message); }

  // ─── Loyalty Config Category ───────────────────────────────────────────────
  try {
    const categoryOverrides = [
      { category: 'pharmacy',    status: 'LIVE',  client_rebate_percent: 6 },
      { category: 'pharmacy',    status: 'GOLD',  client_rebate_percent: 10 },
      { category: 'pharmacy',    status: 'ROYAL', client_rebate_percent: 14 },
      { category: 'agriculture', status: 'LIVE',  client_rebate_percent: 2 },
      { category: 'agriculture', status: 'GOLD',  client_rebate_percent: 4 },
      { category: 'agriculture', status: 'ROYAL', client_rebate_percent: 6 },
    ];
    for (const o of categoryOverrides) {
      await db.query(
        `INSERT INTO loyalty_config_category (id, category, status, client_rebate_percent) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [uuidv4(), o.category, o.status, o.client_rebate_percent]
      );
    }
    console.log('[SEED] Config fidélité par catégorie');
  } catch(e) { console.log('[SEED] loyalty_config_category skip:', e.message); }

  // ─── Merchant Category Rates ────────────────────────────────────────────────
  try {
    const supermarche = merchantMap['supermarche@demo.af'];
    const nairobi = merchantMap['nairobi@demo.af'];
    const catRates = [
      { merchant_id: supermarche.id, category: 'alimentaire', discount_rate: 12 },
      { merchant_id: supermarche.id, category: 'high_tech',   discount_rate: 5 },
      { merchant_id: supermarche.id, category: 'textile',     discount_rate: 8 },
      { merchant_id: nairobi.id,     category: 'grocery',     discount_rate: 10 },
      { merchant_id: nairobi.id,     category: 'electronics', discount_rate: 6 },
    ];
    for (const r of catRates) {
      await db.query(
        `INSERT INTO merchant_category_rates (id, merchant_id, category, discount_rate) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [uuidv4(), r.merchant_id, r.category, r.discount_rate]
      );
    }
    console.log('[SEED] Taux catégories marchands');
  } catch(e) { console.log('[SEED] merchant_category_rates skip:', e.message); }

  // ─── Fraud Rules ───────────────────────────────────────────────────────────
  try {
    const fraudRulesData = [
      { name: 'Montant maximum par transaction',     rule_type: 'max_amount',     value: '500000', is_active: true },
      { name: 'Vélocité 3h (max 5 transactions)',    rule_type: 'velocity_3h',    value: '5',      is_active: true },
      { name: 'Vélocité 24h (max 15 transactions)',  rule_type: 'velocity_24h',   value: '15',     is_active: true },
      { name: 'Blacklist numéros bloqués',           rule_type: 'phone_blacklist',value: 'active', is_active: true },
      { name: 'Risque pays élevé (NE, TD)',          rule_type: 'country_risk',   value: 'NE,TD',  is_active: true },
      { name: 'Détection anomalie (Z-score > 3σ)',   rule_type: 'anomaly_zscore', value: '3',      is_active: false },
      { name: 'Multi-opérateur simultané (max 2)',   rule_type: 'multi_operator', value: '2',      is_active: true },
      { name: 'Nouveau client gros montant (100k)',  rule_type: 'new_client_cap', value: '100000', is_active: true },
    ];
    for (const r of fraudRulesData) {
      await db.query(
        `INSERT INTO fraud_rules (id, name, rule_type, value, is_active) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [uuidv4(), r.name, r.rule_type, r.value, r.is_active]
      );
    }
    console.log(`[SEED] ${fraudRulesData.length} règles anti-fraude`);
  } catch(e) { console.log('[SEED] fraud_rules skip:', e.message); }

  // ─── Blocked Phones ────────────────────────────────────────────────────────
  try {
    const blockedPhonesData = [
      { phone: '+22500999001', reason: 'Fraude avérée — chargeback répété',   blocked_by: adminIds.admin },
      { phone: '+22500999002', reason: 'Numéro SIM swap détecté',             blocked_by: adminIds.admin },
      { phone: '+22500999003', reason: 'Multi-comptes (3 comptes identifiés)', blocked_by: adminIds.superadmin },
      { phone: '+22500999004', reason: 'Tentative de phishing signalée',       blocked_by: adminIds.admin },
      { phone: '+22500999005', reason: 'Compte banni suite à litige',          blocked_by: adminIds.superadmin },
      { phone: '+23766999001', reason: 'Fraude Mobile Money Cameroun',         blocked_by: adminIds.admin },
      { phone: '+254700999001',reason: 'M-Pesa reversal abuse',               blocked_by: adminIds.admin },
    ];
    for (let i = 0; i < blockedPhonesData.length; i++) {
      const b = blockedPhonesData[i];
      await db.query(
        `INSERT INTO blocked_phones (phone, reason, blocked_at, blocked_by) VALUES ($1,$2,$3,$4) ON CONFLICT (phone) DO NOTHING`,
        [b.phone, b.reason, daysAgo(2 + i * 8), b.blocked_by]
      );
    }
    console.log(`[SEED] ${blockedPhonesData.length} numéros bloqués`);
  } catch(e) { console.log('[SEED] blocked_phones skip:', e.message); }

  // ─── Clients ───────────────────────────────────────────────────────────────
  const clientsData = [
    // CI — 8 clients
    { full_name: 'Kofi Mensah',        phone: '+22500111001', email: 'kofi@demo.af',      country_id: 'CI', loyalty_status: 'ROYAL', total_purchases: 42, total_amount: 1850000 },
    { full_name: 'Fatou Diallo',       phone: '+22500111002', email: 'fatou@demo.af',     country_id: 'CI', loyalty_status: 'GOLD',  total_purchases: 14, total_amount: 380000 },
    { full_name: 'Amadou Traoré',      phone: '+22500111003', email: 'amadou@demo.af',    country_id: 'CI', loyalty_status: 'LIVE',  total_purchases: 5,  total_amount: 95000 },
    { full_name: 'Marie Kouassi',      phone: '+22500111004', email: 'marie@demo.af',     country_id: 'CI', loyalty_status: 'OPEN',  total_purchases: 1,  total_amount: 15000 },
    { full_name: 'Ibrahim Coulibaly',  phone: '+22500111005', email: null,                country_id: 'CI', loyalty_status: 'LIVE',  total_purchases: 4,  total_amount: 72000 },
    { full_name: 'Adjoa Yeboah',       phone: '+22500111006', email: 'adjoa@demo.af',     country_id: 'CI', loyalty_status: 'GOLD',  total_purchases: 11, total_amount: 245000 },
    { full_name: 'Siméon Brou',        phone: '+22500111007', email: 'simeon@demo.af',    country_id: 'CI', loyalty_status: 'OPEN',  total_purchases: 0,  total_amount: 0 },
    { full_name: 'Clarisse N\'Goran',  phone: '+22500111008', email: 'clarisse@demo.af',  country_id: 'CI', loyalty_status: 'LIVE',  total_purchases: 3,  total_amount: 58000 },
    // SN — 4 clients
    { full_name: 'Awa Sarr',           phone: '+22177000005', email: 'awa@demo.af',       country_id: 'SN', loyalty_status: 'GOLD',  total_purchases: 13, total_amount: 310000 },
    { full_name: 'Salimata Touré',     phone: '+22177000006', email: 'salimata@demo.af',  country_id: 'SN', loyalty_status: 'ROYAL', total_purchases: 35, total_amount: 1250000 },
    { full_name: 'Ibrahima Fall',      phone: '+22177000007', email: null,                country_id: 'SN', loyalty_status: 'LIVE',  total_purchases: 6,  total_amount: 120000 },
    { full_name: 'Mariama Diop',       phone: '+22177000008', email: 'mariama@demo.af',   country_id: 'SN', loyalty_status: 'OPEN',  total_purchases: 2,  total_amount: 28000 },
    // CM — 4 clients
    { full_name: 'Jean-Pierre Mbida',  phone: '+23766000010', email: 'jpmb@demo.af',      country_id: 'CM', loyalty_status: 'LIVE',  total_purchases: 4,  total_amount: 85000 },
    { full_name: 'Cécile Biya',        phone: '+23766000011', email: 'cecile@demo.af',    country_id: 'CM', loyalty_status: 'GOLD',  total_purchases: 12, total_amount: 280000 },
    { full_name: 'Hervé Nkomo',        phone: '+23766000012', email: null,                country_id: 'CM', loyalty_status: 'OPEN',  total_purchases: 1,  total_amount: 22000 },
    { full_name: 'Doris Tchamba',      phone: '+23766000013', email: 'doris@demo.af',     country_id: 'CM', loyalty_status: 'LIVE',  total_purchases: 7,  total_amount: 145000 },
    // KE — 3 clients
    { full_name: 'David Kamau',        phone: '+254700000010',email: 'david@demo.af',     country_id: 'KE', loyalty_status: 'ROYAL', total_purchases: 38, total_amount: 1500000 },
    { full_name: 'Wanjiku Mwangi',     phone: '+254700000011',email: 'wanjiku@demo.af',   country_id: 'KE', loyalty_status: 'LIVE',  total_purchases: 5,  total_amount: 95000 },
    { full_name: 'Omondi Ochieng',     phone: '+254700000012',email: null,                country_id: 'KE', loyalty_status: 'OPEN',  total_purchases: 0,  total_amount: 0 },
    // BF — 1 client
    { full_name: 'Drissa Ouédraogo',   phone: '+22670000010', email: 'drissa@demo.af',    country_id: 'BF', loyalty_status: 'LIVE',  total_purchases: 4,  total_amount: 65000 },
  ];

  const clientIds = [];
  const rawPhoneMap = {}; // clientId → raw phone
  const walletMap = {};   // clientId → walletId

  for (const c of clientsData) {
    const phoneHash = hashField(c.phone);
    const existing = (await db.query('SELECT id FROM clients WHERE phone_hash = $1', [phoneHash])).rows[0];
    const clientId = existing ? existing.id : uuidv4();
    rawPhoneMap[clientId] = c.phone;

    if (!existing) {
      const afrikfidId = `AFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      const statusSince = c.loyalty_status === 'ROYAL' ? daysAgo(180)
        : c.loyalty_status === 'GOLD' ? daysAgo(90)
        : c.loyalty_status === 'LIVE' ? daysAgo(30)
        : daysAgo(5);
      await db.query(
        `INSERT INTO clients (id, afrikfid_id, full_name, phone, phone_hash, email, email_hash, country_id,
          loyalty_status, status_since, total_purchases, total_amount, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)`,
        [
          clientId, afrikfidId, c.full_name,
          encrypt(c.phone), phoneHash,
          c.email ? encrypt(c.email) : null, c.email ? hashField(c.email) : null,
          c.country_id, c.loyalty_status, statusSince,
          c.total_purchases, c.total_amount,
        ]
      );
    }

    // Wallet
    const walletId = uuidv4();
    const currency = COUNTRY_CURRENCY[c.country_id] || 'XOF';
    await db.query(
      `INSERT INTO wallets (id, client_id, currency, balance, total_earned, total_spent) VALUES ($1,$2,$3,0,0,0) ON CONFLICT (client_id) DO NOTHING`,
      [walletId, clientId, currency]
    );
    const wRow = (await db.query('SELECT id FROM wallets WHERE client_id=$1', [clientId])).rows[0];
    walletMap[clientId] = wRow.id;

    clientIds.push(clientId);
  }
  console.log(`[SEED] ${clientsData.length} clients`);

  // ─── Transactions ──────────────────────────────────────────────────────────
  const allMerchants = (await db.query("SELECT * FROM merchants")).rows;
  const allClients = (await db.query('SELECT id, loyalty_status, country_id FROM clients')).rows;

  const AMOUNTS_XOF = [8000, 15000, 25000, 35000, 50000, 75000, 100000, 150000, 200000, 350000];
  const AMOUNTS_XAF = [8000, 15000, 25000, 50000, 100000, 200000];
  const AMOUNTS_KES = [500, 1000, 2500, 5000, 10000, 25000];
  const OPERATORS_BY_COUNTRY = {
    CI: ['ORANGE', 'MTN', 'WAVE', 'MOOV'],
    SN: ['ORANGE', 'WAVE', 'FREE_MONEY'],
    CM: ['MTN', 'ORANGE'],
    KE: ['MPESA', 'AIRTEL'],
    BF: ['ORANGE', 'MOOV', 'CORIS'],
    default: ['ORANGE', 'MTN'],
  };
  const PRODUCT_CATEGORIES = ['alimentaire', 'high_tech', 'sante', 'textile', 'services', 'agriculture'];
  // Status distribution: 60% completed, 10% each for others
  const STATUSES_DIST = [
    'completed','completed','completed','completed','completed','completed',
    'failed','pending','expired','refunded',
  ];
  const FAILURE_REASONS = ['INSUFFICIENT_FUNDS', 'OPERATOR_TIMEOUT', 'INVALID_PHONE', 'DAILY_LIMIT_EXCEEDED'];

  const completedTxs = [];
  const refundedTxIds = [];
  let txCount = 0;

  for (let i = 0; i < 150; i++) {
    const merchant = allMerchants[i % allMerchants.length];
    const client = allClients[i % allClients.length];
    const currency = COUNTRY_CURRENCY[merchant.country_id] || 'XOF';
    const amounts = currency === 'KES' ? AMOUNTS_KES : currency === 'XAF' ? AMOUNTS_XAF : AMOUNTS_XOF;
    const amount = amounts[i % amounts.length];

    const X = parseFloat(merchant.rebate_percent);
    const Y_global = LOYALTY_RATES[client.loyalty_status] || 0;
    const effectiveY = Math.min(Y_global, X);
    const Z = X - effectiveY;

    const merchantRebateAmt  = Math.round(amount * X / 100 * 100) / 100;
    const clientRebateAmt    = Math.round(amount * effectiveY / 100 * 100) / 100;
    const platformCommAmt    = Math.round(amount * Z / 100 * 100) / 100;
    const merchantReceives   = amount - merchantRebateAmt;
    const netClientAmount    = amount - clientRebateAmt;

    // Dates denser in recent past
    const daysBack = i < 30 ? i : i < 90 ? 30 + Math.floor((i-30) * 0.5) : 60 + Math.floor((i-90) * 0.33);
    const txDateStr = daysAgo(daysBack);

    const status = STATUSES_DIST[i % STATUSES_DIST.length];
    const completedAt = (status === 'completed' || status === 'refunded') ? txDateStr : null;
    const failureReason = status === 'failed' ? FAILURE_REASONS[i % FAILURE_REASONS.length] : null;
    const expiresAt = (status === 'pending' || status === 'expired') ? daysAgo(daysBack - 0.01) : null;

    const operators = OPERATORS_BY_COUNTRY[merchant.country_id] || OPERATORS_BY_COUNTRY.default;
    const operator = operators[i % operators.length];
    const clientPhone = rawPhoneMap[client.id] || '+22500000000';
    const productCat = PRODUCT_CATEGORIES[i % PRODUCT_CATEGORIES.length];

    const txId = uuidv4();
    const ref = `AFD-${Date.now().toString(36).toUpperCase()}-${String(i).padStart(4,'0')}`;

    await db.query(
      `INSERT INTO transactions (
        id, reference, merchant_id, client_id,
        gross_amount, net_client_amount,
        merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
        merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
        merchant_receives, client_loyalty_status, rebate_mode,
        payment_method, payment_operator, payment_phone, payment_phone_hash,
        status, failure_reason, operator_ref, currency, country_id, product_category,
        initiated_at, completed_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'MOBILE_MONEY',$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
      ON CONFLICT (reference) DO NOTHING`,
      [
        txId, ref, merchant.id, client.id,
        amount, netClientAmount,
        X, effectiveY, Z,
        merchantRebateAmt, clientRebateAmt, platformCommAmt,
        merchantReceives, client.loyalty_status, merchant.rebate_mode,
        operator, clientPhone, hashField(clientPhone),
        status, failureReason,
        status !== 'pending' ? `OP-REF-${txId.slice(0,8).toUpperCase()}` : null,
        currency, merchant.country_id, productCat,
        txDateStr, completedAt, expiresAt,
      ]
    );

    if (status === 'completed') {
      completedTxs.push({ id: txId, ref, client_id: client.id, merchant_id: merchant.id, currency, merchant_id_key: merchant.id,
        client_rebate_amount: clientRebateAmt, merchant_receives: merchantReceives,
        platform_commission_amount: platformCommAmt, merchant_rebate_amount: merchantRebateAmt,
        gross_amount: amount, completed_at: txDateStr, operator });
    }
    if (status === 'refunded') refundedTxIds.push({ id: txId, client_id: client.id, gross_amount: amount, merchant_id: merchant.id, currency,
      client_rebate_amount: clientRebateAmt, merchant_rebate_amount: merchantRebateAmt, platform_commission_amount: platformCommAmt,
      completed_at: txDateStr });
    txCount++;
  }
  console.log(`[SEED] ${txCount} transactions (${completedTxs.length} completed, ${refundedTxIds.length} refunded)`);

  // ─── Wallet Movements ──────────────────────────────────────────────────────
  try {
    const walletBalance = {};
    const walletEarned = {};
    const walletSpent = {};
    for (const wId of Object.values(walletMap)) {
      walletBalance[wId] = 0;
      walletEarned[wId] = 0;
      walletSpent[wId] = 0;
    }

    // Credits for completed transactions
    const sortedTxs = [...completedTxs].sort((a,b) => a.completed_at < b.completed_at ? -1 : 1);
    for (const tx of sortedTxs) {
      if (!tx.client_rebate_amount || tx.client_rebate_amount <= 0) continue;
      const wId = walletMap[tx.client_id];
      if (!wId) continue;
      const before = walletBalance[wId];
      const after = before + tx.client_rebate_amount;
      walletBalance[wId] = after;
      walletEarned[wId] += tx.client_rebate_amount;
      await db.query(
        `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description, created_at)
         VALUES ($1,$2,$3,'credit',$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [uuidv4(), wId, tx.id, tx.client_rebate_amount, before, after, `Cashback tx ${tx.ref}`, tx.completed_at]
      );
    }

    // Debits for refunded transactions
    for (const tx of refundedTxIds) {
      if (!tx.client_rebate_amount || tx.client_rebate_amount <= 0) continue;
      const wId = walletMap[tx.client_id];
      if (!wId) continue;
      const before = walletBalance[wId];
      const after = Math.max(0, before - tx.client_rebate_amount);
      walletBalance[wId] = after;
      walletSpent[wId] += (before - after);
      await db.query(
        `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description, created_at)
         VALUES ($1,$2,$3,'debit',$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [uuidv4(), wId, tx.id, before - after, before, after, `Clawback cashback tx remboursé`, tx.completed_at]
      );
    }

    // Update wallet and client balances
    for (const [clientId, wId] of Object.entries(walletMap)) {
      const bal = walletBalance[wId] || 0;
      const earned = walletEarned[wId] || 0;
      const spent = walletSpent[wId] || 0;
      await db.query('UPDATE wallets SET balance=$1, total_earned=$2, total_spent=$3 WHERE id=$4', [bal, earned, spent, wId]);
      await db.query('UPDATE clients SET wallet_balance=$1 WHERE id=$2', [bal, clientId]);
    }
    console.log('[SEED] Mouvements wallet calculés');
  } catch(e) { console.log('[SEED] wallet_movements skip:', e.message); }

  // ─── Distributions ─────────────────────────────────────────────────────────
  try {
    for (const tx of completedTxs) {
      await db.query(
        `INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, operator, operator_ref, executed_at, created_at)
         VALUES ($1,$2,'merchant',$3,$4,$5,'completed',$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
        [uuidv4(), tx.id, tx.merchant_id, tx.merchant_receives, tx.currency, tx.operator, `DIST-M-${tx.id.slice(0,8)}`, tx.completed_at]
      );
      if (tx.client_rebate_amount > 0) {
        await db.query(
          `INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, operator, operator_ref, executed_at, created_at)
           VALUES ($1,$2,'client',$3,$4,$5,'completed',$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
          [uuidv4(), tx.id, tx.client_id, tx.client_rebate_amount, tx.currency, tx.operator, `DIST-C-${tx.id.slice(0,8)}`, tx.completed_at]
        );
      }
      if (tx.platform_commission_amount > 0) {
        await db.query(
          `INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, operator, operator_ref, executed_at, created_at)
           VALUES ($1,$2,'platform','AFRIKFID',$3,$4,'completed',$5,$6,$7,$7) ON CONFLICT DO NOTHING`,
          [uuidv4(), tx.id, tx.platform_commission_amount, tx.currency, tx.operator, `DIST-P-${tx.id.slice(0,8)}`, tx.completed_at]
        );
      }
    }
    console.log('[SEED] Distributions créées');
  } catch(e) { console.log('[SEED] distributions skip:', e.message); }

  // ─── Disbursements ─────────────────────────────────────────────────────────
  try {
    // Group completed tx by merchant and week
    const merchantWeeks = {}; // merchantId → weekKey → { amount, currency, op, txId, date }
    for (const tx of completedTxs) {
      const daysBack = Math.floor((Date.now() - new Date(tx.completed_at).getTime()) / 86400000);
      const weekKey = Math.floor(daysBack / 7);
      const key = `${tx.merchant_id}:${weekKey}`;
      if (!merchantWeeks[key]) merchantWeeks[key] = { merchant_id: tx.merchant_id, amount: 0, currency: tx.currency, op: tx.operator, txId: tx.id, date: tx.completed_at };
      merchantWeeks[key].amount += tx.merchant_receives;
    }
    let disbCount = 0;
    for (const batch of Object.values(merchantWeeks)) {
      const m = allMerchants.find(x => x.id === batch.merchant_id);
      if (!m) continue;
      const status = m.mm_phone && m.mm_operator ? 'completed' : 'pending_manual';
      await db.query(
        `INSERT INTO disbursements (id, beneficiary_type, beneficiary_id, transaction_id, amount, currency, status, operator, operator_ref, executed_at, created_at)
         VALUES ($1,'merchant',$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT DO NOTHING`,
        [uuidv4(), batch.merchant_id, batch.txId, Math.round(batch.amount), batch.currency, status, m.mm_operator,
         status === 'completed' ? `DISB-${uuidv4().slice(0,8).toUpperCase()}` : null,
         status === 'completed' ? batch.date : null]
      );
      disbCount++;
    }
    // A few pending disbursements for current week
    for (const m of merchantList.filter(x => x.kyc_status === 'approved').slice(0,3)) {
      await db.query(
        `INSERT INTO disbursements (id, beneficiary_type, beneficiary_id, amount, currency, status, created_at)
         VALUES ($1,'merchant',$2,$3,$4,'pending',$5) ON CONFLICT DO NOTHING`,
        [uuidv4(), m.id, pick([50000,80000,120000]), COUNTRY_CURRENCY[m.country_id]||'XOF', daysAgo(1)]
      );
    }
    console.log(`[SEED] ${disbCount} virements`);
  } catch(e) { console.log('[SEED] disbursements skip:', e.message); }

  // ─── Refunds ────────────────────────────────────────────────────────────────
  try {
    const refundScenarios = [
      { idx: 0, type: 'full',    reason: 'client_request',     status: 'completed', daysBack: 5,  ratio: 1 },
      { idx: 1, type: 'partial', reason: 'merchant_error',     status: 'completed', daysBack: 10, ratio: 0.5 },
      { idx: 2, type: 'full',    reason: 'fraud',              status: 'completed', daysBack: 15, ratio: 1 },
      { idx: 3, type: 'partial', reason: 'product_return',     status: 'pending',   daysBack: 2,  ratio: 0.3 },
      { idx: 4, type: 'full',    reason: 'double_charge',      status: 'completed', daysBack: 20, ratio: 1 },
      { idx: 5, type: 'partial', reason: 'service_failure',    status: 'pending',   daysBack: 1,  ratio: 0.75 },
      { idx: 6, type: 'full',    reason: 'client_request',     status: 'overdue',   daysBack: 35, ratio: 1 },
    ];
    for (const s of refundScenarios) {
      const tx = refundedTxIds[s.idx % refundedTxIds.length];
      if (!tx) continue;
      const refundAmt = Math.round(tx.gross_amount * s.ratio);
      await db.query(
        `INSERT INTO refunds (id, transaction_id, amount, refund_type, reason, status, initiated_by,
          merchant_rebate_refunded, client_rebate_refunded, platform_commission_refunded, refund_ratio,
          processed_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
        [
          uuidv4(), tx.id, refundAmt, s.type, s.reason, s.status,
          s.reason === 'fraud' ? 'admin' : 'merchant',
          Math.round(tx.merchant_rebate_amount * s.ratio),
          Math.round(tx.client_rebate_amount * s.ratio),
          Math.round(tx.platform_commission_amount * s.ratio),
          s.ratio,
          s.status === 'completed' ? daysAgo(s.daysBack - 1) : null,
          daysAgo(s.daysBack),
        ]
      );
    }
    console.log(`[SEED] ${refundScenarios.length} remboursements`);
  } catch(e) { console.log('[SEED] refunds skip:', e.message); }

  // ─── Payment Links ──────────────────────────────────────────────────────────
  try {
    const approvedMerchants = merchantList.filter(m => m.kyc_status === 'approved');
    const linkDescriptions = ['Paiement commande', 'Abonnement mensuel', 'Consultation médicale', 'Livraison express'];
    const linkStatuses = ['active', 'active', 'expired', 'fully_used'];
    let linkCount = 0;
    for (const m of approvedMerchants) {
      const currency = COUNTRY_CURRENCY[m.country_id] || 'XOF';
      const amounts = currency === 'KES' ? [1000,5000,10000,25000] : currency === 'XAF' ? [15000,25000,50000,100000] : [5000,15000,25000,75000];
      for (let i = 0; i < 4; i++) {
        const st = linkStatuses[i];
        const maxUses = [1, 5, 10, 1][i];
        const usesCount = st === 'fully_used' ? maxUses : st === 'active' ? Math.floor(maxUses * 0.4) : 0;
        const expiresAt = st === 'expired' ? daysAgo(5) : daysAgo(-30);
        await db.query(
          `INSERT INTO payment_links (id, merchant_id, code, amount, currency, description, expires_at, max_uses, uses_count, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code) DO NOTHING`,
          [uuidv4(), m.id, `${m.id.slice(0,6)}-${Date.now().toString(36)}-${i}`,
           amounts[i % amounts.length], currency, `${linkDescriptions[i % linkDescriptions.length]} #${Math.floor(Math.random()*900)+100}`,
           expiresAt, maxUses, usesCount, st, daysAgo(20 + i * 3)]
        );
        linkCount++;
      }
    }
    console.log(`[SEED] ${linkCount} liens de paiement`);
  } catch(e) { console.log('[SEED] payment_links skip:', e.message); }

  // ─── Webhook Events ─────────────────────────────────────────────────────────
  try {
    const EVENT_TYPES = ['payment.success','payment.success','payment.failed','refund.completed','loyalty.status_changed','payment.expired','distribution.completed'];
    const WH_STATUSES = ['delivered','delivered','delivered','failed','retrying'];
    const approvedMerchants = merchantList.filter(m => m.kyc_status === 'approved' && m.webhook_url);
    let whCount = 0;
    for (const m of approvedMerchants) {
      for (let i = 0; i < 8; i++) {
        const evType = EVENT_TYPES[i % EVENT_TYPES.length];
        const whStatus = WH_STATUSES[i % WH_STATUSES.length];
        const attempts = whStatus === 'failed' ? 4 : whStatus === 'retrying' ? 2 : 1;
        const respCode = whStatus === 'delivered' ? 200 : 503;
        const sentAt = whStatus !== 'retrying' ? daysAgo(i + 1) : null;
        const nextRetry = whStatus === 'retrying' ? hoursAgo(-1) : null;
        const sampleTx = completedTxs[i % completedTxs.length];
        const payload = JSON.stringify({ event: evType, merchant_id: m.id, transaction_id: sampleTx?.id, amount: 50000, currency: 'XOF', timestamp: new Date().toISOString() });
        await db.query(
          `INSERT INTO webhook_events (id, merchant_id, event_type, payload, url, status, attempts, next_retry_at, last_response_code, last_error, created_at, sent_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
          [uuidv4(), m.id, evType, payload, m.webhook_url, whStatus, attempts, nextRetry, respCode,
           whStatus !== 'delivered' ? 'Connection refused: ECONNREFUSED' : null,
           daysAgo(i + 2), sentAt]
        );
        whCount++;
      }
    }
    console.log(`[SEED] ${whCount} événements webhook`);
  } catch(e) { console.log('[SEED] webhook_events skip:', e.message); }

  // ─── Notification Log ───────────────────────────────────────────────────────
  try {
    const NOTIF_TYPES = ['payment_success','payment_failed','loyalty_upgrade','loyalty_downgrade','kyc_approved','kyc_rejected','refund_completed','fraud_blocked'];
    const CHANNELS = ['sms','email'];
    const NOTIF_STATUSES = ['sent','sent','sent','failed','pending'];
    let notifCount = 0;
    for (let i = 0; i < 60; i++) {
      const type = NOTIF_TYPES[i % NOTIF_TYPES.length];
      const channel = CHANNELS[i % CHANNELS.length];
      const status = NOTIF_STATUSES[i % NOTIF_STATUSES.length];
      const client = allClients[i % allClients.length];
      const recipient = channel === 'sms' ? (rawPhoneMap[client.id] || '+22500111001') : `user${i}@demo.af`;
      const error = status === 'failed' ? (channel === 'sms' ? "Africa's Talking: Invalid phone" : 'Mailgun: Domain not verified') : null;
      await db.query(
        `INSERT INTO notification_log (id, type, recipient, channel, status, error, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uuidv4(), type, recipient, channel, status, error, status !== 'pending' ? daysAgo(i * 1.5) : null]
      );
      notifCount++;
    }
    console.log(`[SEED] ${notifCount} notifications`);
  } catch(e) { console.log('[SEED] notification_log skip:', e.message); }

  // ─── Disputes ──────────────────────────────────────────────────────────────
  const disputeIds = [];
  try {
    const disputeScenarios = [
      { status: 'open',          reason: 'non_delivery',         initiator: 'client',  daysBack: 3,  amount_ratio: 1,   resolution: null },
      { status: 'investigating', reason: 'wrong_amount',         initiator: 'merchant',daysBack: 10, amount_ratio: 0.5, resolution: null },
      { status: 'investigating', reason: 'unauthorized_tx',      initiator: 'client',  daysBack: 7,  amount_ratio: 1,   resolution: null },
      { status: 'resolved',      reason: 'service_not_rendered', initiator: 'client',  daysBack: 20, amount_ratio: 1,   resolution: 'Remboursement partiel accepté. Client indemnisé à 50%.' },
      { status: 'resolved',      reason: 'duplicate_charge',     initiator: 'merchant',daysBack: 25, amount_ratio: 1,   resolution: 'Transaction dupliquée confirmée. Remboursement intégral effectué.' },
      { status: 'rejected',      reason: 'fraud_claim',          initiator: 'client',  daysBack: 30, amount_ratio: 1,   resolution: 'Fraude non prouvée. Réclamation rejetée après investigation.' },
      { status: 'open',          reason: 'poor_quality',         initiator: 'client',  daysBack: 1,  amount_ratio: 0.3, resolution: null },
    ];
    for (let i = 0; i < disputeScenarios.length && i < completedTxs.length; i++) {
      const s = disputeScenarios[i];
      const tx = completedTxs[i];
      const client = allClients.find(c => c.id === tx.client_id);
      const disputeId = uuidv4();
      const resolvedAt = (s.status === 'resolved' || s.status === 'rejected') ? daysAgo(s.daysBack - 2) : null;
      await db.query(
        `INSERT INTO disputes (id, transaction_id, merchant_id, client_id, reason, description, amount_disputed, status,
          resolution_note, initiated_by, initiated_by_id, resolved_by, resolved_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) ON CONFLICT DO NOTHING`,
        [
          disputeId, tx.id, tx.merchant_id, tx.client_id,
          s.reason,
          `Litige #${i+1}: ${s.reason.replace(/_/g,' ')} — montant contesté`,
          Math.round(tx.gross_amount * s.amount_ratio),
          s.status, s.resolution,
          s.initiator, s.initiator === 'client' ? tx.client_id : tx.merchant_id,
          resolvedAt ? adminIds.admin : null, resolvedAt,
          daysAgo(s.daysBack),
        ]
      );
      disputeIds.push({ id: disputeId, status: s.status, daysBack: s.daysBack, initiator: s.initiator, client_id: tx.client_id, merchant_id: tx.merchant_id });
    }
    console.log(`[SEED] ${disputeIds.length} litiges`);
  } catch(e) { console.log('[SEED] disputes skip:', e.message); }

  // ─── Dispute History ────────────────────────────────────────────────────────
  try {
    const DISPUTE_TIMELINES = {
      open:          [{ action: 'opened',           performer: 'client' }],
      investigating: [{ action: 'opened',            performer: 'client'  },
                      { action: 'assigned_to_ops',  performer: 'admin'   },
                      { action: 'evidence_requested',performer: 'admin'   }],
      resolved:      [{ action: 'opened',            performer: 'client'  },
                      { action: 'assigned_to_ops',  performer: 'admin'   },
                      { action: 'resolution_proposed',performer:'admin'   },
                      { action: 'resolved',          performer: 'admin'   }],
      rejected:      [{ action: 'opened',            performer: 'client'  },
                      { action: 'assigned_to_ops',  performer: 'admin'   },
                      { action: 'evidence_requested',performer: 'admin'   },
                      { action: 'rejected',          performer: 'admin', note: 'Preuves insuffisantes' }],
    };
    for (const d of disputeIds) {
      const timeline = DISPUTE_TIMELINES[d.status] || DISPUTE_TIMELINES.open;
      for (let step = 0; step < timeline.length; step++) {
        const t = timeline[step];
        const performerId = t.performer === 'admin' ? adminIds.admin : (t.performer === 'client' ? d.client_id : d.merchant_id);
        await db.query(
          `INSERT INTO dispute_history (id, dispute_id, action, performed_by, performed_by_id, note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [uuidv4(), d.id, t.action, t.performer, performerId, t.note || null, daysAgo(d.daysBack - step * 1.5)]
        );
      }
    }
    console.log('[SEED] Historique litiges');
  } catch(e) { console.log('[SEED] dispute_history skip:', e.message); }

  // ─── Loyalty Status History ─────────────────────────────────────────────────
  try {
    const LOYALTY_ORDER = ['OPEN','LIVE','GOLD','ROYAL'];
    let histCount = 0;
    for (let ci = 0; ci < allClients.length; ci++) {
      const client = allClients[ci];
      const statusIdx = LOYALTY_ORDER.indexOf(client.loyalty_status);
      if (statusIdx <= 0) continue;
      // Create progression history
      for (let step = 1; step <= statusIdx; step++) {
        const old_status = LOYALTY_ORDER[step - 1];
        const new_status = LOYALTY_ORDER[step];
        const dBack = (statusIdx - step + 1) * 30 + ci * 2;
        await db.query(
          `INSERT INTO loyalty_status_history (id, client_id, old_status, new_status, reason, changed_by, stats, changed_at)
           VALUES ($1,$2,$3,$4,'upgrade','batch',$5,$6) ON CONFLICT DO NOTHING`,
          [uuidv4(), client.id, old_status, new_status,
           JSON.stringify({ purchases: step * 5 + ci, cumulative_amount: step * 100000 + ci * 5000, evaluation_period_months: 3 }),
           daysAgo(dBack)]
        );
        histCount++;
      }
    }
    console.log(`[SEED] ${histCount} historiques fidélité`);
  } catch(e) { console.log('[SEED] loyalty_status_history skip:', e.message); }

  // ─── Audit Logs ─────────────────────────────────────────────────────────────
  try {
    const medicam = merchantMap['medicam@demo.af'];
    const ouaga = merchantMap['ouaga@demo.af'];
    const auditEvents = [
      { actor: 'admin', actor_id: adminIds.admin, action: 'kyc.approved',   resource_type: 'merchant', resource_id: medicam?.id, payload: '{"kyc_status":"approved"}', ip: '41.203.64.12', daysBack: 10 },
      { actor: 'admin', actor_id: adminIds.admin, action: 'kyc.rejected',   resource_type: 'merchant', resource_id: ouaga?.id,   payload: '{"reason":"Document illisible"}', ip: '41.203.64.12', daysBack: 9 },
      { actor: 'admin', actor_id: adminIds.superadmin, action: 'fraud_rule.created', resource_type: 'fraud_rule', payload: '{"rule_type":"velocity_3h","value":"5"}', ip: '196.207.10.45', daysBack: 20 },
      { actor: 'admin', actor_id: adminIds.admin,      action: 'fraud_rule.disabled', resource_type: 'fraud_rule', payload: '{"is_active":false,"rule_type":"anomaly_zscore"}', ip: '41.203.64.12', daysBack: 15 },
      { actor: 'admin', actor_id: adminIds.admin, action: 'phone.blocked',   resource_type: 'blocked_phone', payload: '{"phone":"+22500999001","reason":"Fraude"}', ip: '41.203.64.12', daysBack: 55 },
      { actor: 'admin', actor_id: adminIds.superadmin, action: 'exchange_rate.updated', resource_type: 'exchange_rate', payload: '{"from":"KES","to":"EUR","rate":0.00712}', ip: '196.207.10.45', daysBack: 5 },
      { actor: 'admin', actor_id: adminIds.superadmin, action: 'loyalty_config.updated', resource_type: 'loyalty_config', payload: '{"status":"GOLD","client_rebate_percent":8}', ip: '196.207.10.45', daysBack: 30 },
      { actor: 'admin', actor_id: adminIds.admin, action: 'merchant.suspended', resource_type: 'merchant', resource_id: ouaga?.id, payload: '{"reason":"KYC rejeté"}', ip: '41.203.64.12', daysBack: 8 },
      { actor: 'admin', actor_id: adminIds.superadmin, action: 'admin.login', ip: '196.207.10.45', daysBack: 1 },
      { actor: 'admin', actor_id: adminIds.admin,      action: 'admin.login', ip: '41.203.64.12', daysBack: 2 },
      { actor: 'admin', actor_id: adminIds.auditor,    action: 'admin.login', ip: '102.89.32.5', daysBack: 3 },
      { actor: 'admin', actor_id: adminIds.admin, action: 'dispute.resolved', resource_type: 'dispute', payload: '{"resolution":"Remboursement partiel"}', ip: '41.203.64.12', daysBack: 18 },
      { actor: 'admin', actor_id: adminIds.superadmin, action: 'disbursement.triggered', resource_type: 'disbursement', payload: '{"amount":250000,"currency":"XOF"}', ip: '196.207.10.45', daysBack: 7 },
      { actor: 'admin', actor_id: adminIds.admin, action: 'client.export_requested', resource_type: 'client', payload: '{"reason":"RGPD portabilité"}', ip: '41.203.64.12', daysBack: 12 },
      { actor: 'admin', actor_id: adminIds.superadmin, action: 'exchange_rate.refresh_triggered', resource_type: 'exchange_rate', payload: '{"source":"openexchangerates"}', ip: '196.207.10.45', daysBack: 2 },
    ];
    for (const e of auditEvents) {
      await db.query(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload, ip_address, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [uuidv4(), e.actor, e.actor_id, e.action, e.resource_type||null, e.resource_id||null, e.payload||null, e.ip, daysAgo(e.daysBack)]
      );
    }
    console.log(`[SEED] ${auditEvents.length} logs d'audit`);
  } catch(e) { console.log('[SEED] audit_logs skip:', e.message); }

  // ─── Exchange Rates ─────────────────────────────────────────────────────────
  const exchangeRates = [
    { from: 'XOF', to: 'EUR', rate: 0.001524 },
    { from: 'XAF', to: 'EUR', rate: 0.001524 },
    { from: 'KES', to: 'EUR', rate: 0.00712  },
    { from: 'EUR', to: 'XOF', rate: 655.957  },
    { from: 'EUR', to: 'XAF', rate: 655.957  },
    { from: 'EUR', to: 'KES', rate: 140.45   },
    { from: 'XOF', to: 'XAF', rate: 1.0      },
    { from: 'XAF', to: 'XOF', rate: 1.0      },
  ];
  for (const r of exchangeRates) {
    await db.query(
      `INSERT INTO exchange_rates (id, from_currency, to_currency, rate, source, updated_at)
       VALUES ($1,$2,$3,$4,'initial',NOW())
       ON CONFLICT (from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, updated_at=NOW()`,
      [uuidv4(), r.from, r.to, r.rate]
    );
  }
  console.log('[SEED] Taux de change');

  // ─── Update client purchase stats from real transactions ───────────────────
  try {
    const stats = (await db.query(
      `SELECT client_id, COUNT(*)::int AS cnt, SUM(gross_amount)::numeric AS total
       FROM transactions WHERE status='completed' GROUP BY client_id`
    )).rows;
    for (const s of stats) {
      await db.query('UPDATE clients SET total_purchases=$1, total_amount=$2 WHERE id=$3', [s.cnt, s.total, s.client_id]);
    }
    console.log('[SEED] Stats clients mises à jour');
  } catch(e) { console.log('[SEED] stats clients skip:', e.message); }

  // ─── Résumé ────────────────────────────────────────────────────────────────
  console.log('\n[SEED] Seed terminé !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Admins           : 3  (superadmin, admin, auditor)');
  console.log(' Marchands        : 10 (CI×3, SN×2, CM×2, KE×1, BF×2)');
  console.log(' Clients          : 20 (ROYAL×3, GOLD×5, LIVE×7, OPEN×5)');
  console.log(' Transactions     : 150 (completed ~90, failed/pending/expired/refunded ~60)');
  console.log(' Distributions    : ~270 lignes');
  console.log(' Remboursements   : 7  (full/partial, statuts variés)');
  console.log(' Litiges          : 7  (open×2, investigating×2, resolved×2, rejected×1)');
  console.log(' Règles fraude    : 8');
  console.log(' Numéros bloqués  : 7');
  console.log(' Liens paiement   : ~32 (active/expired/fully_used)');
  console.log(' Webhooks         : ~56 (delivered/failed/retrying)');
  console.log(' Notifications    : 60 (SMS+email)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Admin            : admin@afrikfid.com / Admin@2026!');
  console.log(' Marchands        : supermarche@demo.af (et autres) / Merchant@2026!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await db.pool.end();
  process.exit(0);
}

seed().catch(err => { console.error('[SEED] ERREUR:', err.message); process.exit(1); });
