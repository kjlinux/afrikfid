const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db = require('../lib/db');
const { requireAdmin, requireApiKey, requireClient, requireAuth } = require('../middleware/auth');
const { evaluateClientStatus, applyStatusChange } = require('../lib/loyalty-engine');
const { validate } = require('../middleware/validate');
const { CreateClientSchema, UpdateClientProfileSchema, UpdateLoyaltyStatusSchema, LookupClientSchema } = require('../config/schemas');
const { encrypt, decrypt, hashField } = require('../lib/crypto');
const { randomBytes } = require('crypto');
const { notifyClientWelcome } = require('../lib/notifications');
const { notifyWelcomeWhatsApp } = require('../lib/whatsapp');
const { triggerBienvenue } = require('../lib/campaign-engine');

// POST /api/v1/clients
router.post('/', validate(CreateClientSchema), async (req, res) => {
  const { full_name, phone, email, country_id, password, birth_date, city, district, country_code } = req.body;

  const phoneHash = hashField(phone);
  const existing = await db.query('SELECT id FROM clients WHERE phone_hash = $1', [phoneHash]);
  if (existing.rows[0]) return res.status(409).json({ error: 'Numéro de téléphone déjà enregistré' });

  const id = uuidv4();
  const afrikfidId = `AFD-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const encPhone = encrypt(phone);
  const encEmail = email ? encrypt(email) : null;
  const emailHash = email ? hashField(email) : null;

  await db.query(
    `INSERT INTO clients (id, afrikfid_id, full_name, phone, phone_hash, email, email_hash, country_id, password_hash, birth_date, city, district, country_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, afrikfidId, full_name, encPhone, phoneHash, encEmail, emailHash, country_id || null, passwordHash, birth_date || null, city || null, district || null, country_code || country_id || null]
  );

  await db.query('INSERT INTO wallets (id, client_id) VALUES ($1, $2)', [uuidv4(), id]);

  const client = (await db.query('SELECT * FROM clients WHERE id = $1', [id])).rows[0];
  notifyClientWelcome({ client: { ...client, phone, email } });
  // CDC v3 §5.4 — Trigger BIENVENUE automatique (signature: merchantId, client avec phone déchiffré)
  const merchantId = req.merchant ? req.merchant.id : null;
  if (merchantId) {
    let rawPhone = null, rawEmail = null;
    try { rawPhone = client.phone ? decrypt(client.phone) : null; } catch { /* ignore */ }
    try { rawEmail = client.email ? decrypt(client.email) : null; } catch { /* ignore */ }
    const clientWithPlainData = { ...client, phone: rawPhone, email: rawEmail };
    triggerBienvenue(merchantId, clientWithPlainData).catch(() => {});
    // WhatsApp bienvenue (Starter Boost — CDC §1.4)
    if (rawPhone) {
      const merchantRow = (await db.query('SELECT name FROM merchants WHERE id = $1', [merchantId])).rows[0];
      notifyWelcomeWhatsApp(clientWithPlainData, merchantRow?.name || 'le marchand').catch(() => {});
    }
  }
  res.status(201).json({ client: sanitizeClient(client) });
});

// GET /api/v1/clients (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { status, rfm_segment, page = 1, limit = 20, q } = req.query;
  let sql = `
    SELECT c.*, co.name as country_name, co.currency, rs.segment as rfm_segment
    FROM clients c
    LEFT JOIN countries co ON c.country_id = co.id
    LEFT JOIN LATERAL (
      SELECT segment FROM rfm_scores WHERE client_id = c.id ORDER BY calculated_at DESC LIMIT 1
    ) rs ON TRUE
    WHERE 1=1
  `;
  const params = [];
  let idx = 1;

  if (status) { sql += ` AND c.loyalty_status = $${idx++}`; params.push(status); }
  if (rfm_segment) { sql += ` AND rs.segment = $${idx++}`; params.push(rfm_segment); }
  if (q) {
    // phone et email sont chiffrés AES-256-GCM — recherche via leur hash HMAC-SHA256
    const qHash = hashField(q);
    sql += ` AND (c.full_name ILIKE $${idx++} OR c.phone_hash = $${idx++} OR c.email_hash = $${idx++} OR c.afrikfid_id ILIKE $${idx++})`;
    params.push(`%${q}%`, qHash, qHash, `%${q}%`);
  }

  sql += ` ORDER BY c.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const clients = (await db.query(sql, params)).rows;
  const countParams = params.slice(0, params.length - 2);
  let countSql = `SELECT COUNT(*) as c FROM clients c LEFT JOIN LATERAL (SELECT segment FROM rfm_scores WHERE client_id = c.id ORDER BY calculated_at DESC LIMIT 1) rs ON TRUE WHERE 1=1`;
  let ci = 1;
  if (status) { countSql += ` AND c.loyalty_status = $${ci++}`; }
  if (rfm_segment) { countSql += ` AND rs.segment = $${ci++}`; }
  if (q) {
    const qHash = hashField(q);
    countSql += ` AND (c.full_name ILIKE $${ci++} OR c.phone_hash = $${ci++} OR c.email_hash = $${ci++} OR c.afrikfid_id ILIKE $${ci++})`;
  }
  const total = parseInt((await db.query(countSql, countParams)).rows[0].c);

  res.json({ clients: clients.map(c => ({ ...sanitizeClient(c), rfmSegment: c.rfm_segment || null })), total, page: parseInt(page), limit: parseInt(limit) });
});

// Helper : vérifie que le demandeur est autorisé à accéder aux données d'un client donné.
// Accès autorisé si : admin | client lui-même | marchand ayant fait au moins une tx avec ce client
async function canAccessClient(req, clientId) {
  if (req.admin) return true;
  if (req.client && req.client.id === clientId) return true;
  if (req.merchant) {
    const tx = (await db.query(
      'SELECT id FROM transactions WHERE client_id = $1 AND merchant_id = $2 LIMIT 1',
      [clientId, req.merchant.id]
    )).rows[0];
    return !!tx;
  }
  return false;
}

// GET /api/v1/clients/:id/profile — client lui-même, admin ou marchand ayant transigé avec ce client
router.get('/:id/profile', requireAuth, async (req, res) => {
  const result = await db.query(`
    SELECT c.*, co.name as country_name, co.currency
    FROM clients c LEFT JOIN countries co ON c.country_id = co.id
    WHERE c.id = $1 OR c.afrikfid_id = $1
  `, [req.params.id]);
  const client = result.rows[0];

  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  if (!(await canAccessClient(req, client.id))) return res.status(403).json({ error: 'Accès interdit' });

  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const txStats = (await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total FROM transactions WHERE client_id = $1 AND status = 'completed'`,
    [client.id]
  )).rows[0];

  // Score d'activité + éligibilité prochain statut (CDC §4.3.1)
  const loyaltyConfigs = (await db.query('SELECT * FROM loyalty_config ORDER BY sort_order')).rows;
  const statusOrder = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];
  const currentIdx = statusOrder.indexOf(client.loyalty_status);
  const nextStatus = currentIdx < statusOrder.length - 1 ? statusOrder[currentIdx + 1] : null;

  // CDC v3 : éligibilité basée sur les points statut 12 mois glissants
  const currentPoints12m = parseInt(client.status_points_12m) || 0;
  let nextStatusEligibility = null;
  if (nextStatus) {
    const nextConfig = loyaltyConfigs.find(c => c.status === nextStatus);
    if (nextConfig) {
      const requiredPoints = parseInt(nextConfig.min_status_points) || 0;
      const pointsNeeded = Math.max(0, requiredPoints - currentPoints12m);
      const pointsProgress = requiredPoints > 0
        ? Math.min(100, Math.round((currentPoints12m / requiredPoints) * 100))
        : 100;

      nextStatusEligibility = {
        targetStatus: nextStatus,
        currentStatusPoints12m: currentPoints12m,
        requiredStatusPoints: requiredPoints,
        pointsNeeded,
        pointsProgress,
        eligible: pointsNeeded === 0,
        // Pour ROYAL_ELITE : condition alternative
        ...(nextStatus === 'ROYAL_ELITE' ? {
          alternativeCondition: '3 ans ROYAL consécutifs',
          consecutiveRoyalYears: parseInt(client.consecutive_royal_years) || 0,
          royalEliteViaYears: (parseInt(client.consecutive_royal_years) || 0) >= 3,
        } : {}),
      };
    }
  }

  // Pour admin et le client lui-même : déchiffrer et inclure l'email
  let emailDecrypted = null;
  if ((req.admin || req.client?.id === client.id) && client.email) {
    try { emailDecrypted = decrypt(client.email); } catch { /* ignore */ }
  }

  // RFM + triggers + abandon (admin ou client lui-même)
  const isOwnerOrAdmin = req.admin || (req.client && req.client.id === client.id);
  let rfmSegment = null, triggerHistory = [], abandonInfo = null;
  if (isOwnerOrAdmin) {
    const rfmRes = (await db.query(
      'SELECT segment, r_score, f_score, m_score, calculated_at FROM rfm_scores WHERE client_id = $1 ORDER BY calculated_at DESC LIMIT 1',
      [client.id]
    )).rows[0] || null;
    rfmSegment = rfmRes;

    triggerHistory = (await db.query(
      `SELECT tl.trigger_type, tl.channel, tl.status, tl.sent_at, m.name as merchant_name
       FROM trigger_logs tl LEFT JOIN merchants m ON m.id = tl.merchant_id
       WHERE tl.client_id = $1 ORDER BY tl.created_at DESC LIMIT 10`,
      [client.id]
    )).rows;

    abandonInfo = (await db.query(
      `SELECT at2.*, m.name as merchant_name FROM abandon_tracking at2
       LEFT JOIN merchants m ON m.id = at2.merchant_id
       WHERE at2.client_id = $1 AND at2.status = 'active' LIMIT 1`,
      [client.id]
    )).rows[0] || null;
  }

  res.json({
    client: { ...sanitizeClient(client), email: emailDecrypted },
    wallet: wallet ? { balance: wallet.balance, totalEarned: wallet.total_earned, currency: wallet.currency } : null,
    stats: txStats,
    nextStatusEligibility,
    rfmSegment,
    triggerHistory,
    abandonInfo,
  });
});

// PATCH /api/v1/clients/:id/profile — mise à jour profil (client lui-même)
router.patch('/:id/profile', requireAuth, validate(UpdateClientProfileSchema), async (req, res) => {
  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  // Seul le client lui-même ou un admin peut modifier le profil
  const isOwner = req.client && req.client.id === client.id;
  if (!req.admin && !isOwner) return res.status(403).json({ error: 'Accès interdit' });

  const { full_name, email, birth_date, city, district, country_code } = req.body;
  const updates = [];
  const params = [];
  let idx = 1;

  if (full_name) { updates.push(`full_name = $${idx++}`); params.push(full_name); }
  if (email !== undefined) {
    const encEmail = email ? encrypt(email) : null;
    const eHash = email ? hashField(email) : null;
    updates.push(`email = $${idx++}`); params.push(encEmail);
    updates.push(`email_hash = $${idx++}`); params.push(eHash);
  }
  if (birth_date !== undefined) { updates.push(`birth_date = $${idx++}`); params.push(birth_date); }
  if (city !== undefined) { updates.push(`city = $${idx++}`); params.push(city || null); }
  if (district !== undefined) { updates.push(`district = $${idx++}`); params.push(district || null); }
  if (country_code !== undefined) { updates.push(`country_code = $${idx++}`); params.push(country_code || null); }

  if (updates.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

  params.push(client.id);
  await db.query(`UPDATE clients SET ${updates.join(', ')} WHERE id = $${idx}`, params);

  const updated = (await db.query('SELECT * FROM clients WHERE id = $1', [client.id])).rows[0];
  res.json({ client: sanitizeClient(updated) });
});

// GET /api/v1/clients/:id/wallet — client lui-même ou admin uniquement (données financières sensibles)
router.get('/:id/wallet', requireAuth, async (req, res) => {
  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  // Wallet : accès restreint au client lui-même ou admin (pas les marchands)
  const isOwner = req.client && req.client.id === client.id;
  if (!req.admin && !isOwner) return res.status(403).json({ error: 'Accès interdit' });

  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  if (!wallet) return res.status(404).json({ error: 'Portefeuille non trouvé' });

  const movements = (await db.query(`
    SELECT wm.*, t.reference as tx_reference
    FROM wallet_movements wm
    LEFT JOIN transactions t ON wm.transaction_id = t.id
    WHERE wm.wallet_id = $1
    ORDER BY wm.created_at DESC
    LIMIT 50
  `, [wallet.id])).rows;

  res.json({ wallet: { ...wallet, movements } });
});

// GET /api/v1/clients/:id/transactions — client lui-même ou admin
router.get('/:id/transactions', requireAuth, async (req, res) => {
  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const isOwner = req.client && req.client.id === client.id;
  if (!req.admin && !isOwner) return res.status(403).json({ error: 'Accès interdit' });

  const { page = 1, limit = 20 } = req.query;
  const transactions = (await db.query(`
    SELECT t.*, m.name as merchant_name
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    WHERE t.client_id = $1
    ORDER BY t.initiated_at DESC
    LIMIT $2 OFFSET $3
  `, [client.id, parseInt(limit), (page - 1) * limit])).rows;

  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions WHERE client_id = $1', [client.id])).rows[0].c);
  res.json({ transactions, total });
});

// PATCH /api/v1/clients/:id/loyalty-status (admin)
router.patch('/:id/loyalty-status', requireAdmin, validate(UpdateLoyaltyStatusSchema), async (req, res) => {
  const { status } = req.body;

  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
  if (!clientRes.rows[0]) return res.status(404).json({ error: 'Client non trouvé' });

  await applyStatusChange(req.params.id, status, { reason: 'admin_override', changedBy: req.admin.id });
  const updated = (await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id])).rows[0];
  res.json({ client: sanitizeClient(updated), message: 'Statut mis à jour' });
});

// GET /api/v1/clients/:id/loyalty-history — historique des changements de statut (CDC §4.3.1)
router.get('/:id/loyalty-history', requireAuth, async (req, res) => {
  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  if (!(await canAccessClient(req, client.id))) return res.status(403).json({ error: 'Accès interdit' });

  const { page = 1, limit = 50 } = req.query;
  const history = (await db.query(`
    SELECT * FROM loyalty_status_history
    WHERE client_id = $1
    ORDER BY changed_at DESC
    LIMIT $2 OFFSET $3
  `, [client.id, parseInt(limit), (page - 1) * limit])).rows;

  const total = parseInt((await db.query(
    'SELECT COUNT(*) as c FROM loyalty_status_history WHERE client_id = $1', [client.id]
  )).rows[0].c);

  res.json({ history, total, page: parseInt(page), limit: parseInt(limit) });
});

// DELETE /api/v1/clients/:id — RGPD droit à l'effacement (admin ou client lui-même)
router.delete('/:id', requireAuth, async (req, res) => {
  // Autoriser : admin OU le client lui-même
  const isAdmin = !!req.admin;
  const isOwner = req.client && req.client.id === req.params.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Accès non autorisé' });

  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  if (client.anonymized_at) return res.status(400).json({ error: 'Client déjà anonymisé' });

  // Pseudonymisation RGPD : on remplace les données PII par des valeurs neutres
  const anonPhone = encrypt(`DELETED_${uuidv4()}`);
  const anonEmail = encrypt(`DELETED_${uuidv4()}`);
  const anonHash = hashField(`DELETED_${uuidv4()}`);

  await db.query(`
    UPDATE clients SET
      full_name = 'Utilisateur supprimé',
      phone = $1, phone_hash = $2,
      email = $3, email_hash = $2,
      password_hash = NULL,
      is_active = FALSE,
      anonymized_at = NOW(),
      updated_at = NOW()
    WHERE id = $4
  `, [anonPhone, anonHash, anonEmail, client.id]);

  const actorType = isAdmin ? 'admin' : 'client';
  const actorId = isAdmin ? req.admin.id : req.client.id;
  await db.query(`INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
    VALUES ($1, $2, $3, 'gdpr_anonymize', 'client', $4, $5)`,
    [uuidv4(), actorType, actorId, client.id, req.ip]);

  res.json({ message: 'Données client anonymisées (RGPD). Les transactions historiques sont conservées à des fins comptables.', clientId: client.id });
});

// GET /api/v1/clients/:id/export — RGPD portabilité des données (admin ou client lui-même)
router.get('/:id/export', requireAuth, async (req, res) => {
  const isAdmin = !!req.admin;
  const isOwner = req.client && req.client.id === req.params.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Accès non autorisé' });
  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const movements = (await db.query('SELECT * FROM wallet_movements WHERE wallet_id = $1 ORDER BY created_at DESC', [wallet?.id || ''])).rows;
  const transactions = (await db.query(
    `SELECT id, reference, gross_amount, net_client_amount, merchant_rebate_percent, client_rebate_percent,
            client_rebate_amount, platform_commission_amount, currency, status, payment_method, initiated_at, completed_at
     FROM transactions WHERE client_id = $1 ORDER BY initiated_at DESC`,
    [client.id]
  )).rows;
  const loyaltyHistory = (await db.query(
    'SELECT old_status, new_status, reason, changed_by, changed_at FROM loyalty_status_history WHERE client_id = $1 ORDER BY changed_at DESC',
    [client.id]
  )).rows;

  // Export RGPD Article 20 — portabilité des données
  const exportData = {
    exportedAt: new Date().toISOString(),
    rgpdNote: 'Export de portabilité RGPD (Article 20). Données personnelles traitées par Afrik\'Fid.',
    client: {
      id: client.id,
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: client.phone ? decrypt(client.phone) : null,
      email: client.email ? decrypt(client.email) : null,
      countryId: client.country_id,
      loyaltyStatus: client.loyalty_status,
      isActive: client.is_active,
      createdAt: client.created_at,
      updatedAt: client.updated_at,
    },
    wallet: wallet ? {
      balance: wallet.balance,
      totalEarned: wallet.total_earned,
      totalSpent: wallet.total_spent,
      currency: wallet.currency,
      createdAt: wallet.created_at,
    } : null,
    walletMovements: movements,
    transactions,
    loyaltyStatusHistory: loyaltyHistory,
  };

  const exportActorType = req.admin ? 'admin' : 'client';
  const exportActorId = req.admin ? req.admin.id : req.client.id;
  await db.query(`INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
    VALUES ($1, $2, $3, 'gdpr_export', 'client', $4, $5)`,
    [uuidv4(), exportActorType, exportActorId, client.id, req.ip]);

  res.json(exportData);
});

// POST /api/v1/clients/lookup (marchands)
router.post('/lookup', requireApiKey, validate(LookupClientSchema), async (req, res) => {
  const { phone, afrikfid_id } = req.body;

  let clientRes;
  if (afrikfid_id) {
    clientRes = await db.query('SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.afrikfid_id = $1 AND c.is_active = TRUE', [afrikfid_id]);
  } else if (phone) {
    const ph = hashField(phone);
    clientRes = await db.query('SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.phone_hash = $1 AND c.is_active = TRUE', [ph]);
  }

  const client = clientRes && clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé. Mode invité appliqué.' });

  const wallet = (await db.query('SELECT balance FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  const loyaltyConfig = (await db.query('SELECT * FROM loyalty_config WHERE status = $1', [client.loyalty_status])).rows[0];

  res.json({
    found: true,
    client: {
      afrikfidId: client.afrikfid_id,
      fullName: client.full_name,
      phone: decrypt(client.phone),
      loyaltyStatus: client.loyalty_status,
      clientRebatePercent: loyaltyConfig ? parseFloat(loyaltyConfig.client_rebate_percent) : 0,
      walletBalance: wallet ? wallet.balance : 0,
      currency: client.currency || 'XOF',
    },
  });
});

// POST /api/v1/clients/:id/rewards/spend — CDC v3 §2.3 — Dépenser des points récompense
// Les points récompense (1 pt = 100 FCFA) peuvent être utilisés chez tout marchand du réseau
// Cela n'impacte JAMAIS les points statut ni le niveau de fidélité
router.post('/:id/rewards/spend', requireAuth, async (req, res) => {
  const { points, merchant_id, description } = req.body;
  if (!points || !Number.isInteger(points) || points <= 0) {
    return res.status(400).json({ error: 'points doit être un entier positif' });
  }
  if (!merchant_id) return res.status(400).json({ error: 'merchant_id requis' });

  const clientRes = await db.query('SELECT * FROM clients WHERE id = $1 AND is_active = true', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  // CDC §2.3 : la dépense de points récompense est un acte du client uniquement
  if (!req.client) return res.status(403).json({ error: 'Accès réservé au client' });
  if (req.client.id !== client.id) return res.status(403).json({ error: 'Accès interdit' });

  const currentRewardPoints = parseInt(client.reward_points) || 0;
  if (currentRewardPoints < points) {
    return res.status(400).json({
      error: 'Solde de points récompense insuffisant',
      available: currentRewardPoints,
      requested: points,
    });
  }

  const merchant = (await db.query('SELECT id, name FROM merchants WHERE id = $1 AND is_active = true', [merchant_id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });

  // 1 point récompense = 100 FCFA (POINTS_PER_REWARD_UNIT)
  const amountFCFA = points * 100;
  const newBalance = currentRewardPoints - points;

  await db.query(
    `UPDATE clients SET reward_points = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, client.id]
  );

  // Historique dans wallet_movements (type: reward_spend)
  const wallet = (await db.query('SELECT id, balance FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  if (wallet) {
    await db.query(
      `INSERT INTO wallet_movements (id, wallet_id, type, amount, balance_before, balance_after, description, created_at)
       VALUES ($1, $2, 'reward_spend', $3, $4, $4, $5, NOW())`,
      [uuidv4(), wallet.id, amountFCFA, wallet.balance,
       description || `Dépense ${points} pts récompense chez ${merchant.name}`]
    );
  }

  // Log audit
  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload, created_at)
     VALUES ($1, 'client', $2, 'reward_points_spent', 'client', $2, $3, NOW())`,
    [uuidv4(), client.id, JSON.stringify({ points, amountFCFA, merchant_id, merchant_name: merchant.name })]
  );

  res.json({
    message: `${points} points récompense utilisés (valeur: ${amountFCFA} FCFA)`,
    pointsSpent: points,
    amountFCFA,
    remainingRewardPoints: newBalance,
    merchantName: merchant.name,
  });
});

// GET /api/v1/clients/:id/wallet — CDC v3 §3.6 — solde et mouvements cashback
router.get('/:id/wallet', requireAuth, async (req, res) => {
  const clientRes = await db.query('SELECT id FROM clients WHERE id = $1 OR afrikfid_id = $1', [req.params.id]);
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  if (!(await canAccessClient(req, client.id))) return res.status(403).json({ error: 'Accès interdit' });

  const { limit = 20, page = 1 } = req.query;
  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  if (!wallet) return res.status(404).json({ error: 'Portefeuille non trouvé' });

  const movements = (await db.query(
    `SELECT wm.*, t.reference as tx_reference, t.merchant_id
     FROM wallet_movements wm
     LEFT JOIN transactions t ON t.id = wm.transaction_id
     WHERE wm.wallet_id = $1
     ORDER BY wm.created_at DESC
     LIMIT $2 OFFSET $3`,
    [wallet.id, parseInt(limit), (page - 1) * limit]
  )).rows;

  const total = parseInt((await db.query(
    'SELECT COUNT(*) as c FROM wallet_movements WHERE wallet_id = $1', [wallet.id]
  )).rows[0].c);

  res.json({
    wallet: {
      id: wallet.id,
      balance: wallet.balance,
      totalEarned: wallet.total_earned,
      totalSpent: wallet.total_spent,
      currency: wallet.currency || 'XOF',
      maxBalance: wallet.max_balance || null,
    },
    movements,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
  });
});

function sanitizeClient(c) {
  // Déchiffrer le téléphone en toute sécurité — retourne null si échec (clé absente/différente)
  let phoneMasked = null;
  try {
    const raw = decrypt(c.phone);
    if (raw && !raw.includes(':')) {
      // Masquer : garder seulement les 4 derniers chiffres pour le listing
      phoneMasked = raw.replace(/\d(?=\d{4})/g, '•');
    }
  } catch { /* ignore */ }

  return {
    id: c.id,
    afrikfidId: c.afrikfid_id,
    fullName: c.full_name,
    phone: phoneMasked,
    countryId: c.country_id,
    countryName: c.country_name,
    loyaltyStatus: c.loyalty_status,
    statusSince: c.status_since,
    totalPurchases: c.total_purchases,
    totalAmount: c.total_amount,
    walletBalance: c.wallet_balance,
    statusPoints: c.status_points || 0,
    statusPoints12m: c.status_points_12m || 0,
    rewardPoints: c.reward_points || 0,
    lifetimeStatusPoints: c.lifetime_status_points || 0,
    birthDate: c.birth_date || null,
    isActive: c.is_active,
    createdAt: c.created_at,
  };
}

module.exports = router;
