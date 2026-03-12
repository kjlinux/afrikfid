# Référence Webhooks Afrik'Fid

Les webhooks permettent à votre système d'être notifié en temps réel des événements de paiement, sans polling.

## Configuration

Renseignez votre `webhook_url` dans le dashboard marchand ou lors de la création du compte. Afrik'Fid enverra une requête `POST` JSON à cette URL à chaque événement.

**Exigences de votre endpoint :**
- HTTPS obligatoire en production
- Répondre `2xx` dans les **5 secondes**
- Traitement asynchrone recommandé (stocker l'événement en base, traiter en background)

## Événements disponibles

| `eventType` | Déclencheur |
|---|---|
| `payment.completed` | Transaction confirmée par l'opérateur |
| `payment.failed` | Transaction échouée (timeout, fonds insuffisants…) |
| `payment.refunded` | Remboursement total ou partiel traité |
| `loyalty.status_upgraded` | Client monté en statut de fidélité |
| `webhook.test` | Test manuel depuis le dashboard ou `POST /webhooks/test` |

## Structure du payload

```json
{
  "eventType": "payment.completed",
  "eventId": "evt_550e8400-e29b-41d4-a716-446655440000",
  "merchantId": "mrc_...",
  "timestamp": "2026-03-12T10:30:00.000Z",
  "data": {
    "transactionId": "550e8400-e29b-41d4-a716-446655440000",
    "reference": "AFD-1710000000-ABC123",
    "status": "completed",
    "grossAmount": 10000,
    "currency": "XOF",
    "paymentMethod": "MOBILE_MONEY",
    "paymentOperator": "ORANGE",
    "operatorRef": "ORANGE-TX-9876",
    "clientId": "cli_...",
    "clientLoyaltyStatus": "LIVE",
    "merchantRebateAmount": 800,
    "clientRebateAmount": 500,
    "platformCommissionAmount": 200,
    "merchantReceives": 9200,
    "rebateMode": "cashback",
    "completedAt": "2026-03-12T10:30:00.000Z"
  }
}
```

### Payload `payment.failed`

```json
{
  "eventType": "payment.failed",
  "data": {
    "transactionId": "...",
    "reference": "AFD-...",
    "failureReason": "INSUFFICIENT_FUNDS",
    "paymentOperator": "MTN"
  }
}
```

### Payload `loyalty.status_upgraded`

```json
{
  "eventType": "loyalty.status_upgraded",
  "data": {
    "clientId": "cli_...",
    "afrikfidId": "AFD-CLI-000042",
    "phone": "+2250700123456",
    "oldStatus": "LIVE",
    "newStatus": "GOLD",
    "newRebatePercent": 8,
    "upgradedAt": "2026-03-12T02:00:00.000Z"
  }
}
```

## Signature HMAC-SHA256

Chaque requête webhook inclut l'en-tête :

```
X-AfrikFid-Signature: sha256=<hmac_hex>
```

Le HMAC est calculé sur le **corps brut** de la requête (raw bytes) avec votre `WEBHOOK_SECRET`.

### Vérification JavaScript

```javascript
const crypto = require('crypto');

function verifierSignature(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)  // Buffer ou string brut, PAS le JSON parsé
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}
```

### Vérification PHP

```php
function verifierSignature(string $rawBody, string $signatureHeader, string $secret): bool {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $signatureHeader);
}
```

### Vérification Python

```python
import hmac, hashlib

def verifier_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

> **Important :** Utilisez toujours une comparaison en temps constant (`timingSafeEqual` / `hash_equals` / `compare_digest`) pour éviter les attaques par timing.

## Idempotence

Afrik'Fid peut envoyer le même événement plusieurs fois en cas de retry. Utilisez `eventId` pour déduplication :

```javascript
// Exemple Node.js avec base de données
const deja_traite = await db.webhookEvents.findUnique({ where: { eventId: event.eventId } });
if (deja_traite) return res.status(200).json({ received: true });  // ignoré

await db.webhookEvents.create({ data: { eventId: event.eventId, processed: false } });
// ... traitement ...
await db.webhookEvents.update({ where: { eventId: event.eventId }, data: { processed: true } });
```

## Retry automatique

Si votre endpoint répond avec un code non-2xx ou ne répond pas dans les 5 secondes, Afrik'Fid retentera :

| Tentative | Délai après la précédente |
|-----------|--------------------------|
| 2e | 3 minutes |
| 3e | 10 minutes |
| 4e | 30 minutes |

Après 4 tentatives infructueuses, l'événement passe en statut `failed`. Vous pouvez le rejouer manuellement depuis l'interface admin (`POST /webhooks/:id/retry`).

## Tester votre endpoint

### Via le dashboard admin

1. Ouvrir Admin → Webhooks → "Envoyer un test"

### Via l'API

```bash
curl -X POST https://api.afrikfid.com/api/v1/webhooks/test \
  -H "X-API-Key: af_pub_VOTRE_CLE"
```

Votre endpoint recevra un événement `webhook.test` avec un payload fictif.

## Sécurité

- Ne traitez que les événements dont la signature est valide
- Répondez `200` même si vous ne gérez pas l'événement (évite les retries inutiles)
- N'effectuez pas d'opérations critiques (débiter un client, livrer une commande) avant d'avoir vérifié la signature
- Logguez tous les webhooks reçus avec leur `eventId` pour audit
