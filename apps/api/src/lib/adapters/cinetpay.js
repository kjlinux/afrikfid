'use strict';

/**
 * Adaptateur CinetPay — Paiement par carte (UEMOA + CEMAC)
 * Docs: https://docs.cinetpay.com
 * Flux: initiation → redirect 3DS → webhook de confirmation
 */

const axios = require('axios');

const CINETPAY_BASE_URL = process.env.CINETPAY_API_URL || 'https://api-checkout.cinetpay.com/v2';
const SITE_ID    = process.env.CINETPAY_SITE_ID;
const API_KEY    = process.env.CINETPAY_API_KEY;
const NOTIFY_URL = process.env.CINETPAY_NOTIFY_URL;  // webhook de retour CinetPay
const RETURN_URL = process.env.CINETPAY_RETURN_URL;  // redirect après paiement

const SANDBOX = process.env.NODE_ENV !== 'production';

/**
 * Initie un paiement carte via CinetPay.
 * Retourne une URL de paiement vers laquelle rediriger le payeur (3DS inclus).
 *
 * @param {object} opts
 * @param {string} opts.transactionId   UUID interne de la transaction
 * @param {string} opts.reference       Référence Afrik'Fid (ex: AFD-xxx)
 * @param {number} opts.amount          Montant à collecter
 * @param {string} opts.currency        XOF | XAF | KES
 * @param {string} [opts.customerName]  Nom du payeur
 * @param {string} [opts.customerPhone] Téléphone du payeur
 * @param {string} [opts.description]   Description de la transaction
 */
async function initiateCardPayment({ transactionId, reference, amount, currency, customerName, customerPhone, description }) {
  // Mode sandbox : simuler une réponse réussie
  if (SANDBOX || !SITE_ID || !API_KEY) {
    console.info(`[CINETPAY/sandbox] card payment initiated: ref=${reference} amount=${amount} ${currency}`);
    return {
      success: true,
      paymentUrl: `https://sandbox.cinetpay.com/pay?tx_id=${transactionId}&sandbox=true`,
      cinetpayRef: `CP-SANDBOX-${transactionId.slice(0, 8).toUpperCase()}`,
      message: 'Sandbox: redirection simulée',
    };
  }

  try {
    const payload = {
      apikey: API_KEY,
      site_id: SITE_ID,
      transaction_id: transactionId,
      amount,
      currency,
      description: description || `Paiement Afrik'Fid ${reference}`,
      notify_url: NOTIFY_URL,
      return_url: RETURN_URL,
      channels: 'ALL',  // Visa, Mastercard, GIM-UEMOA, etc.
      ...(customerName  && { customer_name: customerName }),
      ...(customerPhone && { customer_phone_number: customerPhone }),
      metadata: reference,
    };

    const res = await axios.post(`${CINETPAY_BASE_URL}/payment`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    if (res.data?.code !== '201') {
      return {
        success: false,
        error: res.data?.code || 'CINETPAY_ERROR',
        message: res.data?.message || 'Erreur CinetPay',
      };
    }

    return {
      success: true,
      paymentUrl: res.data.data?.payment_url,
      cinetpayRef: res.data.data?.payment_token,
      message: 'Redirection vers la page de paiement sécurisée',
    };
  } catch (err) {
    console.error('[CINETPAY] initiateCardPayment error:', err.message);
    return { success: false, error: 'NETWORK_ERROR', message: err.message };
  }
}

/**
 * Vérifie le statut d'une transaction CinetPay (appelé depuis le webhook de notification).
 * @param {string} transactionId  UUID interne ou transaction_id CinetPay
 */
async function checkPaymentStatus(transactionId) {
  if (SANDBOX || !SITE_ID || !API_KEY) {
    return { success: true, status: 'ACCEPTED', message: 'Sandbox: paiement accepté' };
  }

  try {
    const res = await axios.post(`${CINETPAY_BASE_URL}/payment/check`, {
      apikey: API_KEY,
      site_id: SITE_ID,
      transaction_id: transactionId,
    }, { timeout: 10000 });

    const data = res.data?.data;
    if (!data) return { success: false, status: 'UNKNOWN', message: 'Pas de données CinetPay' };

    // Statuts CinetPay: ACCEPTED | REFUSED | CANCELLED | PENDING
    return {
      success: data.status === 'ACCEPTED',
      status: data.status,
      amount: data.amount,
      currency: data.currency,
      message: data.message || data.status,
      operatorRef: data.operator_id,
    };
  } catch (err) {
    console.error('[CINETPAY] checkPaymentStatus error:', err.message);
    return { success: false, status: 'UNKNOWN', message: err.message };
  }
}

module.exports = { initiateCardPayment, checkPaymentStatus };
