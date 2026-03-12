require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('./lib/db');

async function seed() {
  console.log("🌱 Seeding Afrik'Fid database...");

  // ─── Countries ────────────────────────────────────────────────────────────
  const countries = [
    { id: 'CI', name: "Côte d'Ivoire", currency: 'XOF', zone: 'UEMOA' },
    { id: 'SN', name: 'Sénégal', currency: 'XOF', zone: 'UEMOA' },
    { id: 'BF', name: 'Burkina Faso', currency: 'XOF', zone: 'UEMOA' },
    { id: 'ML', name: 'Mali', currency: 'XOF', zone: 'UEMOA' },
    { id: 'NE', name: 'Niger', currency: 'XOF', zone: 'UEMOA' },
    { id: 'TG', name: 'Togo', currency: 'XOF', zone: 'UEMOA' },
    { id: 'BJ', name: 'Bénin', currency: 'XOF', zone: 'UEMOA' },
    { id: 'CM', name: 'Cameroun', currency: 'XAF', zone: 'CEMAC' },
    { id: 'TD', name: 'Tchad', currency: 'XAF', zone: 'CEMAC' },
    { id: 'CG', name: 'Congo', currency: 'XAF', zone: 'CEMAC' },
    { id: 'GA', name: 'Gabon', currency: 'XAF', zone: 'CEMAC' },
    { id: 'KE', name: 'Kenya', currency: 'KES', zone: 'EA' },
  ];

  for (const c of countries) {
    await db.query(
      'INSERT INTO countries (id, name, currency, zone) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [c.id, c.name, c.currency, c.zone]
    );
  }
  console.log(`✅ ${countries.length} pays insérés`);

  // ─── Loyalty Config ────────────────────────────────────────────────────────
  const loyaltyConfigs = [
    { id: 'LC-OPEN',  status: 'OPEN',  client_rebate_percent: 0,  label: 'Open',  color: '#6B7280', sort_order: 0, min_purchases: 0,  min_cumulative_amount: 0,       evaluation_months: 3,  inactivity_months: 12 },
    { id: 'LC-LIVE',  status: 'LIVE',  client_rebate_percent: 5,  label: 'Live',  color: '#3B82F6', sort_order: 1, min_purchases: 3,  min_cumulative_amount: 50000,   evaluation_months: 3,  inactivity_months: 6 },
    { id: 'LC-GOLD',  status: 'GOLD',  client_rebate_percent: 8,  label: 'Gold',  color: '#F59E0B', sort_order: 2, min_purchases: 10, min_cumulative_amount: 200000,  evaluation_months: 6,  inactivity_months: 6 },
    { id: 'LC-ROYAL', status: 'ROYAL', client_rebate_percent: 10, label: 'Royal', color: '#8B5CF6', sort_order: 3, min_purchases: 30, min_cumulative_amount: 1000000, evaluation_months: 12, inactivity_months: 12 },
  ];

  for (const lc of loyaltyConfigs) {
    await db.query(
      `INSERT INTO loyalty_config (id, status, client_rebate_percent, label, color, sort_order, min_purchases, min_cumulative_amount, evaluation_months, inactivity_months)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [lc.id, lc.status, lc.client_rebate_percent, lc.label, lc.color, lc.sort_order, lc.min_purchases, lc.min_cumulative_amount, lc.evaluation_months, lc.inactivity_months]
    );
  }
  console.log('✅ Config fidélité insérée');

  // ─── Admin ─────────────────────────────────────────────────────────────────
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@afrikfid.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@2026!';
  const adminHash = await bcrypt.hash(adminPassword, 10);

  await db.query(
    `INSERT INTO admins (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'Super Admin', 'admin') ON CONFLICT (email) DO NOTHING`,
    [uuidv4(), adminEmail, adminHash]
  );
  console.log(`✅ Admin créé: ${adminEmail}`);

  // ─── Marchands démo ────────────────────────────────────────────────────────
  const merchantPassword = await bcrypt.hash('Merchant@2026!', 10);
  const merchants = [
    { id: uuidv4(), name: 'SuperMarché Abidjan Centre', email: 'supermarche@demo.af', phone: '+22507000001', country_id: 'CI', category: 'retail',       rebate_percent: 10, rebate_mode: 'cashback',   status: 'active', kyc_status: 'approved' },
    { id: uuidv4(), name: 'Pharmacie Latrille Plus',    email: 'pharmacie@demo.af',   phone: '+22507000002', country_id: 'CI', category: 'pharmacy',      rebate_percent: 7,  rebate_mode: 'immediate',  status: 'active', kyc_status: 'approved' },
    { id: uuidv4(), name: 'Restaurant Chez Maman',      email: 'restaurant@demo.af',  phone: '+22507000003', country_id: 'CI', category: 'restaurant',    rebate_percent: 8,  rebate_mode: 'cashback',   status: 'active', kyc_status: 'approved' },
    { id: uuidv4(), name: 'Tech Boutique Dakar',         email: 'tech@demo.af',        phone: '+22177000004', country_id: 'SN', category: 'electronics',   rebate_percent: 5,  rebate_mode: 'cashback',   status: 'active', kyc_status: 'approved' },
  ];

  for (const m of merchants) {
    await db.query(
      `INSERT INTO merchants (id, name, email, phone, country_id, category, rebate_percent, rebate_mode,
        api_key_public, api_key_secret, sandbox_key_public, sandbox_key_secret, status, kyc_status, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT (email) DO NOTHING`,
      [
        m.id, m.name, m.email, m.phone, m.country_id, m.category, m.rebate_percent, m.rebate_mode,
        `af_pub_${m.id.replace(/-/g, '').slice(0, 24)}`,
        `af_sec_${m.id.replace(/-/g, '')}`,
        `af_sandbox_pub_${m.id.replace(/-/g, '').slice(0, 20)}`,
        `af_sandbox_sec_${m.id.replace(/-/g, '')}`,
        m.status, m.kyc_status, merchantPassword,
      ]
    );
  }
  console.log(`✅ ${merchants.length} marchands démo créés`);

  // ─── Clients démo ─────────────────────────────────────────────────────────
  const clientsData = [
    { full_name: 'Kofi Mensah',        phone: '+22500111001', email: 'kofi@demo.af',   country_id: 'CI', loyalty_status: 'ROYAL' },
    { full_name: 'Fatou Diallo',        phone: '+22500111002', email: 'fatou@demo.af',  country_id: 'CI', loyalty_status: 'GOLD' },
    { full_name: 'Amadou Traoré',       phone: '+22500111003', email: 'amadou@demo.af', country_id: 'CI', loyalty_status: 'LIVE' },
    { full_name: 'Marie Kouassi',       phone: '+22500111004', email: 'marie@demo.af',  country_id: 'CI', loyalty_status: 'OPEN' },
    { full_name: 'Ibrahim Coulibaly',   phone: '+22500111005', email: null,             country_id: 'CI', loyalty_status: 'LIVE' },
    { full_name: 'Awa Sarr',            phone: '+22177000005', email: 'awa@demo.af',    country_id: 'SN', loyalty_status: 'GOLD' },
  ];

  const clientIds = [];
  for (const c of clientsData) {
    const clientId = uuidv4();
    const afrikfidId = `AFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await db.query(
      `INSERT INTO clients (id, afrikfid_id, full_name, phone, email, country_id, loyalty_status) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (phone) DO NOTHING`,
      [clientId, afrikfidId, c.full_name, c.phone, c.email, c.country_id, c.loyalty_status]
    );
    await db.query('INSERT INTO wallets (id, client_id) VALUES ($1, $2) ON CONFLICT (client_id) DO NOTHING', [uuidv4(), clientId]);
    clientIds.push(clientId);
  }
  console.log(`✅ ${clientsData.length} clients démo créés`);

  // ─── Transactions démo ────────────────────────────────────────────────────
  const allMerchants = (await db.query("SELECT * FROM merchants WHERE status = 'active'")).rows;
  const allClients = (await db.query('SELECT * FROM clients')).rows;

  const amounts = [15000, 25000, 50000, 75000, 100000, 150000, 200000];
  const operators = ['ORANGE', 'MTN', 'WAVE'];
  const loyaltyRates = { OPEN: 0, LIVE: 5, GOLD: 8, ROYAL: 10 };
  let txCount = 0;

  for (let i = 0; i < 50; i++) {
    const merchant = allMerchants[i % allMerchants.length];
    const client = allClients[i % allClients.length];
    const amount = amounts[i % amounts.length];
    const Y = loyaltyRates[client.loyalty_status] || 0;
    const X = parseFloat(merchant.rebate_percent);
    const effectiveY = Math.min(Y, X);
    const Z = X - effectiveY;

    const merchantRebateAmt  = Math.round((amount * X) / 100 * 100) / 100;
    const clientRebateAmt    = Math.round((amount * effectiveY) / 100 * 100) / 100;
    const platformCommAmt    = Math.round((amount * Z) / 100 * 100) / 100;
    const merchantReceives   = amount - merchantRebateAmt;

    const daysAgo = Math.floor(Math.random() * 30);
    const txDate = new Date();
    txDate.setDate(txDate.getDate() - daysAgo);
    const txDateStr = txDate.toISOString();

    const txId = uuidv4();
    const ref = `AFD-DEMO-${Date.now()}-${i}`;

    await db.query(
      `INSERT INTO transactions (
        id, reference, merchant_id, client_id,
        gross_amount, net_client_amount,
        merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
        merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
        merchant_receives, client_loyalty_status, rebate_mode,
        payment_method, payment_operator, status, currency, initiated_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'MOBILE_MONEY', $16, 'completed', 'XOF', $17, $18)
      ON CONFLICT (reference) DO NOTHING`,
      [
        txId, ref, merchant.id, client.id,
        amount, amount - clientRebateAmt,
        X, effectiveY, Z,
        merchantRebateAmt, clientRebateAmt, platformCommAmt,
        merchantReceives, client.loyalty_status, merchant.rebate_mode,
        operators[i % operators.length], txDateStr, txDateStr,
      ]
    );
    txCount++;
  }
  console.log(`✅ ${txCount} transactions démo créées`);

  console.log('\n🎉 Seed terminé !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Admin: ${adminEmail} / ${adminPassword}`);
  console.log('Marchands: supermarche@demo.af (et autres) / Merchant@2026!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await db.pool.end();
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
