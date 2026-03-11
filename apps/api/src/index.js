require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { CronJob } = require('cron');
const { runLoyaltyBatch } = require('./lib/loyalty-engine');
const { errorHandler } = require('./middleware/error-handler');
const { runMigrations } = require('./lib/migrations');

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
app.use('/api/v1/payments', require('./routes/payments'));
app.use('/api/v1/merchants', require('./routes/merchants'));
app.use('/api/v1/clients', require('./routes/clients'));
app.use('/api/v1/loyalty', require('./routes/loyalty'));
app.use('/api/v1/payment-links', require('./routes/payment-links'));
app.use('/api/v1/reports', require('./routes/reports'));

// ─── Health Check ──────────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  const db = require('./lib/db');
  const merchantCount = db.prepare('SELECT COUNT(*) as c FROM merchants').get().c;
  const clientCount = db.prepare('SELECT COUNT(*) as c FROM clients').get().c;
  const txCount = db.prepare('SELECT COUNT(*) as c FROM transactions').get().c;

  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    sandbox: process.env.SANDBOX_MODE === 'true',
    stats: { merchants: merchantCount, clients: clientCount, transactions: txCount },
  });
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

// ─── Cron: Batch fidélité quotidien (désactivé en test) ─────────────────────
if (process.env.NODE_ENV !== 'test') {
  const loyaltyBatchJob = new CronJob('0 2 * * *', () => {
    console.log('🔄 Exécution du batch de fidélité...');
    const results = runLoyaltyBatch();
    console.log(`✅ Batch terminé: ${results.length} changements de statut`);
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
