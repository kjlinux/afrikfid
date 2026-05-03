/**
 * Routes Marketplace — Intégration passerelle afrik'fid pour afrikfid-marketplace.
 * Authentification HMAC-SHA256 avec secret partagé (MARKETPLACE_HMAC_SECRET).
 * Ces routes sont appelées server-to-server depuis afrikfid-api (Laravel).
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../lib/db');
const { calculateDistribution, awardPoints } = require('../lib/loyalty-engine');
const mobileMoney = require('../lib/adapters/mobile-money');
const { isOperatorAvailable, recordSuccess, recordFailure } = require('../lib/operator-health');
const { dispatchWebhook, WebhookEvents } = require('../workers/webhook-dispatcher');
const { notifyPaymentConfirmed, notifyCashbackCredit, notifyPaymentFailed } = require('../lib/notifications');
const { TX_EXPIRY_MS } = require('../config/constants');

// ─── Middleware HMAC dédié marketplace ───────────────────────────────────────
// La signature doit être HMAC-SHA256(MARKETPLACE_HMAC_SECRET, timestamp.path.rawBody)
// Headers attendus : X-AfrikFid-Timestamp, X-AfrikFid-Signature, Authorization: Bearer MARKETPLACE_API_KEY
function verifyMarketplaceHmac(req, res, next) {
  const secret = process.env.MARKETPLACE_HMAC_SECRET;
  const apiKey = process.env.MARKETPLACE_API_KEY;

  if (!secret) {
    return res.status(500).json({ error: 'MARKETPLACE_HMAC_SECRET non configuré' });
  }

  // Vérification du bearer token
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (apiKey && token !== apiKey) {
    return res.status(401).json({ error: 'TOKEN_INVALID', message: 'Token marketplace invalide' });
  }

  const ts = req.headers['x-afrikfid-timestamp'];
  const signature = req.headers['x-afrikfid-signature'];

  if (!ts || !signature) {
    return res.status(401).json({ error: 'MISSING_HEADERS', message: 'Headers X-AfrikFid-Timestamp et X-AfrikFid-Signature requis' });
  }

  // Tolérance horloge : 5 minutes
  if (Math.abs(Date.now() - parseInt(ts)) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'TIMESTAMP_EXPIRED', message: 'Timestamp expiré (tolérance 5 min)' });
  }

  const rawBody = req.rawBody || JSON.stringify(req.body) || '';
  const path = req.originalUrl;
  const expected = hash_hmac(secret, `${ts}.${path}.${rawBody}`);

  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return res.status(401).json({ error: 'INVALID_SIGNATURE', message: 'Signature HMAC-SHA256 invalide' });
  }

  next();
}

function hash_hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

// ─── GET /api/v1/marketplace/merchant/:fidelite_marchand_id ──────────────────
// Vérifie qu'un marchand est enregistré dans afrikid et retourne ses infos essentielles.
router.get('/merchant/:fidelite_marchand_id', verifyMarketplaceHmac, async (req, res) => {
  try {
    const { fidelite_marchand_id } = req.params;

    const result = await db.query(
      `SELECT id, name, rebate_percent, package, is_active, country_id, currency, allow_guest_mode
       FROM merchants
       WHERE business_api_marchand_id = $1`,
      [fidelite_marchand_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'MERCHANT_NOT_FOUND', message: 'Marchand non trouvé dans afrikid' });
    }

    const m = result.rows[0];
    res.json({
      merchant_id: m.id,
      rebate_percent: m.rebate_percent,
      package: m.package,
      is_active: m.is_active,
      currency: m.currency,
      country_id: m.country_id,
    });
  } catch (err) {
    console.error('[marketplace/merchant] Erreur:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── POST /api/v1/marketplace/payments/initiate ──────────────────────────────
// Initie un paiement Mobile Money pour la marketplace.
// La résolution du marchand se fait via fidelite_marchand_id (pas via API key).
router.post('/payments/initiate', verifyMarketplaceHmac, async (req, res) => {
  try {
    const {
      amount,
      currency = 'XOF',
      client_identifier,
      payment_method = 'mobile_money',
      payment_operator,
      description,
      idempotency_key,
      fidelite_marchand_id,
      marketplace_commande_id,
      product_category = 'marketplace',
    } = req.body;

    if (!amount || !fidelite_marchand_id || !payment_operator) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'amount, fidelite_marchand_id et payment_operator sont requis' });
    }

    // ── Résolution du marchand ────────────────────────────────────────────────
    const merchantResult = await db.query(
      `SELECT * FROM merchants WHERE business_api_marchand_id = $1 AND is_active = TRUE`,
      [fidelite_marchand_id]
    );
    if (!merchantResult.rows.length) {
      return res.status(404).json({ error: 'MERCHANT_NOT_FOUND', message: `Marchand avec fidelite_marchand_id="${fidelite_marchand_id}" non trouvé ou inactif` });
    }
    const merchant = merchantResult.rows[0];

    // ── Idempotence 24h ────────────────────────────────────────────────────────
    if (idempotency_key) {
      const existing = (await db.query(
        "SELECT * FROM transactions WHERE idempotency_key = $1 AND initiated_at > NOW() - INTERVAL '24 hours'",
        [idempotency_key]
      )).rows[0];
      if (existing) {
        return res.status(200).json({ message: 'Transaction existante', transaction: sanitizeTx(existing) });
      }
    }

    // ── Résolution du client ──────────────────────────────────────────────────
    let client = null;
    if (client_identifier) {
      const { detectIdentifier } = require('../lib/client-identifier');
      const detected = detectIdentifier(client_identifier);

      if (detected.type === 'card' || detected.type === 'afrikfid_legacy') {
        const r = await db.query(
          "SELECT * FROM clients WHERE (afrikfid_id = $1 OR legacy_afrikfid_id = $1) AND is_active = TRUE",
          [detected.normalized]
        );
        client = r.rows[0] || null;
      } else if (detected.type === 'phone') {
        const { hashField } = require('../lib/crypto');
        const r = await db.query(
          "SELECT * FROM clients WHERE phone_hash = $1 AND is_active = TRUE",
          [hashField(detected.normalized)]
        );
        client = r.rows[0] || null;
      }
    }

    const loyaltyStatus = client ? client.loyalty_status : 'OPEN';

    // ── Vérification opérateur ────────────────────────────────────────────────
    if (payment_method === 'mobile_money' && payment_operator) {
      const countryCode = client?.country_id || merchant.country_id;
      if (countryCode) {
        const { getOperatorsForCountry } = mobileMoney;
        const supported = getOperatorsForCountry(countryCode).map(op => op.code);
        if (supported.length > 0 && !supported.includes(payment_operator.toUpperCase())) {
          return res.status(422).json({
            error: 'OPERATOR_NOT_AVAILABLE',
            message: `Opérateur ${payment_operator} non disponible. Opérateurs supportés : ${supported.join(', ')}`,
            supportedOperators: supported,
          });
        }
      }
    }

    // ── Circuit breaker opérateur ─────────────────────────────────────────────
    if (payment_operator && !isOperatorAvailable(payment_operator.toUpperCase())) {
      return res.status(503).json({ error: 'OPERATOR_CIRCUIT_OPEN', message: `Opérateur ${payment_operator} temporairement indisponible` });
    }

    // ── Calcul distribution X/Y/Z ─────────────────────────────────────────────
    const clientCountryId = client?.country_id || merchant.country_id || null;
    const distribution = await calculateDistribution(
      amount, merchant.rebate_percent, loyaltyStatus, clientCountryId, product_category, merchant.id
    );

    // ── Création de la transaction ────────────────────────────────────────────
    const txId = uuidv4();
    const reference = `AFD-MKT-${Date.now()}-${txId.slice(0, 8).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + TX_EXPIRY_MS).toISOString();

    await db.query(`
      INSERT INTO transactions (
        id, reference, merchant_id, client_id,
        gross_amount, net_client_amount,
        merchant_rebate_percent, client_rebate_percent, platform_commission_percent,
        merchant_rebate_amount, client_rebate_amount, platform_commission_amount,
        merchant_receives, client_loyalty_status, rebate_mode,
        payment_method, payment_operator,
        status, currency, description, idempotency_key, expires_at, product_category,
        marketplace_commande_id, source_platform, marketplace_merchant_id,
        is_sandbox
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, 'pending', $18, $19, $20, $21, $22, $23, $24, $25, FALSE
      )
    `, [
      txId, reference, merchant.id, client?.id || null,
      amount, amount - distribution.clientRebateAmount,
      distribution.merchantRebatePercent, distribution.clientRebatePercent, distribution.platformCommissionPercent,
      distribution.merchantRebateAmount, distribution.clientRebateAmount, distribution.platformCommissionAmount,
      distribution.merchantReceives, loyaltyStatus, merchant.rebate_mode || 'standard',
      payment_method, payment_operator.toUpperCase(),
      currency, description || null, idempotency_key || null, expiresAt, product_category,
      marketplace_commande_id || null, 'marketplace', fidelite_marchand_id,
    ]);

    // ── Appel opérateur Mobile Money ──────────────────────────────────────────
    let mmResult = null;
    if (payment_method === 'mobile_money') {
      try {
        mmResult = await mobileMoney.initiatePayment({
          operator: payment_operator.toUpperCase(),
          amount,
          currency,
          phone: client_identifier || null,
          reference,
          description: description || `Commande marketplace ${marketplace_commande_id || ''}`,
        });

        if (mmResult && mmResult.success !== false) {
          recordSuccess(payment_operator.toUpperCase());
        } else {
          recordFailure(payment_operator.toUpperCase());
          await db.query("UPDATE transactions SET status = 'failed' WHERE id = $1", [txId]);
          return res.status(422).json({
            error: 'MM_PAYMENT_FAILED',
            message: mmResult?.message || 'Échec du paiement Mobile Money',
          });
        }
      } catch (mmErr) {
        recordFailure(payment_operator.toUpperCase());
        await db.query("UPDATE transactions SET status = 'failed' WHERE id = $1", [txId]);
        return res.status(503).json({ error: 'MM_ERROR', message: mmErr.message });
      }
    }

    // ── Réponse ────────────────────────────────────────────────────────────────
    res.status(201).json({
      transaction: {
        id: txId,
        reference,
        status: 'pending',
        gross_amount: amount,
        currency,
      },
      distribution: {
        merchantRebatePercent: distribution.merchantRebatePercent,
        clientRebatePercent: distribution.clientRebatePercent,
        platformCommissionPercent: distribution.platformCommissionPercent,
        merchantRebateAmount: distribution.merchantRebateAmount,
        clientRebateAmount: distribution.clientRebateAmount,
        platformCommissionAmount: distribution.platformCommissionAmount,
        merchantReceives: distribution.merchantReceives,
      },
      client: client ? {
        afrikfidId: client.afrikfid_id || client.legacy_afrikfid_id,
        loyaltyStatus: client.loyalty_status,
      } : null,
      payment: {
        operator: payment_operator.toUpperCase(),
        operatorRef: mmResult?.operatorRef || mmResult?.transaction_id || null,
        status: 'pending',
      },
    });

    // ── Post-confirmation asynchrone (pour les opérateurs synchrones) ─────────
    // Certains opérateurs retournent un succès immédiat (ex. sandbox).
    // Dans ce cas, on déclenche les récompenses et webhooks en arrière-plan.
    if (mmResult && mmResult.confirmed === true) {
      setImmediate(() => _postConfirmTransaction(txId, merchant, client, distribution, currency).catch(() => {}));
    }

  } catch (err) {
    console.error('[marketplace/payments/initiate] Erreur:', err.message);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeTx(tx) {
  return {
    id: tx.id,
    reference: tx.reference,
    status: tx.status,
    gross_amount: tx.gross_amount,
    currency: tx.currency,
    marketplace_commande_id: tx.marketplace_commande_id,
  };
}

async function _postConfirmTransaction(txId, merchant, client, distribution, currency) {
  await db.query("UPDATE transactions SET status = 'completed', completed_at = NOW() WHERE id = $1", [txId]);

  if (client) {
    await awardPoints(client.id, merchant.id, distribution.clientRebateAmount, distribution.clientRebatePercent);
    notifyCashbackCredit({ clientId: client.id, amount: distribution.clientRebateAmount, currency }).catch(() => {});
  }

  const webhookPayload = {
    event: WebhookEvents.PAYMENT_COMPLETED,
    transactionId: txId,
    status: 'completed',
    marketplaceCommandeId: null,
  };

  // Récupérer le marketplace_commande_id depuis la DB
  const txRow = (await db.query('SELECT marketplace_commande_id FROM transactions WHERE id = $1', [txId])).rows[0];
  if (txRow) webhookPayload.marketplaceCommandeId = txRow.marketplace_commande_id;

  dispatchWebhook(merchant.id, webhookPayload).catch(() => {});
  notifyPaymentConfirmed({ merchantId: merchant.id, amount: distribution.merchantReceives, currency }).catch(() => {});
}

module.exports = router;
