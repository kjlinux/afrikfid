'use strict';

/**
 * Adaptateur Stripe — Paiement par carte (international)
 * Docs : https://docs.stripe.com/api
 *
 * Flow utilisé : Stripe Checkout Sessions (hébergé par Stripe).
 *   1. /payments/initiate → on crée une Session via POST /v1/checkout/sessions
 *   2. On retourne `paymentUrl` (= session.url) → la passerelle redirige le client
 *   3. Stripe encaisse, gère le 3DS, et appelle notre webhook quand c'est terminé
 *   4. Le webhook /payments/card/stripe/notify écoute `checkout.session.completed`
 *      (succès) et `checkout.session.expired` / `payment_intent.payment_failed` (échec).
 *
 * Authentification API : Bearer secret key (sk_test_... ou sk_live_...).
 * Authentification webhook : header `Stripe-Signature` vérifié via le secret
 * du webhook endpoint (whsec_...). Voir verifyWebhookSignature() ci-dessous.
 *
 * Variables d'env :
 *   STRIPE_SECRET_KEY        — sk_test_... (dev) ou sk_live_... (prod)
 *   STRIPE_PUBLISHABLE_KEY   — pk_test_... ou pk_live_... (info, pas utilisé serveur)
 *   STRIPE_WEBHOOK_SECRET    — whsec_... (signature des webhooks reçus)
 *   STRIPE_RETURN_URL        — URL où Stripe redirige après paiement (succès)
 *   STRIPE_CANCEL_URL        — URL où Stripe redirige si le client annule
 *   STRIPE_API_URL           — par défaut https://api.stripe.com
 */

const axios = require('axios');
const crypto = require('crypto');

const STRIPE_API_URL    = process.env.STRIPE_API_URL || 'https://api.stripe.com';
const SECRET_KEY        = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET    = process.env.STRIPE_WEBHOOK_SECRET;
const RETURN_URL        = process.env.STRIPE_RETURN_URL;
const CANCEL_URL        = process.env.STRIPE_CANCEL_URL;

const SANDBOX = process.env.NODE_ENV !== 'production';

// Devises ISO 4217 supportées par Stripe en zero-decimal (XOF/XAF/KES sont
// "non zero-decimal" pour Stripe sauf XOF/XAF qui n'ont pas de subdivision).
// Stripe traite XOF et XAF comme zero-decimal : on envoie le montant en
// unité majeure directement (pas *100). KES est en cents (2 décimales).
const ZERO_DECIMAL = new Set(['XOF', 'XAF', 'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW',
  'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XPF']);

function toStripeAmount(amount, currency) {
  const cur = String(currency || 'XOF').toUpperCase();
  if (ZERO_DECIMAL.has(cur)) return Math.round(Number(amount));
  return Math.round(Number(amount) * 100);
}

function fromStripeAmount(stripeAmount, currency) {
  const cur = String(currency || 'XOF').toUpperCase();
  if (ZERO_DECIMAL.has(cur)) return Number(stripeAmount);
  return Number(stripeAmount) / 100;
}

/**
 * Initie un paiement carte via Stripe Checkout.
 * Retourne une URL Checkout vers laquelle rediriger le client.
 *
 * @param {object} opts
 * @param {string} opts.transactionId   UUID interne (utilisé comme client_reference_id)
 * @param {string} opts.reference       Référence Afrik'Fid (ex: AFD-xxx)
 * @param {number} opts.amount          Montant en unité majeure (ex : 5000 XOF)
 * @param {string} opts.currency        XOF | XAF | KES | EUR | USD
 * @param {string} [opts.customerName]
 * @param {string} [opts.customerEmail] Pré-rempli sur Checkout si fourni
 * @param {string} [opts.customerPhone]
 * @param {string} [opts.description]
 */
async function initiateCardPayment({ transactionId, reference, amount, currency, customerName, customerEmail, customerPhone, description }) {
  if (SANDBOX || !SECRET_KEY) {
    console.info(`[STRIPE/sandbox] checkout session simulated: ref=${reference} amount=${amount} ${currency}`);
    return {
      success: true,
      paymentUrl: `https://sandbox.afrikfid.com/pay/stripe-simulate/${transactionId}`,
      stripeRef: `cs_test_SANDBOX_${transactionId.slice(0, 8).toUpperCase()}`,
      message: 'Sandbox: redirection Stripe simulée',
    };
  }

  // Stripe attend un body x-www-form-urlencoded avec notation crochets pour
  // les sous-objets (line_items[0][price_data][currency]=...).
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('client_reference_id', transactionId);
  params.append('success_url', (RETURN_URL || 'https://afrikfid.com/pay/success') + '?session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', CANCEL_URL || 'https://afrikfid.com/pay/cancel');
  params.append('payment_method_types[]', 'card');

  // Single line item — produit virtuel "Paiement Afrik'Fid <ref>"
  params.append('line_items[0][quantity]', '1');
  params.append('line_items[0][price_data][currency]', String(currency).toLowerCase());
  params.append('line_items[0][price_data][unit_amount]', String(toStripeAmount(amount, currency)));
  params.append('line_items[0][price_data][product_data][name]', description || `Paiement Afrik'Fid ${reference}`);
  if (description) {
    params.append('line_items[0][price_data][product_data][description]', String(description).slice(0, 500));
  }

  if (customerEmail) params.append('customer_email', customerEmail);

  // Métadonnées remontées sur le PaymentIntent et le webhook
  params.append('metadata[afrikfid_reference]', reference);
  params.append('metadata[afrikfid_transaction_id]', transactionId);
  if (customerName)  params.append('metadata[customer_name]', customerName);
  if (customerPhone) params.append('metadata[customer_phone]', customerPhone);

  // PaymentIntent metadata propagation (utile pour la réconciliation côté Stripe Dashboard)
  params.append('payment_intent_data[metadata][afrikfid_reference]', reference);
  params.append('payment_intent_data[metadata][afrikfid_transaction_id]', transactionId);

  // Idempotence : Stripe accepte un header Idempotency-Key qui empêche les
  // doublons en cas de retry. On utilise transactionId comme clé naturelle.
  try {
    const res = await axios.post(`${STRIPE_API_URL}/v1/checkout/sessions`, params.toString(), {
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `afrikfid_init_${transactionId}`,
      },
      timeout: 15000,
    });

    const session = res.data;
    if (!session?.url) {
      return {
        success: false,
        error: 'STRIPE_NO_URL',
        message: 'Stripe n\'a pas retourné d\'URL de paiement',
      };
    }

    return {
      success: true,
      paymentUrl: session.url,
      stripeRef: session.id, // cs_xxx
      message: 'Redirection vers Stripe Checkout',
    };
  } catch (err) {
    const data = err.response?.data;
    console.error('[STRIPE] initiateCardPayment error:', data?.error?.message || err.message);
    return {
      success: false,
      error: data?.error?.code || 'STRIPE_ERROR',
      message: data?.error?.message || err.message,
    };
  }
}

/**
 * Vérifie le statut d'une transaction Stripe (par session_id ou par metadata).
 *
 * @param {string} sessionIdOrTxId  Session Stripe (cs_xxx) OU UUID interne
 *                                  (dans ce cas on cherche par metadata via search API)
 */
async function checkPaymentStatus(sessionIdOrTxId) {
  if (SANDBOX || !SECRET_KEY) {
    return { success: true, status: 'paid', message: 'Sandbox: paiement accepté' };
  }

  try {
    // Si c'est un cs_xxx, on retrieve directement
    if (String(sessionIdOrTxId).startsWith('cs_')) {
      const res = await axios.get(`${STRIPE_API_URL}/v1/checkout/sessions/${sessionIdOrTxId}`, {
        headers: { 'Authorization': `Bearer ${SECRET_KEY}` },
        timeout: 10000,
      });
      const s = res.data;
      return {
        success: s.payment_status === 'paid',
        status: s.payment_status, // paid | unpaid | no_payment_required
        amount: fromStripeAmount(s.amount_total, s.currency),
        currency: String(s.currency || '').toUpperCase(),
        message: s.payment_status,
        operatorRef: s.payment_intent,
      };
    }

    // Sinon : recherche par metadata.afrikfid_transaction_id
    const res = await axios.get(`${STRIPE_API_URL}/v1/checkout/sessions`, {
      params: { limit: 5 },
      headers: { 'Authorization': `Bearer ${SECRET_KEY}` },
      timeout: 10000,
    });
    const matching = (res.data?.data || []).find(s =>
      s.metadata?.afrikfid_transaction_id === String(sessionIdOrTxId)
    );
    if (!matching) return { success: false, status: 'UNKNOWN', message: 'Session Stripe introuvable' };
    return {
      success: matching.payment_status === 'paid',
      status: matching.payment_status,
      amount: fromStripeAmount(matching.amount_total, matching.currency),
      currency: String(matching.currency || '').toUpperCase(),
      message: matching.payment_status,
      operatorRef: matching.payment_intent,
    };
  } catch (err) {
    console.error('[STRIPE] checkPaymentStatus error:', err.message);
    return { success: false, status: 'UNKNOWN', message: err.message };
  }
}

/**
 * Vérifie la signature d'un webhook Stripe.
 * Le header `Stripe-Signature` contient `t=<ts>,v1=<sig>,...` ; on calcule
 * HMAC-SHA256(secret, "<ts>.<rawBody>") et on compare timing-safe.
 *
 * Tolérance : 5 minutes de skew clock par défaut.
 *
 * @param {express.Request} req — DOIT avoir req.rawBody (capture middleware)
 */
function verifyWebhookSignature(req) {
  if (!WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[STRIPE/webhook] STRIPE_WEBHOOK_SECRET absent en production');
      return false;
    }
    // En dev, on accepte sans vérif (sandbox). Logger pour ne pas oublier.
    console.warn('[STRIPE/webhook] Mode dev sans vérif signature — configurer STRIPE_WEBHOOK_SECRET pour la prod');
    return true;
  }

  const header = req.headers['stripe-signature'];
  if (!header) return false;

  const parts = String(header).split(',').reduce((acc, part) => {
    const [k, v] = part.trim().split('=');
    if (!acc[k]) acc[k] = [];
    acc[k].push(v);
    return acc;
  }, {});

  const ts = (parts.t || [])[0];
  const sigs = parts.v1 || [];
  if (!ts || !sigs.length) return false;

  // Skew 5 min
  const tsMs = parseInt(ts, 10) * 1000;
  if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    console.warn('[STRIPE/webhook] timestamp hors fenêtre');
    return false;
  }

  const body = req.rawBody || '';
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${ts}.${body}`, 'utf8')
    .digest('hex');

  // Stripe peut renvoyer plusieurs v1 (rotation de secret) — on accepte si une match
  for (const sig of sigs) {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

module.exports = { initiateCardPayment, checkPaymentStatus, verifyWebhookSignature };
