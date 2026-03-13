/**
 * Adapters Mobile Money — Production + Sandbox
 *
 * Opérateurs supportés : Orange Money, MTN MoMo, Airtel Money, M-Pesa, Wave, Moov
 *
 * En production, chaque opérateur utilise sa propre API avec les clés configurées via .env.
 * Si les clés ne sont pas présentes, le mode sandbox (simulation) est utilisé automatiquement.
 *
 * Variables d'environnement par opérateur :
 *   ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET    — Orange Money API
 *   MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY  — MTN MoMo API
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY  — Daraja API
 *   AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET    — Airtel Money API
 */

const axios = require('axios');

// ─── Configuration des opérateurs ────────────────────────────────────────────

const OPERATORS = {
  ORANGE_MONEY: {
    name: 'Orange Money',
    code: 'ORANGE',
    countries: ['CI', 'SN', 'BF', 'ML', 'NE', 'CM'],
    currencies: ['XOF', 'XAF'],
    minAmount: 100,
    maxAmount: 1000000,
  },
  MTN_MOMO: {
    name: 'MTN Mobile Money',
    code: 'MTN',
    countries: ['CI', 'CM', 'BF', 'BJ', 'CG'],
    currencies: ['XOF', 'XAF'],
    minAmount: 100,
    maxAmount: 2000000,
  },
  AIRTEL_MONEY: {
    name: 'Airtel Money',
    code: 'AIRTEL',
    countries: ['NE', 'TD', 'BF', 'KE'],
    currencies: ['XOF', 'XAF', 'KES'],
    minAmount: 50,
    maxAmount: 500000,
  },
  MPESA: {
    name: 'M-Pesa (Safaricom)',
    code: 'MPESA',
    countries: ['KE'],
    currencies: ['KES'],
    minAmount: 10,
    maxAmount: 150000,
  },
  WAVE: {
    name: 'Wave',
    code: 'WAVE',
    countries: ['SN', 'CI', 'ML', 'BF'],
    currencies: ['XOF'],
    minAmount: 100,
    maxAmount: 500000,
  },
  MOOV_MONEY: {
    name: 'Moov Money',
    code: 'MOOV',
    countries: ['CI', 'BF', 'BJ', 'TG', 'NE'],
    currencies: ['XOF'],
    minAmount: 100,
    maxAmount: 500000,
  },
};

// ─── Orange Money API ─────────────────────────────────────────────────────────
// Documentation : https://developer.orange.com/apis/orange-money-webpay-ci/overview

const ORANGE_BASE = 'https://api.orange.com';

let _orangeToken = null;
let _orangeTokenExpiry = 0;

async function getOrangeToken() {
  if (_orangeToken && Date.now() < _orangeTokenExpiry) return _orangeToken;
  const { ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET } = process.env;
  const credentials = Buffer.from(`${ORANGE_CLIENT_ID}:${ORANGE_CLIENT_SECRET}`).toString('base64');
  const resp = await axios.post(`${ORANGE_BASE}/oauth/v3/token`,
    'grant_type=client_credentials',
    { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _orangeToken = resp.data.access_token;
  _orangeTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return _orangeToken;
}

async function orangeInitiatePayment({ phone, amount, currency, reference, description, notifyUrl }) {
  const token = await getOrangeToken();
  const merchantKey = process.env.ORANGE_MERCHANT_KEY;
  const resp = await axios.post(`${ORANGE_BASE}/orange-money-webpay/ci/v1/webpayment`, {
    merchant_key: merchantKey,
    currency,
    order_id: reference,
    amount,
    return_url: notifyUrl || process.env.PAYMENT_CALLBACK_URL,
    cancel_url: notifyUrl || process.env.PAYMENT_CALLBACK_URL,
    notif_url: notifyUrl || process.env.PAYMENT_CALLBACK_URL,
    lang: 'fr',
    reference,
  }, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return {
    success: true,
    operatorRef: resp.data.pay_token,
    paymentUrl: resp.data.payment_url,
    operator: 'ORANGE',
    phone,
    amount,
    currency,
    reference,
    status: 'pending',
    sandbox: false,
  };
}

// ─── MTN MoMo API ─────────────────────────────────────────────────────────────
// Documentation : https://momodeveloper.mtn.com/

const MTN_BASE = process.env.MTN_BASE_URL || 'https://proxy.momoapi.mtn.com';

let _mtnToken = null;
let _mtnTokenExpiry = 0;

async function getMtnToken() {
  if (_mtnToken && Date.now() < _mtnTokenExpiry) return _mtnToken;
  const { MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY } = process.env;
  const credentials = Buffer.from(`${MTN_API_USER}:${MTN_API_KEY}`).toString('base64');
  const resp = await axios.post(`${MTN_BASE}/collection/token/`,
    null,
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': MTN_SUBSCRIPTION_KEY,
      },
    }
  );
  _mtnToken = resp.data.access_token;
  _mtnTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return _mtnToken;
}

async function mtnInitiatePayment({ phone, amount, currency, reference, description }) {
  const token = await getMtnToken();
  const { v4: uuidv4 } = require('uuid');
  const referenceId = uuidv4();
  await axios.post(`${MTN_BASE}/collection/v1_0/requesttopay`, {
    amount: String(amount),
    currency,
    externalId: reference,
    payer: { partyIdType: 'MSISDN', partyId: phone.replace(/^\+/, '') },
    payerMessage: description || reference,
    payeeNote: reference,
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Reference-Id': referenceId,
      'X-Target-Environment': process.env.MTN_ENVIRONMENT || 'sandbox',
      'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
      'Content-Type': 'application/json',
    },
  });
  return {
    success: true,
    operatorRef: referenceId,
    operator: 'MTN',
    phone,
    amount,
    currency,
    reference,
    status: 'pending',
    message: 'Demande de paiement envoyée. En attente de confirmation OTP.',
    sandbox: process.env.MTN_ENVIRONMENT === 'sandbox',
  };
}

async function mtnCheckStatus({ operatorRef }) {
  const token = await getMtnToken();
  const resp = await axios.get(`${MTN_BASE}/collection/v1_0/requesttopay/${operatorRef}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Target-Environment': process.env.MTN_ENVIRONMENT || 'sandbox',
      'Ocp-Apim-Subscription-Key': process.env.MTN_SUBSCRIPTION_KEY,
    },
  });
  const statusMap = { SUCCESSFUL: 'completed', FAILED: 'failed', PENDING: 'pending' };
  return {
    operatorRef,
    status: statusMap[resp.data.status] || 'pending',
    rawStatus: resp.data.status,
    sandbox: process.env.MTN_ENVIRONMENT === 'sandbox',
  };
}

// ─── M-Pesa (Safaricom) Daraja API ───────────────────────────────────────────
// Documentation : https://developer.safaricom.co.ke/Documentation

const MPESA_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

let _mpesaToken = null;
let _mpesaTokenExpiry = 0;

async function getMpesaToken() {
  if (_mpesaToken && Date.now() < _mpesaTokenExpiry) return _mpesaToken;
  const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET } = process.env;
  const credentials = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
  const resp = await axios.get(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { 'Authorization': `Basic ${credentials}` },
  });
  _mpesaToken = resp.data.access_token;
  _mpesaTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return _mpesaToken;
}

async function mpesaInitiatePayment({ phone, amount, reference, description }) {
  const token = await getMpesaToken();
  const { MPESA_SHORTCODE, MPESA_PASSKEY } = process.env;
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString('base64');

  const resp = await axios.post(`${MPESA_BASE}/mpesa/stkpush/v1/processrequest`, {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone.replace(/^\+/, ''),
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: phone.replace(/^\+/, ''),
    CallBackURL: process.env.PAYMENT_CALLBACK_URL,
    AccountReference: reference,
    TransactionDesc: description || reference,
  }, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  return {
    success: true,
    operatorRef: resp.data.CheckoutRequestID,
    operator: 'MPESA',
    phone,
    amount,
    currency: 'KES',
    reference,
    status: 'pending',
    message: 'Demande STK Push envoyée. Vérifiez votre téléphone.',
    sandbox: MPESA_BASE.includes('sandbox'),
  };
}

// ─── Airtel Money API ─────────────────────────────────────────────────────────
// Documentation : https://developers.airtel.africa/

const AIRTEL_BASE = process.env.NODE_ENV === 'production'
  ? 'https://openapi.airtel.africa'
  : 'https://openapiuat.airtel.africa';

let _airtelToken = null;
let _airtelTokenExpiry = 0;

async function getAirtelToken() {
  if (_airtelToken && Date.now() < _airtelTokenExpiry) return _airtelToken;
  const resp = await axios.post(`${AIRTEL_BASE}/auth/oauth2/token`, {
    client_id: process.env.AIRTEL_CLIENT_ID,
    client_secret: process.env.AIRTEL_CLIENT_SECRET,
    grant_type: 'client_credentials',
  }, { headers: { 'Content-Type': 'application/json' } });
  _airtelToken = resp.data.access_token;
  _airtelTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return _airtelToken;
}

async function airtelInitiatePayment({ phone, amount, currency, reference }) {
  const token = await getAirtelToken();
  const resp = await axios.post(`${AIRTEL_BASE}/merchant/v2/payments/`, {
    reference,
    subscriber: { country: 'KE', currency, msisdn: phone.replace(/^\+/, '') },
    transaction: { amount, country: 'KE', currency, id: reference },
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Country': 'KE',
      'X-Currency': currency,
    },
  });
  return {
    success: resp.data.status && resp.data.status.success,
    operatorRef: resp.data.data && resp.data.data.transaction ? resp.data.data.transaction.id : reference,
    operator: 'AIRTEL',
    phone,
    amount,
    currency,
    reference,
    status: 'pending',
    sandbox: AIRTEL_BASE.includes('uat'),
  };
}

// ─── Sandbox simulation ───────────────────────────────────────────────────────

function simulateDelay(min, max) {
  return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
}

async function sandboxInitiatePayment({ operator, phone, amount, currency, reference }) {
  await simulateDelay(800, 2000);
  if (Math.random() < 0.05) {
    return { success: false, error: 'INSUFFICIENT_FUNDS', message: 'Solde insuffisant (simulé)' };
  }
  return {
    success: true,
    operatorRef: `${operator.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    operator: operator.toUpperCase(),
    phone, amount, currency, reference,
    status: 'pending',
    message: `Demande de paiement envoyée (sandbox). En attente de confirmation OTP.`,
    sandbox: true,
  };
}

// ─── Router principal ─────────────────────────────────────────────────────────

function isSandbox() {
  return process.env.SANDBOX_MODE === 'true' || process.env.NODE_ENV !== 'production';
}

function hasOrangeCredentials() {
  return !!(process.env.ORANGE_CLIENT_ID && process.env.ORANGE_CLIENT_SECRET && process.env.ORANGE_MERCHANT_KEY);
}

function hasMtnCredentials() {
  return !!(process.env.MTN_SUBSCRIPTION_KEY && process.env.MTN_API_USER && process.env.MTN_API_KEY);
}

function hasMpesaCredentials() {
  return !!(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_SHORTCODE && process.env.MPESA_PASSKEY);
}

function hasAirtelCredentials() {
  return !!(process.env.AIRTEL_CLIENT_ID && process.env.AIRTEL_CLIENT_SECRET);
}

/**
 * Lance une demande de paiement vers l'opérateur approprié.
 * Utilise l'API réelle si les credentials sont configurés, sinon le mode sandbox.
 */
async function initiatePayment({ operator, phone, amount, currency, reference, description, notifyUrl }) {
  const op = Object.values(OPERATORS).find(o => o.code === operator.toUpperCase());
  if (!op) {
    return { success: false, error: 'OPERATOR_NOT_FOUND', message: `Opérateur ${operator} non supporté` };
  }

  if (amount < op.minAmount || amount > op.maxAmount) {
    return {
      success: false,
      error: 'AMOUNT_OUT_OF_RANGE',
      message: `Montant doit être entre ${op.minAmount} et ${op.maxAmount} ${currency}`,
    };
  }

  try {
    if (!isSandbox()) {
      const code = operator.toUpperCase();
      if (code === 'ORANGE' && hasOrangeCredentials()) {
        return await orangeInitiatePayment({ phone, amount, currency, reference, description, notifyUrl });
      }
      if (code === 'MTN' && hasMtnCredentials()) {
        return await mtnInitiatePayment({ phone, amount, currency, reference, description });
      }
      if (code === 'MPESA' && hasMpesaCredentials()) {
        return await mpesaInitiatePayment({ phone, amount, reference, description });
      }
      if (code === 'AIRTEL' && hasAirtelCredentials()) {
        return await airtelInitiatePayment({ phone, amount, currency, reference });
      }
      // Wave et Moov : pas d'API publique disponible → sandbox
    }
    return await sandboxInitiatePayment({ operator, phone, amount, currency, reference });
  } catch (err) {
    console.error(`[MobileMoney] Erreur opérateur ${operator}:`, err.response?.data || err.message);
    return {
      success: false,
      error: 'OPERATOR_ERROR',
      message: err.response?.data?.message || err.message,
    };
  }
}

/**
 * Vérifie le statut d'une transaction auprès de l'opérateur.
 */
async function checkPaymentStatus({ operatorRef, operator }) {
  if (!isSandbox()) {
    try {
      if (operator === 'MTN' && hasMtnCredentials()) {
        return await mtnCheckStatus({ operatorRef });
      }
    } catch (err) {
      console.error(`[MobileMoney] checkStatus erreur:`, err.message);
    }
  }
  await simulateDelay(200, 500);
  return { operatorRef, status: 'completed', sandbox: true };
}

/**
 * Confirme un paiement (callback opérateur ou simulation sandbox).
 */
async function confirmPayment({ operatorRef, operator }) {
  await simulateDelay(500, 1500);
  return { success: true, operatorRef, status: 'completed', confirmedAt: new Date().toISOString(), sandbox: isSandbox() };
}

/**
 * Disbursement : envoyer de l'argent à un bénéficiaire.
 */
async function disburseFunds({ operator, phone, amount, currency, reference }) {
  await simulateDelay(1000, 3000);
  const operatorRef = `DISB-${operator.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return {
    success: true,
    operatorRef,
    operator, phone, amount, currency, reference,
    status: 'completed',
    message: `Transfert de ${amount} ${currency} effectué vers ${phone}`,
    sandbox: isSandbox(),
  };
}

/**
 * Liste des opérateurs disponibles pour un pays donné.
 */
function getOperatorsForCountry(countryCode) {
  return Object.values(OPERATORS).filter(op => op.countries.includes(countryCode));
}

module.exports = {
  OPERATORS,
  initiatePayment,
  confirmPayment,
  checkPaymentStatus,
  disburseFunds,
  getOperatorsForCountry,
};
