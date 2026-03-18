const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { calculateDistribution, awardPoints } = require('../lib/loyalty-engine');
const { requireApiKey, requireClient, requireMerchant } = require('../middleware/auth');
const { verifyHmacSignature } = require('../middleware/hmac-verify');
const mobileMoney = require('../lib/adapters/mobile-money');
const { getOperatorsForCountry } = mobileMoney;
const { validate } = require('../middleware/validate');
const { InitiatePaymentSchema, RefundSchema, WalletPaySchema } = require('../config/schemas');
const { TX_EXPIRY_MS } = require('../config/constants');
const { dispatchWebhook, WebhookEvents } = require('../workers/webhook-dispatcher');
const { notifyPaymentConfirmed, notifyCashbackCredit, notifyPaymentFailed, notifyFraudBlocked, notifyRefundRequested, notifyWalletCapReached } = require('../lib/notifications');
const { checkTransaction } = require('../lib/fraud');
const cinetpay = require('../lib/adapters/cinetpay');
const flutterwave = require('../lib/adapters/flutterwave');
const { emit, SSE_EVENTS } = require('../lib/sse-emitter');
const { processDisbursementsForMerchant } = require('../workers/disbursement');
const { verifyHmac, verifySha256 } = require('../lib/webhook-verify');

// Sélection du provider carte via CARD_PROVIDER env (défaut: cinetpay)
function getCardProvider() {
  return (process.env.CARD_PROVIDER || 'cinetpay').toLowerCase() === 'flutterwave'
    ? flutterwave
    : cinetpay;
}

// POST /api/v1/payments/initiate
router.post('/initiate', requireApiKey, verifyHmacSignature, validate(InitiatePaymentSchema), async (req, res) => {
  const {
    amount, currency, client_phone, client_afrikfid_id,
    payment_method, payment_operator, description, idempotency_key,
    product_category,
  } = req.body;

  // Idempotence
  if (idempotency_key) {
    const existing = (await db.query('SELECT * FROM transactions WHERE idempotency_key = $1', [idempotency_key])).rows[0];
    if (existing) return res.status(200).json({ message: 'Transaction existante', transaction: sanitizeTx(existing) });
  }

  const merchant = req.merchant;

  let client = null;
  if (client_afrikfid_id) {
    client = (await db.query("SELECT * FROM clients WHERE afrikfid_id = $1 AND is_active = TRUE", [client_afrikfid_id])).rows[0];
  } else if (client_phone) {
    client = (await db.query("SELECT * FROM clients WHERE phone = $1 AND is_active = TRUE", [client_phone])).rows[0];
  }

  // Mode invité (CDC §4.1.4) : client non identifié
  if (!client) {
    const guestAllowed = merchant.allow_guest_mode !== false && merchant.allow_guest_mode !== 0;
    if (!guestAllowed) {
      return res.status(403).json({ error: 'GUEST_NOT_ALLOWED', message: 'Ce marchand exige une identification client Afrik\'Fid' });
    }
  }

  const loyaltyStatus = client ? client.loyalty_status : 'OPEN';

  // Validation opérateur mobile money vs pays (CDC §3.2 — extensibilité par pays)
  if (payment_method === 'mobile_money' && payment_operator) {
    const countryCode = client?.country_id || merchant.country_id;
    if (countryCode) {
      const supportedOps = getOperatorsForCountry(countryCode).map(op => op.code);
      if (supportedOps.length > 0 && !supportedOps.includes((payment_operator || '').toUpperCase())) {
        return res.status(422).json({
          error: 'OPERATOR_NOT_AVAILABLE',
          message: `L'opérateur ${payment_operator} n'est pas disponible dans ce pays. Opérateurs supportés : ${supportedOps.join(', ')}`,
          supportedOperators: supportedOps,
        });
      }
    }
  }

  // Vérification seuil maximum par transaction (CDC §4.2.2)
  if (merchant.max_transaction_amount && amount > parseFloat(merchant.max_transaction_amount)) {
    return res.status(422).json({
      error: 'AMOUNT_EXCEEDS_LIMIT',
      message: `Montant (${amount}) dépasse le seuil maximum par transaction (${merchant.max_transaction_amount})`,
    });
  }

  // Vérification volume quotidien marchand (CDC §4.2.2)
  if (merchant.daily_volume_limit) {
    const today = new Date().toISOString().slice(0, 10);
    const dailyRes = await db.query(
      `SELECT COALESCE(SUM(gross_amount), 0) as daily_total FROM transactions
       WHERE merchant_id = $1 AND status IN ('pending','completed') AND initiated_at::date = $2::date`,
      [merchant.id, today]
    );
    const dailyTotal = parseFloat(dailyRes.rows[0].daily_total);
    if (dailyTotal + amount > parseFloat(merchant.daily_volume_limit)) {
      return res.status(422).json({
        error: 'DAILY_LIMIT_EXCEEDED',
        message: `Volume quotidien dépassé. Limite: ${merchant.daily_volume_limit}, déjà traité: ${dailyTotal}`,
      });
    }
  }

  const fraudCheck = await checkTransaction({
    amount, clientId: client ? client.id : null, clientPhone: client_phone || null, merchantId: merchant.id,
  });
  if (fraudCheck.blocked) {
    return res.status(403).json({ error: 'FRAUD_BLOCKED', message: fraudCheck.reason, riskScore: fraudCheck.riskScore });
  }

  const clientCountryId = client ? client.country_id : (merchant.country_id || null);
  const distribution = await calculateDistribution(
    amount, merchant.rebate_percent, loyaltyStatus, clientCountryId,
    product_category || null, merchant.id
  );

  if (distribution.yExceedsX) {
    // Alerte admin pour anomalie de configuration (CDC §4.1.4)
    notifyFraudBlocked({
      amount,
      currency: merchant.currency || 'XOF',
      merchantName: merchant.name,
      clientPhone: client ? client.phone : 'inconnu',
      reason: `Anomalie config: Y (${distribution.clientRebatePercent}%) > X (${distribution.merchantRebatePercent}%)`,
      riskScore: 100,
    }).catch(() => { });
    return res.status(422).json({
      error: 'DISTRIBUTION_ERROR',
      message: `Taux client Y (${distribution.clientRebatePercent}%) supérieur au taux marchand X (${distribution.merchantRebatePercent}%). Anomalie de configuration.`,
    });
  }

  const txId = uuidv4();
  const reference = `AFD-${Date.now()}-${txId.slice(0, 8).toUpperCase()}`;
  const expiresAt = new Date(Date.now() + TX_EXPIRY_MS).toISOString();

  await db.query(`
    INSERT INTO transactions (
      id, reference, merchant_id, client_id,
      gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode,
      payment_method, payment_operator, payment_phone,
      status, currency, description, idempotency_key, expires_at, product_category, is_sandbox
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, 'pending', $19, $20, $21, $22, $23, $24
    )
  `, [
    txId, reference, merchant.id, client ? client.id : null,
    amount, distribution.grossAmount - distribution.clientRebateAmount,
    distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
    distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
    distribution.merchantReceives, loyaltyStatus, merchant.rebate_mode,
    payment_method, payment_operator || null, client_phone || null,
    currency, description || null, idempotency_key || null, expiresAt, product_category || null,
    req.isSandbox ? true : false,
  ]);

  let mmResult = null;
  let cardResult = null;

  if (req.isSandbox) {
    // Mode sandbox : simuler la réponse opérateur sans appel réel
    if (payment_method === 'card') {
      cardResult = { success: true, paymentUrl: `https://sandbox.afrikfid.com/pay/simulate/${txId}`, type: 'card_redirect' };
    } else {
      mmResult = { success: true, operatorRef: `SANDBOX-${Date.now()}`, status: 'pending' };
      await db.query('UPDATE transactions SET operator_ref = $1 WHERE id = $2', [mmResult.operatorRef, txId]);
    }
  } else if (payment_method === 'card') {
    const cardProvider = getCardProvider();
    cardResult = await cardProvider.initiateCardPayment({
      transactionId: txId, reference, amount: distribution.grossAmount, currency,
      customerName: client ? client.full_name : undefined,
      customerEmail: client ? client.email : undefined,
      customerPhone: client_phone || undefined, description,
    });

    if (!cardResult.success) {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [cardResult.message, txId]);
      return res.status(422).json({ error: cardResult.error, message: cardResult.message });
    }
    const cardRef = cardResult.cinetpayRef || cardResult.flutterwaveRef || txId;
    await db.query("UPDATE transactions SET operator_ref = $1 WHERE id = $2", [cardRef, txId]);

  } else if (['ORANGE', 'MTN', 'AIRTEL', 'MPESA', 'WAVE', 'MOOV'].includes((payment_operator || '').toUpperCase())) {
    const clientAmount = merchant.rebate_mode === 'immediate'
      ? distribution.grossAmount - distribution.clientRebateAmount
      : distribution.grossAmount;

    mmResult = await mobileMoney.initiatePayment({
      operator: payment_operator, phone: client_phone, amount: clientAmount,
      currency, reference, description,
    });

    // Basculement vers opérateur alternatif si indisponible (CDC §4.1.4)
    if (!mmResult.success && mmResult.error === 'OPERATOR_UNAVAILABLE') {
      const countryCode = merchant.country_id || client?.country_id;
      const alternatives = countryCode
        ? getOperatorsForCountry(countryCode)
          .map(op => op.code)
          .filter(code => code !== (payment_operator || '').toUpperCase() && code !== 'MPESA')
        : [];

      for (const altOperator of alternatives) {
        try {
          const altResult = await mobileMoney.initiatePayment({
            operator: altOperator, phone: client_phone, amount: clientAmount,
            currency, reference: `${reference}-ALT`, description,
          });
          if (altResult.success) {
            mmResult = { ...altResult, usedFallback: true, originalOperator: payment_operator, fallbackOperator: altOperator };
            await db.query(
              "UPDATE transactions SET payment_operator = $1, operator_ref = $2, failure_reason = $3 WHERE id = $4",
              [altOperator, altResult.operatorRef, `Basculement depuis ${payment_operator} (indisponible)`, txId]
            );
            break;
          }
        } catch { /* essayer le suivant */ }
      }
    }

    if (!mmResult.success) {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [mmResult.message, txId]);
      notifyPaymentFailed({ client, transaction: { gross_amount: amount, currency, merchant_name: merchant.name }, errorMessage: mmResult.message });
      return res.status(422).json({ error: mmResult.error, message: mmResult.message });
    }
    if (!mmResult.usedFallback) {
      await db.query("UPDATE transactions SET operator_ref = $1 WHERE id = $2", [mmResult.operatorRef, txId]);
    }
  }

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1', [txId])).rows[0];

  res.status(201).json({
    transaction: sanitizeTx(tx),
    distribution: {
      grossAmount: amount,
      merchantRebatePercent: distribution.merchantRebatePercent,
      clientRebatePercent: distribution.clientRebatePercent,
      platformCommissionPercent: distribution.platformCommissionPercent,
      clientRebateAmount: distribution.clientRebateAmount,
      merchantReceives: distribution.merchantReceives,
      mode: merchant.rebate_mode,
    },
    client: client ? { afrikfidId: client.afrikfid_id, loyaltyStatus, fullName: client.full_name } : null,
    payment: mmResult || (cardResult ? { paymentUrl: cardResult.paymentUrl, type: 'card_redirect' } : null),
    fallback: mmResult?.usedFallback ? { originalOperator: mmResult.originalOperator, fallbackOperator: mmResult.fallbackOperator } : undefined,
  });
});

// POST /api/v1/payments/card/notify (CinetPay webhook)
router.post('/card/notify', async (req, res) => {
  const { cpm_trans_id, cpm_site_id, cpm_signature, cpm_amount } = req.body;

  if (process.env.CINETPAY_SITE_ID && cpm_site_id !== process.env.CINETPAY_SITE_ID) {
    return res.status(403).json({ error: 'Site ID invalide' });
  }

  // Validation de signature CinetPay (SHA-256 de apikey+site_id+trans_id+amount)
  if (process.env.CINETPAY_SECRET_KEY) {
    const sigInput = `${process.env.CINETPAY_API_KEY}${process.env.CINETPAY_SITE_ID}${cpm_trans_id}${cpm_amount}`;
    if (!verifySha256(sigInput, cpm_signature)) {
      console.warn('[cinetpay/notify] Signature invalide pour tx:', cpm_trans_id);
      return res.status(403).json({ error: 'Signature invalide' });
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[cinetpay/notify] CINETPAY_SECRET_KEY non configuré — validation de signature désactivée (production)');
  }

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1', [cpm_trans_id])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'pending') return res.status(200).json({ message: 'Déjà traitée' });

  const statusCheck = await checkPaymentStatus(cpm_trans_id);

  if (statusCheck.success && statusCheck.status === 'ACCEPTED') {
    await processCompletedPayment(tx);
  } else if (statusCheck.status === 'REFUSED' || statusCheck.status === 'CANCELLED') {
    await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`CinetPay: ${statusCheck.status}`, tx.id]);
    dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: statusCheck.status }).catch(() => { });
  }

  res.status(200).json({ message: 'OK' });
});

// POST /api/v1/payments/card/flutterwave/notify (Flutterwave webhook)
router.post('/card/flutterwave/notify', async (req, res) => {
  if (!flutterwave.verifyWebhookSignature(req)) {
    return res.status(403).json({ error: 'Signature webhook invalide' });
  }

  const { data } = req.body;
  if (!data || !data.tx_ref) return res.status(400).json({ error: 'Payload invalide' });

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1', [data.tx_ref])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'pending') return res.status(200).json({ message: 'Déjà traitée' });

  const statusCheck = await flutterwave.checkPaymentStatus(data.tx_ref);

  if (statusCheck.success && statusCheck.status === 'successful') {
    await processCompletedPayment(tx);
  } else if (statusCheck.status === 'failed') {
    await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`Flutterwave: ${statusCheck.message}`, tx.id]);
    dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: statusCheck.status }).catch(() => { });
  }

  res.status(200).json({ message: 'OK' });
});

// POST /api/v1/payments/mm/mpesa/notify (M-Pesa Daraja STK callback)
// Safaricom exige toujours un HTTP 200 — même en cas de rejet on renvoie 200 avec ResultCode: 1
router.post('/mm/mpesa/notify', async (req, res) => {
  // Validation du token secret transmis dans le CallBackURL (?token=MPESA_WEBHOOK_SECRET)
  if (process.env.MPESA_WEBHOOK_SECRET) {
    if (req.query.token !== process.env.MPESA_WEBHOOK_SECRET) {
      console.warn('[mpesa/notify] Token invalide ou absent — callback rejeté');
      return res.status(200).json({ ResultCode: 1, ResultDesc: 'Unauthorized' });
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn('[mpesa/notify] MPESA_WEBHOOK_SECRET non configuré — validation désactivée (production)');
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return;

    const checkoutRequestId = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode; // 0 = success

    const tx = (await db.query(
      "SELECT * FROM transactions WHERE operator_ref = $1 AND status = 'pending'",
      [checkoutRequestId]
    )).rows[0];
    if (!tx) return;

    const MPESA_RESULT_CODES = {
      0:    'Paiement réussi',
      1:    'Solde insuffisant',
      17:   'Limite de transfert dépassée',
      1001: 'Numéro de bénéficiaire invalide',
      1032: 'Transaction annulée par l\'utilisateur',
      1037: 'Timeout — aucune réponse de l\'utilisateur',
      2001: 'Numéro initiant invalide',
    };

    if (resultCode === 0) {
      await processCompletedPayment(tx);
    } else {
      const desc = MPESA_RESULT_CODES[resultCode] || callback.ResultDesc || `Erreur M-Pesa code ${resultCode}`;
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`M-Pesa: ${desc}`, tx.id]);
      dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: 'failed' }).catch(() => { });
    }
  } catch (err) {
    console.error('[mpesa/notify]', err.message);
  }
});

// POST /api/v1/payments/mm/wave/notify (Wave checkout webhook)
router.post('/mm/wave/notify', async (req, res) => {
  res.status(200).json({ message: 'OK' });

  try {
    const { payment_status, client_reference } = req.body || {};
    if (!client_reference) return;

    const tx = (await db.query(
      "SELECT * FROM transactions WHERE reference = $1 AND status = 'pending'",
      [client_reference]
    )).rows[0];
    if (!tx) return;

    if (payment_status === 'complete') {
      await processCompletedPayment(tx);
    } else if (payment_status === 'error' || payment_status === 'cancelled') {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`Wave: ${payment_status}`, tx.id]);
      dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: 'failed' }).catch(() => { });
    }
  } catch (err) {
    console.error('[wave/notify]', err.message);
  }
});

// POST /api/v1/payments/mm/moov/notify (Moov Money callback)
router.post('/mm/moov/notify', async (req, res) => {
  res.status(200).json({ message: 'OK' });

  try {
    const { status, externalReference } = req.body || {};
    if (!externalReference) return;

    const tx = (await db.query(
      "SELECT * FROM transactions WHERE reference = $1 AND status = 'pending'",
      [externalReference]
    )).rows[0];
    if (!tx) return;

    if (status === 'SUCCESS') {
      // En production, vérifier le statut via l'API Moov avant de valider
      if (process.env.NODE_ENV === 'production' && tx.operator_ref) {
        try {
          const checkResult = await mobileMoney.checkPaymentStatus({ operatorRef: tx.operator_ref, operator: 'MOOV' });
          if (checkResult.status !== 'completed') {
            console.warn('[moov/notify] Callback SUCCESS mais vérification API = ' + checkResult.status + ' — ignoré');
            return;
          }
        } catch (checkErr) {
          console.error('[moov/notify] Impossible de vérifier le statut via API Moov:', checkErr.message);
          // En cas d'indisponibilité de l'API, refuser par précaution en production
          return;
        }
      }
      await processCompletedPayment(tx);
    } else if (status === 'FAILED' || status === 'CANCELLED') {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`Moov: ${status}`, tx.id]);
      dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: 'failed' }).catch(() => { });
    }
  } catch (err) {
    console.error('[moov/notify]', err.message);
  }
});

// POST /api/v1/payments/mm/orange/notify (Orange Money return/callback)
// Orange Money redirige vers return_url avec les paramètres de statut
router.post('/mm/orange/notify', async (req, res) => {
  res.status(200).json({ message: 'OK' });

  try {
    const { status, txnid, txnStatus, notifToken } = req.body || {};
    const reference = txnid || req.body?.order_id;
    if (!reference) return;

    // Vérification de signature Orange (HMAC-SHA256 du reference dans notifToken)
    if (process.env.ORANGE_WEBHOOK_SECRET) {
      if (!notifToken) {
        console.warn('[orange/notify] ORANGE_WEBHOOK_SECRET configuré mais notifToken absent — callback rejeté');
        return;
      }
      if (!verifyHmac(process.env.ORANGE_WEBHOOK_SECRET, reference, notifToken, 'hex')) {
        console.warn('[orange/notify] Signature invalide pour ref:', reference);
        return;
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[orange/notify] ORANGE_WEBHOOK_SECRET non configuré — validation de signature désactivée (production)');
    }

    const tx = (await db.query(
      "SELECT * FROM transactions WHERE reference = $1 AND status = 'pending'",
      [reference]
    )).rows[0];
    if (!tx) return;

    const successStatuses = ['SUCCESS', 'SUCCESSFULL', '00'];
    const failStatuses = ['FAILED', 'CANCELLED', 'EXPIRED'];

    const normalizedStatus = String(status || txnStatus || '').toUpperCase();
    if (successStatuses.includes(normalizedStatus)) {
      await processCompletedPayment(tx);
    } else if (failStatuses.includes(normalizedStatus)) {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`Orange: ${normalizedStatus}`, tx.id]);
      dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: 'failed' }).catch(() => { });
    }
  } catch (err) {
    console.error('[orange/notify]', err.message);
  }
});

// POST /api/v1/payments/mm/airtel/notify (Airtel Money callback)
router.post('/mm/airtel/notify', async (req, res) => {
  res.status(200).json({ message: 'OK' });

  try {
    const body = req.body || {};
    // Vérification de signature Airtel (HMAC-SHA256 base64 dans X-Airtel-Signature)
    if (process.env.AIRTEL_WEBHOOK_SECRET) {
      const signature = req.headers['x-airtel-signature'];
      if (!signature) {
        console.warn('[airtel/notify] AIRTEL_WEBHOOK_SECRET configuré mais x-airtel-signature absent — callback rejeté');
        return;
      }
      if (!verifyHmac(process.env.AIRTEL_WEBHOOK_SECRET, JSON.stringify(body), signature, 'base64')) {
        console.warn('[airtel/notify] Signature webhook invalide');
        return;
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[airtel/notify] AIRTEL_WEBHOOK_SECRET non configuré — validation de signature désactivée (production)');
    }

    const reference = body?.transaction?.id || body?.reference;
    const statusCode = body?.transaction?.status || body?.status;
    if (!reference) return;

    const tx = (await db.query(
      "SELECT * FROM transactions WHERE reference = $1 AND status = 'pending'",
      [reference]
    )).rows[0];
    if (!tx) return;

    const normalizedStatus = String(statusCode || '').toUpperCase();
    if (normalizedStatus === 'TS' || normalizedStatus === 'SUCCESS') {
      await processCompletedPayment(tx);
    } else if (['TF', 'FAILED', 'CANCELLED'].includes(normalizedStatus)) {
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`Airtel: ${normalizedStatus}`, tx.id]);
      dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: 'failed' }).catch(() => { });
    }
  } catch (err) {
    console.error('[airtel/notify]', err.message);
  }
});

// POST /api/v1/payments/mm/mtn/notify (MTN MoMo callback)
router.post('/mm/mtn/notify', async (req, res) => {
  res.status(200).json({ message: 'OK' });

  try {
    const body = req.body || {};
    // MTN MoMo utilise X-Callback-Api-Key pour l'authentification
    if (process.env.MTN_CALLBACK_API_KEY) {
      const apiKey = req.headers['x-callback-api-key'];
      if (!apiKey || apiKey !== process.env.MTN_CALLBACK_API_KEY) {
        console.warn('[mtn/notify] Clé API callback invalide ou absente — callback rejeté');
        return;
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.warn('[mtn/notify] MTN_CALLBACK_API_KEY non configuré — validation désactivée (production)');
    }

    // Format MTN MoMo: { financialTransactionId, externalId, status, reason }
    const externalId = body?.externalId || body?.external_id;
    const financialTransactionId = body?.financialTransactionId;
    const statusCode = body?.status;
    if (!externalId && !financialTransactionId) return;

    // L'externalId correspond à la référence de transaction Afrik'Fid
    const reference = externalId || financialTransactionId;
    const tx = (await db.query(
      "SELECT * FROM transactions WHERE (reference = $1 OR operator_reference = $1) AND status = 'pending'",
      [reference]
    )).rows[0];
    if (!tx) return;

    const normalizedStatus = String(statusCode || '').toUpperCase();
    if (normalizedStatus === 'SUCCESSFUL') {
      await processCompletedPayment(tx);
    } else if (['FAILED', 'REJECTED', 'TIMEOUT', 'EXPIRED'].includes(normalizedStatus)) {
      const reason = body?.reason?.message || body?.reason || normalizedStatus;
      await db.query("UPDATE transactions SET status = 'failed', failure_reason = $1 WHERE id = $2", [`MTN: ${reason}`, tx.id]);
      dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_FAILED, { transactionId: tx.id, status: 'failed' }).catch(() => { });
    }
  } catch (err) {
    console.error('[mtn/notify]', err.message);
  }
});

// POST /api/v1/payments/:id/sandbox/simulate — Simuler confirmation ou échec (sandbox uniquement)
router.post('/:id/sandbox/simulate', requireApiKey, async (req, res) => {
  if (!req.isSandbox) {
    return res.status(403).json({ error: 'SANDBOX_ONLY', message: 'Cet endpoint est uniquement disponible en mode sandbox.' });
  }

  const { outcome = 'success' } = req.body; // 'success' | 'failed' | 'expired'
  if (!['success', 'failed', 'expired'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome doit être "success", "failed" ou "expired"' });
  }

  const tx = (await db.query(
    'SELECT * FROM transactions WHERE id = $1 AND merchant_id = $2 AND is_sandbox = TRUE',
    [req.params.id, req.merchant.id]
  )).rows[0];

  if (!tx) return res.status(404).json({ error: 'Transaction sandbox non trouvée' });
  if (tx.status !== 'pending') return res.status(400).json({ error: `Transaction déjà traitée (statut: ${tx.status})` });

  if (outcome === 'success') {
    await processCompletedPayment(tx);
  } else {
    await db.query(
      "UPDATE transactions SET status = $1, failure_reason = $2 WHERE id = $3",
      [outcome, `Simulation sandbox: ${outcome}`, tx.id]
    );
    const event = outcome === 'expired' ? WebhookEvents.PAYMENT_EXPIRED : WebhookEvents.PAYMENT_FAILED;
    dispatchWebhook(tx.merchant_id, event, { transactionId: tx.id, status: outcome }).catch(() => { });
  }

  const updated = (await db.query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
  res.json({
    message: `Simulation "${outcome}" effectuée`,
    transaction: sanitizeTx(updated),
  });
});

// GET /api/v1/payments/:id/status
router.get('/:id/status', requireApiKey, async (req, res) => {
  const tx = (await db.query(`
    SELECT t.*, c.full_name as client_name, c.afrikfid_id, c.loyalty_status
    FROM transactions t
    LEFT JOIN clients c ON t.client_id = c.id
    WHERE t.id = $1 AND t.merchant_id = $2
  `, [req.params.id, req.merchant.id])).rows[0];

  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });

  const distributions = (await db.query('SELECT * FROM distributions WHERE transaction_id = $1', [tx.id])).rows;

  res.json({
    transaction: sanitizeTx(tx),
    distributions,
    client: tx.client_name ? { fullName: tx.client_name, afrikfidId: tx.afrikfid_id, loyaltyStatus: tx.loyalty_status } : null,
  });
});

// POST /api/v1/payments/:id/refund
router.post('/:id/refund', requireApiKey, verifyHmacSignature, validate(RefundSchema), async (req, res) => {
  const { amount, reason, refund_type } = req.body;

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1 AND merchant_id = $2', [req.params.id, req.merchant.id])).rows[0];

  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'completed') return res.status(400).json({ error: 'Seules les transactions complétées peuvent être remboursées' });

  // Vérification délai maximum 72h (fallback sur initiated_at si completed_at absent)
  const refundRef = tx.completed_at || tx.initiated_at;
  const hoursElapsed = refundRef ? (Date.now() - new Date(refundRef).getTime()) / 3600000 : 0;
  if (hoursElapsed > 72) {
    return res.status(422).json({ error: 'Délai de remboursement dépassé (72h maximum après la transaction)', hours_elapsed: Math.round(hoursElapsed) });
  }

  const grossAmount = parseFloat(tx.gross_amount);
  const refundAmount = refund_type === 'full' ? grossAmount : Math.min(parseFloat(amount || grossAmount), grossAmount);

  // Recalcul proportionnel X/Y/Z 
  const refundRatio = refundAmount / grossAmount;
  const merchantRebateRefunded = parseFloat(tx.merchant_rebate_amount) * refundRatio;
  const clientRebateRefunded = parseFloat(tx.client_rebate_amount) * refundRatio;
  const platformCommissionRefunded = parseFloat(tx.platform_commission_amount) * refundRatio;

  const refundId = uuidv4();

  await db.query(
    `INSERT INTO refunds (id, transaction_id, amount, refund_type, reason, status, initiated_by,
       merchant_rebate_refunded, client_rebate_refunded, platform_commission_refunded, refund_ratio)
     VALUES ($1, $2, $3, $4, $5, 'processing', $6, $7, $8, $9, $10)`,
    [refundId, tx.id, refundAmount, refund_type, reason || null, req.merchant.id,
      merchantRebateRefunded, clientRebateRefunded, platformCommissionRefunded, refundRatio]
  );

  // Annulation du cashback client proportionnel 
  if (tx.rebate_mode === 'cashback' && tx.client_id && clientRebateRefunded > 0) {
    const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [tx.client_id])).rows[0];
    if (wallet) {
      const debit = Math.min(parseFloat(wallet.balance), clientRebateRefunded);
      if (debit > 0) {
        const newBalance = parseFloat(wallet.balance) - debit;
        await db.query('UPDATE wallets SET balance = $1, total_spent = total_spent + $2, updated_at = NOW() WHERE client_id = $3', [newBalance, debit, tx.client_id]);
        await db.query(
          `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description) VALUES ($1, $2, $3, 'debit', $4, $5, $6, $7)`,
          [uuidv4(), wallet.id, tx.id, debit, wallet.balance, newBalance, `Annulation cashback - remboursement ${tx.reference} (${Math.round(refundRatio * 100)}%)`]
        );
      }
    }
  }

  const newStatus = refund_type === 'full' ? 'refunded' : 'partially_refunded';
  await db.query("UPDATE transactions SET status = $1 WHERE id = $2", [newStatus, tx.id]);
  await db.query("UPDATE refunds SET status = 'completed', processed_at = NOW() WHERE id = $1", [refundId]);

  dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_REFUNDED, {
    transactionId: tx.id,
    reference: tx.reference,
    refundAmount,
    refundRatio,
    distribution: { merchantRebateRefunded, clientRebateRefunded, platformCommissionRefunded },
  }).catch(() => { });

  res.json({
    refundId,
    message: 'Remboursement effectué avec succès',
    amount: refundAmount,
    refundRatio,
    distribution: {
      merchantRebateRefunded: parseFloat(merchantRebateRefunded.toFixed(2)),
      clientRebateRefunded: parseFloat(clientRebateRefunded.toFixed(2)),
      platformCommissionRefunded: parseFloat(platformCommissionRefunded.toFixed(2)),
    },
  });
});

// POST /api/v1/payments/:id/refund/dashboard — Remboursement depuis le dashboard marchand (JWT)
router.post('/:id/refund/dashboard', requireMerchant, async (req, res) => {
  const { amount, reason, refund_type = 'full' } = req.body;
  if (!reason) return res.status(400).json({ error: 'Le motif du remboursement est requis' });

  const tx = (await db.query('SELECT * FROM transactions WHERE id = $1 AND merchant_id = $2', [req.params.id, req.merchant.id])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'completed') return res.status(400).json({ error: 'Seules les transactions complétées peuvent être remboursées' });

  const refundRef2 = tx.completed_at || tx.initiated_at;
  const hoursElapsed = refundRef2 ? (Date.now() - new Date(refundRef2).getTime()) / 3600000 : 0;
  if (hoursElapsed > 72) {
    return res.status(422).json({ error: `Délai de remboursement dépassé (72h max). ${Math.round(hoursElapsed)}h écoulées.` });
  }

  const grossAmount = parseFloat(tx.gross_amount);
  const refundAmount = refund_type === 'full' ? grossAmount : Math.min(parseFloat(amount || grossAmount), grossAmount);
  const refundRatio = refundAmount / grossAmount;
  const merchantRebateRefunded = parseFloat(tx.merchant_rebate_amount) * refundRatio;
  const clientRebateRefunded = parseFloat(tx.client_rebate_amount) * refundRatio;
  const platformCommissionRefunded = parseFloat(tx.platform_commission_amount) * refundRatio;

  const refundId = uuidv4();
  await db.query(
    `INSERT INTO refunds (id, transaction_id, amount, refund_type, reason, status, initiated_by,
       merchant_rebate_refunded, client_rebate_refunded, platform_commission_refunded, refund_ratio)
     VALUES ($1, $2, $3, $4, $5, 'processing', $6, $7, $8, $9, $10)`,
    [refundId, tx.id, refundAmount, refund_type, reason, req.merchant.id,
      merchantRebateRefunded, clientRebateRefunded, platformCommissionRefunded, refundRatio]
  );

  // Annulation du cashback client si mode cashback
  if (tx.rebate_mode === 'cashback' && tx.client_id && clientRebateRefunded > 0) {
    const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [tx.client_id])).rows[0];
    if (wallet) {
      const debit = Math.min(parseFloat(wallet.balance), clientRebateRefunded);
      if (debit > 0) {
        const newBalance = parseFloat(wallet.balance) - debit;
        await db.query('UPDATE wallets SET balance = $1, total_spent = total_spent + $2, updated_at = NOW() WHERE client_id = $3', [newBalance, debit, tx.client_id]);
        await db.query(
          `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description) VALUES ($1, $2, $3, 'debit', $4, $5, $6, $7)`,
          [uuidv4(), wallet.id, tx.id, debit, wallet.balance, newBalance, `Annulation cashback - ${tx.reference}`]
        );
      }
    }
  }

  const newStatus = refund_type === 'full' ? 'refunded' : 'partially_refunded';
  await db.query('UPDATE transactions SET status = $1 WHERE id = $2', [newStatus, tx.id]);
  await db.query("UPDATE refunds SET status = 'completed', processed_at = NOW() WHERE id = $1", [refundId]);

  dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_REFUNDED, { transactionId: tx.id, reference: tx.reference, refundAmount, refundRatio }).catch(() => {});

  res.json({ refundId, message: 'Remboursement effectué avec succès', amount: refundAmount });
});

// POST /api/v1/payments/:id/refund/request — Demande de remboursement par le client (JWT)
router.post('/:id/refund/request', requireClient, async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Le motif est requis' });

  const tx = (await db.query(
    'SELECT * FROM transactions WHERE id = $1 AND client_id = $2',
    [req.params.id, req.client.id]
  )).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction non trouvée' });
  if (tx.status !== 'completed') return res.status(400).json({ error: 'Seules les transactions complétées peuvent faire l\'objet d\'une demande de remboursement' });

  const refundRef = tx.completed_at || tx.initiated_at;
  const hoursElapsed = refundRef ? (Date.now() - new Date(refundRef).getTime()) / 3600000 : 0;
  if (hoursElapsed > 72) {
    return res.status(422).json({ error: `Délai de remboursement dépassé (72h max). ${Math.round(hoursElapsed)}h écoulées.` });
  }

  // Vérifier qu'une demande en cours n'existe pas déjà
  const existing = (await db.query(
    "SELECT id FROM refunds WHERE transaction_id = $1 AND status IN ('pending', 'processing')",
    [tx.id]
  )).rows[0];
  if (existing) return res.status(409).json({ error: 'Une demande de remboursement est déjà en cours pour cette transaction' });

  const refundId = uuidv4();
  await db.query(
    `INSERT INTO refunds (id, transaction_id, amount, refund_type, reason, status, initiated_by,
       merchant_rebate_refunded, client_rebate_refunded, platform_commission_refunded, refund_ratio)
     VALUES ($1, $2, $3, 'full', $4, 'pending', $5, 0, 0, 0, 1)`,
    [refundId, tx.id, tx.gross_amount, reason.trim(), req.client.id]
  );

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, ip_address)
     VALUES ($1, 'client', $2, 'refund_requested', 'transaction', $3, $4)`,
    [uuidv4(), req.client.id, tx.id, req.ip]
  );

  // Notifier le marchand de la demande de remboursement
  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1', [tx.merchant_id])).rows[0];
  if (merchant) {
    notifyRefundRequested({
      merchant,
      client: req.client,
      transaction: tx,
      refundId,
      reason: reason.trim(),
    });
  }

  res.status(201).json({ refundId, message: 'Demande de remboursement soumise. Le marchand sera notifié.' });
});

// POST /api/v1/payments/wallet/pay — Paiement avec solde cashback 
// Authentification: JWT client (header Authorization: Bearer <token>)
router.post('/wallet/pay', requireClient, validate(WalletPaySchema), async (req, res) => {
  const { merchant_id, amount, currency = 'XOF', description, idempotency_key } = req.body;
  const client = req.client;

  // Idempotence
  if (idempotency_key) {
    const existing = (await db.query('SELECT * FROM transactions WHERE idempotency_key = $1', [idempotency_key])).rows[0];
    if (existing) return res.status(200).json({ message: 'Transaction existante', transaction: sanitizeTx(existing) });
  }

  const merchant = (await db.query('SELECT * FROM merchants WHERE id = $1 AND is_active = TRUE AND status = $2', [merchant_id, 'active'])).rows[0];
  if (!merchant) return res.status(404).json({ error: 'Marchand non trouvé ou inactif' });
  if (merchant.kyc_status !== 'approved') return res.status(403).json({ error: 'Marchand non vérifié (KYC requis)' });

  // Vérifier le solde wallet
  const wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [client.id])).rows[0];
  if (!wallet) return res.status(400).json({ error: 'Portefeuille non trouvé' });
  if (parseFloat(wallet.balance) < amount) {
    return res.status(422).json({
      error: 'INSUFFICIENT_WALLET_BALANCE',
      message: `Solde insuffisant. Disponible: ${wallet.balance} ${wallet.currency}, demandé: ${amount} ${currency}`,
    });
  }

  // Vérifier seuils marchand
  if (merchant.max_transaction_amount && amount > parseFloat(merchant.max_transaction_amount)) {
    return res.status(422).json({ error: 'AMOUNT_EXCEEDS_LIMIT', message: `Montant dépasse le seuil maximum (${merchant.max_transaction_amount})` });
  }

  // Calcul distribution X/Y/Z (paiement wallet = même mécanique, statut fidélité client)
  const clientCountryId = client.country_id || merchant.country_id || null;
  const distribution = await calculateDistribution(amount, merchant.rebate_percent, client.loyalty_status, clientCountryId);

  if (distribution.yExceedsX) {
    notifyFraudBlocked({
      amount,
      currency: merchant.currency || 'XOF',
      merchantName: merchant.name,
      clientPhone: client.phone || 'inconnu',
      reason: `Anomalie config wallet: Y (${distribution.clientRebatePercent}%) > X (${distribution.merchantRebatePercent}%)`,
      riskScore: 100,
    }).catch(() => { });
    return res.status(422).json({ error: 'DISTRIBUTION_ERROR', message: 'Taux Y supérieur à X. Anomalie de configuration.' });
  }

  // Débit immédiat du wallet
  const balanceBefore = parseFloat(wallet.balance);
  const newBalance = balanceBefore - amount;

  // Montant net facturé au client (si mode immediate, déduction Y% supplémentaire déjà intégrée)
  const chargedAmount = merchant.rebate_mode === 'immediate'
    ? amount - distribution.clientRebateAmount
    : amount;

  const txId = uuidv4();
  const reference = `AFD-WLT-${Date.now()}-${txId.slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  await db.query(`
    INSERT INTO transactions (
      id, reference, merchant_id, client_id,
      gross_amount, net_client_amount,
      merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
      merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
      merchant_receives, client_loyalty_status, rebate_mode,
      payment_method, status, currency, description, idempotency_key,
      initiated_at, completed_at, expires_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      'wallet', 'completed', $16, $17, $18,
      $19, $19, $19
    )
  `, [
    txId, reference, merchant.id, client.id,
    amount, chargedAmount,
    distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
    distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
    distribution.merchantReceives, client.loyalty_status, merchant.rebate_mode,
    currency, description || null, idempotency_key || null, now,
  ]);

  // Débit wallet client
  await db.query('UPDATE wallets SET balance = $1, total_spent = total_spent + $2, updated_at = NOW() WHERE id = $3', [newBalance, amount, wallet.id]);
  await db.query(
    `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description)
     VALUES ($1, $2, $3, 'debit', $4, $5, $6, $7)`,
    [uuidv4(), wallet.id, txId, amount, balanceBefore, newBalance, `Paiement chez ${merchant.name} - ${reference}`]
  );

  // Distributions
  const distId1 = uuidv4(), distId2 = uuidv4();
  await db.query(`
    INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, executed_at)
    VALUES ($1, $2, 'merchant', $3, $4, $5, 'completed', $6),
           ($7, $8, 'platform', 'afrikfid', $9, $10, 'completed', $11)
  `, [distId1, txId, merchant.id, distribution.merchantReceives, currency, now,
    distId2, txId, distribution.platformCommissionAmount, currency, now]);

  // Si mode cashback: re-créditer Y% (récompense fidélité sur paiement wallet aussi)
  if (merchant.rebate_mode === 'cashback' && distribution.clientRebateAmount > 0) {
    const walletCap = wallet.max_balance;
    const rebateToCredit = walletCap
      ? Math.min(distribution.clientRebateAmount, walletCap - newBalance)
      : distribution.clientRebateAmount;

    if (rebateToCredit > 0) {
      const balanceAfterRebate = newBalance + rebateToCredit;
      await db.query('UPDATE wallets SET balance = $1, total_earned = total_earned + $2, updated_at = NOW() WHERE id = $3', [balanceAfterRebate, rebateToCredit, wallet.id]);
      await db.query(
        `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, $2, $3, 'credit', $4, $5, $6, $7)`,
        [uuidv4(), wallet.id, txId, rebateToCredit, newBalance, balanceAfterRebate, `Cashback - ${reference}`]
      );
      await db.query(
        `INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, executed_at)
         VALUES ($1, $2, 'client_cashback', $3, $4, $5, 'completed', $6)`,
        [uuidv4(), txId, client.id, rebateToCredit, currency, now]
      );
    }

    // Notifier si le plafond a tronqué le cashback
    if (walletCap && rebateToCredit < distribution.clientRebateAmount) {
      notifyWalletCapReached({
        client,
        merchant,
        transaction: { id: txId },
        rawRebate: distribution.clientRebateAmount,
        creditedRebate: rebateToCredit,
        cap: walletCap,
        currency,
      }).catch(() => {});
    }
  }

  // Mise à jour stats client
  await db.query(
    'UPDATE clients SET total_purchases = total_purchases + 1, total_amount = total_amount + $1, updated_at = NOW() WHERE id = $2',
    [amount, client.id]
  );

  // Webhooks + SSE
  const completedTx = (await db.query('SELECT * FROM transactions WHERE id = $1', [txId])).rows[0];
  dispatchWebhook(merchant.id, WebhookEvents.PAYMENT_COMPLETED, sanitizeTx(completedTx)).catch(() => { });
  emit(SSE_EVENTS.PAYMENT_SUCCESS, { transactionId: txId, reference, merchantId: merchant.id, status: 'completed', amount, currency, operator: 'wallet' });

  res.status(201).json({
    transaction: sanitizeTx(completedTx),
    walletBalance: newBalance,
    message: 'Paiement par solde cashback effectué avec succès',
    distribution: {
      grossAmount: amount,
      merchantReceives: distribution.merchantReceives,
      clientRebateAmount: distribution.clientRebateAmount,
      platformCommissionAmount: distribution.platformCommissionAmount,
    },
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function processCompletedPayment(tx) {
  const now = new Date().toISOString();
  const distId1 = uuidv4();
  const distId2 = uuidv4();
  const distId3 = uuidv4();

  await db.query(`
    INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, executed_at)
    VALUES ($1, $2, 'merchant', $3, $4, $5, 'completed', $6),
           ($7, $8, 'platform', 'afrikfid', $9, $10, 'completed', $11)
  `, [
    distId1, tx.id, tx.merchant_id, tx.merchant_receives, tx.currency, now,
    distId2, tx.id, tx.platform_commission_amount, tx.currency, now,
  ]);

  if (tx.client_id && tx.client_rebate_amount > 0) {
    if (tx.rebate_mode === 'cashback') {
      let wallet = (await db.query('SELECT * FROM wallets WHERE client_id = $1', [tx.client_id])).rows[0];
      if (!wallet) {
        const walletId = uuidv4();
        await db.query('INSERT INTO wallets (id, client_id, currency) VALUES ($1, $2, $3)', [walletId, tx.client_id, tx.currency]);
        wallet = (await db.query('SELECT * FROM wallets WHERE id = $1', [walletId])).rows[0];
      }
      // Respect du plafond wallet  : max_balance propre au wallet ou global (wallet_config)
      const walletConfigRes = await db.query("SELECT default_max_balance FROM wallet_config WHERE id = 'global'");
      const globalCap = walletConfigRes.rows[0]?.default_max_balance != null
        ? parseFloat(walletConfigRes.rows[0].default_max_balance) : null;
      const effectiveCap = wallet.max_balance != null ? parseFloat(wallet.max_balance) : globalCap;
      const currentBalance = parseFloat(wallet.balance);
      const rawRebate = parseFloat(tx.client_rebate_amount);
      const rebateToCredit = effectiveCap != null
        ? Math.max(0, Math.min(rawRebate, effectiveCap - currentBalance))
        : rawRebate;

      if (rebateToCredit > 0) {
        const newBalance = currentBalance + rebateToCredit;
        await db.query(
          'UPDATE wallets SET balance = $1, total_earned = total_earned + $2, updated_at = NOW() WHERE id = $3',
          [newBalance, rebateToCredit, wallet.id]
        );
        await db.query(
          `INSERT INTO wallet_movements (id, wallet_id, transaction_id, type, amount, balance_before, balance_after, description) VALUES ($1, $2, $3, 'credit', $4, $5, $6, $7)`,
          [uuidv4(), wallet.id, tx.id, rebateToCredit, currentBalance, newBalance, `Cashback - ${tx.reference}`]
        );
      }
      await db.query(
        `INSERT INTO distributions (id, transaction_id, beneficiary_type, beneficiary_id, amount, currency, status, executed_at) VALUES ($1, $2, 'client_cashback', $3, $4, $5, 'completed', $6)`,
        [distId3, tx.id, tx.client_id, rawRebate, tx.currency, now]
      );

      // Notifier si le plafond a tronqué le cashback
      if (effectiveCap !== null && rebateToCredit < rawRebate) {
        const clientRow = (await db.query('SELECT * FROM clients WHERE id = $1', [tx.client_id])).rows[0];
        const merchantRow = (await db.query('SELECT id, name FROM merchants WHERE id = $1', [tx.merchant_id])).rows[0];
        notifyWalletCapReached({
          client: clientRow,
          merchant: merchantRow,
          transaction: tx,
          rawRebate,
          creditedRebate: rebateToCredit,
          cap: effectiveCap,
          currency: tx.currency,
        }).catch(() => {});
      }
    }

    // CDC v3 §2.3 — Attribution des points statut et récompense
    await awardPoints(tx.client_id, tx.id, parseFloat(tx.gross_amount));
  }

  await db.query("UPDATE transactions SET status = 'completed', completed_at = $1 WHERE id = $2", [now, tx.id]);

  const completedTx = (await db.query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];

  // Journalisation audit_log pour conformité BCEAO/BEAC (CDC §4.1.3 étape 7)
  db.query(
    `INSERT INTO audit_logs (id, action, entity_type, entity_id, actor_type, actor_id, metadata, created_at)
     VALUES ($1, 'payment.completed', 'transaction', $2, 'system', 'gateway', $3, NOW())`,
    [uuidv4(), tx.id, JSON.stringify({
      reference: tx.reference,
      merchant_id: tx.merchant_id,
      client_id: tx.client_id || null,
      gross_amount: tx.gross_amount,
      currency: tx.currency,
      merchant_rebate_amount: tx.merchant_rebate_amount,
      client_rebate_amount: tx.client_rebate_amount,
      platform_commission_amount: tx.platform_commission_amount,
      payment_operator: tx.payment_operator,
    })]
  ).catch(() => { });

  // Notifier les clients SSE en temps réel
  emit(SSE_EVENTS.PAYMENT_SUCCESS, {
    transactionId: tx.id, reference: tx.reference,
    merchantId: tx.merchant_id, status: 'completed',
    amount: tx.gross_amount, currency: tx.currency,
    operator: tx.payment_operator,
  });
  emit(SSE_EVENTS.TRANSACTION_STATUS, {
    transactionId: tx.id, status: 'completed',
    merchantId: tx.merchant_id,
    amount: tx.gross_amount, currency: tx.currency,
  });

  dispatchWebhook(tx.merchant_id, WebhookEvents.PAYMENT_COMPLETED, sanitizeTx(completedTx)).catch(() => { });

  // Webhook distribution.completed (CDC §4.5.3)
  const distributions = (await db.query('SELECT * FROM distributions WHERE transaction_id = $1', [tx.id])).rows;
  dispatchWebhook(tx.merchant_id, WebhookEvents.DISTRIBUTION_COMPLETED, {
    transaction_id: tx.id,
    reference: tx.reference,
    distributions: distributions.map(d => ({
      beneficiary_type: d.beneficiary_type,
      amount: d.amount,
      currency: d.currency,
      status: d.status,
    })),
  }).catch(() => { });

  if (tx.client_id) {
    const client = (await db.query('SELECT * FROM clients WHERE id = $1', [tx.client_id])).rows[0];
    const distRow = { client_rebate_amount: tx.client_rebate_amount, client_rebate_percent: tx.client_rebate_percent };
    notifyPaymentConfirmed({ client, transaction: { ...completedTx, merchant_name: null }, distribution: distRow });
    notifyCashbackCredit({ client, transaction: completedTx, distribution: distRow });
  }

  // Règlement instantané si settlement_frequency = 'instant' (CDC §4.2.2)
  processDisbursementsForMerchant(tx.merchant_id, 'instant').catch(err =>
    console.error(`[DISB/instant] Marchand ${tx.merchant_id}:`, err.message)
  );
}

function sanitizeTx(tx) {
  return {
    id: tx.id,
    reference: tx.reference,
    status: tx.status,
    grossAmount: tx.gross_amount,
    currency: tx.currency,
    merchantRebatePercent: tx.merchant_rebate_percent,
    clientRebatePercent: tx.client_rebate_percent,
    platformCommissionPercent: tx.platform_commission_percent,
    clientRebateAmount: tx.client_rebate_amount,
    platformCommissionAmount: tx.platform_commission_amount,
    merchantReceives: tx.merchant_receives,
    rebateMode: tx.rebate_mode,
    clientLoyaltyStatus: tx.client_loyalty_status,
    paymentMethod: tx.payment_method,
    paymentOperator: tx.payment_operator,
    operatorRef: tx.operator_ref,
    description: tx.description,
    initiatedAt: tx.initiated_at,
    completedAt: tx.completed_at,
    expiresAt: tx.expires_at,
  };
}

module.exports = router;
module.exports.processCompletedPayment = processCompletedPayment;
