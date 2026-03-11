# Afrik'Fid — Passerelle de Paiement B2B Multi-Pays

Plateforme complète développée selon le CDC V2 — Février 2026.

## Architecture

```
afrikfid-gateway/
├── apps/
│   ├── api/          — Backend Node.js/Express + SQLite
│   └── web/          — Frontend React (Panel Admin + Marchand + Page de paiement)
```

## Démarrage rapide

### 1. API Backend
```bash
cd apps/api
cp .env.example .env
npm install
node src/seed.js    # Initialise la DB avec les données démo
npm start           # Démarre sur http://localhost:4001
```

### 2. Frontend
```bash
cd apps/web
npm install
npm run dev         # Démarre sur http://localhost:5173
```

## Comptes démo

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Admin | admin@afrikfid.com | Admin@2026! |
| Marchand 1 | supermarche@demo.af | Merchant@2026! |
| Marchand 2 | pharmacie@demo.af | Merchant@2026! |

## Modèle économique X/Y/Z

```
X% (remise marchand) = Y% (remise client) + Z% (commission Afrik'Fid)
```

| Statut | Remise Y% client |
|--------|-----------------|
| OPEN   | 0%              |
| LIVE   | 5%              |
| GOLD   | 8%              |
| ROYAL  | 10%             |

## API Endpoints principaux

```
POST   /api/v1/payments/initiate          Initier un paiement
GET    /api/v1/payments/:id/status        Statut d'une transaction
POST   /api/v1/payments/:id/refund        Remboursement
POST   /api/v1/payments/:id/confirm       Confirmer (sandbox)

GET    /api/v1/merchants                  Liste marchands (admin)
POST   /api/v1/merchants                  Créer marchand (admin)
GET    /api/v1/merchants/me/stats         Stats marchand connecté

GET    /api/v1/clients/:id/profile        Profil client
GET    /api/v1/clients/:id/wallet         Portefeuille cashback
POST   /api/v1/clients/lookup             Identifier un client

GET    /api/v1/loyalty/config             Config fidélité
POST   /api/v1/loyalty/batch              Batch évaluation statuts

POST   /api/v1/payment-links              Créer lien de paiement
GET    /api/v1/payment-links/:code/info   Info lien (public)
POST   /api/v1/payment-links/:code/pay    Payer via lien

GET    /api/v1/reports/overview           KPIs globaux
GET    /api/v1/reports/daily              Rapport quotidien

GET    /api/v1/health                     Santé de l'API
```

## Opérateurs Mobile Money supportés (sandbox)

- 🟠 Orange Money (CI, SN, BF, ML, NE, CM)
- 🟡 MTN Mobile Money (CI, CM, BF, BJ, CG)
- 🔴 Airtel Money (NE, TD, BF, KE)
- 🦁 M-Pesa Safaricom (KE)
- 🌊 Wave (SN, CI, ML, BF)
- 🟢 Moov Money (CI, BF, BJ, TG, NE)

## Zones géographiques couvertes

- **UEMOA (XOF)**: CI, SN, BF, ML, NE, TG, BJ
- **CEMAC (XAF)**: CM, TD, CG, GA
- **Afrique de l'Est**: Kenya (KES)
