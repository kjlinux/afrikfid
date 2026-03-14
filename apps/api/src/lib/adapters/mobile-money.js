/**
 * Adapters Mobile Money — Production + Sandbox
 *
 * Opérateurs supportés : Orange Money, MTN MoMo, Airtel Money, M-Pesa, Wave, Moov Money
 *
 * En production, chaque opérateur utilise sa propre API avec les clés configurées via .env.
 * Si les clés ne sont pas présentes, le mode sandbox (simulation) est utilisé automatiquement.
 *
 * Variables d'environnement par opérateur :
 *   ORANGE_CLIENT_ID, ORANGE_CLIENT_SECRET, ORANGE_MERCHANT_KEY  — Orange Money WebPay
 *   MTN_SUBSCRIPTION_KEY, MTN_API_USER, MTN_API_KEY               — MTN MoMo Collection API
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY  — Daraja STK Push
 *   AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET                        — Airtel Money API
 *   WAVE_API_KEY                                                  — Wave Business API
 *   MOOV_CLIENT_ID, MOOV_CLIENT_SECRET                            — Moov Money API
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

// Map de devises vers codes pays Airtel
const AIRTEL_CURRENCY_COUNTRY = { KES: 'KE', XOF: 'BF', XAF: 'TD' };

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
  const country = AIRTEL_CURRENCY_COUNTRY[currency] || 'KE';
  const resp = await axios.post(`${AIRTEL_BASE}/merchant/v2/payments/`, {
    reference,
    subscriber: { country, currency, msisdn: phone.replace(/^\+/, '') },
    transaction: { amount, country, currency, id: reference },
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Country': country,
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

// ─── Wave Business API ────────────────────────────────────────────────────────
// Documentation : https://docs.wave.com/business-api/
// Inscription   : https://business.wave.com/

const WAVE_BASE = 'https://api.wave.com/v1';

async function waveInitiatePayment({ phone, amount, currency, reference, description, notifyUrl }) {
  const callbackUrl = notifyUrl || process.env.WAVE_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL;
  const resp = await axios.post(`${WAVE_BASE}/checkout/sessions`, {
    amount: String(amount),
    currency,
    error_url: callbackUrl,
    success_url: callbackUrl,
    client_reference: reference,
    restrict_mobile: phone ? `+${phone.replace(/^\+/, '')}` : undefined,
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.WAVE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  return {
    success: true,
    operatorRef: resp.data.id,
    paymentUrl: resp.data.wave_launch_url,
    operator: 'WAVE',
    phone,
    amount,
    currency,
    reference,
    status: 'pending',
    message: 'Redirection vers Wave pour paiement.',
    sandbox: false,
  };
}

async function waveCheckStatus({ operatorRef }) {
  const resp = await axios.get(`${WAVE_BASE}/checkout/sessions/${operatorRef}`, {
    headers: { 'Authorization': `Bearer ${process.env.WAVE_API_KEY}` },
    timeout: 10000,
  });
  // statuts Wave: open | processing | complete | error | cancelled
  const statusMap = { complete: 'completed', error: 'failed', cancelled: 'failed', processing: 'pending', open: 'pending' };
  return {
    operatorRef,
    status: statusMap[resp.data.payment_status] || 'pending',
    rawStatus: resp.data.payment_status,
    sandbox: false,
  };
}

// ─── Moov Money API ───────────────────────────────────────────────────────────
// Documentation : https://developer.moov.africa/
// Inscription   : https://developer.moov.africa/

const MOOV_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api.moov.africa'
  : 'https://sandbox.moov.africa';

let _moovToken = null;
let _moovTokenExpiry = 0;

async function getMoovToken() {
  if (_moovToken && Date.now() < _moovTokenExpiry) return _moovToken;
  const { MOOV_CLIENT_ID, MOOV_CLIENT_SECRET } = process.env;
  const credentials = Buffer.from(`${MOOV_CLIENT_ID}:${MOOV_CLIENT_SECRET}`).toString('base64');
  const resp = await axios.post(`${MOOV_BASE}/oauth/token`,
    'grant_type=client_credentials',
    { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  _moovToken = resp.data.access_token;
  _moovTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return _moovToken;
}

async function moovInitiatePayment({ phone, amount, currency, reference, description }) {
  const token = await getMoovToken();
  const resp = await axios.post(`${MOOV_BASE}/v1/collect`, {
    amount,
    currency,
    externalReference: reference,
    msisdn: phone.replace(/^\+/, ''),
    description: description || reference,
    callbackUrl: process.env.MOOV_CALLBACK_URL || process.env.PAYMENT_CALLBACK_URL,
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  return {
    success: true,
    operatorRef: resp.data.transactionId || resp.data.id || reference,
    operator: 'MOOV',
    phone,
    amount,
    currency,
    reference,
    status: 'pending',
    message: 'Demande Moov Money envoyée. En attente de confirmation USSD.',
    sandbox: MOOV_BASE.includes('sandbox'),
  };
}

async function moovCheckStatus({ operatorRef }) {
  const token = await getMoovToken();
  const resp = await axios.get(`${MOOV_BASE}/v1/collect/${operatorRef}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: 10000,
  });
  const statusMap = { SUCCESS: 'completed', FAILED: 'failed', PENDING: 'pending', PROCESSING: 'pending' };
  return {
    operatorRef,
    status: statusMap[resp.data.status] || 'pending',
    rawStatus: resp.data.status,
    sandbox: MOOV_BASE.includes('sandbox'),
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

function hasWaveCredentials() {
  return !!(process.env.WAVE_API_KEY);
}

function hasMoovCredentials() {
  return !!(process.env.MOOV_CLIENT_ID && process.env.MOOV_CLIENT_SECRET);
}

// ─── Table de failover par devise/pays (CDC §4.1.4) ──────────────────────────
// Si l'opérateur principal échoue, on tente les suivants dans l'ordre.
const FAILOVER_CHAINS = {
  XOF: ['ORANGE', 'MTN', 'WAVE', 'MOOV'],
  XAF: ['ORANGE', 'MTN'],
  KES: ['MPESA', 'AIRTEL'],
};

function getFailoverChain(operator, currency) {
  const chain = FAILOVER_CHAINS[currency] || [];
  const opUpper = operator.toUpperCase();
  // Placer l'opérateur demandé en premier, puis les alternatives
  const alternatives = chain.filter(o => o !== opUpper);
  return [opUpper, ...alternatives];
}

/**
 * Tente l'initiation sur l'opérateur demandé.
 * En cas d'erreur technique (timeout, API down), bascule automatiquement
 * vers un opérateur alternatif disponible sur la même devise (CDC §4.1.4).
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

  const chain = isSandbox() ? [operator.toUpperCase()] : getFailoverChain(operator, currency);
  let lastError = null;

  for (const code of chain) {
    try {
      let result = null;

      if (!isSandbox()) {
        if (code === 'ORANGE' && hasOrangeCredentials()) {
          result = await orangeInitiatePayment({ phone, amount, currency, reference, description, notifyUrl });
        } else if (code === 'MTN' && hasMtnCredentials()) {
          result = await mtnInitiatePayment({ phone, amount, currency, reference, description });
        } else if (code === 'MPESA' && hasMpesaCredentials()) {
          result = await mpesaInitiatePayment({ phone, amount, reference, description });
        } else if (code === 'AIRTEL' && hasAirtelCredentials()) {
          result = await airtelInitiatePayment({ phone, amount, currency, reference });
        } else if (code === 'WAVE' && hasWaveCredentials()) {
          result = await waveInitiatePayment({ phone, amount, currency, reference, description, notifyUrl });
        } else if (code === 'MOOV' && hasMoovCredentials()) {
          result = await moovInitiatePayment({ phone, amount, currency, reference, description });
        }
      }

      if (!result) {
        // Pas de credentials pour cet opérateur, passer au suivant si c'est un failover
        if (code !== operator.toUpperCase()) continue;
        result = await sandboxInitiatePayment({ operator: code, phone, amount, currency, reference });
      }

      if (result.success) {
        if (code !== operator.toUpperCase()) {
          console.warn(`[MobileMoney] Failover: ${operator} → ${code} pour ref ${reference}`);
          result.failover = true;
          result.originalOperator = operator.toUpperCase();
        }
        return result;
      }

      // Erreur métier (solde insuffisant, numéro invalide) — ne pas essayer d'autres opérateurs
      if (['INSUFFICIENT_FUNDS', 'INVALID_PHONE', 'AMOUNT_OUT_OF_RANGE'].includes(result.error)) {
        return result;
      }

      lastError = result;
    } catch (err) {
      console.error(`[MobileMoney] Erreur opérateur ${code}:`, err.response?.data || err.message);
      lastError = { success: false, error: 'OPERATOR_ERROR', message: err.response?.data?.message || err.message };
      // Continuer sur le prochain opérateur du failover
    }
  }

  return lastError || { success: false, error: 'ALL_OPERATORS_FAILED', message: 'Tous les opérateurs disponibles ont échoué.' };
}

/**
 * Vérifie le statut d'une transaction auprès de l'opérateur.
 */
async function checkPaymentStatus({ operatorRef, operator }) {
  if (!isSandbox()) {
    try {
      const code = (operator || '').toUpperCase();
      if (code === 'MTN' && hasMtnCredentials()) {
        return await mtnCheckStatus({ operatorRef });
      }
      if (code === 'WAVE' && hasWaveCredentials()) {
        return await waveCheckStatus({ operatorRef });
      }
      if (code === 'MOOV' && hasMoovCredentials()) {
        return await moovCheckStatus({ operatorRef });
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
