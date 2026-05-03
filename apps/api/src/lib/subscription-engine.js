'use strict';

/**
 * Moteur d'abonnements marchands.
 *
 * Concepts :
 *  - Une `subscription` a UNE période active (current_period_*) + le package en vigueur.
 *  - Une file FIFO `subscription_periods` stocke la période active + les périodes
 *    payées d'avance (status='paid').
 *  - Un upgrade en cours de période ne crée PAS de nouvelle période ; il modifie
 *    le `package` immédiatement et le marchand paie le prorata jusqu'à
 *    `current_period_end`. Les périodes d'avance déjà en file conservent
 *    leur package d'origine.
 *  - À l'expiration : on consomme la période courante, on active la suivante en
 *    file si elle existe, sinon on bascule en STARTER_BOOST.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const {
  PACKAGE_PRICES_FCFA,
  PACKAGE_RANK,
  ANNUAL_PAID_MONTHS,
  FALLBACK_PACKAGE,
  MERCHANT_PACKAGES,
  BILLING_CYCLES,
} = require('../config/constants');

const MS_DAY = 24 * 60 * 60 * 1000;

function priceFor(pkg, cycle) {
  const monthly = PACKAGE_PRICES_FCFA[pkg];
  if (monthly == null) throw new Error(`Package inconnu: ${pkg}`);
  if (cycle === 'annual') return monthly * ANNUAL_PAID_MONTHS;
  return monthly;
}

function periodLengthMs(cycle) {
  // Approximations : 30j / 365j. Les bornes exactes sont calculées via setMonth() ailleurs.
  return cycle === 'annual' ? 365 * MS_DAY : 30 * MS_DAY;
}

function addPeriod(start, cycle) {
  const d = new Date(start);
  if (cycle === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function isUpgrade(currentPkg, newPkg) {
  return PACKAGE_RANK[newPkg] > PACKAGE_RANK[currentPkg];
}

/**
 * Charge la subscription active du marchand. La crée en STARTER_BOOST si absente.
 */
async function getOrCreateSubscription(merchantId) {
  let sub = (await db.query(
    `SELECT * FROM subscriptions WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [merchantId]
  )).rows[0];
  if (sub) return sub;

  const id = uuidv4();
  await db.query(
    `INSERT INTO subscriptions
       (id, merchant_id, package, base_monthly_fee, effective_monthly_fee, status,
        billing_cycle, current_period_start, current_period_end, next_billing_at)
     VALUES ($1,$2,$3,0,0,'active','monthly',NOW(),NULL,NULL)`,
    [id, merchantId, FALLBACK_PACKAGE]
  );
  return (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [id])).rows[0];
}

async function listQueuedPeriods(subscriptionId) {
  return (await db.query(
    `SELECT * FROM subscription_periods
      WHERE subscription_id = $1 AND status IN ('active','paid')
      ORDER BY period_start ASC`,
    [subscriptionId]
  )).rows;
}

/**
 * Prorata pour un upgrade en cours de période active.
 * (prixNouveau - prixActuel) * jours_restants / jours_totaux_periode
 */
function computeProrata(sub, newPackage) {
  const cycle = sub.billing_cycle || 'monthly';
  const oldPrice = priceFor(sub.package, cycle);
  const newPrice = priceFor(newPackage, cycle);
  const diff = newPrice - oldPrice;
  if (diff <= 0) return 0;
  const start = new Date(sub.current_period_start).getTime();
  const end = new Date(sub.current_period_end).getTime();
  const total = Math.max(end - start, MS_DAY);
  const remaining = Math.max(end - Date.now(), 0);
  return Math.ceil(diff * (remaining / total) / 10) * 10;
}

/**
 * Calcule un devis sans rien persister.
 *
 * mode = 'auto' :
 *   - s'il y a déjà une période active et que le marchand vise un upgrade → 'upgrade_prorata'
 *   - s'il y a une période active mais pas d'upgrade → 'advance' (paiement d'avance)
 *   - sinon → 'renewal' (le marchand n'a pas/plus de période active)
 */
async function quoteCheckout(merchantId, { package: newPackage, billing_cycle: cycle, mode }) {
  if (!MERCHANT_PACKAGES.includes(newPackage)) {
    throw new Error(`Package invalide: ${newPackage}`);
  }
  const billingCycle = BILLING_CYCLES.includes(cycle) ? cycle : 'monthly';

  if (newPackage === FALLBACK_PACKAGE) {
    const sub = await getOrCreateSubscription(merchantId);
    return {
      subscription_id: sub.id,
      current_package: sub.package,
      target_package: newPackage,
      billing_cycle: billingCycle,
      kind: 'free',
      amount: 0,
      currency: 'XOF',
      period_start: null,
      period_end: null,
      description: 'Plan Starter Boost — gratuit',
    };
  }

  const sub = await getOrCreateSubscription(merchantId);
  const queued = await listQueuedPeriods(sub.id);
  const lastQueued = queued[queued.length - 1];
  const hasActive = sub.current_period_end && new Date(sub.current_period_end) > new Date();

  let kind = mode || 'auto';
  if (kind === 'auto') {
    if (hasActive && isUpgrade(sub.package, newPackage) && newPackage !== sub.package) {
      kind = 'upgrade_prorata';
    } else if (hasActive) {
      kind = 'advance';
    } else {
      kind = 'renewal';
    }
  }

  let amount = 0;
  let periodStart = null;
  let periodEnd = null;
  let description = '';

  if (kind === 'upgrade_prorata') {
    if (!isUpgrade(sub.package, newPackage)) {
      throw new Error('Upgrade impossible : le package cible n\'est pas supérieur');
    }
    amount = computeProrata(sub, newPackage);
    description = `Upgrade ${sub.package} → ${newPackage} (prorata jusqu'au ${new Date(sub.current_period_end).toLocaleDateString('fr-FR')})`;
  } else if (kind === 'renewal') {
    amount = priceFor(newPackage, billingCycle);
    periodStart = new Date();
    periodEnd = addPeriod(periodStart, billingCycle);
    description = `Renouvellement ${newPackage} ${billingCycle === 'annual' ? '(annuel - 1 mois offert)' : '(mensuel)'}`;
  } else if (kind === 'advance') {
    amount = priceFor(newPackage, billingCycle);
    const base = lastQueued ? new Date(lastQueued.period_end) : new Date(sub.current_period_end);
    periodStart = base;
    periodEnd = addPeriod(periodStart, billingCycle);
    description = `Paiement à l'avance ${newPackage} ${billingCycle === 'annual' ? '(annuel)' : '(mensuel)'} — démarrera le ${periodStart.toLocaleDateString('fr-FR')}`;
  } else {
    throw new Error(`Mode inconnu: ${kind}`);
  }

  return {
    subscription_id: sub.id,
    current_package: sub.package,
    target_package: newPackage,
    billing_cycle: billingCycle,
    kind,
    amount,
    currency: 'XOF',
    period_start: periodStart,
    period_end: periodEnd,
    description,
  };
}

/**
 * Crée un enregistrement subscription_payments en status 'pending'.
 * Renvoie le payment row.
 */
async function createPendingPayment({
  subscription, kind, package: pkg, billingCycle, amount, provider, providerRef, phone, operator, periodStart, periodEnd,
}) {
  const id = uuidv4();
  const ps = periodStart ? new Date(periodStart) : new Date(subscription.current_period_start);
  const pe = periodEnd ? new Date(periodEnd) : new Date(subscription.current_period_end);
  await db.query(
    `INSERT INTO subscription_payments
       (id, subscription_id, merchant_id, period_start, period_end,
        base_amount, discount_percent, effective_amount, recruited_clients_count,
        status, provider, provider_ref, kind, phone, operator, package, billing_cycle, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,0,$6,0,'pending',$7,$8,$9,$10,$11,$12,$13,NOW())`,
    [id, subscription.id, subscription.merchant_id,
     ps.toISOString().slice(0, 10), pe.toISOString().slice(0, 10),
     amount, provider, providerRef || null, kind, phone || null, operator || null, pkg, billingCycle]
  );
  return (await db.query(`SELECT * FROM subscription_payments WHERE id = $1`, [id])).rows[0];
}

async function findPaymentByProviderRef(provider, providerRef) {
  const r = await db.query(
    `SELECT * FROM subscription_payments WHERE provider = $1 AND provider_ref = $2 LIMIT 1`,
    [provider, providerRef]
  );
  return r.rows[0] || null;
}

async function logPackageChange({ subscriptionId, merchantId, oldPackage, newPackage, changedBy, actorId, reason }) {
  await db.query(
    `INSERT INTO subscription_package_changes
       (id, subscription_id, merchant_id, old_package, new_package, changed_by, actor_id, reason, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [uuidv4(), subscriptionId, merchantId, oldPackage, newPackage, changedBy, actorId || null, reason || null]
  );
}

/**
 * Applique un paiement confirmé par le provider.
 * Idempotent : si payment.status est déjà 'completed', no-op.
 */
async function applyPaidPayment(payment) {
  if (!payment) throw new Error('payment requis');
  if (payment.status === 'completed') return { skipped: true };

  const sub = (await db.query(`SELECT * FROM subscriptions WHERE id = $1`, [payment.subscription_id])).rows[0];
  if (!sub) throw new Error('Subscription introuvable');

  if (payment.kind === 'upgrade_prorata') {
    const oldPackage = sub.package;
    await db.query(
      `UPDATE subscriptions
         SET package = $1, base_monthly_fee = $2, effective_monthly_fee = $2, updated_at = NOW()
       WHERE id = $3`,
      [payment.package, PACKAGE_PRICES_FCFA[payment.package], sub.id]
    );
    await db.query(`UPDATE merchants SET package = $1 WHERE id = $2`, [payment.package, sub.merchant_id]);
    await logPackageChange({
      subscriptionId: sub.id, merchantId: sub.merchant_id,
      oldPackage, newPackage: payment.package,
      changedBy: 'merchant_upgrade', actorId: sub.merchant_id,
      reason: `Upgrade prorata via ${payment.provider}`,
    });
    await db.query(
      `UPDATE subscription_payments SET status = 'completed', paid_at = NOW() WHERE id = $1`,
      [payment.id]
    );
    return { kind: 'upgrade_prorata', oldPackage, newPackage: payment.package };
  }

  if (payment.kind === 'renewal' || payment.kind === 'initial') {
    const start = new Date();
    const end = addPeriod(start, payment.billing_cycle || 'monthly');
    const periodId = uuidv4();
    await db.query(
      `INSERT INTO subscription_periods
         (id, subscription_id, merchant_id, package, billing_cycle,
          period_start, period_end, amount_paid, currency, payment_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'XOF',$9,'active',NOW())`,
      [periodId, sub.id, sub.merchant_id, payment.package, payment.billing_cycle || 'monthly',
       start, end, payment.effective_amount || payment.base_amount, payment.id]
    );
    const oldPackage = sub.package;
    await db.query(
      `UPDATE subscriptions
         SET package = $1, billing_cycle = $2,
             current_period_start = $3, current_period_end = $4,
             next_billing_at = $4, status = 'active',
             base_monthly_fee = $5, effective_monthly_fee = $5,
             updated_at = NOW()
       WHERE id = $6`,
      [payment.package, payment.billing_cycle || 'monthly', start, end,
       PACKAGE_PRICES_FCFA[payment.package], sub.id]
    );
    await db.query(`UPDATE merchants SET package = $1 WHERE id = $2`, [payment.package, sub.merchant_id]);
    if (oldPackage !== payment.package) {
      await logPackageChange({
        subscriptionId: sub.id, merchantId: sub.merchant_id,
        oldPackage, newPackage: payment.package,
        changedBy: 'merchant_upgrade', actorId: sub.merchant_id,
        reason: `Renouvellement avec changement de plan`,
      });
    }
    await db.query(
      `UPDATE subscription_payments SET status='completed', paid_at = NOW(), period_id = $1 WHERE id = $2`,
      [periodId, payment.id]
    );
    return { kind: payment.kind, periodId };
  }

  if (payment.kind === 'advance') {
    // Empile à la fin de la file
    const queued = await listQueuedPeriods(sub.id);
    const last = queued[queued.length - 1];
    const start = last ? new Date(last.period_end) : new Date(sub.current_period_end);
    const end = addPeriod(start, payment.billing_cycle || 'monthly');
    const periodId = uuidv4();
    await db.query(
      `INSERT INTO subscription_periods
         (id, subscription_id, merchant_id, package, billing_cycle,
          period_start, period_end, amount_paid, currency, payment_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'XOF',$9,'paid',NOW())`,
      [periodId, sub.id, sub.merchant_id, payment.package, payment.billing_cycle || 'monthly',
       start, end, payment.effective_amount || payment.base_amount, payment.id]
    );
    await db.query(
      `UPDATE subscription_payments SET status='completed', paid_at = NOW(), period_id = $1 WHERE id = $2`,
      [periodId, payment.id]
    );
    return { kind: 'advance', periodId };
  }

  throw new Error(`Kind inconnu: ${payment.kind}`);
}

/**
 * Marque un paiement en échec.
 */
async function failPayment(payment, reason) {
  await db.query(
    `UPDATE subscription_payments SET status='failed', failure_reason=$1 WHERE id=$2`,
    [String(reason || '').slice(0, 500), payment.id]
  );
}

/**
 * Si la période courante est expirée :
 *  - la marque consumed
 *  - active la suivante en file si dispo (le package adopte celui de la période)
 *  - sinon downgrade en STARTER_BOOST (sans grâce)
 *
 * Renvoie { changed: bool, newPackage, downgraded: bool }
 */
async function expireAndAdvance(sub) {
  if (!sub.current_period_end) return { changed: false };
  const now = new Date();
  if (new Date(sub.current_period_end) > now) return { changed: false };

  // Marquer la période active comme consommée si elle existe
  await db.query(
    `UPDATE subscription_periods SET status='consumed'
      WHERE subscription_id = $1 AND status = 'active'`,
    [sub.id]
  );

  const next = (await db.query(
    `SELECT * FROM subscription_periods
      WHERE subscription_id = $1 AND status = 'paid'
      ORDER BY period_start ASC LIMIT 1`,
    [sub.id]
  )).rows[0];

  const oldPackage = sub.package;

  if (next) {
    await db.query(`UPDATE subscription_periods SET status='active' WHERE id = $1`, [next.id]);
    await db.query(
      `UPDATE subscriptions
         SET package = $1, billing_cycle = $2,
             current_period_start = $3, current_period_end = $4,
             next_billing_at = $4, base_monthly_fee = $5, effective_monthly_fee = $5,
             status = 'active', updated_at = NOW()
       WHERE id = $6`,
      [next.package, next.billing_cycle, next.period_start, next.period_end,
       PACKAGE_PRICES_FCFA[next.package], sub.id]
    );
    await db.query(`UPDATE merchants SET package = $1 WHERE id = $2`, [next.package, sub.merchant_id]);
    if (oldPackage !== next.package) {
      await logPackageChange({
        subscriptionId: sub.id, merchantId: sub.merchant_id,
        oldPackage, newPackage: next.package,
        changedBy: 'system_downgrade', actorId: 'system',
        reason: 'Activation période payée à l\'avance',
      });
    }
    return { changed: true, newPackage: next.package, downgraded: oldPackage !== next.package };
  }

  // Aucune période en file → downgrade STARTER_BOOST (plan gratuit, pas d'expiration)
  if (oldPackage === FALLBACK_PACKAGE) {
    // Déjà sur le plan gratuit : supprimer la date d'expiration résiduelle
    await db.query(
      `UPDATE subscriptions
         SET current_period_end = NULL, next_billing_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [sub.id]
    );
    return { changed: true, newPackage: FALLBACK_PACKAGE, downgraded: false };
  }

  await db.query(
    `UPDATE subscriptions
       SET package = $1, billing_cycle = 'monthly',
           current_period_start = NOW(), current_period_end = NULL,
           next_billing_at = NULL,
           base_monthly_fee = 0, effective_monthly_fee = 0,
           status = 'active', updated_at = NOW()
     WHERE id = $2`,
    [FALLBACK_PACKAGE, sub.id]
  );
  await db.query(`UPDATE merchants SET package = $1 WHERE id = $2`, [FALLBACK_PACKAGE, sub.merchant_id]);
  await logPackageChange({
    subscriptionId: sub.id, merchantId: sub.merchant_id,
    oldPackage, newPackage: FALLBACK_PACKAGE,
    changedBy: 'system_downgrade', actorId: 'system',
    reason: 'Abonnement non renouvelé — bascule sur plan gratuit',
  });
  return { changed: true, newPackage: FALLBACK_PACKAGE, downgraded: true };
}

/**
 * Marque qu'un rappel a été envoyé (idempotent grâce à l'unique index).
 */
async function recordReminderSent(subscriptionId, kind, channel, periodEndRef) {
  try {
    await db.query(
      `INSERT INTO subscription_notifications
         (id, subscription_id, kind, channel, period_end_ref, sent_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [uuidv4(), subscriptionId, kind, channel, periodEndRef]
    );
    return true;
  } catch (err) {
    // Doublon (uq_sub_notif) → déjà envoyé
    if (String(err.message || '').includes('uq_sub_notif') || err.code === '23505') return false;
    throw err;
  }
}

async function alreadySent(subscriptionId, kind, channel, periodEndRef) {
  const r = await db.query(
    `SELECT 1 FROM subscription_notifications
      WHERE subscription_id = $1 AND kind = $2 AND channel = $3 AND period_end_ref = $4
      LIMIT 1`,
    [subscriptionId, kind, channel, periodEndRef]
  );
  return r.rows.length > 0;
}

module.exports = {
  priceFor,
  addPeriod,
  isUpgrade,
  computeProrata,
  getOrCreateSubscription,
  listQueuedPeriods,
  quoteCheckout,
  createPendingPayment,
  findPaymentByProviderRef,
  applyPaidPayment,
  failPayment,
  expireAndAdvance,
  logPackageChange,
  recordReminderSent,
  alreadySent,
};
