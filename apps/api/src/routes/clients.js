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
//
// L'inscription publique est désactivée : les comptes clients sont créés
// exclusivement côté business-api (qui détient la table consommateurs et la
// numérotation des cartes 2014xxxxxxxx). Cet endpoint admin agit comme un
// proxy : on appelle /external/consommateurs côté Laravel, on récupère le
// numero_carte généré, puis on provisionne le mirror local.
//
// Body attendu : full_name, phone, email?, sexe ('M'|'F'), birth_date?, city?, indicatif?
// (full_name est décomposé en prenom + nom pour Laravel)
router.post('/', requireAdmin, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const { upsertClientFromCarteInfo } = require('../lib/business-api-sync');

  const { full_name, phone, email, sexe, birth_date, city, indicatif, whatsapp } = req.body;
  if (!full_name || !sexe || !['M', 'F'].includes(sexe)) {
    return res.status(400).json({ error: 'full_name et sexe (M|F) requis' });
  }

  // Décomposition full_name → prenom + nom (au minimum)
  const parts = String(full_name).trim().split(/\s+/);
  const prenom = parts[0] || '';
  const nom = parts.slice(1).join(' ') || prenom; // fallback si un seul mot

  // Délégation business-api
  let bapi;
  try {
    bapi = await afrikfidClient.createConsommateur({
      nom, prenom, sexe,
      date_naissance: birth_date || null,
      ville: city || null,
      telephone: phone || null,
      whatsapp: whatsapp || null,
      email: email || null,
      indicatif: indicatif || null,
    });
  } catch (err) {
    console.error('[POST /clients] business-api unreachable:', err.message);
    return res.status(503).json({ error: 'BUSINESS_API_UNAVAILABLE', message: 'Service fidélité indisponible.' });
  }

  // Cas doublon : on rattache (provisioning local sur consommateur existant)
  if (!bapi.ok && bapi.already_exists) {
    if (!bapi.numero_carte) {
      return res.status(409).json({ error: 'consommateur_already_exists_without_card' });
    }
    const card = await afrikfidClient.lookupCard(bapi.numero_carte).catch(() => null);
    const client = card ? await upsertClientFromCarteInfo(card, bapi.numero_carte) : null;
    return res.status(409).json({
      error: 'CONSOMMATEUR_ALREADY_EXISTS',
      message: 'Un consommateur avec ce téléphone ou email existe déjà — il a été rattaché à votre passerelle.',
      consommateur_id: bapi.consommateur_id,
      numero_carte: bapi.numero_carte,
      client: client ? sanitizeClient(client) : null,
    });
  }

  if (!bapi.ok) {
    return res.status(502).json({ error: bapi.error || 'BUSINESS_API_ERROR', message: bapi.message });
  }

  // Provisioning local : on utilise lookupCard pour récupérer le payload riche
  // (incluant points = 0, reduction = null, transactions = []) puis upsert.
  const card = await afrikfidClient.lookupCard(bapi.numero_carte).catch(() => null);
  let client = null;
  if (card) {
    client = await upsertClientFromCarteInfo(card, bapi.numero_carte);
  } else {
    // Fallback : création minimaliste du mirror si lookup échoue (ne devrait pas arriver)
    const id = uuidv4();
    const encPhone = phone ? encrypt(phone) : null;
    const phoneHash = phone ? hashField(phone) : null;
    const encEmail = email ? encrypt(email) : null;
    const emailHash = email ? hashField(email) : null;
    await db.query(
      `INSERT INTO clients (id, afrikfid_id, full_name, phone, phone_hash, email, email_hash,
                            birth_date, city, gender, business_api_consommateur_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
       ON CONFLICT (afrikfid_id) DO NOTHING`,
      [id, bapi.numero_carte, full_name, encPhone, phoneHash, encEmail, emailHash,
       birth_date || null, city || null, sexe, bapi.consommateur_id]
    );
    client = (await db.query('SELECT * FROM clients WHERE afrikfid_id = $1', [bapi.numero_carte])).rows[0];
  }

  // Bienvenue : on garde notifyClientWelcome pour cohérence avec l'ancien flow
  notifyClientWelcome({ client: { ...client, phone, email } }).catch(() => {});

  res.status(201).json({
    client: sanitizeClient(client),
    consommateur_id: bapi.consommateur_id,
    numero_carte: bapi.numero_carte,
  });
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
    `SELECT COUNT(*) as count, COALESCE(SUM(gross_amount), 0) as total, COALESCE(SUM(client_rebate_amount), 0) as total_rebate FROM transactions WHERE client_id = $1 AND status = 'completed'`,
    [client.id]
  )).rows[0];

  // Score d'activité + éligibilité prochain statut 
  const loyaltyConfigs = (await db.query('SELECT * FROM loyalty_config ORDER BY sort_order')).rows;
  const statusOrder = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];
  const currentIdx = statusOrder.indexOf(client.loyalty_status);
  const nextStatus = currentIdx < statusOrder.length - 1 ? statusOrder[currentIdx + 1] : null;

  // CDC v3 : éligibilité basée sur les points statut 12 mois glissants
  const { LOYALTY_POINTS_THRESHOLDS } = require('../config/constants');
  const currentPoints12m = parseInt(client.status_points_12m) || 0;
  let nextStatusEligibility = null;
  if (nextStatus) {
    const nextConfig = loyaltyConfigs.find(c => c.status === nextStatus);
    const requiredPoints = nextConfig
      ? (parseInt(nextConfig.min_status_points) || LOYALTY_POINTS_THRESHOLDS[nextStatus] || 0)
      : (LOYALTY_POINTS_THRESHOLDS[nextStatus] || 0);

    if (requiredPoints > 0) {
      const pointsNeeded = Math.max(0, requiredPoints - currentPoints12m);
      const pointsProgress = Math.min(100, Math.round((currentPoints12m / requiredPoints) * 100));

      nextStatusEligibility = {
        targetStatus: nextStatus,
        currentStatusPoints12m: currentPoints12m,
        requiredStatusPoints: requiredPoints,
        pointsNeeded,
        pointsProgress,
        overallProgress: pointsProgress,
        evaluationMonths: 12,
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

  // Points réels depuis fidelite-api (source de vérité) — enrichit les valeurs locales
  let bapiPoints = null;
  const afrikfidClient = require('../lib/afrikfid-client');
  if (afrikfidClient.isValidCardNumero(client.afrikfid_id)) {
    try {
      const card = await afrikfidClient.lookupCard(client.afrikfid_id);
      if (card && card.points_cumules != null) {
        bapiPoints = parseInt(card.points_cumules) || 0;
        // Mettre à jour la DB locale en arrière-plan pour cohérence future
        db.query('UPDATE clients SET reward_points = $1 WHERE id = $2', [bapiPoints, client.id]).catch(() => {});
      }
    } catch { /* fail-open : on garde les valeurs locales */ }
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

  const clientData = sanitizeClient(client);

  res.json({
    client: { ...clientData, email: emailDecrypted },
    wallet: wallet ? { balance: wallet.balance, totalEarned: wallet.total_earned, currency: wallet.currency } : null,
    stats: txStats,
    nextStatusEligibility,
    rfmSegment,
    triggerHistory,
    abandonInfo,
    // Points caisse physique (fidelite-api) — séparés des reward_points passerelle
    afrikfidPoints: bapiPoints,
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

  // Sync sortante vers business-api (asynchrone, fail-soft) — uniquement si :
  //   1. la sync entrante n'est pas en cours d'application (anti-boucle)
  //   2. le client est lié à un consommateur business-api
  //   3. au moins un champ partagé a changé
  const { isPushSuspended } = require('./external-sync');
  if (!isPushSuspended() && updated.business_api_consommateur_id) {
    const sharedChanges = {};
    if (full_name !== undefined) {
      // Décompose full_name en prenom/nom pour cohérence avec le schéma Laravel
      const parts = String(full_name || '').trim().split(/\s+/);
      sharedChanges.prenom = parts[0] || '';
      sharedChanges.nom = parts.slice(1).join(' ') || '';
    }
    if (email !== undefined) sharedChanges.email = email;
    if (birth_date !== undefined) sharedChanges.date_naissance = birth_date;
    if (city !== undefined) sharedChanges.ville = city;
    if (Object.keys(sharedChanges).length > 0) {
      const afrikfidClient = require('../lib/afrikfid-client');
      // Fire-and-forget : on ne bloque pas la réponse HTTP sur la latence Laravel.
      afrikfidClient.pushProfileUpdate({
        type: 'client',
        business_api_id: updated.business_api_consommateur_id,
        changes: sharedChanges,
      }).catch(err => console.warn('[clients/profile] push to business-api failed:', err.message));
    }
  }

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

// GET /api/v1/clients/:id/loyalty-history — historique des changements de statut 
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
//
// Accepte soit `identifier` (champ unique intelligent : téléphone, carte
// 2014xxxxxxxx, ou afrikfid_id legacy), soit les champs legacy phone /
// afrikfid_id / card_number. Si la carte n'est pas connue localement, on
// interroge business-api (source de vérité des cartes fidélité) et on
// importe/rattache le consommateur si trouvé.
router.post('/lookup', requireApiKey, validate(LookupClientSchema), async (req, res) => {
  const { detectIdentifier } = require('../lib/client-identifier');
  const afrikfidClient = require('../lib/afrikfid-client');
  const { identifier, phone, afrikfid_id, card_number } = req.body;

  let lookup = { type: 'unknown', normalized: '' };
  if (identifier) lookup = detectIdentifier(identifier);
  else if (card_number) lookup = { type: 'card', normalized: card_number };
  else if (afrikfid_id) {
    // afrikfid_id peut être au nouveau format (12 chiffres) ou au format legacy AFD-*
    lookup = detectIdentifier(afrikfid_id);
    if (lookup.type === 'unknown') lookup = { type: 'afrikfid_legacy', normalized: afrikfid_id };
  } else if (phone) lookup = { type: 'phone', normalized: phone };

  let clientRes;
  if (lookup.type === 'card') {
    // Depuis la migration 031, clients.afrikfid_id EST le numéro de carte (2014xxxxxxxx).
    clientRes = await db.query(
      'SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.afrikfid_id = $1 AND c.is_active = TRUE',
      [lookup.normalized]
    );
  } else if (lookup.type === 'afrikfid_legacy') {
    clientRes = await db.query(
      `SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id
       WHERE (c.afrikfid_id = $1 OR c.legacy_afrikfid_id = $1) AND c.is_active = TRUE`,
      [lookup.normalized]
    );
  } else if (lookup.type === 'phone') {
    const ph = hashField(lookup.normalized);
    clientRes = await db.query(
      'SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id WHERE c.phone_hash = $1 AND c.is_active = TRUE',
      [ph]
    );
  } else {
    return res.status(400).json({ error: 'Identifiant non reconnu' });
  }

  let client = clientRes && clientRes.rows[0];

  // Fallback business-api : carte inconnue localement → on résout via l'API
  // historique des cartes fidélité et on crée le client local au vol.
  if (!client && lookup.type === 'card') {
    try {
      const card = await afrikfidClient.lookupCard(lookup.normalized);
      if (card && (card.consommateur || card.numero)) {
        const { upsertClientFromCarteInfo } = require('../lib/business-api-sync');
        client = await upsertClientFromCarteInfo(card, lookup.normalized);
      }
    } catch (err) {
      console.warn('[lookup] business-api fallback failed:', err.message);
    }
  }

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
      businessApiLinked: !!client.business_api_consommateur_id,
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

  //: la dépense de points récompense est un acte du client uniquement
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

// ─── GET /api/v1/clients/me/afrikfid-profile ─────────────────────────────────
// Profil fidélité historique (carte + wallet + carte cadeau) rapatrié depuis business-api.
// Renvoie { available: false } si la carte n'est pas connue côté SI fidélité ou si
// l'intégration est indisponible — l'espace client continue de fonctionner en mode dégradé.
router.get('/me/afrikfid-profile', require('../middleware/auth').requireClient, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const numero = req.client?.afrikfid_id;
  if (!afrikfidClient.isValidCardNumero(numero)) {
    return res.json({ available: false, reason: 'card_format_not_unified' });
  }
  const [card, wallet] = await Promise.all([
    afrikfidClient.lookupCard(numero).catch(() => null),
    afrikfidClient.getWallet(numero).catch(() => null),
  ]);
  if (!card) return res.json({ available: false, reason: 'upstream_unavailable' });
  res.json({
    available: true,
    card: {
      numero: card.numero,
      points: card.points_cumules,
      reduction: card.reduction,
    },
    wallet: wallet || null,
  });
});

// ─── GET /clients/me/unified-history ──────────────────────────────────────────
//
// Timeline fusionnée : paiements passerelle (transactions locales) + achats
// multi-enseignes rapportés par business-api (InfoController@infoCarteFidelite).
// Tri chronologique décroissant, tag de source sur chaque entrée.
//
// Fail-open sur business-api : si le SI fidélité est injoignable, on renvoie
// uniquement la partie gateway avec `sources.afrikfid = { available: false }`.

router.get('/me/unified-history', requireClient, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

  const clientId = req.client.id;
  const afrikfidId = req.client.afrikfid_id;

  // Gateway : transactions locales récentes (toutes statuts)
  const gatewayRes = await db.query(`
    SELECT t.id, t.reference, t.gross_amount, t.client_rebate_amount, t.currency,
           t.status, t.payment_method, t.payment_operator, t.initiated_at, t.completed_at,
           m.name AS merchant_name, m.logo_url AS merchant_logo
      FROM transactions t
      JOIN merchants m ON m.id = t.merchant_id
     WHERE t.client_id = $1
     ORDER BY COALESCE(t.completed_at, t.initiated_at) DESC
     LIMIT $2
  `, [clientId, limit]);

  const gatewayItems = gatewayRes.rows.map(r => ({
    source: 'gateway',
    id: r.id,
    reference: r.reference,
    date: r.completed_at || r.initiated_at,
    merchantName: r.merchant_name,
    merchantLogo: r.merchant_logo || null,
    amountXof: Number(r.gross_amount) || 0,
    clientRebateXof: Number(r.client_rebate_amount) || 0,
    currency: r.currency || 'XOF',
    status: r.status,
    paymentMethod: r.payment_method,
    paymentOperator: r.payment_operator || null,
  }));

  // Index logo local par nom de marchand (normalisé) pour unifier les logos entre sources
  const localLogoByName = {};
  for (const gi of gatewayItems) {
    if (gi.merchantName && gi.merchantLogo) {
      localLogoByName[gi.merchantName.toLowerCase().trim()] = gi.merchantLogo;
    }
  }

  // business-api : achats multi-enseignes (depuis normalizeCard)
  let afrikfidSource = { available: false, reason: 'card_not_linked' };
  let afrikfidItems = [];
  if (afrikfidClient.isValidCardNumero(afrikfidId)) {
    try {
      const card = await afrikfidClient.lookupCard(afrikfidId);
      if (card) {
        afrikfidSource = { available: true, numero: card.numero, points: card.points_cumules };
        afrikfidItems = (card.transactions || []).map((t, i) => {
          const nameKey = (t.merchant || '').toLowerCase().trim();
          const logo = localLogoByName[nameKey] || t.logo || null;
          return {
            source: 'afrikfid',
            id: `bapi-${afrikfidId}-${i}-${t.date || ''}`,
            date: t.date,
            merchantName: t.merchant,
            merchantLogo: logo,
            amountXof: t.amountXof,
            pointsEarned: t.pointsEarned,
            currency: 'XOF',
            status: 'completed',
          };
        });
      } else {
        afrikfidSource = { available: false, reason: 'upstream_404' };
      }
    } catch {
      afrikfidSource = { available: false, reason: 'upstream_unavailable' };
    }
  }

  // Fusion : déduplication des transactions déjà synchronisées depuis la
  // gateway vers business-api — on préfère l'entrée gateway (plus riche :
  // remise, statut, ID). Heuristique : même marchand + même montant + date ±2min.
  const near = (a, b) => {
    if (!a || !b) return false;
    return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 2 * 60 * 1000;
  };
  const afrikfidFiltered = afrikfidItems.filter(ai =>
    !gatewayItems.some(gi =>
      gi.status === 'completed' &&
      gi.merchantName === ai.merchantName &&
      Math.round(gi.amountXof) === Math.round(ai.amountXof) &&
      near(gi.date, ai.date)
    )
  );

  const merged = [...gatewayItems, ...afrikfidFiltered]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  res.json({
    items: merged,
    sources: {
      gateway: { available: true, count: gatewayItems.length },
      afrikfid: { ...afrikfidSource, count: afrikfidItems.length, kept: afrikfidFiltered.length },
    },
  });
});

// ─── DELETE /clients/:id/card-link — Admin : délier la carte fidélité ────────
//
// Cas d'usage : fraude, demande client, carte perdue.
// Effet : le client reste actif mais perd son rattachement à la carte fidélité
// business-api. On restaure legacy_afrikfid_id s'il existe (format AFD-*),
// sinon on génère un nouvel identifiant AFD-UNLNK-*. Le consommateur business-api
// n'est PAS supprimé (géré par leur équipe), on coupe juste le lien.

router.delete('/:id/card-link', requireAdmin, async (req, res) => {
  const clientRes = await db.query(
    'SELECT id, afrikfid_id, legacy_afrikfid_id, business_api_consommateur_id FROM clients WHERE id = $1 OR afrikfid_id = $1',
    [req.params.id]
  );
  const client = clientRes.rows[0];
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });

  if (!/^2014\d{8}$/.test(client.afrikfid_id)) {
    return res.status(409).json({ error: 'Ce client n\'a pas de carte fidélité liée.' });
  }

  // Restauration de l'ancien identifiant si disponible, sinon génération.
  let newAfrikfidId = client.legacy_afrikfid_id;
  if (!newAfrikfidId) {
    const { randomBytes } = require('crypto');
    newAfrikfidId = `AFD-UNLNK-${randomBytes(3).toString('hex').toUpperCase()}`;
  } else {
    // Vérifie que le legacy ne collisionne pas (cas rare : un autre compte l'a repris)
    const taken = (await db.query(
      'SELECT id FROM clients WHERE afrikfid_id = $1 AND id != $2',
      [newAfrikfidId, client.id]
    )).rows[0];
    if (taken) {
      const { randomBytes } = require('crypto');
      newAfrikfidId = `AFD-UNLNK-${randomBytes(3).toString('hex').toUpperCase()}`;
    }
  }

  const formerCard = client.afrikfid_id;

  await db.query(
    `UPDATE clients
        SET afrikfid_id = $1,
            legacy_afrikfid_id = NULL,
            business_api_consommateur_id = NULL,
            updated_at = NOW()
      WHERE id = $2`,
    [newAfrikfidId, client.id]
  );

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload, ip_address)
     VALUES ($1, 'admin', $2, 'card_link_removed', 'client', $3, $4, $5)`,
    [uuidv4(), req.admin.id, client.id,
     JSON.stringify({ former_card: formerCard, former_consommateur_id: client.business_api_consommateur_id, new_afrikfid_id: newAfrikfidId }),
     req.ip]
  );

  res.json({
    unlinked: true,
    formerCard,
    newAfrikfidId,
  });
});

// ─── Link Card — lier une carte fidélité existante à son compte ───────────────
//
// Flux en deux temps côté client authentifié :
//   1) POST /clients/me/link-card/request  { numero_carte }
//        → lookup business-api, envoi OTP par SMS sur le téléphone du consommateur
//   2) POST /clients/me/link-card/verify   { numero_carte, otp }
//        → vérif OTP, écriture afrikfid_id (+ legacy_afrikfid_id) et
//          business_api_consommateur_id sur le client local
//
// Sécurité :
//   - OTP envoyé sur le téléphone business-api (pas celui saisi par l'UI) → prouve la possession
//   - Unicité sur afrikfid_id : une carte ne peut être liée qu'à un seul compte
//   - Audit log sur chaque étape

router.post('/me/link-card/request', requireClient, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const { sendSMS } = require('../lib/notifications');
  const { issueOtp, OTP_TTL_SECONDS } = require('../lib/link-card-otp');

  const numero = String(req.body.numero_carte || '').replace(/\s+/g, '');
  if (!afrikfidClient.isValidCardNumero(numero)) {
    return res.status(400).json({ error: 'Numéro de carte invalide (format 2014xxxxxxxx attendu)' });
  }

  // Déjà lié au compte courant → idempotent
  if (req.client.afrikfid_id === numero) {
    return res.json({ alreadyLinked: true });
  }

  // Carte déjà liée à un autre compte actif → refus
  const occupied = (await db.query(
    'SELECT id FROM clients WHERE afrikfid_id = $1 AND id != $2 AND is_active = TRUE',
    [numero, req.client.id]
  )).rows[0];
  if (occupied) {
    return res.status(409).json({ error: 'Cette carte est déjà liée à un autre compte.' });
  }

  let card;
  try { card = await afrikfidClient.lookupCard(numero); } catch { card = null; }
  if (!card || !card.consommateur) {
    return res.status(404).json({ error: 'Carte introuvable dans le système fidélité.' });
  }

  const phoneConso = card.consommateur.telephone;
  if (!phoneConso) {
    return res.status(422).json({ error: "Cette carte n'a pas de téléphone rattaché — impossible d'envoyer un OTP." });
  }

  const code = await issueOtp(req.client.id, numero);
  try {
    await sendSMS(
      phoneConso,
      `Afrik'Fid : votre code pour lier la carte ${numero} est ${code}. Valable ${Math.round(OTP_TTL_SECONDS / 60)} min.`
    );
  } catch (err) {
    console.warn('[link-card/request] SMS failed:', err.message);
    return res.status(502).json({ error: "Échec de l'envoi du SMS. Réessayez dans un instant." });
  }

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
     VALUES ($1, 'client', $2, 'link_card_otp_requested', 'client', $3, $4)`,
    [uuidv4(), req.client.id, req.client.id, req.ip]
  );

  // Masque partiel pour affichage UI : "+225•••••45 67"
  const masked = phoneConso.length > 4
    ? phoneConso.slice(0, 4) + '•'.repeat(Math.max(phoneConso.length - 8, 2)) + phoneConso.slice(-4)
    : '••••';

  res.json({
    otpSent: true,
    phoneMasked: masked,
    ttlSeconds: OTP_TTL_SECONDS,
    consommateurName: [card.consommateur.prenom, card.consommateur.nom].filter(Boolean).join(' ') || null,
  });
});

router.post('/me/link-card/verify', requireClient, async (req, res) => {
  const afrikfidClient = require('../lib/afrikfid-client');
  const { verifyOtp } = require('../lib/link-card-otp');

  const numero = String(req.body.numero_carte || '').replace(/\s+/g, '');
  const otp = String(req.body.otp || '').trim();

  if (!afrikfidClient.isValidCardNumero(numero)) {
    return res.status(400).json({ error: 'Numéro de carte invalide' });
  }
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ error: 'Code OTP invalide (6 chiffres attendus)' });
  }

  const check = await verifyOtp(req.client.id, numero, otp);
  if (!check.ok) {
    const msg = {
      expired_or_missing: 'Code expiré — demandez un nouvel envoi.',
      too_many_attempts: 'Trop de tentatives — demandez un nouvel envoi.',
      invalid_code: `Code incorrect.${check.remaining != null ? ` ${check.remaining} tentative(s) restante(s).` : ''}`,
    }[check.reason] || 'Vérification impossible.';
    return res.status(401).json({ error: msg, reason: check.reason, remaining: check.remaining });
  }

  // Re-vérifie la non-collision (course avec un autre lien simultané)
  const occupied = (await db.query(
    'SELECT id FROM clients WHERE afrikfid_id = $1 AND id != $2 AND is_active = TRUE',
    [numero, req.client.id]
  )).rows[0];
  if (occupied) return res.status(409).json({ error: 'Cette carte est déjà liée à un autre compte.' });

  // Re-lookup pour récupérer consommateur_id (la carte peut avoir changé depuis /request)
  let card;
  try { card = await afrikfidClient.lookupCard(numero); } catch { card = null; }
  const consommateurId = card?.consommateur?.id != null ? parseInt(card.consommateur.id, 10) : null;

  await db.query(
    `UPDATE clients
        SET legacy_afrikfid_id = COALESCE(legacy_afrikfid_id, afrikfid_id),
            afrikfid_id = $1,
            business_api_consommateur_id = COALESCE($2, business_api_consommateur_id),
            updated_at = NOW()
      WHERE id = $3`,
    [numero, consommateurId, req.client.id]
  );

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
     VALUES ($1, 'client', $2, 'link_card_verified', 'client', $3, $4)`,
    [uuidv4(), req.client.id, req.client.id, req.ip]
  );

  res.json({ linked: true, afrikfidId: numero });
});

module.exports = router;
