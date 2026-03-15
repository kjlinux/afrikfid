require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { CronJob } = require('cron');
const { runLoyaltyBatch } = require('./lib/loyalty-engine');
const { errorHandler } = require('./middleware/error-handler');
const { runMigrations } = require('./lib/migrations');
const { processRetryQueue, dispatchWebhook, WebhookEvents } = require('./workers/webhook-dispatcher');
const { processExpiredTransactions } = require('./workers/transaction-expiry');
const { processDisbursements } = require('./workers/disbursement');
const { checkOverdueRefunds } = require('./workers/refund-monitor');
const { rotateExpiredApiKeys } = require('./workers/key-rotation');
const { rotateKey, reencryptPendingRecords, isRotationDue } = require('./lib/key-rotation');
const { refreshExchangeRates } = require('./lib/currency');
const { notifyLoyaltyUpgrade } = require('./lib/notifications');
const swaggerUi = require('swagger-ui-express');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// ─── Vérifications de sécurité au démarrage ─────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const defaultSecret = 'afrikfid-jwt-secret-change-in-production';
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === defaultSecret) {
    console.warn('[SECURITY WARNING] JWT_SECRET is using the default development value in production! Set a strong secret in your .env file.');
  }
}

// ─── Migrations au démarrage ────────────────────────────────────────────────
runMigrations().catch(err => { console.error('[FATAL] Migration failed:', err.message); process.exit(1); });

const app = express();
const PORT = process.env.PORT || 4001;

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline requis pour Swagger UI embarqué
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// CORS — liste blanche configurable via CORS_ORIGINS (CSV). '*' uniquement en dev/test.
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: (origin, callback) => {
    // En dev/test sans liste blanche, tout autoriser
    if (!CORS_ORIGINS || CORS_ORIGINS.includes('*')) return callback(null, true);
    // Requêtes sans origin (curl, Postman, serveur-à-serveur) : autoriser
    if (!origin) return callback(null, true);
    if (CORS_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origine non autorisée — ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // X-CSRF-Token exposé pour requêtes cross-origin si nécessaire (CDC §5.4.2 OWASP)
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Sandbox', 'X-CSRF-Token'],
  credentials: true,
}));

// Protection CSRF (CDC §5.4.2 — OWASP Top 10 A01)
// L'API utilise exclusivement JWT Bearer en header Authorization.
// Les navigateurs ne peuvent PAS envoyer des headers Authorization dans des requêtes
// cross-origin sans CORS pré-vol — le CSRF classique est donc impossible sur cette API.
// On renforce avec SameSite=Strict sur tout cookie potentiel et vérification Origin.
app.use((req, res, next) => {
  // Bloquer les requêtes cross-origin avec credentials qui viennent d'une origin non whitelistée
  // (deuxième ligne de défense derrière CORS)
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS && !CORS_ORIGINS.includes('*') && !CORS_ORIGINS.includes(origin)) {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH', message: 'Origine non autorisée' });
    }
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

// Confiance proxy (Nginx/Kubernetes ingress) pour obtenir la vraie IP client 
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

// Rate limiting par IP (CDC §5.4.2 — "rate limiting par IP et par clé API")
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // Explicitement par IP
  message: { error: 'TOO_MANY_REQUESTS', message: 'Trop de requêtes depuis cette adresse. Réessayez dans quelques minutes.' },
});
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/v1/sse')) return next(); // SSE: connexions longues, pas de rate limit
  return limiter(req, res, next);
});

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/sse', require('./routes/sse'));
app.use('/api/v1/webhooks', require('./routes/webhooks'));
app.use('/api/v1/payments', require('./routes/payments'));
app.use('/api/v1/merchants', require('./routes/merchants'));
app.use('/api/v1/clients', require('./routes/clients'));
app.use('/api/v1/loyalty', require('./routes/loyalty'));
app.use('/api/v1/payment-links', require('./routes/payment-links'));
app.use('/api/v1/reports', require('./routes/reports'));
app.use('/api/v1/fraud', require('./routes/fraud'));
app.use('/api/v1/distributions', require('./routes/distributions'));
app.use('/api/v1/disputes', require('./routes/disputes'));
app.use('/api/v1/audit-logs', require('./routes/audit'));

// ─── Health Check ──────────────────────────────────────────────────────────
const _startTime = Date.now();

app.get('/api/v1/health', async (req, res) => {
  const db = require('./lib/db');
  let dbStatus = 'ok';
  let dbLatencyMs = null;

  try {
    const t0 = Date.now();
    const merchantCount = parseInt((await db.query('SELECT COUNT(*) as c FROM merchants')).rows[0].c);
    const clientCount = parseInt((await db.query('SELECT COUNT(*) as c FROM clients')).rows[0].c);
    const txCount = parseInt((await db.query('SELECT COUNT(*) as c FROM transactions')).rows[0].c);
    const pendingWebhooks = parseInt((await db.query("SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('pending','retry')")).rows[0].c);
    dbLatencyMs = Date.now() - t0;

    res.json({
      status: 'ok',
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - _startTime) / 1000),
      sandbox: process.env.SANDBOX_MODE !== 'false',
      db: { status: dbStatus, latencyMs: dbLatencyMs },
      queue: { pendingWebhooks },
      stats: { merchants: merchantCount, clients: clientCount, transactions: txCount },
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      db: { status: 'error', error: err.message },
    });
  }
});

// ─── Swagger UI ────────────────────────────────────────────────────────────
try {
  const openapiSpec = yaml.load(fs.readFileSync(path.join(__dirname, 'docs/openapi.yaml'), 'utf8'));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: "Afrik'Fid API Docs",
    swaggerOptions: { persistAuthorization: true },
  }));
} catch (e) {
  console.warn('[docs] Swagger UI non disponible:', e.message);
}

// ─── Prometheus Metrics (prom-client — CDC §5.5 SLA P95 < 2s) ────────────────
const promClient = require('prom-client');
const promRegistry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: promRegistry, prefix: 'afrikfid_node_' });

// Histogramme de latence HTTP — permet de mesurer P50/P95/P99 
const httpRequestDurationMs = new promClient.Histogram({
  name: 'afrikfid_http_request_duration_ms',
  help: 'Durée des requêtes HTTP en millisecondes',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [50, 100, 200, 500, 1000, 2000, 5000],
  registers: [promRegistry],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'afrikfid_http_requests_total',
  help: 'Nombre total de requêtes HTTP reçues',
  labelNames: ['method', 'route', 'status_code'],
  registers: [promRegistry],
});

const paymentCounter = new promClient.Counter({
  name: 'afrikfid_payments_total',
  help: 'Transactions de paiement par statut',
  labelNames: ['status', 'operator', 'currency'],
  registers: [promRegistry],
});

const webhookQueueDepth = new promClient.Gauge({
  name: 'afrikfid_webhook_queue_depth',
  help: 'Webhooks en attente ou en retry',
  registers: [promRegistry],
});

// Exposer les compteurs de paiement pour les routes
app.set('paymentCounter', paymentCounter);
app.set('webhookQueueDepth', webhookQueueDepth);

// Middleware de mesure de latence (exclut /health et /metrics)
app.use((req, res, next) => {
  if (req.path === '/api/v1/health' || req.path === '/api/v1/metrics') return next();
  const start = Date.now();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const duration = Date.now() - start;
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestDurationMs.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });
  next();
});

app.get('/api/v1/metrics', async (req, res) => {
  const db = require('./lib/db');
  try {
    // Actualiser la jauge des webhooks depuis la BDD
    const wRes = await db.query("SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('pending','retry')");
    webhookQueueDepth.set(parseInt(wRes.rows[0]?.c || 0));
  } catch (_) { /* db not ready */ }

  res.set('Content-Type', promRegistry.contentType);
  res.send(await promRegistry.metrics());
});

// ─── Sandbox: Confirmer un paiement automatiquement ───────────────────────
app.post('/api/v1/sandbox/auto-confirm', async (req, res) => {
  const { transaction_id } = req.body;
  const db = require('./lib/db');
  const { processCompletedPayment } = require('./routes/payments');

  const tx = (await db.query("SELECT * FROM transactions WHERE id = $1 AND status = 'pending'", [transaction_id])).rows[0];
  if (!tx) return res.status(404).json({ error: 'Transaction en attente non trouvée' });

  await processCompletedPayment(tx);
  res.json({ message: 'Transaction confirmée (sandbox)', transactionId: transaction_id });
});

// ─── 404 ───────────────────────────────────────────────────────────────────
app.use('*', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: `Route non trouvée: ${req.method} ${req.originalUrl}` }));

// ─── Error Handler centralisé ──────────────────────────────────────────────
app.use(errorHandler);

// ─── Crons (désactivés en test) ─────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  // Batch fidélité: quotidien à 2h ou hebdomadaire le lundi selon LOYALTY_BATCH_FREQUENCY 
  // Valeurs acceptées: 'daily' (défaut) ou 'weekly' (lundi à 2h)
  const loyaltyBatchFreq = (process.env.LOYALTY_BATCH_FREQUENCY || 'daily').toLowerCase();
  const loyaltyCronExpr = loyaltyBatchFreq === 'weekly' ? '0 2 * * 1' : '0 2 * * *';
  new CronJob(loyaltyCronExpr, async () => {
    console.log('[CRON] Exécution du batch de fidélité...');
    const db = require('./lib/db');
    const results = await runLoyaltyBatch();
    for (const r of results) {
      if (r.changed) {
        const client = (await db.query('SELECT * FROM clients WHERE id = $1', [r.clientId])).rows[0];
        if (client) {
          if (r.newStatus !== 'OPEN') {
            notifyLoyaltyUpgrade({ client, oldStatus: r.currentStatus, newStatus: r.newStatus });
          }
          // Webhook loyalty.status_changed vers tous les marchands actifs du client (CDC §4.5.3)
          const merchantIds = (await db.query(
            `SELECT DISTINCT merchant_id FROM transactions WHERE client_id = $1 AND status = 'completed'`,
            [r.clientId]
          )).rows.map(row => row.merchant_id);
          for (const merchantId of merchantIds) {
            dispatchWebhook(merchantId, WebhookEvents.STATUS_CHANGED, {
              client_id: client.id,
              afrikfid_id: client.afrikfid_id,
              old_status: r.currentStatus,
              new_status: r.newStatus,
              changed_at: new Date().toISOString(),
            }).catch(() => { });
          }
        }
      }
    }
    console.log(`[CRON] Batch terminé: ${results.length} changements de statut`);
  }, null, true, 'Africa/Abidjan');

  // File de retry webhooks: toutes les 2 minutes
  new CronJob('*/2 * * * *', async () => {
    try {
      const count = await processRetryQueue();
      if (count > 0) console.log(`[CRON] Webhooks retry: ${count} traité(s)`);
    } catch (err) {
      console.error('[CRON] processRetryQueue error:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  // Expiration transactions pending: toutes les 30 secondes (CDC §4.1.4)
  new CronJob('*/30 * * * * *', async () => {
    try {
      await processExpiredTransactions();
    } catch (err) {
      console.error('[CRON] processExpiredTransactions error:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  // Rafraîchissement automatique des taux de change: toutes les heures (si fournisseur configuré)
  new CronJob('0 * * * *', async () => {
    try {
      if (process.env.OPENEXCHANGERATES_APP_ID || process.env.FIXER_API_KEY) {
        const result = await refreshExchangeRates();
        if (result.updated > 0) console.log(`[CRON] Taux de change mis à jour (${result.source}): ${result.updated} paires`);
      }
    } catch (err) {
      console.error('[CRON] refreshExchangeRates error:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  // Rotation automatique des clés AES-256-GCM: vérification quotidienne à 03h00 (CDC §5.4.1 — PCI-DSS 90j)
  new CronJob('0 3 * * *', async () => {
    try {
      if (await isRotationDue()) {
        console.log('[CRON] Rotation des clés de chiffrement déclenchée...');
        const { version } = await rotateKey();
        console.log(`[CRON] Clé v${version} activée`);
      }
      // Re-chiffrement progressif des enregistrements avec l'ancienne clé
      const { reencrypted } = await reencryptPendingRecords();
      if (reencrypted > 0) console.log(`[CRON] ${reencrypted} enregistrements re-chiffrés`);
    } catch (err) {
      console.error('[key-rotation] Erreur:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  // Rotation automatique des clés API marchands: quotidien à 03h30 (CDC §5.4.1 — rotation 90j)
  new CronJob('30 3 * * *', async () => {
    try {
      const result = await rotateExpiredApiKeys();
      if (result.rotated > 0) console.log(`[api-key-rotation] ${result.rotated} clé(s) API marchand(s) renouvelée(s)`);
    } catch (err) {
      console.error('[api-key-rotation] Erreur:', err.message);
    }
  }, null, true, 'Africa/Abidjan');

  // Disbursement automatique vers marchands: tous les jours à 06h00 (CDC §settlement_frequency)
  new CronJob('0 6 * * *', async () => {
    console.log('[CRON] Exécution du disbursement automatique...');
    const result = await processDisbursements();
    if (result.processed > 0) {
      console.log(`[CRON] Disbursement terminé: ${result.processed} règlements, total ${result.totalAmount}`);
    }
  }, null, true, 'Africa/Abidjan');

  // Surveillance remboursements en attente > 72h (CDC §4.4 — SLA 72h)
  new CronJob('0 * * * *', async () => {
    try {
      const result = await checkOverdueRefunds();
      if (result.overdue > 0) {
        console.warn(`[REFUND-MONITOR] ${result.overdue} remboursement(s) dépassent le SLA de 72h`);
      }
    } catch (err) {
      console.error('[REFUND-MONITOR] Erreur:', err.message);
    }
  }, null, true, 'Africa/Abidjan');
}

// Ne pas démarrer le serveur HTTP en mode test (Supertest gère ses propres connexions)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n[INFO] Afrik'Fid API démarrée sur http://localhost:${PORT}`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'} | Sandbox: ${process.env.SANDBOX_MODE !== 'false'}`);
    console.log(`   Documentation: http://localhost:${PORT}/api/v1/health\n`);
  });
}

module.exports = app;
