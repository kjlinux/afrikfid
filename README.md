# Afrik'Fid — Passerelle de Paiement B2B Multi-Pays

Plateforme complète de paiement mobile money et carte bancaire pour l'Afrique francophone et anglophone, développée selon le CDC V2 — Février 2026.

**Stack** : Node.js 22 + Express + PostgreSQL + Redis (backend) · React 18 + Vite (frontend) · Docker Compose (déploiement)

```
afrikid/
├── apps/
│   ├── api/   — Backend Node.js/Express + PostgreSQL
│   └── web/   — Frontend React (Panel Admin + Marchand + Client + Page paiement)
```

---

## Prérequis

| Mode | Outils requis |
|------|--------------|
| **Local** | Node.js 22+, npm 10+, PostgreSQL 16+, Redis 7+ |
| **Docker** | Docker 24+ et Docker Compose v2 (`docker compose` sans tiret) |

---

## Démarrage — Mode Local (sans Docker)

### Étape 1 — Configurer l'environnement

```bash
git clone <url-du-repo>
cd afrikid
cp apps/api/.env.example apps/api/.env
```

Ouvrir `apps/api/.env` et ajuster a minima :
- `DATABASE_URL` → connexion PostgreSQL locale
- `REDIS_URL` → connexion Redis locale (ou laisser par défaut `redis://localhost:6379`)

> En développement, `SANDBOX_MODE=true` est activé par défaut — aucun vrai paiement ne sera effectué.

### Étape 2 — Démarrer PostgreSQL et Redis

**macOS (Homebrew)**
```bash
brew services start postgresql@16
brew services start redis
```

**Ubuntu / Debian**
```bash
sudo systemctl start postgresql redis
```

**Windows** : utiliser les services ou WSL2 avec les commandes Ubuntu ci-dessus.

Créer la base de données si elle n'existe pas encore :
```bash
psql -U postgres -c "CREATE USER afrikfid WITH PASSWORD 'afrikfid_dev';"
psql -U postgres -c "CREATE DATABASE afrikfid OWNER afrikfid;"
```

### Étape 3 — Backend

```bash
cd apps/api
npm install
npm run seed    # Crée les tables et insère les données démo
npm start       # API disponible sur http://localhost:4001
```

Vérifier que l'API répond :
```bash
curl http://localhost:4001/api/v1/health
```

### Étape 4 — Frontend

```bash
cd apps/web
npm install
npm run dev     # Interface disponible sur http://localhost:5173
```

---

## Démarrage — Mode Docker (développement)

Le mode dev expose tous les ports, active le hot-reload et inclut Prometheus + Grafana.

```bash
cp apps/api/.env.example apps/api/.env
docker compose -f docker-compose.dev.yml up --build
```

Le seed est exécuté automatiquement au premier démarrage.

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API | http://localhost:4001 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin) |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

Pour arrêter et supprimer les volumes :
```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## Démarrage — Mode Docker (production)

```bash
cp apps/api/.env.example apps/api/.env
# Éditer .env : voir section "Configuration .env" ci-dessous
docker compose up --build -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost (port 80) |
| API | http://localhost:4001 |

---

## Configuration `.env`

Copier `apps/api/.env.example` vers `apps/api/.env`. Voici les variables par groupe :

### Obligatoires en développement

| Variable | Valeur par défaut | Description |
|----------|-------------------|-------------|
| `PORT` | `4001` | Port de l'API |
| `NODE_ENV` | `development` | Environnement (`development` / `production` / `test`) |
| `DATABASE_URL` | `postgres://afrikfid:afrikfid_dev@localhost:5432/afrikfid` | URL de connexion PostgreSQL |
| `DATABASE_SSL` | `false` | Passer à `true` sur Render, Railway, Supabase |
| `SANDBOX_MODE` | `true` | `true` = aucun vrai paiement déclenché |

### JWT — changer absolument en production

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret de signature des tokens d'accès (min. 64 hex) |
| `JWT_REFRESH_SECRET` | Secret des tokens de rafraîchissement |
| `JWT_EXPIRES_IN` | Durée d'un token d'accès (ex : `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Durée d'un refresh token (ex : `7d`) |

Générer des secrets sécurisés :
```bash
# JWT_SECRET et JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Chiffrement — obligatoire en production

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | Clé AES-256-GCM pour les données sensibles (64 chars hex) |
| `HMAC_SECRET` | Secret pour les hashes recherchables (64 chars hex) |

```bash
# ENCRYPTION_KEY et HMAC_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Admin initial

| Variable | Description |
|----------|-------------|
| `ADMIN_EMAIL` | Email du compte admin créé au premier `npm run seed` |
| `ADMIN_PASSWORD` | Mot de passe admin (changer en prod) |

### Redis (sessions et révocation des tokens)

| Variable | Description |
|----------|-------------|
| `REDIS_URL` | `redis://localhost:6379` (fallback in-memory si absent) |
| `REDIS_PASSWORD` | Mot de passe Redis en production |

### Paiements

| Variable | Description |
|----------|-------------|
| `DEFAULT_PLATFORM_FEE_PERCENT` | Commission Afrik'Fid (défaut : `2`) |
| `CARD_PROVIDER` | `cinetpay` ou `flutterwave` (fallback sandbox si clés absentes) |
| `WEBHOOK_SECRET` | Secret HMAC pour signer les webhooks marchands |

### Notifications (optionnelles — fallback silencieux si absent)

| Groupe | Variables |
|--------|-----------|
| SMS (Africa's Talking) | `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` |
| Email SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Email Mailgun | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM` |

> En développement, `AT_USERNAME=sandbox` envoie les SMS vers la console Africa's Talking sans les délivrer.

### Mobile Money (optionnel — fallback sandbox si clés absentes)

| Opérateur | Variables |
|-----------|-----------|
| Orange Money | `ORANGE_CLIENT_ID`, `ORANGE_CLIENT_SECRET`, `ORANGE_MERCHANT_KEY`, `ORANGE_WEBHOOK_SECRET` |
| MTN MoMo | `MTN_SUBSCRIPTION_KEY`, `MTN_API_USER`, `MTN_API_KEY`, `MTN_BASE_URL`, `MTN_ENVIRONMENT` |
| M-Pesa (Daraja) | `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `PAYMENT_CALLBACK_URL` |
| Airtel Money | `AIRTEL_CLIENT_ID`, `AIRTEL_CLIENT_SECRET`, `AIRTEL_WEBHOOK_SECRET` |
| Wave | `WAVE_API_KEY`, `WAVE_CALLBACK_URL` |
| Moov Money | `MOOV_CLIENT_ID`, `MOOV_CLIENT_SECRET`, `MOOV_CALLBACK_URL` |

### Carte bancaire (optionnel — fallback sandbox si clés absentes)

| Provider | Variables |
|----------|-----------|
| CinetPay | `CINETPAY_SITE_ID`, `CINETPAY_API_KEY`, `CINETPAY_NOTIFY_URL`, `CINETPAY_RETURN_URL` |
| Flutterwave | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_ENCRYPT_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`, `FLUTTERWAVE_NOTIFY_URL`, `FLUTTERWAVE_RETURN_URL` |

### Taux de change automatiques (optionnel)

| Variable | Description |
|----------|-------------|
| `OPENEXCHANGERATES_APP_ID` | Clé Open Exchange Rates (gratuit jusqu'à 1000 req/mois) |
| `FIXER_API_KEY` | Clé Fixer.io (fallback) |

### CORS et alertes (production)

| Variable | Description |
|----------|-------------|
| `CORS_ORIGINS` | CSV des origines autorisées (ex : `https://app.afrikfid.com,https://admin.afrikfid.com`) — laisser vide pour autoriser tout en dev |
| `ADMIN_ALERT_EMAIL` | Email de l'équipe sécurité pour les alertes fraude |
| `DASHBOARD_URL` | URL de l'interface pour les liens dans les emails KYC |

### Docker / Production uniquement

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Domaine de déploiement (ex : `afrikfid.com`) |
| `ACME_EMAIL` | Email pour Let's Encrypt |
| `GRAFANA_PASSWORD` | Mot de passe Grafana (défaut : `afrikfid_grafana`) |
| `APP_VERSION` | Tag des images Docker (ex : `latest` ou `sha-abc1234`) |

---

## Scripts utiles

```bash
# Backend (dans apps/api/)
npm run seed          # Réinitialise la DB et insère les données démo
npm run reset         # Vide la DB sans données démo
npm start             # Démarre l'API (production)
npm run dev           # Démarre avec nodemon (rechargement automatique)
npm test              # Lance les tests Jest
npm run test:coverage # Tests avec rapport de couverture

# Frontend (dans apps/web/)
npm run dev           # Serveur de développement Vite
npm run build         # Build de production
npm run preview       # Prévisualise le build
```

---

## Comptes démo

| Rôle | Email | Mot de passe |
|------|-------|-------------|
| Admin | admin@afrikfid.com | Admin@2026! |
| Marchand 1 | supermarche@demo.af | Merchant@2026! |
| Marchand 2 | pharmacie@demo.af | Merchant@2026! |

---

## Modèle économique X/Y/Z

```
X% (remise marchand) = Y% (remise client) + Z% (commission Afrik'Fid)
```

| Statut fidélité | Remise Y% client |
|-----------------|-----------------|
| OPEN | 0% |
| LIVE | 5% |
| GOLD | 8% |
| ROYAL | 12% |

---

## API Endpoints principaux

```
POST   /api/v1/payments/initiate           Initier un paiement
GET    /api/v1/payments/:id/status         Statut d'une transaction
POST   /api/v1/payments/:id/refund         Remboursement
POST   /api/v1/payments/:id/confirm        Confirmer (sandbox)

GET    /api/v1/merchants                   Liste marchands (admin)
POST   /api/v1/merchants                   Créer marchand (admin)
GET    /api/v1/merchants/me/stats          Stats marchand connecté

GET    /api/v1/clients/:id/profile         Profil client
GET    /api/v1/clients/:id/wallet          Portefeuille cashback
POST   /api/v1/clients/lookup              Identifier un client
DELETE /api/v1/clients/:id                 Anonymiser (RGPD)
GET    /api/v1/clients/:id/export          Export données (RGPD)

GET    /api/v1/loyalty/config              Config fidélité
POST   /api/v1/loyalty/batch              Batch évaluation statuts

POST   /api/v1/payment-links              Créer lien de paiement
GET    /api/v1/payment-links/:code/info   Info lien (public)
POST   /api/v1/payment-links/:code/pay   Payer via lien

GET    /api/v1/reports/overview           KPIs globaux
GET    /api/v1/reports/daily              Rapport quotidien
GET    /api/v1/reports/transactions/pdf   Export PDF transactions

POST   /api/v1/auth/login                 Connexion admin/marchand
POST   /api/v1/auth/client/login          Connexion client (téléphone)
POST   /api/v1/auth/refresh               Rafraîchir le token
POST   /api/v1/auth/logout                Révoquer le token
POST   /api/v1/auth/2fa/setup             Configurer 2FA (admin)
POST   /api/v1/auth/2fa/verify            Vérifier code TOTP

GET    /api/v1/audit-logs                 Journal d'audit (admin)
GET    /api/v1/health                     Santé de l'API
```

---

## Opérateurs Mobile Money supportés

| Opérateur | Pays |
|-----------|------|
| Orange Money | CI, SN, BF, ML, NE, CM |
| MTN Mobile Money | CI, CM, BF, BJ, CG |
| Airtel Money | NE, TD, BF, KE |
| M-Pesa Safaricom | KE |
| Wave | SN, CI, ML, BF |
| Moov Money | CI, BF, BJ, TG, NE |

> Sans clés API configurées, tous les opérateurs basculent automatiquement en mode sandbox.

## Zones géographiques couvertes

- **UEMOA (XOF)** : CI, SN, BF, ML, NE, TG, BJ
- **CEMAC (XAF)** : CM, TD, CG, GA
- **Afrique de l'Est** : Kenya (KES)
