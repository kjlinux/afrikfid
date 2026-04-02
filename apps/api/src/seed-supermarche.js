/**
 * seed-supermarche.js — Données réalistes pour SuperMarché Abidjan Centre
 * Package GROWTH → active : basic_kpis, loyalty_score, return_rate, top_clients,
 *                            churn_alerts, rfm_simple, rfm_detailed, churn_predictions, campaigns
 *
 * Usage : node src/seed-supermarche.js
 */
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('./lib/db');
const { encrypt, hashField } = require('./lib/crypto');

const daysAgo  = n => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = n => new Date(Date.now() + n * 86400000).toISOString();
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const MID = 'cf407301-6a55-4869-bbea-4fe1dc409bb9'; // SuperMarché Abidjan Centre

async function run() {
  console.log('[SEED-SM] SuperMarché Abidjan Centre — injection données intelligence...');

  // ── 1. Corriger les statuts fidélité des clients existants ─────────────────
  const STATUS_MAP = [
    // [full_name_fragment, loyalty_status, total_purchases, total_amount, city, district]
    ['Kofi Mensah',       'ROYAL',  42, 1850000, 'Abidjan', 'Cocody'],
    ['Fatou Diallo',      'GOLD',   14,  380000, 'Abidjan', 'Plateau'],
    ['Amadou Traoré',     'LIVE',    5,   95000, 'Abidjan', 'Yopougon'],
    ['Marie Kouassi',     'OPEN',    1,   15000, 'Abidjan', 'Marcory'],
    ['Ibrahim Coulibaly', 'LIVE',    4,   72000, 'Abidjan', 'Yopougon'],
    ['Adjoa Yeboah',      'GOLD',   11,  245000, 'Abidjan', 'Cocody'],
    ['Siméon Brou',       'OPEN',    0,       0, 'Abidjan', 'Plateau'],
    ["Clarisse N'Goran",  'LIVE',    3,   58000, 'Abidjan', 'Marcory'],
    ['Awa Sarr',          'GOLD',   13,  310000, 'Dakar',   'Plateau'],
    ['Salimata Touré',    'ROYAL',  35, 1250000, 'Dakar',   'Almadies'],
    ['Ibrahima Fall',     'LIVE',    6,  120000, 'Dakar',   'Medina'],
    ['Mariama Diop',      'OPEN',    2,   28000, 'Dakar',   null],
    ['Jean-Pierre Mbida', 'LIVE',    4,   85000, 'Douala',  'Bonanjo'],
    ['Cécile Biya',       'GOLD',   12,  280000, 'Douala',  'Bonapriso'],
    ['Hervé Nkomo',       'OPEN',    1,   22000, 'Douala',  null],
    ['Doris Tchamba',     'LIVE',    7,  145000, 'Douala',  'Akwa'],
    ['David Kamau',       'ROYAL',  38, 1500000, 'Nairobi', 'Westlands'],
    ['Wanjiku Mwangi',    'LIVE',    5,   95000, 'Nairobi', 'CBD'],
    ['Omondi Ochieng',    'OPEN',    0,       0, 'Nairobi', null],
    ['Drissa Ouédraogo',  'LIVE',    4,   65000, 'Ouagadougou', null],
  ];

  for (const [name, status, purchases, amount, city, district] of STATUS_MAP) {
    await db.query(
      `UPDATE clients SET loyalty_status=$1, total_purchases=$2, total_amount=$3,
       city=$4, district=$5, status_since=NOW()-INTERVAL '90 days'
       WHERE full_name=$6`,
      [status, purchases, amount, city, district, name]
    );
  }
  console.log('[SEED-SM] Statuts fidélité et géolocalisation clients corrigés');

  // ── 2. Ajouter des clients dédiés au SuperMarché ──────────────────────────
  const clientPassword = await bcrypt.hash('Client@2026!', 10);
  const newClients = [
    { full_name: 'Oumar Bamba',       phone: '+22500222001', email: 'oumar@demo.af',    loyalty_status: 'ROYAL_ELITE', purchases: 65, amount: 3200000, city: 'Abidjan', district: 'Cocody' },
    { full_name: 'Aissatou Koné',     phone: '+22500222002', email: 'aissatou@demo.af', loyalty_status: 'ROYAL',       purchases: 38, amount: 1450000, city: 'Abidjan', district: 'Plateau' },
    { full_name: 'Yves Assoumou',     phone: '+22500222003', email: 'yves@demo.af',     loyalty_status: 'GOLD',        purchases: 16, amount:  420000, city: 'Abidjan', district: 'Yopougon' },
    { full_name: 'Nadia Touré',       phone: '+22500222004', email: 'nadia@demo.af',    loyalty_status: 'GOLD',        purchases: 12, amount:  295000, city: 'Abidjan', district: 'Marcory' },
    { full_name: 'Serge Koffi',       phone: '+22500222005', email: null,               loyalty_status: 'LIVE',        purchases:  7, amount:  135000, city: 'Abidjan', district: 'Yopougon' },
    { full_name: 'Pauline Aka',       phone: '+22500222006', email: 'pauline@demo.af',  loyalty_status: 'LIVE',        purchases:  4, amount:   68000, city: 'Abidjan', district: 'Cocody' },
    { full_name: 'Hamidou Diarra',    phone: '+22500222007', email: null,               loyalty_status: 'OPEN',        purchases:  1, amount:   12000, city: 'Abidjan', district: 'Plateau' },
    { full_name: 'Constance Blé',     phone: '+22500222008', email: 'constance@demo.af',loyalty_status: 'A_RISQUE',    purchases:  8, amount:  180000, city: 'Abidjan', district: 'Marcory' },
    { full_name: 'Moussa Sanogo',     phone: '+22500222009', email: null,               loyalty_status: 'A_RISQUE',    purchases:  5, amount:   95000, city: 'Abidjan', district: 'Yopougon' },
    { full_name: 'Raïssa Gbagbo',     phone: '+22500222010', email: 'raissa@demo.af',   loyalty_status: 'HIBERNANTS',  purchases:  3, amount:   42000, city: 'Abidjan', district: 'Cocody' },
    { full_name: 'Thierno Baldé',     phone: '+22500222011', email: null,               loyalty_status: 'HIBERNANTS',  purchases:  2, amount:   28000, city: 'Bouaké',  district: null },
    { full_name: 'Florence Gnangui',  phone: '+22500222012', email: 'florence@demo.af', loyalty_status: 'PERDUS',      purchases:  1, amount:    8000, city: 'Abidjan', district: 'Plateau' },
  ];

  const smClientIds = [];
  for (const c of newClients) {
    const phoneHash = hashField(c.phone);
    const existing = (await db.query('SELECT id FROM clients WHERE phone_hash=$1', [phoneHash])).rows[0];
    const clientId = existing ? existing.id : uuidv4();
    if (!existing) {
      const afrikfidId = `AFD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      // Pour les statuts A_RISQUE/HIBERNANTS/PERDUS on utilise OPEN en DB (pas dans LOYALTY_STATUSES)
      const dbStatus = ['A_RISQUE','HIBERNANTS','PERDUS'].includes(c.loyalty_status) ? 'OPEN' : c.loyalty_status;
      await db.query(
        `INSERT INTO clients (id, afrikfid_id, full_name, phone, phone_hash, email, email_hash,
           country_id, loyalty_status, status_since, total_purchases, total_amount, city, district, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CI',$8,NOW()-INTERVAL '60 days',$9,$10,$11,$12,true)`,
        [clientId, afrikfidId, c.full_name,
         encrypt(c.phone), phoneHash,
         c.email ? encrypt(c.email) : null, c.email ? hashField(c.email) : null,
         dbStatus, c.purchases, c.amount, c.city, c.district]
      );
      // Wallet
      await db.query(
        `INSERT INTO wallets (id, client_id, currency, balance, total_earned, total_spent)
         VALUES ($1,$2,'XOF',$3,$3,0) ON CONFLICT (client_id) DO NOTHING`,
        [uuidv4(), clientId, Math.round(c.amount * 0.08)]
      );
    }
    smClientIds.push({ id: clientId, ...c });
  }
  console.log(`[SEED-SM] ${newClients.length} clients spécifiques SuperMarché`);

  // Récupérer tous les clients CI pour les transactions
  const allClients = (await db.query(
    "SELECT id, loyalty_status, city FROM clients WHERE country_id='CI'"
  )).rows;

  // ── 3. Transactions supplémentaires pour SuperMarché ──────────────────────
  const AMOUNTS = [8500, 12000, 18000, 25000, 35000, 50000, 75000, 100000, 150000, 200000, 280000, 350000];
  const OPERATORS = ['ORANGE', 'MTN', 'WAVE', 'MOOV'];
  const CATEGORIES = ['alimentaire', 'boisson', 'hygiène', 'textile', 'high_tech', 'maison'];
  const STATUSES = ['completed','completed','completed','completed','completed','completed','failed','pending'];

  let txCount = 0;
  // Générer 6 mois de transactions denses (180 transactions supplémentaires)
  for (let i = 0; i < 180; i++) {
    const client = allClients[i % allClients.length];
    const amount = AMOUNTS[i % AMOUNTS.length];
    const X = 10; // rebate SuperMarché = 10%
    const LOYALTY_RATES = { OPEN: 0, LIVE: 5, GOLD: 8, ROYAL: 12, ROYAL_ELITE: 12 };
    const Y = Math.min(LOYALTY_RATES[client.loyalty_status] || 0, X);
    const Z = X - Y;
    const merchantRebateAmt  = Math.round(amount * X / 100);
    const clientRebateAmt    = Math.round(amount * Y / 100);
    const platformCommAmt    = Math.round(amount * Z / 100);
    const merchantReceives   = amount - merchantRebateAmt;
    const netClientAmount    = amount - clientRebateAmt;
    // Distribution sur 6 mois, plus dense les 2 derniers mois
    const daysBack = i < 60 ? rand(1, 30) : i < 120 ? rand(30, 90) : rand(90, 180);
    const status = STATUSES[i % STATUSES.length];
    const txDate = daysAgo(daysBack);
    const ref = `AFD-SM-${Date.now().toString(36).toUpperCase()}-${String(i).padStart(4,'0')}`;

    await db.query(
      `INSERT INTO transactions (
        id, reference, merchant_id, client_id,
        gross_amount, net_client_amount,
        merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
        merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
        merchant_receives, client_loyalty_status, rebate_mode,
        payment_method, payment_operator, payment_phone, payment_phone_hash,
        status, operator_ref, currency, country_id, product_category,
        initiated_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'cashback',
        'MOBILE_MONEY',$15,$16,$17,$18,$19,'XOF','CI',$20,$21,$22)
      ON CONFLICT (reference) DO NOTHING`,
      [
        uuidv4(), ref, MID, client.id,
        amount, netClientAmount,
        X, Y, Z,
        merchantRebateAmt, clientRebateAmt, platformCommAmt,
        merchantReceives, client.loyalty_status,
        pick(OPERATORS), '+22500000000', hashField('+22500000000'),
        status,
        status !== 'pending' ? `OP-SM-${uuidv4().slice(0,8).toUpperCase()}` : null,
        pick(CATEGORIES),
        txDate, status === 'completed' ? txDate : null,
      ]
    );
    if (status === 'completed') txCount++;
  }
  console.log(`[SEED-SM] ${txCount} transactions completed ajoutées`);

  // ── 4. RFM Scores pour SuperMarché ────────────────────────────────────────
  const RFM_DATA = [
    // Champions (clients fidèles, achats récents et élevés)
    { status: 'ROYAL_ELITE', segment: 'CHAMPIONS',   r: 5, f: 5, m: 5, days: 2,  count: 52, total: 3200000 },
    { status: 'ROYAL',       segment: 'CHAMPIONS',   r: 5, f: 4, m: 4, days: 3,  count: 38, total: 1450000 },
    { status: 'ROYAL',       segment: 'CHAMPIONS',   r: 4, f: 5, m: 4, days: 5,  count: 35, total: 1250000 },
    { status: 'ROYAL',       segment: 'CHAMPIONS',   r: 5, f: 4, m: 5, days: 4,  count: 42, total: 1850000 },
    // Fidèles
    { status: 'GOLD',        segment: 'FIDELES',     r: 4, f: 3, m: 3, days: 12, count: 16, total:  420000 },
    { status: 'GOLD',        segment: 'FIDELES',     r: 4, f: 3, m: 4, days: 10, count: 13, total:  380000 },
    { status: 'GOLD',        segment: 'FIDELES',     r: 3, f: 4, m: 3, days: 14, count: 12, total:  295000 },
    { status: 'GOLD',        segment: 'FIDELES',     r: 4, f: 3, m: 3, days: 11, count: 11, total:  245000 },
    { status: 'GOLD',        segment: 'FIDELES',     r: 3, f: 3, m: 3, days: 18, count: 12, total:  280000 },
    // Prometteurs
    { status: 'LIVE',        segment: 'PROMETTEURS', r: 3, f: 2, m: 2, days: 20, count:  7, total:  135000 },
    { status: 'LIVE',        segment: 'PROMETTEURS', r: 3, f: 2, m: 2, days: 22, count:  6, total:  120000 },
    { status: 'LIVE',        segment: 'PROMETTEURS', r: 2, f: 2, m: 2, days: 25, count:  5, total:   95000 },
    { status: 'LIVE',        segment: 'PROMETTEURS', r: 3, f: 2, m: 2, days: 21, count:  7, total:  145000 },
    { status: 'LIVE',        segment: 'PROMETTEURS', r: 2, f: 3, m: 2, days: 19, count:  4, total:   68000 },
    // À Risque
    { status: 'OPEN',        segment: 'A_RISQUE',    r: 2, f: 2, m: 2, days: 45, count:  8, total:  180000 },
    { status: 'OPEN',        segment: 'A_RISQUE',    r: 2, f: 1, m: 2, days: 50, count:  5, total:   95000 },
    // Hibernants
    { status: 'OPEN',        segment: 'HIBERNANTS',  r: 2, f: 1, m: 1, days: 80, count:  3, total:   42000 },
    { status: 'OPEN',        segment: 'HIBERNANTS',  r: 1, f: 1, m: 1, days: 95, count:  2, total:   28000 },
    // Perdus
    { status: 'OPEN',        segment: 'PERDUS',      r: 1, f: 1, m: 1, days: 150, count: 1, total:    8000 },
  ];

  // Associer les clients SuperMarché + clients généraux
  const smAll = [...smClientIds, ...allClients.slice(0, RFM_DATA.length - smClientIds.length)];

  for (let i = 0; i < RFM_DATA.length; i++) {
    const d = RFM_DATA[i];
    const clientId = smAll[i % smAll.length]?.id || allClients[0].id;
    await db.query(
      `INSERT INTO rfm_scores (id, merchant_id, client_id, r_score, f_score, m_score, segment,
         last_purchase_at, purchase_count, total_amount, calculated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (merchant_id, client_id) DO UPDATE
         SET r_score=$4, f_score=$5, m_score=$6, segment=$7,
             last_purchase_at=$8, purchase_count=$9, total_amount=$10, calculated_at=NOW()`,
      [uuidv4(), MID, clientId, d.r, d.f, d.m, d.segment,
       daysAgo(d.days), d.count, d.total]
    );
  }
  console.log(`[SEED-SM] ${RFM_DATA.length} scores RFM injectés`);

  // ── 5. RFM Transitions ────────────────────────────────────────────────────
  const transitions = [
    { old: 'HIBERNANTS', new: 'PROMETTEURS', old_r: 1, new_r: 3, days: 5,  trigger: 'WIN_BACK' },
    { old: 'A_RISQUE',   new: 'FIDELES',     old_r: 2, new_r: 4, days: 12, trigger: null },
    { old: 'PROMETTEURS',new: 'CHAMPIONS',   old_r: 3, new_r: 5, days: 20, trigger: null },
    { old: 'FIDELES',    new: 'A_RISQUE',    old_r: 4, new_r: 2, days: 8,  trigger: 'ALERTE_R' },
    { old: 'CHAMPIONS',  new: 'FIDELES',     old_r: 5, new_r: 4, days: 15, trigger: null },
  ];
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const clientId = smAll[i % smAll.length]?.id || allClients[0].id;
    await db.query(
      `INSERT INTO rfm_transitions (id, merchant_id, client_id, old_segment, new_segment,
         old_r_score, new_r_score, transitioned_at, processed_at, trigger_fired)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [uuidv4(), MID, clientId, t.old, t.new, t.old_r, t.new_r,
       daysAgo(t.days), t.trigger ? daysAgo(t.days - 1) : null, t.trigger]
    );
  }
  console.log('[SEED-SM] RFM transitions');

  // ── 6. Campagnes SuperMarché ───────────────────────────────────────────────
  const campaigns = [
    { name: 'Promo Ramadan — Alimentaire',  segment: 'FIDELES',    channel: 'sms',      status: 'completed', daysBack: 20, targeted: 42, sent: 42, converted: 18 },
    { name: 'Relance clients inactifs',     segment: 'A_RISQUE',   channel: 'sms',      status: 'completed', daysBack: 35, targeted: 15, sent: 14, converted:  4 },
    { name: 'Win-back Hibernants mai',      segment: 'HIBERNANTS', channel: 'sms',      status: 'running',   daysBack:  3, targeted: 12, sent: 12, converted:  2 },
    { name: 'Offre VIP Champions',          segment: 'CHAMPIONS',  channel: 'whatsapp', status: 'completed', daysBack: 50, targeted: 22, sent: 22, converted: 15 },
    { name: 'Découverte nouveaux clients',  segment: 'PROMETTEURS',channel: 'sms',      status: 'scheduled', daysBack:  0, targeted:  0, sent:  0, converted:  0 },
    { name: 'Spécial fête des mères',       segment: 'FIDELES',    channel: 'sms',      status: 'completed', daysBack: 60, targeted: 38, sent: 37, converted: 12 },
    { name: 'Flash sale weekend',           segment: 'PROMETTEURS',channel: 'sms',      status: 'draft',     daysBack:  0, targeted:  0, sent:  0, converted:  0 },
  ];
  for (const c of campaigns) {
    const id = uuidv4();
    const scheduledAt = c.status === 'scheduled' ? daysAhead(2) : null;
    await db.query(
      `INSERT INTO campaigns (id, merchant_id, name, target_segment, channel, message_template,
         scheduled_at, status, total_targeted, total_sent, total_converted, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) ON CONFLICT DO NOTHING`,
      [id, MID, c.name, c.segment, c.channel,
       `Cher client, profitez de notre offre exclusive : ${c.name}. Code: PROMO${rand(100,999)}`,
       scheduledAt, c.status, c.targeted, c.sent, c.converted,
       c.status !== 'draft' && c.status !== 'scheduled' ? daysAgo(c.daysBack + 3) : daysAgo(1)]
    );
  }
  console.log(`[SEED-SM] ${campaigns.length} campagnes`);

  // ── 7. Triggers SuperMarché ───────────────────────────────────────────────
  const triggers = [
    { type: 'BIENVENUE',   segment: null,          channel: 'sms',  template: 'Bienvenue au SuperMarché Abidjan ! Profitez de 10% cashback dès votre 1er achat. Carte fidélité gratuite en caisse.', cooldown: 8760 },
    { type: '1ER_ACHAT',   segment: null,          channel: 'sms',  template: 'Bravo pour votre 1er achat ! Vous avez gagné {{points}} points. Statut: {{statut}}. Revenez vite !', cooldown: 8760 },
    { type: 'ABSENCE',     segment: 'A_RISQUE',    channel: 'sms',  template: '{{prenom}}, ça fait {{jours}} jours ! Revenez au SuperMarché et obtenez -15% sur vos courses. Valable 7 jours.', cooldown: 168 },
    { type: 'WIN_BACK',    segment: 'HIBERNANTS',  channel: 'sms',  template: '{{prenom}}, offre exclusive pour votre retour : -20% sur tout le magasin ce weekend. Code: RETOUR{{code}}', cooldown: 720 },
    { type: 'ANNIVERSAIRE',segment: null,          channel: 'sms',  template: 'Joyeux anniversaire {{prenom}} ! Le SuperMarché vous offre 500 XOF de cashback bonus aujourd\'hui 🎂', cooldown: 8760 },
    { type: 'PALIER',      segment: null,          channel: 'sms',  template: 'Félicitations {{prenom}} ! Vous êtes maintenant {{statut}} au SuperMarché. Profitez de {{avantages}}.', cooldown: 8760 },
    { type: 'ALERTE_R',    segment: 'A_RISQUE',    channel: 'sms',  template: 'Attention {{prenom}}, votre statut fidélité risque de baisser. Faites un achat avant le {{date}} pour le maintenir.', cooldown: 72 },
  ];
  for (const t of triggers) {
    await db.query(
      `INSERT INTO triggers (id, merchant_id, trigger_type, target_segment, channel, message_template, is_active, cooldown_hours, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,NOW()-INTERVAL '30 days',NOW()) ON CONFLICT DO NOTHING`,
      [uuidv4(), MID, t.type, t.segment, t.channel, t.template, t.cooldown]
    );
  }
  console.log(`[SEED-SM] ${triggers.length} triggers`);

  // ── 8. Abandon Tracking ───────────────────────────────────────────────────
  const abandonData = [
    { status: 'active',      step: 1, daysBack: 2,  clientIdx: 0 },
    { status: 'active',      step: 2, daysBack: 5,  clientIdx: 1 },
    { status: 'active',      step: 3, daysBack: 9,  clientIdx: 2 },
    { status: 'reactivated', step: 5, daysBack: 15, clientIdx: 3 },
    { status: 'reactivated', step: 5, daysBack: 22, clientIdx: 4 },
    { status: 'lost',        step: 5, daysBack: 40, clientIdx: 5 },
    { status: 'active',      step: 1, daysBack: 1,  clientIdx: 6 },
    { status: 'active',      step: 4, daysBack: 12, clientIdx: 7 },
  ];
  // Nettoyer les anciens abandons du SuperMarché
  await db.query('DELETE FROM abandon_tracking WHERE merchant_id=$1', [MID]);
  for (const a of abandonData) {
    const clientId = smAll[a.clientIdx % smAll.length]?.id || allClients[0].id;
    const stepStarted = daysAgo(a.daysBack);
    await db.query(
      `INSERT INTO abandon_tracking (id, client_id, merchant_id, current_step, step_started_at,
         next_step_at, status, reactivated_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [uuidv4(), clientId, MID, a.step, stepStarted,
       a.status === 'active' ? daysAhead(1) : null,
       a.status,
       a.status === 'reactivated' ? daysAgo(1) : null,
       stepStarted]
    );
  }
  console.log(`[SEED-SM] ${abandonData.length} protocoles d'abandon`);

  // ── 9. Zones de chalandise (trade_zone_stats) ─────────────────────────────
  // SuperMarché est GROWTH, pas PREMIUM → pas de trade_zones dans l'UI
  // Mais on les ajoute au cas où il passe PREMIUM
  const zones = [
    { city: 'Abidjan', district: 'Plateau',   clients: 85, txCount: 210, revenue: 4200000, loyal: 28 },
    { city: 'Abidjan', district: 'Cocody',    clients: 72, txCount: 185, revenue: 3850000, loyal: 24 },
    { city: 'Abidjan', district: 'Yopougon',  clients: 58, txCount: 142, revenue: 2650000, loyal: 15 },
    { city: 'Abidjan', district: 'Marcory',   clients: 41, txCount:  98, revenue: 1920000, loyal: 11 },
    { city: 'Bouaké',  district: null,        clients: 18, txCount:  42, revenue:  780000, loyal:  4 },
  ];
  const today = new Date().toISOString().slice(0, 10);
  for (const z of zones) {
    await db.query(
      `INSERT INTO trade_zone_stats (merchant_id, calculated_date, city, district,
         client_count, transaction_count, total_revenue, avg_basket, loyal_client_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [MID, today, z.city, z.district, z.clients, z.txCount,
       z.revenue, Math.round(z.revenue / z.txCount), z.loyal]
    );
  }
  console.log('[SEED-SM] Zones de chalandise');

  // ── 10. Subscription SuperMarché ─────────────────────────────────────────
  // Vérifier si subscription existe, sinon créer
  const existingSub = (await db.query('SELECT id FROM subscriptions WHERE merchant_id=$1', [MID])).rows[0];
  let subId = existingSub?.id;
  if (!subId) {
    subId = uuidv4();
    await db.query(
      `INSERT INTO subscriptions (id, merchant_id, package, base_monthly_fee, effective_monthly_fee,
         recruited_clients_count, status, started_at, next_billing_at)
       VALUES ($1,$2,'GROWTH',75000,65000,14,'active',NOW()-INTERVAL '8 months',NOW()+INTERVAL '10 days')`,
      [subId, MID]
    );
  }
  // Paiements abonnement sur 8 mois
  for (let m = 8; m >= 1; m--) {
    const periodStart = new Date();
    periodStart.setMonth(periodStart.getMonth() - m);
    periodStart.setDate(1);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    periodEnd.setDate(0);
    const recruited = rand(8, 20);
    const discount = Math.min(30, recruited * 2);
    const effective = Math.round(75000 * (1 - discount / 100));
    await db.query(
      `INSERT INTO subscription_payments (id, subscription_id, merchant_id, period_start, period_end,
         base_amount, discount_percent, effective_amount, recruited_clients_count, status, paid_at, created_at)
       VALUES ($1,$2,$3,$4,$5,75000,$6,$7,$8,'completed',$9,$9) ON CONFLICT DO NOTHING`,
      [uuidv4(), subId, MID,
       periodStart.toISOString().slice(0,10),
       periodEnd.toISOString().slice(0,10),
       discount, effective, recruited, periodEnd.toISOString()]
    );
  }
  console.log('[SEED-SM] Subscription + 8 paiements');

  // ── 11. Contact Priority List ──────────────────────────────────────────────
  const priorityItems = smAll.slice(0, 5).map((c, idx) => ({
    client_id: c.id,
    client_name: c.full_name,
    reason: ['churn_risk','birthday','abandon','churn_risk','birthday'][idx],
    churn_score: [0.78, 0.45, 0.62, 0.81, 0.38][idx],
    last_purchase_days: [45, 30, 12, 52, 25][idx],
    loyalty_status: c.loyalty_status,
    priority_rank: idx + 1,
  }));
  await db.query(
    `INSERT INTO contact_priority_lists (merchant_id, date, items, generated_at)
     VALUES ($1,$2,$3,NOW()) ON CONFLICT DO NOTHING`,
    [MID, today, JSON.stringify(priorityItems)]
  );
  console.log('[SEED-SM] Contact priority list');

  // ── 12. Rapport trimestriel ────────────────────────────────────────────────
  const reportData = {
    total_transactions: 165, total_revenue: 8250000, total_cashback: 495000,
    new_clients: 18, returning_clients: 92, return_rate: 0.72,
    avg_basket: 50000, top_segment: 'FIDELES',
    churn_alerts: 7, churn_resolved: 4,
    loyalty_score: 74,
    segments: { CHAMPIONS: 4, FIDELES: 8, PROMETTEURS: 5, A_RISQUE: 2, HIBERNANTS: 2, PERDUS: 1 },
  };
  await db.query(
    `INSERT INTO periodic_reports (id, merchant_id, report_type, period_label, period_start, period_end,
       data, generated_at, sent_at, status)
     VALUES ($1,$2,'quarterly','Q1-2026','2026-01-01','2026-03-31',$3,NOW(),NOW(),'sent')
     ON CONFLICT DO NOTHING`,
    [uuidv4(), MID, JSON.stringify(reportData)]
  );
  console.log('[SEED-SM] Rapport trimestriel Q1-2026');

  // ── Résumé ────────────────────────────────────────────────────────────────
  const finalTx = (await db.query("SELECT COUNT(*) FROM transactions WHERE merchant_id=$1 AND status='completed'", [MID])).rows[0].count;
  const finalRfm = (await db.query('SELECT segment, COUNT(*) as c FROM rfm_scores WHERE merchant_id=$1 GROUP BY segment ORDER BY c DESC', [MID])).rows;

  console.log('\n[SEED-SM] ✅ Terminé !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` Transactions completed : ${finalTx}`);
  console.log(' RFM segments          :', finalRfm.map(r => `${r.segment}(${r.c})`).join(', '));
  console.log(' Campagnes             : 7 (completed/running/scheduled/draft)');
  console.log(' Triggers              : 7 actifs');
  console.log(' Abandons              : 8 (active/reactivated/lost)');
  console.log(' Zones chalandise      : 5 (Abidjan ×4 + Bouaké)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Login marchand : supermarche@demo.af / Merchant@2026!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await db.pool.end();
}

run().catch(e => { console.error('[SEED-SM] ERREUR:', e.message, e.stack); process.exit(1); });
