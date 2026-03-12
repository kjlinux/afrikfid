# Guide de démarrage rapide — Afrik'Fid API

Intégrez votre première transaction en 5 minutes.

## Prérequis

- Un compte marchand activé (demandez via `/merchants/register` ou contactez support@afrikfid.com)
- Vos clés API (disponibles dans votre dashboard)
- cURL ou un outil HTTP (Postman, Insomnia…)

## 1. Récupérer vos clés API

Connectez-vous à votre dashboard marchand et copiez :

| Clé | Usage | Préfixe |
|-----|-------|---------|
| **Clé production** | Paiements réels | `af_pub_xxx` |
| **Clé sandbox** | Tests sans argent réel | `af_sandbox_pub_xxx` |

> **Conseil :** Commencez toujours en sandbox. Ajoutez l'en-tête `X-Sandbox: true` + utilisez la clé sandbox.

## 2. Premier paiement sandbox

```bash
curl -X POST https://api.afrikfid.com/api/v1/payments/initiate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: af_sandbox_pub_VOTRE_CLE" \
  -H "X-Sandbox: true" \
  -d '{
    "amount": 10000,
    "currency": "XOF",
    "payment_method": "MOBILE_MONEY",
    "payment_phone": "+2250700123456",
    "payment_operator": "ORANGE",
    "client_phone": "+2250700123456",
    "description": "Commande #1001"
  }'
```

**Réponse :**
```json
{
  "transaction": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "reference": "AFD-1710000000-ABC123",
    "status": "pending",
    "grossAmount": 10000,
    "currency": "XOF",
    "clientRebateAmount": 0,
    "merchantReceives": 9800
  },
  "distribution": {
    "grossAmount": 10000,
    "merchantRebatePercent": 8,
    "clientRebatePercent": 0,
    "platformCommissionPercent": 2,
    "merchantReceives": 9800
  },
  "message": "Paiement Mobile Money initié. OTP envoyé au client."
}
```

## 3. Confirmer le paiement (sandbox uniquement)

En sandbox, l'opérateur ne confirme pas automatiquement. Utilisez :

```bash
curl -X POST https://api.afrikfid.com/api/v1/sandbox/auto-confirm \
  -H "Content-Type: application/json" \
  -d '{ "transaction_id": "550e8400-e29b-41d4-a716-446655440000" }'
```

Ou confirmez via l'API paiements :

```bash
curl -X POST https://api.afrikfid.com/api/v1/payments/550e8400.../confirm \
  -H "X-API-Key: af_sandbox_pub_VOTRE_CLE" \
  -H "X-Sandbox: true"
```

## 4. Vérifier le statut

```bash
curl https://api.afrikfid.com/api/v1/payments/550e8400.../status \
  -H "X-API-Key: af_sandbox_pub_VOTRE_CLE" \
  -H "X-Sandbox: true"
```

**Réponse :**
```json
{
  "transaction": {
    "status": "completed",
    "completedAt": "2026-03-12T10:30:00.000Z"
  },
  "distributions": [
    { "beneficiaryType": "merchant", "amount": 9800 },
    { "beneficiaryType": "platform", "amount": 200 }
  ]
}
```

## 5. Recevoir les notifications webhook

Configurez votre `webhook_url` dans le dashboard. Afrik'Fid enverra :

```json
POST https://votre-site.com/webhook/afrikfid
X-AfrikFid-Signature: sha256=abc123...

{
  "eventType": "payment.completed",
  "merchantId": "...",
  "data": {
    "transactionId": "...",
    "reference": "AFD-1710000000-ABC123",
    "amount": 10000,
    "currency": "XOF",
    "status": "completed"
  }
}
```

Vérifiez toujours la signature HMAC-SHA256. Voir [webhooks.md](./webhooks.md) pour les détails.

## Étapes suivantes

- [Guide JavaScript/Node.js](./js-guide.md)
- [Guide PHP](./php-guide.md)
- [Guide Python](./python-guide.md)
- [Référence Webhooks](./webhooks.md)
- [Modèle de fidélité X/Y/Z](./loyalty-model.md)
- [Documentation API complète](http://localhost:4001/api/docs)
