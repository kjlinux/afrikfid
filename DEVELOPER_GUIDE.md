# Guide Développeur — Afrik'Fid Payment Gateway

> **Destinataires :** Équipe de développement et QA du client
> **Version :** 2.0 — Mars 2026
> **Stack :** Node.js 22 · React 18 · PostgreSQL 16 · Redis 7 · Docker · Kubernetes · Prometheus · Grafana

---

## Table des matières

1. [Prérequis](#1-prérequis)
2. [Structure du projet](#2-structure-du-projet)
3. [Configuration des variables d'environnement](#3-configuration-des-variables-denvironnement)
4. [Lancement en développement local (sans Docker)](#4-lancement-en-développement-local-sans-docker)
5. [Lancement avec Docker Compose — Mode Dev](#5-lancement-avec-docker-compose--mode-dev)
6. [Lancement avec Docker Compose — Mode Production](#6-lancement-avec-docker-compose--mode-production)
7. [Monitoring : Prometheus + Grafana](#7-monitoring--prometheus--grafana)
8. [Documentation API : OpenAPI / Swagger UI](#8-documentation-api--openapi--swagger-ui)
9. [Tests unitaires et d'intégration](#9-tests-unitaires-et-dintégration)
10. [Tests de charge (Load Tests)](#10-tests-de-charge-load-tests)
11. [Déploiement Kubernetes](#11-déploiement-kubernetes)
12. [Collection Postman](#12-collection-postman)
13. [Référence des variables d'environnement](#13-référence-des-variables-denvironnement)
14. [Commandes utiles (cheat sheet)](#14-commandes-utiles-cheat-sheet)
15. [Résolution des problèmes courants](#15-résolution-des-problèmes-courants)

---

## 1. Prérequis

### Outils requis

| Outil | Version minimale | Installation |
|-------|-----------------|--------------|
| Node.js | **22.x** | https://nodejs.org (LTS) |
| npm | 10.x | inclus avec Node |
| Docker | 25.x | https://docs.docker.com/get-docker/ |
| Docker Compose | v2.x | inclus avec Docker Desktop |
| Git | 2.x | https://git-scm.com |

### Outils optionnels (recommandés)

| Outil | Usage |
|-------|-------|
| kubectl | Déploiement Kubernetes |
| k3d / minikube | Cluster K8s local |
| Postman | Test des APIs |
| pgAdmin / DBeaver | Inspection PostgreSQL |
| Redis Insight | Inspection Redis |

### Vérification des prérequis

```bash
node --version       # doit afficher v22.x.x
npm --version        # doit afficher 10.x.x
docker --version     # doit afficher 25.x.x
docker compose version  # doit afficher v2.x.x
```

---

## 2. Structure du projet

```
afrikid/
├── apps/
│   ├── api/                    # Backend Node.js Express
│   │   ├── src/
│   │   │   ├── config/         # Constantes + schémas Zod
│   │   │   ├── docs/           # openapi.yaml (spec Swagger)
│   │   │   ├── lib/            # Moteur fidélité, crypto, notifications...
│   │   │   ├── middleware/     # Auth, validation, erreurs
│   │   │   ├── routes/         # Tous les endpoints REST
│   │   │   └── workers/        # Cron jobs (webhooks, disbursements...)
│   │   ├── __tests__/          # Tests Jest + Supertest
│   │   ├── .env.example        # Template variables d'environnement
│   │   └── package.json
│   └── web/                    # Frontend React + Vite
│       ├── src/
│       │   ├── components/     # Design system (ui.jsx)
│       │   └── pages/          # Admin + Merchant + Pay pages
│       └── package.json
├── docs/
│   ├── afrikfid-postman-collection.json   # Collection Postman
│   └── integration/            # Guides d'intégration (JS, PHP, Python)
├── infra/
│   ├── prometheus.yml          # Config Prometheus (Docker)
│   └── grafana/provisioning/   # Datasources + dashboards Grafana
├── k8s/                        # Manifests Kubernetes
│   ├── monitoring/             # Prometheus + Grafana en K8s
│   └── kustomization.yaml
├── load-tests/                 # Scripts de charge (k6/Node)
├── docker-compose.yml          # Stack standard
├── docker-compose.dev.yml      # Stack développement
└── docker-compose.prod.yml     # Stack production complète + monitoring
```

---

## 3. Configuration des variables d'environnement

### 3.1 Copier le template

```bash
cp apps/api/.env.example apps/api/.env
```

### 3.2 Éditer le fichier `.env`

Les variables **obligatoires** pour démarrer :

```env
# Serveur
PORT=4001
NODE_ENV=development

# Base de données PostgreSQL
DATABASE_URL=postgresql://afrikfid:afrikfid_pass@localhost:5432/afrikfid

# Redis
REDIS_URL=redis://localhost:6379

# JWT (changer en production !)
JWT_SECRET=dev-secret-change-me-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-me

# Admin initial
ADMIN_EMAIL=admin@afrikfid.com
ADMIN_PASSWORD=Admin123!

# Chiffrement AES-256 (64 caractères hex en production)
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
HMAC_SECRET=dev-hmac-secret

# Mode sandbox (désactive les vrais appels APIs tiers)
SANDBOX_MODE=true
```

> **Note :** Avec `SANDBOX_MODE=true`, tous les providers de paiement (Orange Money, MTN, CinetPay, etc.) fonctionnent en mode simulé. Idéal pour les tests.

---

## 4. Lancement en développement local (sans Docker)

Nécessite PostgreSQL et Redis installés localement.

### 4.1 Installer les dépendances

```bash
# Backend
cd apps/api
npm install

# Frontend
cd ../web
npm install
```

### 4.2 Démarrer PostgreSQL et Redis

```bash
# Exemple avec Docker pour juste la DB et Redis
docker run -d --name pg-dev \
  -e POSTGRES_DB=afrikfid \
  -e POSTGRES_USER=afrikfid \
  -e POSTGRES_PASSWORD=afrikfid_pass \
  -p 5432:5432 \
  postgres:16-alpine

docker run -d --name redis-dev \
  -p 6379:6379 \
  redis:7-alpine
```

### 4.3 Lancer le backend

```bash
cd apps/api

# Mode développement (hot reload avec nodemon)
npm run dev

# Les migrations s'exécutent automatiquement au démarrage
# L'API écoute sur http://localhost:4001
```

### 4.4 Seeder la base de données (optionnel)

```bash
cd apps/api
npm run seed
# Crée des marchands, clients et transactions de démonstration
```

### 4.5 Lancer le frontend

```bash
cd apps/web
npm run dev
# Interface disponible sur http://localhost:3000
```

### 4.6 URLs en développement local

| Service | URL |
|---------|-----|
| API REST | http://localhost:4001/api/v1 |
| Swagger UI | http://localhost:4001/api-docs |
| Métriques Prometheus | http://localhost:4001/api/v1/metrics |
| Frontend Web | http://localhost:3000 |

---

## 5. Lancement avec Docker Compose — Mode Dev

La méthode la plus simple pour tester l'ensemble de la stack.

### 5.1 Démarrage

```bash
# À la racine du projet
docker compose -f docker-compose.dev.yml up --build

# En arrière-plan
docker compose -f docker-compose.dev.yml up --build -d
```

### 5.2 Vérifier que tout tourne

```bash
docker compose -f docker-compose.dev.yml ps

# Attendu :
# afrikfid-postgres   Up (healthy)
# afrikfid-redis      Up (healthy)
# afrikfid-api        Up (healthy)
# afrikfid-web        Up
```

### 5.3 URLs (mode dev)

| Service | URL | Identifiants |
|---------|-----|--------------|
| API REST | http://localhost:4001/api/v1 | — |
| Swagger UI | http://localhost:4001/api-docs | — |
| Frontend | http://localhost:3000 | — |
| PostgreSQL | localhost:5432 | user: `afrikfid` / pass: `afrikfid_pass` |
| Redis | localhost:6379 | — |

### 5.4 Logs

```bash
# Tous les services
docker compose -f docker-compose.dev.yml logs -f

# Un seul service
docker compose -f docker-compose.dev.yml logs -f api
docker compose -f docker-compose.dev.yml logs -f web
```

### 5.5 Arrêt

```bash
# Arrêter (sans supprimer les volumes)
docker compose -f docker-compose.dev.yml down

# Arrêter ET supprimer les données
docker compose -f docker-compose.dev.yml down -v
```

### 5.6 Réinitialiser la base de données

```bash
# Se connecter au conteneur API
docker compose -f docker-compose.dev.yml exec api sh

# Dans le conteneur :
npm run reset   # Supprime et recrée toutes les tables
npm run seed    # Insère les données de démonstration
exit
```

---

## 6. Lancement avec Docker Compose — Mode Production

Inclut : API + Web + PostgreSQL + Redis + Prometheus + Grafana + Traefik (reverse proxy TLS)

### 6.1 Prérequis production

```bash
# Copier et éditer le .env
cp apps/api/.env.example apps/api/.env
# Remplir TOUTES les variables (voir section 13)

# Variables spécifiques production dans .env :
DOMAIN=votre-domaine.com
ACME_EMAIL=admin@votre-domaine.com
GRAFANA_PASSWORD=motdepasse-grafana-securise
APP_VERSION=1.0.0
NODE_ENV=production
```

### 6.2 Démarrage

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### 6.3 URLs (mode production)

| Service | URL |
|---------|-----|
| API REST | https://api.votre-domaine.com/api/v1 |
| Swagger UI | https://api.votre-domaine.com/api-docs |
| Frontend | https://votre-domaine.com |
| Grafana | https://grafana.votre-domaine.com |
| Prometheus | https://prometheus.votre-domaine.com |
| Traefik Dashboard | https://traefik.votre-domaine.com |

### 6.4 Vérification santé

```bash
# Health check de l'API
curl https://api.votre-domaine.com/api/v1/health

# Réponse attendue :
# {"status":"ok","timestamp":"...","version":"1.0.0","db":"connected","redis":"connected"}
```

---

## 7. Monitoring : Prometheus + Grafana

### 7.1 Accès Grafana (Docker Compose)

Avec `docker-compose.prod.yml` ou en ajoutant le bloc monitoring :

```bash
# Lancer uniquement la stack monitoring
docker compose -f docker-compose.prod.yml up prometheus grafana -d
```

| Paramètre | Valeur |
|-----------|--------|
| URL | http://localhost:3001 |
| Login | `admin` |
| Mot de passe | valeur de `GRAFANA_PASSWORD` dans `.env` (défaut: `afrikfid2024`) |

### 7.2 Dashboard pré-configuré

Le dashboard **"Afrik'Fid Overview"** est provisionné automatiquement avec les panels :

| Panel | Métrique |
|-------|---------|
| Uptime | `process_uptime_seconds` |
| Total requêtes HTTP | `http_requests_total` |
| Transactions complétées | `afrikfid_transactions_completed_total` |
| Transactions échouées | `afrikfid_transactions_failed_total` |
| Volume total (XOF) | `afrikfid_transaction_volume_xof_total` |
| File webhooks | `afrikfid_webhook_queue_depth` |
| Taux de requêtes (req/min) | `rate(http_requests_total[1m])` |
| Taux d'erreurs 5xx | `rate(http_requests_total{status=~"5.."}[1m])` |

### 7.3 Métriques exposées par l'API

L'endpoint `/api/v1/metrics` expose des métriques au format Prometheus :

```bash
curl http://localhost:4001/api/v1/metrics
```

### 7.4 Prometheus (accès direct)

| Paramètre | Valeur |
|-----------|--------|
| URL | http://localhost:9090 |
| Cible principale | `api:4001` (path: `/api/v1/metrics`) |
| Scrape interval | 15s |

---

## 8. Documentation API : OpenAPI / Swagger UI

### 8.1 Accès Swagger UI

```
http://localhost:4001/api-docs
```

L'interface interactive permet de :
- Parcourir tous les endpoints documentés
- Tester les requêtes directement depuis le navigateur
- Voir les schémas de requête/réponse

### 8.2 Schémas d'authentification

| Type | Header | Usage |
|------|--------|-------|
| JWT Bearer | `Authorization: Bearer <token>` | Dashboard admin/marchand |
| API Key | `X-API-Key: af_pub_xxx` | Intégration marchand |
| HMAC | `X-AfrikFid-Signature: sha256=xxx` | Vérification requêtes |

### 8.3 Obtenir un token JWT (admin)

```bash
curl -X POST http://localhost:4001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@afrikfid.com","password":"Admin123!"}'

# Réponse :
# {
#   "token": "eyJ...",
#   "refreshToken": "eyJ...",
#   "user": { "id": 1, "email": "...", "role": "admin" }
# }
```

### 8.4 Obtenir un token marchand

```bash
curl -X POST http://localhost:4001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"merchant@exemple.com","password":"password123"}'
```

### 8.5 Télécharger la spec OpenAPI

```bash
curl http://localhost:4001/api-docs/openapi.yaml -o openapi.yaml
```

### 8.6 Tags API disponibles

| Tag | Description |
|-----|-------------|
| `Auth` | Login, refresh token, logout, 2FA |
| `Payments` | Initier, confirmer, rembourser des paiements |
| `Payment Links` | Créer/gérer des liens de paiement |
| `Merchants` | CRUD marchands, KYC, paramètres |
| `Clients` | CRUD clients, RGPD |
| `Loyalty` | Programme fidélité X/Y/Z |
| `Reports` | Exports CSV/PDF, statistiques |
| `Fraud` | Règles anti-fraude, blacklist |
| `Webhooks` | Événements, retry, historique |
| `System` | Health, métriques, audit logs |

---

## 9. Tests unitaires et d'intégration

### 9.1 Commande principale

```bash
cd apps/api

# Lancer tous les tests
npm test

# Avec couverture de code
npm run test:coverage

# Mode watch (re-run à chaque modification)
npm run test:watch
```

> **Important :** Les tests utilisent une base SQLite **in-memory** (mock automatique). Aucune connexion PostgreSQL ou Redis réelle n'est nécessaire.

### 9.2 Commande complète avec flags Node.js

```bash
cd apps/api
NODE_OPTIONS="--experimental-sqlite --experimental-vm-modules" \
NODE_ENV=test \
npx jest --forceExit --runInBand
```

### 9.3 Variables d'environnement pour les tests

Les tests utilisent automatiquement :
- `NODE_ENV=test` → active le mock SQLite in-memory (`__mocks__/db.js`)
- Base de données créée en mémoire avec seed de données de test
- Pas besoin de `.env` configuré

### 9.4 Lancer un fichier de test spécifique

```bash
# Un seul fichier
npm test -- payments.test.js

# Un répertoire
npm test -- __tests__/routes/

# Avec un pattern
npm test -- --testNamePattern="should create payment"
```

### 9.5 Rapport de couverture

```bash
npm run test:coverage
# Génère : apps/api/coverage/lcov-report/index.html
```

Ouvrir `apps/api/coverage/lcov-report/index.html` dans le navigateur pour voir la couverture détaillée.

### 9.6 Structure des tests

```
apps/api/__tests__/
├── routes/
│   ├── auth.test.js         # Tests login, refresh, 2FA
│   ├── payments.test.js     # Tests paiements, remboursements
│   ├── merchants.test.js    # Tests CRUD marchands, KYC
│   ├── clients.test.js      # Tests clients, RGPD
│   ├── loyalty.test.js      # Tests programme fidélité
│   ├── reports.test.js      # Tests exports
│   ├── fraud.test.js        # Tests règles anti-fraude
│   └── webhooks.test.js     # Tests webhooks
└── lib/
    ├── loyalty-engine.test.js
    ├── currency.test.js
    └── notifications.test.js
```

### 9.7 Tests dans Docker

```bash
# Lancer les tests dans un conteneur isolé
docker compose -f docker-compose.dev.yml run --rm api npm test
```

---

## 10. Tests de charge (Load Tests)

### 10.1 Prérequis

```bash
cd load-tests
npm install  # si package.json présent
```

### 10.2 Scripts disponibles

```
load-tests/
├── payment-flow.js     # Simule des flux de paiement complets
└── loyalty-batch.js    # Teste le moteur fidélité sous charge
```

### 10.3 Lancer les tests de charge

```bash
# S'assurer que l'API tourne (mode dev ou Docker)
# puis :

cd load-tests

# Test flux paiement
node payment-flow.js

# Test batch fidélité
node loyalty-batch.js
```

### 10.4 Paramètres configurables

Éditer les fichiers pour ajuster :
- `BASE_URL` : URL de l'API cible
- Nombre de virtual users (VU)
- Durée du test
- Seuils de performance

---

## 11. Déploiement Kubernetes

### 11.1 Prérequis K8s

```bash
# Vérifier kubectl
kubectl version --client

# Option A : k3d (cluster local léger)
brew install k3d        # macOS
# ou
choco install k3d       # Windows
k3d cluster create afrikfid --ports "80:80@loadbalancer" --ports "443:443@loadbalancer"

# Option B : minikube
minikube start --cpus=4 --memory=8g
```

### 11.2 Créer les secrets

```bash
# Encoder les secrets en base64
echo -n "votre-jwt-secret" | base64
echo -n "postgresql://..." | base64

# Éditer le fichier des secrets
cp k8s/secret.yaml k8s/secret.local.yaml
# Remplir les valeurs encodées dans secret.local.yaml
```

### 11.3 Déploiement complet

```bash
# Créer le namespace
kubectl apply -f k8s/namespace.yaml

# Appliquer tous les manifests
kubectl apply -k k8s/

# OU manuellement dans l'ordre :
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.local.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/api.yaml
kubectl apply -f k8s/web.yaml
kubectl apply -f k8s/ingress.yaml

# Stack monitoring
kubectl apply -f k8s/monitoring/prometheus.yaml
kubectl apply -f k8s/monitoring/grafana.yaml
```

### 11.4 Vérifier le déploiement

```bash
# Status de tous les pods
kubectl get pods -n afrikfid

# Attendu (tous Running) :
# afrikfid-api-xxx       Running
# afrikfid-web-xxx       Running
# afrikfid-postgres-0    Running
# afrikfid-redis-0       Running
# prometheus-xxx         Running
# grafana-xxx            Running

# Logs d'un pod
kubectl logs -n afrikfid -l app=api -f

# Describe un pod en erreur
kubectl describe pod -n afrikfid <pod-name>
```

### 11.5 Auto-scaling (HPA)

```bash
# Voir l'état du HPA
kubectl get hpa -n afrikfid

# Le HPA scale l'API entre 2 et 10 replicas selon :
# - CPU > 70%
# - Mémoire > 80%
```

### 11.6 Accès aux services

```bash
# Port-forward pour accès local
kubectl port-forward -n afrikfid svc/api 4001:4001
kubectl port-forward -n afrikfid svc/grafana 3001:3000
kubectl port-forward -n afrikfid svc/prometheus 9090:9090
```

### 11.7 Mise à jour de l'image

```bash
# Builder et pousser une nouvelle image
docker build -t votre-registry/afrikfid-api:1.1.0 apps/api/
docker push votre-registry/afrikfid-api:1.1.0

# Déployer la mise à jour
kubectl set image deployment/afrikfid-api api=votre-registry/afrikfid-api:1.1.0 -n afrikfid

# Vérifier le rollout
kubectl rollout status deployment/afrikfid-api -n afrikfid
```

### 11.8 Rollback

```bash
kubectl rollout undo deployment/afrikfid-api -n afrikfid
```

---

## 12. Collection Postman

### 12.1 Importer la collection

1. Ouvrir Postman
2. **File → Import**
3. Sélectionner `docs/afrikfid-postman-collection.json`
4. La collection **"Afrik'Fid API"** apparaît dans le panneau gauche

### 12.2 Configurer l'environnement Postman

Créer un environnement avec ces variables :

| Variable | Valeur dev | Description |
|----------|-----------|-------------|
| `base_url` | `http://localhost:4001/api/v1` | URL de base de l'API |
| `admin_token` | *(auto-rempli après login)* | JWT admin |
| `merchant_token` | *(auto-rempli après login)* | JWT marchand |
| `api_key` | `af_sandbox_pub_xxx` | Clé API marchand |

### 12.3 Workflow de test recommandé

1. **Auth → POST Login Admin** → token sauvegardé automatiquement
2. **Merchants → POST Create Merchant** → créer un marchand test
3. **Auth → POST Login Merchant** → token marchand
4. **Payments → POST Initiate Payment** → créer un paiement
5. **Payments → POST Confirm Payment** → confirmer
6. **Loyalty → GET Client Status** → vérifier les points
7. **Reports → GET Transaction Report** → export CSV/PDF

---

## 13. Référence des variables d'environnement

### Obligatoires

```env
PORT=4001
NODE_ENV=development|production|test
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379
JWT_SECRET=<string aléatoire 64+ chars>
JWT_REFRESH_SECRET=<string aléatoire 64+ chars>
ADMIN_EMAIL=admin@exemple.com
ADMIN_PASSWORD=<mot de passe fort>
ENCRYPTION_KEY=<64 chars hex>
HMAC_SECRET=<string aléatoire>
```

### Paiement mobile (sandbox si absent)

```env
SANDBOX_MODE=true|false

# Orange Money
ORANGE_API_KEY=
ORANGE_API_SECRET=
ORANGE_WEBHOOK_SECRET=

# MTN MoMo
MTN_API_USER=
MTN_API_KEY=
MTN_SUBSCRIPTION_KEY=

# M-Pesa
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_PASSKEY=
MPESA_SHORTCODE=

# Airtel Money
AIRTEL_CLIENT_ID=
AIRTEL_CLIENT_SECRET=
AIRTEL_WEBHOOK_SECRET=

# CinetPay (carte bancaire)
CINETPAY_API_KEY=
CINETPAY_SITE_ID=
```

### Notifications

```env
# Africa's Talking (SMS)
AT_API_KEY=
AT_USERNAME=sandbox  # 'sandbox' pour les tests

# Mailgun (Email)
MAILGUN_API_KEY=
MAILGUN_DOMAIN=
MAILGUN_FROM=noreply@exemple.com
ADMIN_ALERT_EMAIL=alerts@exemple.com
```

### Taux de change auto

```env
OPENEXCHANGERATES_APP_ID=   # optionnel
FIXER_API_KEY=               # optionnel (fallback)
```

### Production et monitoring

```env
DOMAIN=api.votre-domaine.com
ACME_EMAIL=admin@votre-domaine.com
GRAFANA_PASSWORD=motdepasse-grafana
APP_VERSION=1.0.0
CORS_ORIGINS=https://votre-domaine.com,https://app.votre-domaine.com
DASHBOARD_URL=https://votre-domaine.com
```

---

## 14. Commandes utiles (cheat sheet)

```bash
# ─── Développement ──────────────────────────────────────────────────────────

# Démarrer la stack de dev complète
docker compose -f docker-compose.dev.yml up --build -d

# Voir les logs en temps réel
docker compose -f docker-compose.dev.yml logs -f api

# Réinitialiser la DB et remettre les données de démo
docker compose -f docker-compose.dev.yml exec api sh -c "npm run reset && npm run seed"

# ─── Tests ──────────────────────────────────────────────────────────────────

# Lancer tous les tests
cd apps/api && npm test

# Tests avec couverture
cd apps/api && npm run test:coverage

# Tests en mode watch
cd apps/api && npm run test:watch

# Test d'un fichier spécifique
cd apps/api && npm test -- payments.test.js

# ─── API ────────────────────────────────────────────────────────────────────

# Health check
curl http://localhost:4001/api/v1/health

# Login admin
curl -X POST http://localhost:4001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@afrikfid.com","password":"Admin123!"}'

# Métriques Prometheus
curl http://localhost:4001/api/v1/metrics

# ─── Docker ─────────────────────────────────────────────────────────────────

# Rebuild une seule image
docker compose -f docker-compose.dev.yml build api

# Shell dans un conteneur
docker compose -f docker-compose.dev.yml exec api sh

# Supprimer tout (images + volumes)
docker compose -f docker-compose.dev.yml down -v --rmi all

# ─── Kubernetes ─────────────────────────────────────────────────────────────

# Status de la stack
kubectl get all -n afrikfid

# Logs API en temps réel
kubectl logs -n afrikfid -l app=api -f

# Port-forward API locale
kubectl port-forward -n afrikfid svc/api 4001:4001

# Scale manuel
kubectl scale deployment afrikfid-api --replicas=3 -n afrikfid
```

---

## 15. Résolution des problèmes courants

### L'API ne démarre pas : "Migration failed"

```bash
# Vérifier la connexion PostgreSQL
docker compose -f docker-compose.dev.yml exec api \
  node -e "const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('SELECT 1').then(()=>console.log('OK')).catch(console.error)"

# Solutions :
# 1. Attendre que PostgreSQL soit healthy (peut prendre 10-15s)
# 2. Vérifier DATABASE_URL dans .env
# 3. Vérifier que le conteneur postgres est bien démarré
```

### Les tests échouent avec "Cannot find module"

```bash
cd apps/api
npm install  # réinstaller les dépendances

# Si l'erreur persiste :
rm -rf node_modules package-lock.json
npm install
```

### Port déjà utilisé

```bash
# Trouver le processus utilisant le port 4001
lsof -i :4001         # macOS/Linux
netstat -ano | findstr :4001  # Windows

# Changer le port dans .env :
PORT=4002
```

### Redis : "Connection refused"

```bash
# Vérifier que Redis tourne
docker ps | grep redis

# Tester la connexion
docker compose -f docker-compose.dev.yml exec api \
  node -e "const r=require('ioredis');const c=new r(process.env.REDIS_URL);c.ping().then(console.log)"
```

### Grafana : "No data"

1. Vérifier que Prometheus scrape bien l'API : http://localhost:9090/targets
2. Vérifier que l'API expose les métriques : `curl http://localhost:4001/api/v1/metrics`
3. Dans Grafana, vérifier la datasource : **Configuration → Data Sources → Prometheus → Test**

### Kubernetes : Pod en CrashLoopBackOff

```bash
# Voir les logs du pod en crash
kubectl logs -n afrikfid <pod-name> --previous

# Vérifier les variables d'environnement
kubectl describe pod -n afrikfid <pod-name>

# Vérifier les secrets
kubectl get secret -n afrikfid afrikfid-secrets -o yaml
```

### Swagger UI inaccessible

```bash
# Vérifier que le fichier openapi.yaml existe
ls apps/api/src/docs/openapi.yaml

# L'UI est montée sur /api-docs (et non /swagger)
curl http://localhost:4001/api-docs
```

---

## Contacts et support

| Rôle | Contact |
|------|---------|
| Documentation complète | `INSTALL.md` à la racine |
| Spec API | `apps/api/src/docs/openapi.yaml` |
| Collection Postman | `docs/afrikfid-postman-collection.json` |
| Guides d'intégration | `docs/integration/` (JS, PHP, Python) |
| Issues & bugs | Système de tickets du projet |

---

*Guide généré le 14 mars 2026 — Afrik'Fid v2.0*
