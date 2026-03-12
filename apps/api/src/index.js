require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { CronJob } = require('cron');
const { runLoyaltyBatch } = require('./lib/loyalty-engine');
const { errorHandler } = require('./middleware/error-handler');
const { runMigrations } = require('./lib/migrations');
const { processRetryQueue } = require('./workers/webhook-dispatcher');
const { notifyLoyaltyUpgrade } = require('./lib/notifications');

// ─── Migrations au démarrage ────────────────────────────────────────────────
runMigrations();

const app = express();
const PORT = process.env.PORT || 4001;

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Sandbox'] }));
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
});
app.use('/api/', limiter);

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/webhooks', require('./routes/webhooks'));
app.use('/api/v1/payments', require('./routes/payments'));
app.use('/api/v1/merchants', require('./routes/merchants'));
app.use('/api/v1/clients', require('./routes/clients'));
app.use('/api/v1/loyalty', require('./routes/loyalty'));
app.use('/api/v1/payment-links', require('./routes/payment-links'));
app.use('/api/v1/reports', require('./routes/reports'));
app.use('/api/v1/fraud', require('./routes/fraud'));

// ─── Health Check ──────────────────────────────────────────────────────────
const _startTime = Date.now();

app.get('/api/v1/health', (req, res) => {
  const db = require('./lib/db');
  let dbStatus = 'ok';
  let dbLatencyMs = null;

  try {
    const t0 = Date.now();
    const merchantCount = db.prepare('SELECT COUNT(*) as c FROM merchants').get().c;
    const clientCount = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
    const txCount = db.prepare('SELECT COUNT(*) as c FROM transactions').get().c;
    const pendingWebhooks = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('pending','retry')").get().c;
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

// ─── Prometheus Metrics ────────────────────────────────────────────────────
// Compteurs en mémoire (remis à zéro au redémarrage du processus)
const _metrics = {
  http_requests_total: 0,
  http_errors_total: 0,
  payment_initiated_total: 0,
  payment_completed_total: 0,
  payment_failed_total: 0,
};

// Middleware de comptage des requêtes
app.use((req, res, next) => {
  _metrics.http_requests_total++;
  res.on('finish', () => { if (res.statusCode >= 500) _metrics.http_errors_total++; });
  next();
});

// Exposer un compteur depuis les routes paiements
app.set('metrics', _metrics);

app.get('/api/v1/metrics', (req, res) => {
  const db = require('./lib/db');
  const uptimeSeconds = Math.floor((Date.now() - _startTime) / 1000);

  let txStats = { completed: 0, failed: 0, pending: 0, total_volume: 0 };
  let pendingWebhooks = 0;
  try {
    txStats = db.prepare(`
      SELECT
        COUNT(CASE WHEN status='completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status='failed'    THEN 1 END) as failed,
        COUNT(CASE WHEN status='pending'   THEN 1 END) as pending,
        COALESCE(SUM(CASE WHEN status='completed' THEN gross_amount ELSE 0 END), 0) as total_volume
      FROM transactions
    `).get();
    pendingWebhooks = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('pending','retry')").get().c;
  } catch (_) { /* db not ready */ }

  const lines = [
    '# HELP afrikfid_uptime_seconds Uptime du processus en secondes',
    '# TYPE afrikfid_uptime_seconds gauge',
    `afrikfid_uptime_seconds ${uptimeSeconds}`,
    '',
    '# HELP afrikfid_http_requests_total Nombre total de requêtes HTTP reçues',
    '# TYPE afrikfid_http_requests_total counter',
    `afrikfid_http_requests_total ${_metrics.http_requests_total}`,
    '',
    '# HELP afrikfid_http_errors_total Nombre de réponses HTTP 5xx',
    '# TYPE afrikfid_http_errors_total counter',
    `afrikfid_http_errors_total ${_metrics.http_errors_total}`,
    '',
    '# HELP afrikfid_transactions_total Transactions par statut',
    '# TYPE afrikfid_transactions_total gauge',
    `afrikfid_transactions_total{status="completed"} ${txStats.completed}`,
    `afrikfid_transactions_total{status="failed"} ${txStats.failed}`,
    `afrikfid_transactions_total{status="pending"} ${txStats.pending}`,
    '',
    '# HELP afrikfid_total_volume_xof Volume total traité (transactions complétées) en XOF',
    '# TYPE afrikfid_total_volume_xof counter',
    `afrikfid_total_volume_xof ${txStats.total_volume}`,
    '',
    '# HELP afrikfid_webhook_queue_depth Webhooks en attente ou en retry',
    '# TYPE afrikfid_webhook_queue_depth gauge',
    `afrikfid_webhook_queue_depth ${pendingWebhooks}`,
    '',
  ];

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n'));
});

// ─── Sandbox: Confirmer un paiement automatiquement ───────────────────────
app.post('/api/v1/sandbox/auto-confirm', async (req, res) => {
  const { transaction_id } = req.body;
  const db = require('./lib/db');
  const { processCompletedPayment } = require('./routes/payments');

  const tx = db.prepare("SELECT * FROM transactions WHERE id = ? AND status = 'pending'").get(transaction_id);
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
  // Batch fidélité: tous les jours à 2h (heure Abidjan)
  new CronJob('0 2 * * *', () => {
    console.log('🔄 Exécution du batch de fidélité...');
    const db = require('./lib/db');
    const results = runLoyaltyBatch();
    for (const r of results) {
      // Notify only on upgrades (not downgrades)
      if (r.changed && r.newStatus !== 'OPEN') {
        const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(r.clientId);
        if (client) notifyLoyaltyUpgrade({ client, oldStatus: r.currentStatus, newStatus: r.newStatus });
      }
    }
    console.log(`✅ Batch terminé: ${results.length} changements de statut`);
  }, null, true, 'Africa/Abidjan');

  // File de retry webhooks: toutes les 2 minutes
  new CronJob('*/2 * * * *', async () => {
    const count = await processRetryQueue();
    if (count > 0) console.log(`🔔 Webhooks retry: ${count} traité(s)`);
  }, null, true, 'Africa/Abidjan');
}

// Ne pas démarrer le serveur HTTP en mode test (Supertest gère ses propres connexions)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n🚀 Afrik'Fid API démarrée sur http://localhost:${PORT}`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'} | Sandbox: ${process.env.SANDBOX_MODE !== 'false'}`);
    console.log(`   Documentation: http://localhost:${PORT}/api/v1/health\n`);
  });
}

module.exports = app;
