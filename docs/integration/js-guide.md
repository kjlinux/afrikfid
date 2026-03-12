# Guide d'intégration JavaScript / Node.js

## Installation

Aucune dépendance obligatoire — l'API utilise REST/JSON standard.
Pour Node.js, vous pouvez utiliser `fetch` (natif Node 18+) ou `axios`.

```bash
npm install axios  # optionnel
```

## Client HTTP minimal

```javascript
// afrikfid.js
const BASE_URL = process.env.AFRIKFID_BASE_URL || 'https://api.afrikfid.com/api/v1';
const API_KEY  = process.env.AFRIKFID_API_KEY;   // af_pub_xxx
const SANDBOX  = process.env.AFRIKFID_SANDBOX === 'true';

async function afrikfidRequest(method, endpoint, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  };
  if (SANDBOX) headers['X-Sandbox'] = 'true';

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message || data.error), { status: res.status, data });
  return data;
}

module.exports = { afrikfidRequest };
```

## Initier un paiement Mobile Money

```javascript
const { afrikfidRequest } = require('./afrikfid');

async function initierPaiementOrange(montant, telephone, clientTelephone) {
  const result = await afrikfidRequest('POST', '/payments/initiate', {
    amount: montant,
    currency: 'XOF',
    payment_method: 'MOBILE_MONEY',
    payment_phone: telephone,
    payment_operator: 'ORANGE',
    client_phone: clientTelephone,      // pour créditer la fidélité
    idempotency_key: `order_${Date.now()}`, // évite les doublons
  });

  console.log('Référence:', result.transaction.reference);
  console.log('Montant reçu marchand:', result.distribution.merchantReceives);
  console.log('Rebate client:', result.distribution.clientRebateAmount);

  return result.transaction.id;
}
```

## Initier un paiement par carte (CinetPay redirect)

```javascript
async function initierPaiementCarte(montant, clientPhone, description) {
  const result = await afrikfidRequest('POST', '/payments/initiate', {
    amount: montant,
    currency: 'XOF',
    payment_method: 'card',
    payment_phone: clientPhone,
    description,
  });

  // Rediriger le client vers la page 3DS CinetPay
  if (result.paymentUrl) {
    // Dans Express/Node.js:
    // res.redirect(result.paymentUrl);

    // Dans le navigateur:
    // window.location.href = result.paymentUrl;
    console.log('Rediriger vers:', result.paymentUrl);
  }

  return result.transaction;
}
```

## Vérifier le statut

```javascript
async function verifierStatut(transactionId) {
  const result = await afrikfidRequest('GET', `/payments/${transactionId}/status`);

  switch (result.transaction.status) {
    case 'completed':
      console.log('Paiement confirmé! Ref:', result.transaction.reference);
      break;
    case 'pending':
      console.log('En attente de confirmation opérateur...');
      break;
    case 'failed':
      console.log('Paiement échoué.');
      break;
  }

  return result.transaction.status;
}
```

## Webhook Handler (Express.js)

```javascript
const express = require('express');
const crypto  = require('crypto');

const router = express.Router();
const WEBHOOK_SECRET = process.env.AFRIKFID_WEBHOOK_SECRET;

function verifierSignature(payload, signatureHeader) {
  if (!WEBHOOK_SECRET || !signatureHeader) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')}`;
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}

router.post('/webhook/afrikfid', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-afrikfid-signature'];

  if (!verifierSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Signature invalide' });
  }

  const event = JSON.parse(req.body.toString());

  switch (event.eventType) {
    case 'payment.completed':
      console.log('Paiement confirmé:', event.data.reference);
      // Mettre à jour votre commande en base de données
      // crediterCompte(event.data.merchantId, event.data.merchantReceives);
      break;

    case 'payment.failed':
      console.log('Paiement échoué:', event.data.reference, event.data.failureReason);
      break;

    case 'payment.refunded':
      console.log('Remboursement:', event.data.reference);
      break;

    case 'loyalty.status_upgraded':
      console.log('Client monté en statut:', event.data.clientId, event.data.newStatus);
      break;
  }

  // IMPORTANT: toujours répondre 200 rapidement
  res.status(200).json({ received: true });
});

module.exports = router;
```

## Identifier un client avant paiement

```javascript
async function identifierClient(telephone) {
  const result = await afrikfidRequest('POST', '/clients/lookup', { phone: telephone });

  if (result.found) {
    const { afrikfidId, fullName, loyaltyStatus, clientRebatePercent, walletBalance } = result.client;
    console.log(`Client: ${fullName} (${loyaltyStatus}) — Rebate: ${clientRebatePercent}%`);
    return result.client;
  }

  console.log('Client non trouvé, paiement anonyme.');
  return null;
}
```

## Gérer les erreurs

```javascript
async function paiementAvecGestionErreurs(montant, telephone, operateur) {
  try {
    return await afrikfidRequest('POST', '/payments/initiate', {
      amount: montant,
      currency: 'XOF',
      payment_method: 'MOBILE_MONEY',
      payment_phone: telephone,
      payment_operator: operateur,
    });
  } catch (err) {
    switch (err.status) {
      case 400:
        console.error('Données invalides:', err.data.details);
        break;
      case 401:
        console.error('Clé API invalide ou expirée');
        break;
      case 409:
        console.error('Transaction dupliquée (idempotency_key déjà utilisée)');
        break;
      case 422:
        console.error('Échec opérateur:', err.data.operatorError);
        // Proposer un autre opérateur au client
        break;
      case 429:
        console.error('Rate limit atteint, attendre 15 minutes');
        break;
      default:
        console.error('Erreur inattendue:', err.message);
    }
    throw err;
  }
}
```

## Variables d'environnement

```env
AFRIKFID_BASE_URL=https://api.afrikfid.com/api/v1
AFRIKFID_API_KEY=af_pub_votre_cle_production
AFRIKFID_SANDBOX=false
AFRIKFID_WEBHOOK_SECRET=votre_secret_webhook
```
