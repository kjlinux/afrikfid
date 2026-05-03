/**
 * Routes Subscriptions — Moteur d'abonnements marchands.
 * CDC v3.0 §1.4, §2.5, §2.6
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { requireAdmin, requireMerchant, requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { calculateStarterBoostDiscount } = require('../lib/loyalty-engine');
const {
  MERCHANT_PACKAGES, PACKAGE_PRICES_FCFA, PACKAGE_LABELS, BILLING_CYCLES, ANNUAL_PAID_MONTHS,
} = require('../config/constants');
const {
  SubscriptionQuoteSchema, SubscriptionCheckoutSchema, SubscriptionAdminPatchSchema,
} = require('../config/schemas');
const engine = require('../lib/subscription-engine');
const stripe = require('../lib/adapters/stripe');
const mm = require('../lib/adapters/mobile-money');

// ─── Public : grille tarifaire ───────────────────────────────────────────────
router.get('/packages', (req, res) => {
  const packages = MERCHANT_PACKAGES.map(pkg => {
    const isFree = PACKAGE_PRICES_FCFA[pkg] === 0;
    return {
      code: pkg,
      label: PACKAGE_LABELS[pkg],
      monthly: PACKAGE_PRICES_FCFA[pkg],
      annual: isFree ? 0 : PACKAGE_PRICES_FCFA[pkg] * ANNUAL_PAID_MONTHS,
      annual_free_months: isFree ? 0 : 1,
      is_free: isFree,
      currency: 'XOF',
    };
  });
  res.json({ packages, billing_cycles: BILLING_CYCLES });
});

// ─── Marchand : ma subscription complète ─────────────────────────────────────
router.get('/me', requireMerchant, async (req, res) => {
  const sub = await engine.getOrCreateSubscription(req.merchant.id);
  const periods = await engine.listQueuedPeriods(sub.id);
  const payments = (await db.query(
    `SELECT * FROM subscription_payments WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [req.merchant.id]
  )).rows;
  const changes = (await db.query(
    `SELECT * FROM subscription_package_changes WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.merchant.id]
  )).rows;

  let recruitmentBonus = null;
  if (sub.package === 'STARTER_BOOST') {
    const boost = await calculateStarterBoostDiscount(req.merchant.id);
    recruitmentBonus = {
      clientsRecruitedThisMonth: boost.recruitedCount,
      discountPercent: boost.discountPercent,
    };
  }

  const daysLeft = sub.current_period_end
    ? Math.ceil((new Date(sub.current_period_end) - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  res.json({ subscription: sub, periods, payments, changes, recruitmentBonus, daysLeft });
});

// ─── Marchand : devis ────────────────────────────────────────────────────────
router.post('/me/quote', requireMerchant, validate(SubscriptionQuoteSchema), async (req, res) => {
  try {
    const quote = await engine.quoteCheckout(req.merchant.id, req.body);
    res.json(quote);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Marchand : checkout (Stripe ou Mobile Money) ────────────────────────────
router.post('/me/checkout', requireMerchant, validate(SubscriptionCheckoutSchema), async (req, res) => {
  try {
    const { provider, phone, operator, package: pkg, billing_cycle, mode } = req.body;
    const quote = await engine.quoteCheckout(req.merchant.id, { package: pkg, billing_cycle, mode });

    if (quote.kind === 'free') {
      // Plan gratuit : activer directement sans paiement
      const sub = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [quote.subscription_id])).rows[0];
      if (sub.package !== 'STARTER_BOOST') {
        await db.query(
          `UPDATE subscriptions SET package='STARTER_BOOST', base_monthly_fee=0, effective_monthly_fee=0,
             current_period_end=NULL, next_billing_at=NULL, status='active', updated_at=NOW() WHERE id=$1`,
          [sub.id]
        );
        await db.query(`UPDATE merchants SET package='STARTER_BOOST' WHERE id=$1`, [sub.merchant_id]);
        await engine.logPackageChange({
          subscriptionId: sub.id, merchantId: sub.merchant_id,
          oldPackage: sub.package, newPackage: 'STARTER_BOOST',
          changedBy: 'merchant_upgrade', actorId: req.merchant.id,
          reason: 'Bascule vers plan gratuit',
        });
      }
      return res.json({ status: 'activated', package: 'STARTER_BOOST', kind: 'free' });
    }
    if (quote.amount <= 0) {
      return res.status(400).json({ error: 'Montant nul — aucun paiement requis' });
    }
    if (provider === 'mobile_money' && (!phone || !operator)) {
      return res.status(400).json({ error: 'phone et operator requis pour Mobile Money' });
    }

    const sub = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [quote.subscription_id])).rows[0];
    const reference = `SUB-${sub.id.slice(0, 8)}-${Date.now().toString(36).toUpperCase()}`;
    const description = `Afrik'Fid — ${quote.description}`;

    if (provider === 'stripe') {
      const txId = uuidv4();
      const result = await stripe.initiateCardPayment({
        transactionId: txId,
        reference,
        amount: quote.amount,
        currency: quote.currency,
        customerEmail: req.merchant.email,
        customerName: req.merchant.name,
        description,
      });
      if (!result.success) return res.status(502).json({ error: result.error || 'STRIPE_ERROR', message: result.message });

      await engine.createPendingPayment({
        subscription: sub, kind: quote.kind, package: pkg, billingCycle: quote.billing_cycle,
        amount: quote.amount, provider: 'stripe', providerRef: result.stripeRef,
        periodStart: quote.period_start, periodEnd: quote.period_end,
      });
      return res.json({
        provider: 'stripe', checkout_url: result.paymentUrl, provider_ref: result.stripeRef,
        amount: quote.amount, currency: quote.currency, kind: quote.kind,
      });
    }

    // Mobile Money
    const result = await mm.initiatePayment({
      operator, phone, amount: quote.amount, currency: quote.currency,
      reference, description,
    });
    if (!result.success) return res.status(502).json({ error: result.error || 'MM_ERROR', message: result.message });

    const payment = await engine.createPendingPayment({
      subscription: sub, kind: quote.kind, package: pkg, billingCycle: quote.billing_cycle,
      amount: quote.amount, provider: 'mobile_money', providerRef: result.operatorRef || reference,
      phone, operator, periodStart: quote.period_start, periodEnd: quote.period_end,
    });

    // En sandbox MM, le résultat est immédiatement "completed" : on applique tout de suite
    if (result.sandbox || result.status === 'completed') {
      await engine.applyPaidPayment(payment);
      return res.json({
        provider: 'mobile_money', status: 'completed', sandbox: !!result.sandbox,
        provider_ref: result.operatorRef, amount: quote.amount, kind: quote.kind,
      });
    }

    res.json({
      provider: 'mobile_money', status: 'pending', provider_ref: result.operatorRef,
      payment_url: result.paymentUrl || null, amount: quote.amount, kind: quote.kind,
    });
  } catch (err) {
    console.error('[SUBSCRIPTIONS] checkout error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── Webhook Stripe (subscriptions) ──────────────────────────────────────────
router.post('/webhook/stripe', async (req, res) => {
  if (!stripe.verifyWebhookSignature(req)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }
  const event = req.body;
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data?.object;
      const ref = session?.id;
      const payment = await engine.findPaymentByProviderRef('stripe', ref);
      if (payment && payment.status === 'pending') {
        await engine.applyPaidPayment(payment);
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
      const obj = event.data?.object;
      const ref = obj?.id;
      const payment = await engine.findPaymentByProviderRef('stripe', ref);
      if (payment && payment.status === 'pending') {
        await engine.failPayment(payment, event.type);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[SUBSCRIPTIONS/webhook stripe] erreur:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Webhook Mobile Money (callback opérateur) ───────────────────────────────
router.post('/webhook/mobile-money', async (req, res) => {
  try {
    const { provider_ref, operatorRef, status } = req.body || {};
    const ref = provider_ref || operatorRef;
    if (!ref) return res.status(400).json({ error: 'provider_ref requis' });
    const payment = await engine.findPaymentByProviderRef('mobile_money', ref);
    if (!payment) return res.status(404).json({ error: 'payment introuvable' });
    if (payment.status !== 'pending') return res.json({ already: true });

    if (status === 'completed' || status === 'success') {
      await engine.applyPaidPayment(payment);
    } else {
      await engine.failPayment(payment, status || 'failed');
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[SUBSCRIPTIONS/webhook mm] erreur:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Admin : liste ───────────────────────────────────────────────────────────
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

  let countSql = `SELECT COUNT(*) as c FROM subscriptions s JOIN merchants m ON s.merchant_id = m.id WHERE 1=1`;
  const countP = []; let ci = 1;
  if (status) { countSql += ` AND s.status = $${ci++}`; countP.push(status); }
  if (pkg) { countSql += ` AND s.package = $${ci++}`; countP.push(pkg); }
  const total = parseInt((await db.query(countSql, countP)).rows[0].c);
  res.json({ subscriptions: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── Historique paiements (avant /:id pour ne pas matcher /payments comme id) ─
router.get('/payments', requireAuth, async (req, res) => {
  const { merchant_id, page = 1, limit = 20 } = req.query;
  const params = []; let idx = 1;
  let sql = `
    SELECT sp.*, m.name as merchant_name, s.package as sub_package
    FROM subscription_payments sp
    JOIN subscriptions s ON s.id = sp.subscription_id
    JOIN merchants m ON m.id = sp.merchant_id
    WHERE 1=1
  `;
  if (req.merchant) { sql += ` AND sp.merchant_id = $${idx++}`; params.push(req.merchant.id); }
  else if (req.admin && merchant_id) { sql += ` AND sp.merchant_id = $${idx++}`; params.push(merchant_id); }
  else if (!req.admin) return res.status(403).json({ error: 'Accès interdit' });

  sql += ` ORDER BY sp.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(parseInt(limit), (page - 1) * limit);
  const rows = (await db.query(sql, params)).rows;

  let countSql = `SELECT COUNT(*) as c FROM subscription_payments sp WHERE 1=1`;
  const countParams = []; let ci = 1;
  if (req.merchant) { countSql += ` AND sp.merchant_id = $${ci++}`; countParams.push(req.merchant.id); }
  else if (req.admin && merchant_id) { countSql += ` AND sp.merchant_id = $${ci++}`; countParams.push(merchant_id); }
  const total = parseInt((await db.query(countSql, countParams)).rows[0].c);
  res.json({ payments: rows, total, page: parseInt(page), limit: parseInt(limit) });
});

// ─── Admin : détail subscription + file de périodes ──────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const sub = (await db.query(
    `SELECT s.*, m.name as merchant_name, m.package as merchant_package, m.email as merchant_email
       FROM subscriptions s JOIN merchants m ON s.merchant_id = m.id WHERE s.id = $1`,
    [req.params.id]
  )).rows[0];
  if (!sub) return res.status(404).json({ error: 'Subscription non trouvée' });
  if (req.merchant && req.merchant.id !== sub.merchant_id) return res.status(403).json({ error: 'Accès interdit' });

  const periods = await engine.listQueuedPeriods(sub.id);
  const changes = (await db.query(
    `SELECT * FROM subscription_package_changes WHERE subscription_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [sub.id]
  )).rows;

  let recruitmentBonus = null;
  if (sub.package === 'STARTER_BOOST') {
    const boost = await calculateStarterBoostDiscount(sub.merchant_id);
    const baseFee = parseFloat(sub.base_monthly_fee) || PACKAGE_PRICES_FCFA.STARTER_BOOST;
    const effectiveFee = baseFee * (1 - boost.discountPercent / 100);
    recruitmentBonus = {
      clientsRecruitedThisMonth: boost.recruitedCount,
      discountPercent: boost.discountPercent,
      baseMonthlyfee: baseFee,
      effectiveMonthlyFee: Math.round(effectiveFee),
      savingsAmount: Math.round(baseFee - effectiveFee),
    };
  }
  res.json({ subscription: sub, periods, changes, recruitmentBonus });
});

// ─── Admin : créer subscription ──────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  const { merchant_id, package: pkg, base_monthly_fee } = req.body;
  if (!merchant_id || !pkg) return res.status(400).json({ error: 'merchant_id et package requis' });
  if (!MERCHANT_PACKAGES.includes(pkg)) return res.status(400).json({ error: `Package invalide` });

  const merchant = (await db.query('SELECT id FROM merchants WHERE id = $1', [merchant_id])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé' });

  const fee = base_monthly_fee != null ? base_monthly_fee : PACKAGE_PRICES_FCFA[pkg];
  const id = uuidv4();
  const start = new Date();
  const end = engine.addPeriod(start, 'monthly');

  await db.query(
    `INSERT INTO subscriptions
       (id, merchant_id, package, base_monthly_fee, effective_monthly_fee, status,
        billing_cycle, current_period_start, current_period_end, next_billing_at)
     VALUES ($1,$2,$3,$4,$4,'active','monthly',$5,$6,$6)`,
    [id, merchant_id, pkg, fee, start, end]
  );
  await db.query('UPDATE merchants SET package = $1 WHERE id = $2', [pkg, merchant_id]);
  await engine.logPackageChange({
    subscriptionId: id, merchantId: merchant_id,
    oldPackage: null, newPackage: pkg, changedBy: 'admin',
    actorId: req.admin?.id, reason: req.body.reason || 'Création initiale',
  });
  const sub = (await db.query('SELECT * FROM subscriptions WHERE id = $1', [id])).rows[0];
  res.status(201).json({ subscription: sub });
});

// ─── Admin : changer le package (gratuit, échéance inchangée) ────────────────
router.patch('/:id', requireAdmin, validate(SubscriptionAdminPatchSchema), async (req, res) => {
  const { package: pkg, status, base_monthly_fee, reason } = req.body;
  const sub = (await db.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id])).rows[0];
  if (!sub) return res.status(404).json({ error: 'Subscription non trouvée' });

  const updates = []; const params = []; let idx = 1;
  if (pkg && pkg !== sub.package) {
    updates.push(`package = $${idx++}`); params.push(pkg);
    const fee = base_monthly_fee != null ? base_monthly_fee : PACKAGE_PRICES_FCFA[pkg];
    updates.push(`base_monthly_fee = $${idx++}`); params.push(fee);
    updates.push(`effective_monthly_fee = $${idx++}`); params.push(fee);
  } else if (base_monthly_fee != null) {
    updates.push(`base_monthly_fee = $${idx++}`); params.push(base_monthly_fee);
  }
  if (status) { updates.push(`status = $${idx++}`); params.push(status); }
  if (updates.length === 0) return res.status(400).json({ error: 'Aucune donnée' });

  updates.push(`updated_at = NOW()`);
  params.push(req.params.id);
  await db.query(`UPDATE subscriptions SET ${updates.join(', ')} WHERE id = $${idx}`, params);

  if (pkg && pkg !== sub.package) {
    await db.query('UPDATE merchants SET package = $1 WHERE id = $2', [pkg, sub.merchant_id]);
    await engine.logPackageChange({
      subscriptionId: sub.id, merchantId: sub.merchant_id,
      oldPackage: sub.package, newPackage: pkg, changedBy: 'admin',
      actorId: req.admin?.id, reason: reason || 'Changement administrateur',
    });
  }

  const updated = (await db.query('SELECT * FROM subscriptions WHERE id = $1', [req.params.id])).rows[0];
  res.json({ subscription: updated });
});

// ─── Bonus recrutement Starter Boost (compat) ────────────────────────────────
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
  const baseFee = sub ? parseFloat(sub.base_monthly_fee) : PACKAGE_PRICES_FCFA.STARTER_BOOST;
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
