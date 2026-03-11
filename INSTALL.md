# Afrik'Fid Gateway — Guide d'installation serveur

## Prérequis

| Composant | Version minimale |
|-----------|-----------------|
| Node.js   | **v22 ou supérieur** (v24 recommandé — SQLite natif) |
| npm       | v10+ |
| OS        | Linux (Ubuntu 22.04+ / Debian 12+) ou macOS |

> ⚠️ L'API utilise le module **`node:sqlite`** natif (flag `--experimental-sqlite`).
> Ce module n'est disponible qu'à partir de Node.js 22.5+.

---

## Structure du projet

```
afrikfid-gateway/
├── apps/
│   ├── api/        ← Backend Express + SQLite
│   └── web/        ← Frontend React (Vite)
├── INSTALL.md
└── README.md
```

---

## Installation en développement local

### 1. Installer les dépendances

```bash
# Dépendances API
cd apps/api
npm install

# Dépendances Frontend
cd ../web
npm install
```

### 2. Configurer les variables d'environnement

```bash
cd apps/api
cp .env.example .env
```

Éditez `.env` selon vos besoins :

```env
PORT=4001
JWT_SECRET=changez_ce_secret_en_production
JWT_REFRESH_SECRET=changez_ce_refresh_secret_en_production
FRONTEND_URL=http://localhost:5173
```

### 3. Initialiser la base de données (seed)

```bash
cd apps/api
node --experimental-sqlite src/seed.js
```

Cela crée la base SQLite dans `apps/api/data/afrikfid.db` et insère les données de démonstration.

### 4. Démarrer les serveurs

**Terminal 1 — API (port 4001) :**
```bash
cd apps/api
node --experimental-sqlite src/index.js
```

**Terminal 2 — Frontend (port 5173) :**
```bash
cd apps/web
npm run dev
```

Accédez à l'application : **http://localhost:5173**

---

## Installation en production (Linux)

### 1. Installer Node.js 22+

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # doit afficher v22.x ou supérieur
```

### 2. Déployer les fichiers

```bash
# Copier le projet sur le serveur
scp -r afrikfid-gateway/ user@votre-serveur:/opt/afrikfid/

# Sur le serveur
cd /opt/afrikfid/afrikfid-gateway

# Installer les dépendances
cd apps/api && npm install --omit=dev
cd ../web && npm install
```

### 3. Builder le frontend

```bash
cd apps/web
npm run build
# Les fichiers statiques sont dans apps/web/dist/
```

### 4. Configurer la production

Créez `/opt/afrikfid/afrikfid-gateway/apps/api/.env` :

```env
NODE_ENV=production
PORT=4001
JWT_SECRET=VOTRE_SECRET_FORT_ICI_64_CHARS_MIN
JWT_REFRESH_SECRET=VOTRE_REFRESH_SECRET_FORT_ICI_64_CHARS_MIN
FRONTEND_URL=https://votre-domaine.com
```

> 🔐 **Important** : Utilisez des secrets longs et aléatoires en production.
> Générez-les avec : `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### 5. Initialiser la base de données

```bash
cd /opt/afrikfid/afrikfid-gateway/apps/api
node --experimental-sqlite src/seed.js
```

### 6. Configurer un reverse proxy (Nginx)

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    # Frontend (fichiers statiques buildés)
    root /opt/afrikfid/afrikfid-gateway/apps/web/dist;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SPA fallback (React Router)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/afrikfid /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Lancer l'API avec PM2 (process manager)

```bash
npm install -g pm2

# Démarrer l'API
pm2 start "node --experimental-sqlite src/index.js" \
  --name afrikfid-api \
  --cwd /opt/afrikfid/afrikfid-gateway/apps/api

# Démarrer au boot
pm2 startup
pm2 save
```

---

## Comptes de démonstration

Après le seed, les comptes suivants sont disponibles :

### Administrateur
| Champ | Valeur |
|-------|--------|
| Email | `admin@afrikfid.com` |
| Mot de passe | `Admin@2026!` |

### Marchand (démo)
| Champ | Valeur |
|-------|--------|
| Email | `supermarche@demo.af` |
| Mot de passe | `Merchant@2026!` |
| Remise X | 10% (Y=10% client, Z=0% plateforme) |

### Clients fidélité (démo)
| Nom | Statut | Remise |
|-----|--------|--------|
| Kofi Mensah | ROYAL 👑 | 10% |
| Amina Diallo | GOLD 🥇 | 8% |
| Oumar Traoré | LIVE ⭐ | 5% |
| Fatou Camara | OPEN 🔵 | 0% |

---

## Architecture technique

```
Client Browser
      │
      ▼
  Nginx (80/443)
      │
      ├── /* ──────────────→ apps/web/dist/ (React SPA)
      │
      └── /api/* ──────────→ Express API (port 4001)
                                    │
                                    └── SQLite (apps/api/data/afrikfid.db)
```

### Stack
- **Backend** : Node.js + Express.js + SQLite (natif node:sqlite)
- **Frontend** : React 18 + Vite + React Router v6
- **Auth** : JWT (accessToken 15min + refreshToken 7j)
- **Paiement** : Simulateur Mobile Money (Orange, MTN, Wave, Airtel, Moov, M-Pesa)

---

## Réinitialiser les données

Pour repartir de zéro :

```bash
cd apps/api
rm -f data/afrikfid.db data/afrikfid.db-shm data/afrikfid.db-wal
node --experimental-sqlite src/seed.js
```

---

## Support & Développement

- **Langage** : JavaScript (ES Modules côté web, CommonJS côté API)
- **Base de données** : SQLite (fichier unique — facile à sauvegarder)
- **Logs** : Console (stdout/stderr) — intégrez à votre système de logs (PM2 logs, journald…)

---

*Afrik'Fid Gateway © 2026 — Passerelle de paiement Mobile Money avec fidélité intégrée*
