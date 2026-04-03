/**
 * seed-extended.js — Données réalistes pour toutes les tables non couvertes par seed.js
 *
 * Tables couvertes :
 *   rfm_sector_thresholds, rfm_scores, rfm_transitions
 *   campaigns, campaign_actions
 *   triggers, trigger_logs
 *   abandon_tracking
 *   governance_requests
 *   gdpr_export_requests
 *   encryption_keys, wallet_config
 *   subscription_payments, success_fees
 *   contact_priority_lists
 *   trade_zone_stats
 *   price_elasticity_snapshots
 *   periodic_reports
 *
 * Prérequis : seed.js doit avoir été exécuté (tables de base peuplées)
 * Usage     : node src/seed-extended.js
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const db = require('./lib/db');

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = n => new Date(Date.now() + n * 86400000).toISOString();
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

async function seedExtended() {
  console.log("[SEED-EXT] Démarrage seed étendu Afrik'Fid...");

  // ── Fetch base data ────────────────────────────────────────────────────────
  const merchants = (await db.query("SELECT * FROM merchants WHERE kyc_status = 'approved' AND is_active = true")).rows;
  const allMerchants = (await db.query("SELECT * FROM merchants")).rows;
  const clients = (await db.query("SELECT id, loyalty_status, country_id FROM clients")).rows;
  const admins = (await db.query("SELECT id, role FROM admins")).rows;
  const adminMap = {};
  for (const a of admins) adminMap[a.role] = a.id;

  if (!merchants.length) {
    console.error('[SEED-EXT] Aucun marchand approuvé trouvé — exécutez seed.js d\'abord');
    process.exit(1);
  }

  // ── 1. Wallet Config ───────────────────────────────────────────────────────
  try {
    await db.query(
      `INSERT INTO wallet_config (id, default_max_balance, updated_at)
       VALUES ('global', 500000, NOW()) ON CONFLICT (id) DO NOTHING`
    );
    console.log('[SEED-EXT] wallet_config');
  } catch (e) { console.log('[SEED-EXT] wallet_config skip:', e.message); }

  // ── 2. Encryption Keys ─────────────────────────────────────────────────────
  try {
    const keys = [
      { version: 1, key_hex: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', is_active: false, expires_at: daysAgo(90) },
      { version: 2, key_hex: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3', is_active: false, expires_at: daysAgo(30) },
      { version: 3, key_hex: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4', is_active: true, expires_at: daysAhead(60) },
    ];
    for (const k of keys) {
      await db.query(
        `INSERT INTO encryption_keys (id, version, key_hex, is_active, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (version) DO NOTHING`,
        [uuidv4(), k.version, k.key_hex, k.is_active, k.expires_at, daysAgo(90 - (k.version - 1) * 30)]
      );
    }
    console.log('[SEED-EXT] encryption_keys (3 versions)');
  } catch (e) { console.log('[SEED-EXT] encryption_keys skip:', e.message); }

  // ── 3. RFM Sector Thresholds ───────────────────────────────────────────────
  try {
    const sectors = ['epicerie', 'restaurant', 'pharmacie', 'informatique', 'general', 'station_service', 'beaute', 'mode'];
    const thresholds = {
      recency: { score_5: 7, score_4: 14, score_3: 30, score_2: 60, score_1: 90 },  // jours depuis dernier achat
      frequency: { score_5: 12, score_4: 8, score_3: 4, score_2: 2, score_1: 0 },  // nb achats
      monetary: { score_5: 500000, score_4: 200000, score_3: 100000, score_2: 50000, score_1: 0 }, // montant XOF
    };
    // Ajustements par secteur
    const adjustments = {
      restaurant: { recency: { score_5: 3, score_4: 7, score_3: 14, score_2: 30, score_1: 60 }, frequency: { score_5: 20, score_4: 12, score_3: 6, score_2: 3, score_1: 0 }, monetary: { score_5: 300000, score_4: 150000, score_3: 75000, score_2: 30000, score_1: 0 } },
      pharmacie: { monetary: { score_5: 300000, score_4: 120000, score_3: 60000, score_2: 25000, score_1: 0 } },
      informatique: { frequency: { score_5: 5, score_4: 3, score_3: 2, score_2: 1, score_1: 0 }, monetary: { score_5: 1500000, score_4: 500000, score_3: 200000, score_2: 80000, score_1: 0 } },
    };

    let count = 0;
    for (const sector of sectors) {
      for (const dimension of ['recency', 'frequency', 'monetary']) {
        const base = thresholds[dimension];
        const adj = (adjustments[sector] || {})[dimension] || {};
        const t = { ...base, ...adj };
        await db.query(
          `INSERT INTO rfm_sector_thresholds (id, sector, dimension, score_5, score_4, score_3, score_2, score_1, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT DO NOTHING`,
          [uuidv4(), sector, dimension, t.score_5, t.score_4, t.score_3, t.score_2, t.score_1]
        );
        count++;
      }
    }
    console.log(`[SEED-EXT] rfm_sector_thresholds (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] rfm_sector_thresholds skip:', e.message); }

  // ── 4. RFM Scores ──────────────────────────────────────────────────────────
  try {
    // Segments par profil de fidélité
    const SEGMENT_BY_STATUS = {
      ROYAL_ELITE: 'CHAMPIONS',
      ROYAL: 'CHAMPIONS',
      GOLD: 'FIDELES',
      LIVE: 'PROMETTEURS',
      OPEN: 'HIBERNANTS',
    };
    const SCORE_BY_STATUS = {
      ROYAL_ELITE: { r: 5, f: 5, m: 5 },
      ROYAL: { r: 5, f: 4, m: 4 },
      GOLD: { r: 4, f: 3, m: 3 },
      LIVE: { r: 3, f: 2, m: 2 },
      OPEN: { r: 2, f: 1, m: 1 },
    };

    let count = 0;
    // Chaque client chez chaque marchand approuvé (simuler les scores)
    for (let ci = 0; ci < clients.length; ci++) {
      const client = clients[ci];
      const merchant = merchants[ci % merchants.length];
      const scores = SCORE_BY_STATUS[client.loyalty_status] || { r: 1, f: 1, m: 1 };
      const segment = SEGMENT_BY_STATUS[client.loyalty_status] || 'PERDUS';

      // Variation légère par client
      const r = Math.min(5, Math.max(1, scores.r + (ci % 3 === 0 ? -1 : 0)));
      const f = Math.min(5, Math.max(1, scores.f + (ci % 5 === 0 ? 1 : 0)));
      const m = Math.min(5, Math.max(1, scores.m + (ci % 4 === 0 ? -1 : 0)));

      const totalAmount = [15000, 75000, 200000, 500000, 1500000][m - 1];
      const purchaseCount = [1, 4, 10, 20, 40][f - 1];
      const lastPurchaseDays = [3, 10, 25, 50, 100][5 - r];

      await db.query(
        `INSERT INTO rfm_scores (id, merchant_id, client_id, r_score, f_score, m_score, segment,
           last_purchase_at, purchase_count, total_amount, calculated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (merchant_id, client_id) DO UPDATE
           SET r_score=$4, f_score=$5, m_score=$6, segment=$7,
               last_purchase_at=$8, purchase_count=$9, total_amount=$10, calculated_at=NOW()`,
        [uuidv4(), merchant.id, client.id, r, f, m, segment,
        daysAgo(lastPurchaseDays), purchaseCount, totalAmount]
      );
      count++;
    }
    console.log(`[SEED-EXT] rfm_scores (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] rfm_scores skip:', e.message); }

  // ── 5. RFM Transitions ─────────────────────────────────────────────────────
  try {
    const TRANSITIONS = [
      { old_seg: 'HIBERNANTS', new_seg: 'PROMETTEURS', old_r: 2, new_r: 3, trigger: 'ALERTE_R' },
      { old_seg: 'PROMETTEURS', new_seg: 'FIDELES', old_r: 3, new_r: 4, trigger: null },
      { old_seg: 'FIDELES', new_seg: 'CHAMPIONS', old_r: 4, new_r: 5, trigger: null },
      { old_seg: 'CHAMPIONS', new_seg: 'A_RISQUE', old_r: 5, new_r: 2, trigger: 'WIN_BACK' },
      { old_seg: 'A_RISQUE', new_seg: 'PERDUS', old_r: 2, new_r: 1, trigger: 'WIN_BACK' },
      { old_seg: 'PERDUS', new_seg: 'PROMETTEURS', old_r: 1, new_r: 3, trigger: 'WIN_BACK' },
    ];

    let count = 0;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const merchant = merchants[i % merchants.length];
      // Seulement une partie des clients ont des transitions
      if (i % 3 === 0) continue;
      const t = TRANSITIONS[i % TRANSITIONS.length];
      const transitioned = daysAgo(Math.floor(Math.random() * 30) + 1);
      const processed = t.trigger ? daysAgo(Math.floor(Math.random() * 29) + 1) : null;

      await db.query(
        `INSERT INTO rfm_transitions (id, merchant_id, client_id, old_segment, new_segment,
           old_r_score, new_r_score, transitioned_at, processed_at, trigger_fired)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [uuidv4(), merchant.id, client.id, t.old_seg, t.new_seg, t.old_r, t.new_r,
          transitioned, processed, t.trigger]
      );
      count++;
    }
    console.log(`[SEED-EXT] rfm_transitions (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] rfm_transitions skip:', e.message); }

  // ── 6. Triggers ────────────────────────────────────────────────────────────
  const triggerIds = {};
  try {
    const TRIGGER_DATA = [
      { type: 'BIENVENUE', segment: null, channel: 'sms', template: 'Bienvenue {{prenom}} ! Votre première commande chez {{marchand}} vous offre {{remise}}% de cashback. Code: {{code}}', cooldown: 8760 },
      { type: '1ER_ACHAT', segment: null, channel: 'sms', template: 'Bravo {{prenom}} pour votre 1er achat ! Vous gagnez {{points}} points fidélité. Statut actuel: {{statut}}', cooldown: 8760 },
      { type: 'ABSENCE', segment: 'A_RISQUE', channel: 'sms', template: '{{prenom}}, vous nous manquez ! Revenez chez {{marchand}} et bénéficiez de -{{remise}}% sur votre prochain achat. Valable 7 jours.', cooldown: 168 },
      { type: 'ALERTE_R', segment: 'HIBERNANTS', channel: 'sms', template: 'Attention {{prenom}}, votre score fidélité baisse. Faites un achat avant le {{date_limite}} pour maintenir votre statut {{statut}}.', cooldown: 72 },
      { type: 'WIN_BACK', segment: 'PERDUS', channel: 'sms', template: '{{prenom}}, ça fait longtemps ! Offre exclusive: {{remise}}% sur tout chez {{marchand}} pendant 48h. Code: RETOUR{{code}}', cooldown: 720 },
      { type: 'ANNIVERSAIRE', segment: null, channel: 'sms', template: 'Joyeux anniversaire {{prenom}} ! {{marchand}} vous offre un cadeau spécial: {{remise}}% cashback aujourd\'hui uniquement 🎂', cooldown: 8760 },
      { type: 'PALIER', segment: null, channel: 'sms', template: 'Félicitations {{prenom}} ! Vous venez d\'atteindre le statut {{nouveau_statut}}. Profitez de {{avantages}}.', cooldown: 8760 },
      { type: 'ABSENCE', segment: 'A_RISQUE', channel: 'whatsapp', template: 'Bonjour {{prenom}} 👋 Votre marchand préféré {{marchand}} a une offre spéciale pour vous. Répondez OUI pour en savoir plus.', cooldown: 168 },
    ];

    for (let i = 0; i < TRIGGER_DATA.length; i++) {
      const td = TRIGGER_DATA[i];
      const merchant = merchants[i % merchants.length];
      const id = uuidv4();
      await db.query(
        `INSERT INTO triggers (id, merchant_id, trigger_type, target_segment, channel, message_template, is_active, cooldown_hours, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT DO NOTHING`,
        [id, merchant.id, td.type, td.segment, td.channel, td.template, true, td.cooldown, daysAgo(60 - i * 7)]
      );
      triggerIds[`${merchant.id}:${td.type}`] = id;
    }
    console.log(`[SEED-EXT] triggers (${TRIGGER_DATA.length} lignes)`);
  } catch (e) { console.log('[SEED-EXT] triggers skip:', e.message); }

  // ── 7. Trigger Logs ────────────────────────────────────────────────────────
  try {
    const triggerRows = (await db.query("SELECT id, merchant_id, trigger_type, channel FROM triggers")).rows;
    const STATUSES = ['sent', 'sent', 'sent', 'failed', 'sent'];
    let count = 0;
    for (let i = 0; i < clients.length * 2; i++) {
      const client = clients[i % clients.length];
      const trigger = triggerRows[i % triggerRows.length];
      const status = STATUSES[i % STATUSES.length];
      const dBack = Math.floor(i * 0.8) + 1;

      await db.query(
        `INSERT INTO trigger_logs (id, trigger_id, client_id, merchant_id, trigger_type, channel, status, sent_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
        [uuidv4(), trigger.id, client.id, trigger.merchant_id, trigger.trigger_type,
        trigger.channel, status, status !== 'pending' ? daysAgo(dBack) : null]
      );
      count++;
    }
    console.log(`[SEED-EXT] trigger_logs (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] trigger_logs skip:', e.message); }

  // ── 8. Campaigns ──────────────────────────────────────────────────────────
  const campaignIds = [];
  try {
    const CAMP_DATA = [
      { name: 'Ramadan 2026 — Offre spéciale', segment: 'FIDELES', channel: 'sms', status: 'completed', daysBack: 25, targeted: 45, sent: 45, converted: 18 },
      { name: 'Relance clients inactifs T1', segment: 'A_RISQUE', channel: 'sms', status: 'completed', daysBack: 15, targeted: 30, sent: 28, converted: 7 },
      { name: 'Upgrade Gold → Royal', segment: 'FIDELES', channel: 'sms', status: 'running', daysBack: 3, targeted: 22, sent: 22, converted: 5 },
      { name: 'Bienvenue nouveaux clients', segment: 'PROMETTEURS', channel: 'email', status: 'scheduled', daysBack: 0, targeted: 0, sent: 0, converted: 0 },
      { name: 'Promo Fête des Mères', segment: 'CHAMPIONS', channel: 'whatsapp', status: 'draft', daysBack: 0, targeted: 0, sent: 0, converted: 0 },
      { name: 'Win-back clients perdus', segment: 'PERDUS', channel: 'sms', status: 'cancelled', daysBack: 40, targeted: 60, sent: 15, converted: 2 },
    ];
    for (let i = 0; i < CAMP_DATA.length; i++) {
      const c = CAMP_DATA[i];
      const merchant = merchants[i % merchants.length];
      const id = uuidv4();
      const scheduledAt = c.status === 'scheduled' ? daysAhead(3) : (c.status !== 'draft' ? daysAgo(c.daysBack) : null);
      await db.query(
        `INSERT INTO campaigns (id, merchant_id, name, target_segment, channel, message_template, scheduled_at,
           status, total_targeted, total_sent, total_converted, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) ON CONFLICT DO NOTHING`,
        [id, merchant.id, c.name, c.segment, c.channel,
          `Cher client {{prenom}}, profitez de notre offre exclusive: ${c.name}. Code promo: PROMO${i + 1}`,
          scheduledAt, c.status, c.targeted, c.sent, c.converted, daysAgo(c.daysBack + 5)]
      );
      campaignIds.push({ id, merchant_id: merchant.id, status: c.status, targeted: c.targeted, sent: c.sent, converted: c.converted });
    }
    console.log(`[SEED-EXT] campaigns (${CAMP_DATA.length} lignes)`);
  } catch (e) { console.log('[SEED-EXT] campaigns skip:', e.message); }

  // ── 9. Campaign Actions ────────────────────────────────────────────────────
  try {
    const completedCampaigns = campaignIds.filter(c => ['completed', 'running'].includes(c.status) && c.sent > 0);
    let count = 0;
    for (const camp of completedCampaigns) {
      const STATUSES_DIST = ['sent', 'sent', 'converted', 'failed'];
      for (let i = 0; i < Math.min(camp.sent, clients.length); i++) {
        const client = clients[i % clients.length];
        const status = i < camp.converted ? 'converted' : STATUSES_DIST[i % STATUSES_DIST.length];
        const sentAt = daysAgo(Math.floor(Math.random() * 10) + 1);
        await db.query(
          `INSERT INTO campaign_actions (id, campaign_id, client_id, status, sent_at, converted_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [uuidv4(), camp.id, client.id, status, sentAt,
          status === 'converted' ? daysAgo(Math.floor(Math.random() * 5) + 1) : null,
            sentAt]
        );
        count++;
      }
    }
    console.log(`[SEED-EXT] campaign_actions (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] campaign_actions skip:', e.message); }

  // ── 10. Abandon Tracking ──────────────────────────────────────────────────
  try {
    const ABANDON_STATUSES = ['active', 'active', 'reactivated', 'lost', 'cancelled'];
    let count = 0;
    for (let i = 0; i < Math.min(clients.length, 12); i++) {
      const client = clients[i];
      const merchant = merchants[i % merchants.length];
      const status = ABANDON_STATUSES[i % ABANDON_STATUSES.length];
      const step = status === 'active' ? (i % 4) + 1 : 5;
      const stepStarted = daysAgo(step * 3);
      const nextStep = status === 'active' ? daysAhead(1) : null;
      const reactivatedAt = status === 'reactivated' ? daysAgo(1) : null;

      await db.query(
        `INSERT INTO abandon_tracking (id, client_id, merchant_id, current_step, step_started_at,
           next_step_at, status, reactivated_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT DO NOTHING`,
        [uuidv4(), client.id, merchant.id, step, stepStarted, nextStep, status, reactivatedAt, stepStarted]
      );
      count++;
    }
    console.log(`[SEED-EXT] abandon_tracking (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] abandon_tracking skip:', e.message); }

  // ── 11. Governance Requests ────────────────────────────────────────────────
  try {
    const TYPES = ['commercial_gesture', 'retroactive_restore', 'fraud_revoke', 'partner_exit'];
    const STATUSES = ['pending', 'approved', 'rejected', 'approved'];
    const REASONS = [
      'Client ROYAL depuis 2 ans, demande de geste commercial suite bug de facturation',
      'Restauration rétroactive des points suite migration technique',
      'Révocation statut fidélité suite fraude avérée (SIM swap)',
      'Sortie du programme partenaire — remise en état compte client',
    ];
    const COMMENTS = [
      null,
      'Vérification effectuée — points restaurés conformément aux transactions réelles',
      'Fraude confirmée après investigation. Statut révoqué. Client notifié.',
      'Procédure de sortie appliquée conformément au',
    ];
    const STATUSES_LOYALTY = ['GOLD', 'OPEN', 'LIVE', 'ROYAL'];
    const REQUESTED_STATUSES = ['ROYAL', 'GOLD', null, 'OPEN'];

    let count = 0;
    for (let i = 0; i < Math.min(clients.length, 4); i++) {
      const client = clients[i];
      const status = STATUSES[i];
      const reviewedAt = status !== 'pending' ? daysAgo(i * 3 + 1) : null;
      await db.query(
        `INSERT INTO governance_requests (id, client_id, requested_by, type, current_status, requested_status,
           reason, status, reviewed_by, reviewed_at, review_comment, applied_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
        [uuidv4(), client.id, adminMap.admin, TYPES[i], STATUSES_LOYALTY[i], REQUESTED_STATUSES[i],
        REASONS[i], status,
        reviewedAt ? adminMap.superadmin : null, reviewedAt, COMMENTS[i],
        status === 'approved' ? reviewedAt : null,
        daysAgo(i * 5 + 5)]
      );
      count++;
    }
    console.log(`[SEED-EXT] governance_requests (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] governance_requests skip:', e.message); }

  // ── 12. GDPR Export Requests ───────────────────────────────────────────────
  try {
    const GDPR_STATUSES = ['completed', 'completed', 'pending', 'completed', 'processing'];
    let count = 0;
    for (let i = 0; i < Math.min(clients.length, 5); i++) {
      const client = clients[i];
      const status = GDPR_STATUSES[i];
      const requestedAt = daysAgo(i * 7 + 3);
      const processedAt = status === 'completed' ? daysAgo(i * 7 + 1) : null;
      const exportUrl = status === 'completed'
        ? `https://exports.afrikfid.com/gdpr/${client.id}/${Date.now().toString(36)}.zip`
        : null;
      await db.query(
        `INSERT INTO gdpr_export_requests (id, client_id, requested_at, processed_at, export_url, status)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uuidv4(), client.id, requestedAt, processedAt, exportUrl, status]
      );
      count++;
    }
    console.log(`[SEED-EXT] gdpr_export_requests (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] gdpr_export_requests skip:', e.message); }

  // ── 13. Subscription Payments ──────────────────────────────────────────────
  try {
    const subscriptions = (await db.query("SELECT * FROM subscriptions WHERE status = 'active'")).rows;
    let count = 0;
    for (const sub of subscriptions) {
      // 3 mois de paiements précédents
      for (let month = 3; month >= 1; month--) {
        const periodStart = new Date();
        periodStart.setMonth(periodStart.getMonth() - month);
        periodStart.setDate(1);
        const periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(0);

        const recruited = Math.floor(Math.random() * 20);
        const discountPct = Math.min(30, recruited * 2); // 2% par client recruté, max 30%
        const baseAmount = sub.base_monthly_fee || 25000;
        const effectiveAmount = Math.round(baseAmount * (1 - discountPct / 100));

        await db.query(
          `INSERT INTO subscription_payments (id, subscription_id, merchant_id, period_start, period_end,
             base_amount, discount_percent, effective_amount, recruited_clients_count, status, paid_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',$10,$10) ON CONFLICT DO NOTHING`,
          [uuidv4(), sub.id, sub.merchant_id,
          periodStart.toISOString().slice(0, 10),
          periodEnd.toISOString().slice(0, 10),
            baseAmount, discountPct, effectiveAmount, recruited,
          periodEnd.toISOString()]
        );
        count++;
      }
      // Paiement en cours du mois actuel (pending)
      const now = new Date();
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
      await db.query(
        `INSERT INTO subscription_payments (id, subscription_id, merchant_id, period_start, period_end,
           base_amount, discount_percent, effective_amount, recruited_clients_count, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,0,$6,0,'pending',NOW()) ON CONFLICT DO NOTHING`,
        [uuidv4(), sub.id, sub.merchant_id, currentStart, currentEnd, sub.base_monthly_fee || 25000]
      );
      count++;
    }
    console.log(`[SEED-EXT] subscription_payments (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] subscription_payments skip:', e.message); }

  // ── 14. Success Fees ───────────────────────────────────────────────────────
  try {
    let count = 0;
    for (let i = 0; i < merchants.length; i++) {
      const m = merchants[i];
      // 2 calculs trimestriels
      for (let q = 1; q <= 2; q++) {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() - (q - 1) * 3);
        const periodStart = new Date(periodEnd);
        periodStart.setMonth(periodStart.getMonth() - 3);

        const refAvgBasket = 45000 + i * 5000;
        const currentAvgBasket = refAvgBasket * (1 + (i % 3 === 0 ? 0.12 : i % 3 === 1 ? 0.05 : -0.02));
        const growth = Math.max(0, currentAvgBasket - refAvgBasket);
        const totalRevenue = currentAvgBasket * (15 + i * 3);
        const totalTx = 15 + i * 3;
        const feeAmt = growth > 0 ? Math.round(totalRevenue * 0.03) : 0;
        const status = q === 2 ? 'paid' : feeAmt > 0 ? 'invoiced' : 'waived';

        await db.query(
          `INSERT INTO success_fees (id, merchant_id, period_start, period_end,
             reference_avg_basket, current_avg_basket, growth_amount, fee_percent, fee_amount,
             total_revenue_period, total_transactions_period, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,3,$8,$9,$10,$11,NOW()) ON CONFLICT DO NOTHING`,
          [uuidv4(), m.id,
          periodStart.toISOString().slice(0, 10),
          periodEnd.toISOString().slice(0, 10),
          Math.round(refAvgBasket), Math.round(currentAvgBasket), Math.round(growth),
            feeAmt, Math.round(totalRevenue), totalTx, status]
        );
        count++;
      }
    }
    console.log(`[SEED-EXT] success_fees (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] success_fees skip:', e.message); }

  // ── 15. Trade Zone Stats ───────────────────────────────────────────────────
  try {
    // Uniquement pour les marchands PREMIUM ou GROWTH
    const eligibleMerchants = (await db.query(
      "SELECT * FROM merchants WHERE package IN ('PREMIUM','GROWTH') AND is_active = true"
    )).rows;

    const ZONES_CI = [
      { city: 'Abidjan', district: 'Plateau' },
      { city: 'Abidjan', district: 'Cocody' },
      { city: 'Abidjan', district: 'Yopougon' },
      { city: 'Abidjan', district: 'Marcory' },
      { city: 'Bouaké', district: null },
    ];
    const ZONES_SN = [
      { city: 'Dakar', district: 'Plateau' },
      { city: 'Dakar', district: 'Almadies' },
      { city: 'Dakar', district: 'Medina' },
      { city: 'Thiès', district: null },
    ];
    const ZONES_KE = [
      { city: 'Nairobi', district: 'Westlands' },
      { city: 'Nairobi', district: 'CBD' },
      { city: 'Nairobi', district: 'Karen' },
      { city: 'Mombasa', district: null },
    ];
    const ZONES_BY_COUNTRY = { CI: ZONES_CI, SN: ZONES_SN, KE: ZONES_KE };

    let count = 0;
    for (const m of eligibleMerchants) {
      const zones = ZONES_BY_COUNTRY[m.country_id] || ZONES_CI;
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = daysAgo(1).slice(0, 10);

      for (const date of [today, yesterday]) {
        for (let z = 0; z < zones.length; z++) {
          const zone = zones[z];
          const clientCount = Math.floor(Math.random() * 50) + 5;
          const txCount = clientCount * (Math.floor(Math.random() * 3) + 1);
          const avgBasket = 15000 + z * 10000 + Math.floor(Math.random() * 5000);
          const totalRevenue = txCount * avgBasket;
          const loyalCount = Math.floor(clientCount * 0.3);

          await db.query(
            `INSERT INTO trade_zone_stats (merchant_id, calculated_date, city, district,
               client_count, transaction_count, total_revenue, avg_basket, loyal_client_count)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [m.id, date, zone.city, zone.district,
              clientCount, txCount, totalRevenue, avgBasket, loyalCount]
          );
          count++;
        }
      }
    }
    console.log(`[SEED-EXT] trade_zone_stats (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] trade_zone_stats skip:', e.message); }

  // ── 16. Price Elasticity Snapshots ────────────────────────────────────────
  try {
    const premiumMerchants = (await db.query(
      "SELECT * FROM merchants WHERE package = 'PREMIUM' AND is_active = true"
    )).rows;

    let count = 0;
    for (const m of premiumMerchants) {
      const now = new Date();
      const periodEnd = now.toISOString().slice(0, 10);
      const periodStart = new Date(now.setMonth(now.getMonth() - 3)).toISOString().slice(0, 10);

      const avgBasket = 48000 + Math.floor(Math.random() * 20000);
      const sensitivity = Math.random() * 0.6 + 0.2; // 0.2 à 0.8
      const optimalDiscount = Math.round(sensitivity * 15); // 3% à 12%
      const revenueAtOptimal = avgBasket * 1.15 * 100; // estimation

      const basketDist = {
        '<10000': Math.floor(Math.random() * 15),
        '10000-25000': Math.floor(Math.random() * 25) + 10,
        '25000-50000': Math.floor(Math.random() * 30) + 20,
        '50000-100000': Math.floor(Math.random() * 20) + 10,
        '>100000': Math.floor(Math.random() * 10),
      };
      const segmentsAnalysis = {
        CHAMPIONS: { avg_basket: avgBasket * 1.8, tx_count: 12, sensitivity: 0.2 },
        FIDELES: { avg_basket: avgBasket * 1.2, tx_count: 35, sensitivity: 0.45 },
        PROMETTEURS: { avg_basket: avgBasket * 0.8, tx_count: 28, sensitivity: 0.65 },
        A_RISQUE: { avg_basket: avgBasket * 0.6, tx_count: 8, sensitivity: 0.78 },
      };

      await db.query(
        `INSERT INTO price_elasticity_snapshots (id, merchant_id, calculated_at, period_start, period_end,
           avg_basket, basket_distribution, price_sensitivity_score, optimal_discount_pct, revenue_at_optimal,
           segments_analysis)
         VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [uuidv4(), m.id, periodStart, periodEnd, avgBasket,
        JSON.stringify(basketDist), Math.round(sensitivity * 100) / 100,
          optimalDiscount, revenueAtOptimal, JSON.stringify(segmentsAnalysis)]
      );
      count++;
    }
    console.log(`[SEED-EXT] price_elasticity_snapshots (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] price_elasticity_snapshots skip:', e.message); }

  // ── 17. Contact Priority Lists ────────────────────────────────────────────
  try {
    let count = 0;
    for (const m of merchants.slice(0, 4)) {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = daysAgo(1).slice(0, 10);

      for (const date of [today, yesterday]) {
        // Sélectionner 3-5 clients prioritaires (churn + anniversaire + abandon)
        const priorityClients = clients.slice(0, 5).map((c, idx) => ({
          client_id: c.id,
          reason: ['churn_risk', 'birthday', 'abandon', 'churn_risk', 'birthday'][idx],
          churn_score: Math.round(Math.random() * 0.6 + 0.3, 2),
          last_purchase_days: 15 + idx * 5,
          loyalty_status: c.loyalty_status,
          priority_rank: idx + 1,
        }));

        await db.query(
          `INSERT INTO contact_priority_lists (merchant_id, date, items, generated_at)
           VALUES ($1,$2,$3,NOW()) ON CONFLICT DO NOTHING`,
          [m.id, date, JSON.stringify(priorityClients)]
        );
        count++;
      }
    }
    console.log(`[SEED-EXT] contact_priority_lists (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] contact_priority_lists skip:', e.message); }

  // ── 18. Periodic Reports ──────────────────────────────────────────────────
  try {
    let count = 0;
    // Rapport trimestriel global admin (T4 2025)
    await db.query(
      `INSERT INTO periodic_reports (id, merchant_id, report_type, period_label, period_start, period_end,
         data, generated_at, sent_at, status)
       VALUES ($1,NULL,'admin_global','Q4-2025','2025-10-01','2025-12-31',$2,NOW(),NOW(),'sent')
       ON CONFLICT DO NOTHING`,
      [uuidv4(), JSON.stringify({
        total_merchants: 10, active_merchants: 6, total_clients: 20,
        total_transactions: 150, total_revenue_xof: 7500000,
        total_cashback_distributed: 450000, new_clients: 8,
        top_merchant: 'SuperMarché Abidjan Centre',
        churn_rate: 0.08, avg_basket_xof: 50000,
      })]
    );
    count++;

    // Rapports par marchand
    for (let i = 0; i < Math.min(merchants.length, 4); i++) {
      const m = merchants[i];
      const pkg = (await db.query("SELECT package FROM merchants WHERE id=$1", [m.id])).rows[0]?.package;
      const reportType = 'quarterly';
      const quarters = [
        { label: 'Q4-2025', start: '2025-10-01', end: '2025-12-31', status: 'sent' },
        { label: 'Q1-2026', start: '2026-01-01', end: '2026-03-31', status: 'generated' },
      ];
      for (const q of quarters) {
        await db.query(
          `INSERT INTO periodic_reports (id, merchant_id, report_type, period_label, period_start, period_end,
             data, generated_at, sent_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9) ON CONFLICT DO NOTHING`,
          [uuidv4(), m.id, reportType, q.label, q.start, q.end,
          JSON.stringify({
            total_transactions: 30 + i * 5,
            total_revenue: 1500000 + i * 200000,
            total_cashback: 90000 + i * 12000,
            new_clients: 5 + i,
            returning_clients: 18 + i * 2,
            return_rate: Math.round((0.6 + i * 0.05) * 100) / 100,
            avg_basket: 50000 + i * 3000,
            top_segment: ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE'][i % 4],
            churn_alerts: Math.floor(Math.random() * 5) + 1,
          }),
          q.status === 'sent' ? daysAgo(5) : null,
          q.status]
        );
        count++;
      }
    }
    console.log(`[SEED-EXT] periodic_reports (${count} lignes)`);
  } catch (e) { console.log('[SEED-EXT] periodic_reports skip:', e.message); }

  // ── Résumé ─────────────────────────────────────────────────────────────────
  console.log('\n[SEED-EXT] ✅ Seed étendu terminé !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' wallet_config            : 1  (config globale)');
  console.log(' encryption_keys          : 3  (versions 1-3, v3 active)');
  console.log(' rfm_sector_thresholds    : 24 (8 secteurs × 3 dimensions)');
  console.log(' rfm_scores               : ~20 (1 par client)');
  console.log(' rfm_transitions          : ~13 (transitions de segments)');
  console.log(' triggers                 : 8  (BIENVENUE/1ER_ACHAT/ABSENCE/etc.)');
  console.log(' trigger_logs             : ~40');
  console.log(' campaigns                : 6  (draft/scheduled/running/completed/cancelled)');
  console.log(' campaign_actions         : ~80');
  console.log(' abandon_tracking         : 12 (active/reactivated/lost/cancelled)');
  console.log(' governance_requests      : 4  (pending/approved/rejected)');
  console.log(' gdpr_export_requests     : 5  (pending/processing/completed)');
  console.log(' subscription_payments    : ~16 (3 mois + current)');
  console.log(' success_fees             : ~12 (2 trimestres par marchand)');
  console.log(' trade_zone_stats         : ~36 (GROWTH/PREMIUM × zones × 2 jours)');
  console.log(' price_elasticity_snapshots: 1+ (PREMIUM uniquement)');
  console.log(' contact_priority_lists   : ~8  (4 marchands × 2 jours)');
  console.log(' periodic_reports         : ~9  (admin global + marchands Q4+Q1)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await db.pool.end();
  process.exit(0);
}

seedExtended().catch(err => {
  console.error('[SEED-EXT] ERREUR:', err.message, err.stack);
  process.exit(1);
});
