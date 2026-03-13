'use strict';

/**
 * Adaptateur Flutterwave — Paiement par carte (UEMOA + CEMAC + Afrique de l'Est)
 * Docs: https://developer.flutterwave.com/docs
 * Flux: initiation → redirect 3DS → webhook de confirmation
 *
 * Variables d'environnement :
 *   FLUTTERWAVE_SECRET_KEY    — Clé secrète Flutterwave (ex: FLWSECK_TEST-xxx ou FLWSECK-xxx)
 *   FLUTTERWAVE_PUBLIC_KEY    — Clé publique (pour le front-end si besoin)
 *   FLUTTERWAVE_ENCRYPT_KEY   — Clé de chiffrement des charges (3DES)
 *   FLUTTERWAVE_NOTIFY_URL    — Webhook de retour Flutterwave
 *   FLUTTERWAVE_RETURN_URL    — Redirect après paiement
 */

const axios = require('axios');
const crypto = require('crypto');

const FLW_BASE = 'https://api.flutterwave.com/v3';
const SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;
const ENCRYPT_KEY = process.env.FLUTTERWAVE_ENCRYPT_KEY;
const SANDBOX = process.env.NODE_ENV !== 'production';

/**
 * Chiffre le payload pour les paiements directs (3DES).
 * Utilisé uniquement pour les charges directes par carte (pas redirect).
 */
function encryptPayload(payload) {
  if (!ENCRYPT_KEY) return null;
  const text = JSON.stringify(payload);
  const forceKey = ENCRYPT_KEY.substring(0, 24);
  const cipher = crypto.createCipheriv('des-ede3', forceKey, '');
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

/**
 * Initie un paiement carte via Flutterwave (redirect 3DS).
 * Retourne une URL de paiement vers laquelle rediriger le payeur.
 */
async function initiateCardPayment({ transactionId, reference, amount, currency, customerName, customerEmail, customerPhone, description }) {
  // Mode sandbox : simuler une réponse réussie
  if (SANDBOX || !SECRET_KEY) {
    console.info(`[FLUTTERWAVE/sandbox] card payment initiated: ref=${reference} amount=${amount} ${currency}`);
    return {
      success: true,
      paymentUrl: `https://ravemodal-dev.herokuapp.com/v2/hosted/pay?sandbox=true&tx_ref=${transactionId}`,
      flutterwaveRef: `FLW-SANDBOX-${transactionId.slice(0, 8).toUpperCase()}`,
      message: 'Sandbox: redirection simulée Flutterwave',
    };
  }

  try {
    const payload = {
      tx_ref: transactionId,
      amount,
      currency,
      redirect_url: process.env.FLUTTERWAVE_RETURN_URL,
      meta: { merchant_reference: reference },
      customer: {
        email: customerEmail || `guest+${transactionId.slice(0, 8)}@afrikfid.com`,
        phonenumber: customerPhone || '',
        name: customerName || 'Client Afrik\'Fid',
      },
      customizations: {
        title: 'Afrik\'Fid',
        description: description || `Paiement Afrik'Fid ${reference}`,
        logo: process.env.BRAND_LOGO_URL || '',
      },
      payment_options: 'card,ussd,mobilemoney',
    };

    const resp = await axios.post(`${FLW_BASE}/payments`, payload, {
      headers: {
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    if (resp.data?.status !== 'success') {
      return {
        success: false,
        error: 'FLUTTERWAVE_ERROR',
        message: resp.data?.message || 'Erreur Flutterwave',
      };
    }

    return {
      success: true,
      paymentUrl: resp.data.data?.link,
      flutterwaveRef: transactionId,
      message: 'Redirection vers la page de paiement sécurisée Flutterwave',
    };
  } catch (err) {
    console.error('[FLUTTERWAVE] initiateCardPayment error:', err.message);
    return { success: false, error: 'NETWORK_ERROR', message: err.message };
  }
}

/**
 * Vérifie le statut d'une transaction Flutterwave via son ID interne (tx_ref).
 * Appelé depuis le webhook de notification ou la page de retour.
 */
async function checkPaymentStatus(transactionId) {
  if (SANDBOX || !SECRET_KEY) {
    return { success: true, status: 'successful', message: 'Sandbox: paiement accepté' };
  }

  try {
    // Vérification via tx_ref
    const resp = await axios.get(`${FLW_BASE}/transactions?tx_ref=${transactionId}`, {
      headers: { 'Authorization': `Bearer ${SECRET_KEY}` },
      timeout: 10000,
    });

    const tx = resp.data?.data?.[0];
    if (!tx) return { success: false, status: 'unknown', message: 'Transaction non trouvée chez Flutterwave' };

    // Statuts Flutterwave: successful | failed | pending
    return {
      success: tx.status === 'successful',
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      message: tx.processor_response || tx.status,
      operatorRef: tx.id,
      flutterwaveRef: tx.flw_ref,
    };
  } catch (err) {
    console.error('[FLUTTERWAVE] checkPaymentStatus error:', err.message);
    return { success: false, status: 'unknown', message: err.message };
  }
}

/**
 * Vérifie la signature du webhook Flutterwave.
 * À appeler dans la route webhook pour valider l'authenticité.
 */
function verifyWebhookSignature(req) {
  const signature = req.headers['verif-hash'];
  return signature && signature === process.env.FLUTTERWAVE_WEBHOOK_HASH;
}

module.exports = { initiateCardPayment, checkPaymentStatus, verifyWebhookSignature };
