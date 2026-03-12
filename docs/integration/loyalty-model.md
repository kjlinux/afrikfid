# Modèle de fidélité X/Y/Z — Afrik'Fid

## Principe

Chaque paiement est réparti entre trois parties selon la formule **X/Y/Z** :

```
Paiement brut (100%) = Rebate marchand (X%) distribué comme suit :
  ├── Y% → Client (cashback ou réduction immédiate)
  ├── Z% → Plateforme Afrik'Fid (commission)
  └── (X - Y - Z)% → Marchand (reste)
```

- **X** = `rebate_percent` configuré par le marchand (ex: 8%)
- **Y** = `client_rebate_percent` selon le statut de fidélité du client
- **Z** = commission fixe plateforme (ex: 2%)

> Le marchand reçoit toujours : `montant_brut - Z%`. Le Y% est prélevé sur X% et crédité au client.

## Statuts de fidélité

| Statut | Y% rebate client | Conditions d'accès | Évaluation |
|--------|------------------|--------------------|------------|
| **OPEN** | 0% | Par défaut (nouveau client) | — |
| **LIVE** | 5% | 3+ achats ET 50 000 XOF cumulés sur 3 mois | Mensuelle |
| **GOLD** | 8% | 10+ achats ET 200 000 XOF cumulés sur 6 mois | Mensuelle |
| **ROYAL** | 10% | 30+ achats ET 1 000 000 XOF cumulés sur 12 mois | Mensuelle |

Un client perd son statut s'il est inactif 12 mois consécutifs.

## Modes de rebate

### Mode `cashback`
Le rebate client est crédité sur son **portefeuille Afrik'Fid**. Il peut l'utiliser lors d'un prochain achat.

```
Client LIVE paie 10 000 XOF chez un marchand X=8%, Z=2%
→ Client reçoit 500 XOF sur son wallet (5% de 10 000)
→ Marchand reçoit 9 800 XOF (10 000 - 2%)
→ Plateforme reçoit 200 XOF (2%)
→ Wallet balance client: +500 XOF
```

### Mode `immediate`
Le rebate est déduit **immédiatement** du montant à payer. Le client paie moins.

```
Client GOLD paie 10 000 XOF chez un marchand X=8%, Z=2%
→ Client paie effectivement 9 200 XOF (10 000 - 8% rebate immédiat)
→ Marchand reçoit 8 560 XOF (9 200 - 2%)
→ Plateforme reçoit 184 XOF
```

## Exemples de calcul

### Client OPEN (pas de fidélité)

| Paramètre | Valeur |
|-----------|--------|
| Montant brut | 10 000 XOF |
| Rebate marchand X | 8% |
| Rebate client Y | 0% (OPEN) |
| Commission Z | 2% |
| **Client paie** | **10 000 XOF** |
| **Marchand reçoit** | **9 800 XOF** |
| **Client cashback** | **0 XOF** |

### Client LIVE (cashback mode)

| Paramètre | Valeur |
|-----------|--------|
| Montant brut | 10 000 XOF |
| Rebate marchand X | 8% |
| Rebate client Y | 5% (LIVE) |
| Commission Z | 2% |
| **Client paie** | **10 000 XOF** |
| **Marchand reçoit** | **9 800 XOF** |
| **Client cashback** | **500 XOF** (crédité sur wallet) |
| **Plateforme** | **200 XOF** |

> Le cashback de 500 XOF est pris sur la marge marchand (8% - 2% plateforme = 6% disponible, dont 5% pour le client).

### Client ROYAL (cashback mode)

| Paramètre | Valeur |
|-----------|--------|
| Montant brut | 50 000 XOF |
| Rebate marchand X | 8% |
| Rebate client Y | 10% → plafonné à X (8%) |
| Commission Z | 2% |
| **Client paie** | **50 000 XOF** |
| **Marchand reçoit** | **49 000 XOF** |
| **Client cashback** | **4 000 XOF** |
| **Plateforme** | **1 000 XOF** |

> Si Y > X, le rebate client est plafonné à X - Z.

## API — Champ `distribution` dans les réponses

```json
{
  "distribution": {
    "grossAmount": 10000,
    "merchantRebatePercent": 8,
    "clientRebatePercent": 5,
    "platformCommissionPercent": 2,
    "merchantRebateAmount": 800,
    "clientRebateAmount": 500,
    "platformCommissionAmount": 200,
    "merchantReceives": 9800,
    "rebateMode": "cashback"
  }
}
```

## Identification du client avant paiement

Pour que le rebate soit correctement calculé, identifiez le client avant d'initier le paiement :

```bash
POST /clients/lookup
{ "phone": "+2250700123456" }

→ { "found": true, "client": { "loyaltyStatus": "LIVE", "clientRebatePercent": 5 } }
```

Puis passez `client_phone` ou `afrikfid_id` dans `/payments/initiate`.

## Batch de réévaluation

Le moteur de fidélité réévalue tous les clients **chaque nuit à 2h00 (heure Abidjan)**. Les marchands peuvent aussi déclencher une réévaluation manuelle :

```bash
POST /loyalty/batch
Authorization: Bearer <admin_token>
```

Lors d'une montée en statut, le client reçoit une notification SMS et un événement webhook `loyalty.status_upgraded` est envoyé à tous les marchands.
