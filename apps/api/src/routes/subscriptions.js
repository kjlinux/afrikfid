/**
 * Routes Subscriptions & Starter Boost — CDC v3.0 §1.4, §2.6, §3.5
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAdmin, requireMerchant, requireAuth } = require('../middleware/auth');
const { calculateStarterBoostDiscount } = require('../lib/loyalty-engine');
const { MERCHANT_PACKAGES } = require('../config/constants');

// GET /api/v1/subscriptions — liste toutes les subscriptions (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { status, package: pkg, page = 1, limit = 20 } = req.query;
  let sql = `
    SELECT s.*, m.name as merchant_name, m.email as merchant_email, m.package as current_package
    FROM subscriptions s JOIN merchants m ON s.merchant_id = m.id WHERE 1=1
  `;
  const params = [];
  let idx = 1;
  if (status) { sql += ` AND s.status = $${idx++}`; params.push(status); }
  if (pkg) { sql += ` AND s.package = $${idx++}`; params.push(pkg); }
  sql += ` ORDER BY s.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);

  const rows = (await db.query(sql, params)).rows;
  const total = parseInt((await db.query('SELECT COUNT(*) as c FROM subscriptions')).rows[0].c);
  res.json({ subscriptions: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/v1/subscriptions/:id — détail avec bonus recrutement Starter Boost (CDC v3 §2.6, §3.6)
router.get('/:id', requireAuth, async (req, res) => {
  const sub = (await db.query('SELECT s.*, m.name as merchant_name, m.package as merchant_package FROM subscriptions s JOIN merchants m ON s.merchant_id = m.id WHERE s.id = $1', [req.params.id])).rows[0];
  if (!sub) return res.status(404).json({ error: 'Subscription non trouvée' });
  if (req.merchant && req.merchant.id !== sub.merchant_id) return res.status(403).json({ error: 'Accès interdit' });

  // Pour Starter Boost: calculer le bonus recrutement du mois en cours (CDC v3 §2.6)
  let recruitmentBonus = null;
  if (sub.package === 'STARTER_BOOST' || sub.merchant_package === 'STARTER_BOOST') {
    const boost = await calculateStarterBoostDiscount(sub.merchant_id);
    const baseFee = parseFloat(sub.base_monthly_fee) || 25000;
    const effectiveFee = baseFee * (1 - boost.discountPercent / 100);
    recruitmentBonus = {
      clientsRecruitedThisMonth: boost.recruitedCount,
      discountPercent: boost.discountPercent,
      baseMonthlyfee: baseFee,
      effectiveMonthlyFee: Math.round(effectiveFee),
      savingsAmount: Math.round(baseFee - effectiveFee),
    };
  }

  res.json({ subscription: sub, recruitmentBonus });
});

// POST /api/v1/subscriptions — créer une subscription (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { merchant_id, package: pkg, base_monthly_fee } = req.body;
  if (!merchant_id || !pkg) return res.status(400).json({ error: 'merchant_id et package requis' });
  if (!MERCHANT_PACKAGES.includes(pkg)) return res.status(400).json({ error: `Package invalide. Valeurs: ${MERCHANT_PACKAGES.join(', ')}` });

  const merchant = (await db.query('SELECT id FROM merchants WHERE id = $1', [merchant_id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });

  const fee = base_monthly_fee || (pkg === 'STARTER_BOOST' ? 25000 : 0);
  const id = uuidv4();

  await db.query(
    `INSERT INTO subscriptions (id, merchant_id, package, base_monthly_fee, effective_monthly_fee, status, next_billing_at)
     VALUES ($1, $2, $3, $4, $4, 'active', NOW() + INTERVAL '30 days')`,
    [id, merchant_id, pkg, fee]
  );
  await db.query('UPDATE merchants SET package = $1 WHERE id = $2', [pkg, merchant_id]);

  const sub = (await db.query('SELECT * FROM subscriptions WHERE id = $1', [id])).rows[0];
  res.status(201).json({ subscription: sub });
});

// PATCH /api/v1/subscriptions/:id — modifier (admin)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { package: pkg, status, base_monthly_fee } = req.body;
  const sub = (await db.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id])).rows[0];
  if (!sub) return res.status(404).json({ error: 'Subscription non trouvée' });

  const updates = [];
  const params = [];
  let idx = 1;
  if (pkg && MERCHANT_PACKAGES.includes(pkg)) { updates.push(`package = $${idx++}`); params.push(pkg); }
  if (status) { updates.push(`status = $${idx++}`); params.push(status); }
  if (base_monthly_fee !== undefined) { updates.push(`base_monthly_fee = $${idx++}`); params.push(base_monthly_fee); }
  if (updates.length === 0) return res.status(400).json({ error: 'Aucune donnée' });

  updates.push(`updated_at = NOW()`);
  params.push(req.params.id);
  await db.query(`UPDATE subscriptions SET ${updates.join(', ')} WHERE id = $${idx}`, params);

  if (pkg) await db.query('UPDATE merchants SET package = $1 WHERE id = $2', [pkg, sub.merchant_id]);

  const updated = (await db.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id])).rows[0];
  res.json({ subscription: updated });
});

// GET /api/v1/subscriptions/merchant/:merchantId/boost — bonus recrutement Starter Boost (CDC v3 §2.6)
router.get('/merchant/:merchantId/boost', requireAuth, async (req, res) => {
  const { merchantId } = req.params;
  if (req.merchant && req.merchant.id !== merchantId && !req.admin) {
    return res.status(403).json({ error: 'Accès interdit' });
  }
  const boost = await calculateStarterBoostDiscount(merchantId);
  const sub = (await db.query(
    "SELECT * FROM subscriptions WHERE merchant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [merchantId]
  )).rows[0];

  const baseFee = sub ? parseFloat(sub.base_monthly_fee) : 25000;
  const effectiveFee = baseFee * (1 - boost.discountPercent / 100);

  res.json({
    merchantId,
    recruitedClientsLast30Days: boost.recruitedCount,
    discountPercent: boost.discountPercent,
    baseFee,
    effectiveFee: Math.round(effectiveFee),
    subscription: sub || null,
  });
});

module.exports = router;
