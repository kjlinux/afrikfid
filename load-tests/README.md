# Tests de charge Afrik'Fid — k6

Conformément au CDC §5.5, les tests de charge vérifient :
- **Disponibilité** : 99.9% uptime
- **Latence P95** : < 2 secondes
- **Latence P99** : < 5 secondes
- **Capacité** : 500 transactions simultanées minimum

## Prérequis

```bash
# Installer k6
# macOS
brew install k6
# Linux
sudo apt install k6
# Windows
choco install k6
```

## Lancer les tests

```bash
# Flux paiement principal (500 VU)
k6 run --env BASE_URL=http://localhost:3000 \
       --env API_KEY_PUBLIC=your_key \
       --env API_KEY_SECRET=your_secret \
       load-tests/payment-flow.js

# Batch fidélité & rapports
k6 run --env BASE_URL=http://localhost:3000 \
       --env ADMIN_TOKEN=your_admin_jwt \
       load-tests/loyalty-batch.js
```

## Résultats

Les rapports JSON sont sauvegardés dans `load-tests/results/`.
