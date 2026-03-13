/**
 * Afrik'Fid Payment Gateway — Guide d'intégration JavaScript (Node.js)
 * =====================================================================
 * Ce fichier illustre les principales opérations disponibles via l'API.
 *
 * Prérequis :
 *   npm install axios
 *
 * Variables d'environnement :
 *   AFRIKFID_API_URL=https://api.afrikfid.com/api/v1
 *   AFRIKFID_API_KEY=af_pub_<votre_clé_publique>
 */

'use strict';

const axios = require('axios');

const API_URL = process.env.AFRIKFID_API_URL || 'https://api.afrikfid.com/api/v1';
const API_KEY = process.env.AFRIKFID_API_KEY;

// Client HTTP pré-configuré avec la clé API marchand
const client = axios.create({
  baseURL: API_URL,
  headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' },
  timeout: 10000,
});

// ─── 1. Initier un paiement Mobile Money ────────────────────────────────────

async function initiatePayment() {
  try {
    const response = await client.post('/payments/initiate', {
      amount: 50000,               // Montant brut en XOF
      currency: 'XOF',
      client_afrikfid_id: 'AFD-LK9A2F-B3X7', // ID Afrik'Fid du client
      payment_method: 'mobile_money',
      payment_operator: 'ORANGE',  // ORANGE | MTN | AIRTEL | MPESA | WAVE | MOOV
      client_phone: '+22507000001',
      description: 'Achat SuperMarché — Réf. CMD-001',
      idempotency_key: 'cmd-2026-001', // Clé unique par transaction (réessai idempotent)
    });

    const { transaction, distribution, client: clientInfo, payment } = response.data;

    console.log('Transaction créée:', transaction.reference);
    console.log('Statut:', transaction.status);          // pending
    console.log('Distribution:');
    console.log('  Remise marchand (X%):', distribution.merchantRebatePercent, '%');
    console.log('  Remise client (Y%):', distribution.clientRebatePercent, '%');
    console.log('  Commission Afrik\'Fid (Z%):', distribution.platformCommissionPercent, '%');
    console.log('  Statut fidélité client:', clientInfo?.loyaltyStatus);

    return transaction.id;
  } catch (err) {
    console.error('Erreur:', err.response?.data || err.message);
  }
}

// ─── 2. Vérifier le statut d'une transaction ────────────────────────────────

async function checkTransactionStatus(transactionId) {
  try {
    const response = await client.get(`/payments/${transactionId}/status`);
    const { transaction, distributions } = response.data;

    console.log('Statut:', transaction.status); // pending | completed | failed | expired
    console.log('Distributions:', distributions);
    return transaction;
  } catch (err) {
    console.error('Erreur:', err.response?.data || err.message);
  }
}

// ─── 3. Initier un paiement par carte ───────────────────────────────────────

async function initiateCardPayment() {
  try {
    const response = await client.post('/payments/initiate', {
      amount: 100000,
      currency: 'XOF',
      client_afrikfid_id: 'AFD-LK9A2F-B3X7',
      payment_method: 'card',
      description: 'Paiement en ligne',
    });

    const { payment } = response.data;
    console.log('URL de paiement carte:', payment.paymentUrl);
    // Rediriger le client vers payment.paymentUrl pour la saisie carte + 3D Secure
    return payment.paymentUrl;
  } catch (err) {
    console.error('Erreur:', err.response?.data || err.message);
  }
}

// ─── 4. Rembourser une transaction ──────────────────────────────────────────

async function refundTransaction(transactionId) {
  try {
    // Remboursement complet
    const fullRefund = await client.post(`/payments/${transactionId}/refund`, {
      refund_type: 'full',
      reason: 'Annulation commande client',
    });
    console.log('Remboursement complet:', fullRefund.data);

    // Remboursement partiel (recalcul proportionnel X/Y/Z automatique)
    const partialRefund = await client.post(`/payments/${transactionId}/refund`, {
      refund_type: 'partial',
      amount: 25000,               // 50% du montant original
      reason: 'Remboursement partiel — article retourné',
    });
    console.log('Remboursement partiel:', partialRefund.data);
    console.log('Distribution remboursée:', partialRefund.data.distribution);
    /*
      {
        merchantRebateRefunded: 2500,       // X% remboursé proportionnellement
        clientRebateRefunded: 1250,         // Y% annulé du cashback
        platformCommissionRefunded: 1250,   // Z% retourné
      }
    */
  } catch (err) {
    console.error('Erreur:', err.response?.data || err.message);
  }
}

// ─── 5. Créer un lien de paiement ───────────────────────────────────────────

async function createPaymentLink() {
  try {
    const response = await client.post('/payment-links', {
      amount: 75000,
      currency: 'XOF',
      description: 'Abonnement mensuel Premium',
      expires_in_hours: 48,
      max_uses: 1,
    });

    const { paymentLink } = response.data;
    console.log('Lien de paiement:', `https://pay.afrikfid.com/pay/${paymentLink.code}`);
    return paymentLink.code;
  } catch (err) {
    console.error('Erreur:', err.response?.data || err.message);
  }
}

// ─── 6. Identifier un client avant paiement ─────────────────────────────────

async function lookupClient(phone) {
  try {
    const response = await client.post('/clients/lookup', { phone });
    const { client: clientInfo } = response.data;

    console.log('Client trouvé:', clientInfo.fullName);
    console.log('Statut fidélité:', clientInfo.loyaltyStatus); // OPEN | LIVE | GOLD | ROYAL
    console.log('Remise applicable (Y%):', clientInfo.clientRebatePercent, '%');
    console.log('Solde wallet:', clientInfo.walletBalance, clientInfo.currency);
    return clientInfo;
  } catch (err) {
    if (err.response?.status === 404) console.log('Client non trouvé — mode invité appliqué');
    else console.error('Erreur:', err.response?.data || err.message);
  }
}

// ─── 7. Recevoir les webhooks Afrik'Fid ─────────────────────────────────────
//
// Configurez une route sur votre serveur pour recevoir les notifications.
// Chaque webhook est signé HMAC-SHA256 avec votre clé secrète API.
//
// Événements : payment.success | payment.failed | payment.expired
//              refund.completed | distribution.completed | loyalty.status_changed

const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, apiSecret) {
  const expected = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Exemple Express :
// app.post('/webhooks/afrikfid', express.raw({ type: 'application/json' }), (req, res) => {
//   const sig = req.headers['x-afrikfid-signature'];
//   const event = req.headers['x-afrikfid-event'];
//   if (!verifyWebhookSignature(req.body, sig, process.env.AFRIKFID_API_SECRET)) {
//     return res.status(403).send('Signature invalide');
//   }
//   const data = JSON.parse(req.body);
//   switch (event) {
//     case 'payment.success':   handlePaymentSuccess(data); break;
//     case 'refund.completed':  handleRefund(data); break;
//     default: break;
//   }
//   res.status(200).send('OK');
// });

// ─── 8. Vérification de l'état de l'API ─────────────────────────────────────

async function healthCheck() {
  const response = await axios.get(`${API_URL}/health`);
  console.log('API status:', response.data.status);
  console.log('DB latency:', response.data.db.latencyMs, 'ms');
  return response.data;
}

// ─── Exécution exemple ───────────────────────────────────────────────────────

(async () => {
  if (!API_KEY) { console.error('AFRIKFID_API_KEY manquante'); process.exit(1); }
  await healthCheck();
  const txId = await initiatePayment();
  if (txId) await checkTransactionStatus(txId);
})();
