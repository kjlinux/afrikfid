'use strict';

/**
 * Vérifie la présence des variables d'environnement des opérateurs de paiement.
 * Appelé au démarrage de l'application (hors mode test).
 * Ne bloque jamais le démarrage — affiche uniquement des warnings/errors.
 */
function checkOperatorCredentials() {
  if (process.env.NODE_ENV === 'test') return;

  const isProduction = process.env.NODE_ENV === 'production';
  const log = isProduction ? console.warn : console.info;

  const checks = [
    // Opérateurs Mobile Money
    { name: 'Orange Money', vars: ['ORANGE_CLIENT_ID', 'ORANGE_CLIENT_SECRET', 'ORANGE_MERCHANT_KEY'] },
    { name: 'Orange Webhook', vars: ['ORANGE_WEBHOOK_SECRET'], security: true },
    { name: 'MTN MoMo', vars: ['MTN_SUBSCRIPTION_KEY', 'MTN_API_USER', 'MTN_API_KEY'] },
    { name: 'MTN Callback', vars: ['MTN_CALLBACK_API_KEY'], security: true },
    { name: 'M-Pesa Daraja', vars: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY'] },
    { name: 'M-Pesa Webhook', vars: ['MPESA_WEBHOOK_SECRET'], security: true },
    { name: 'Airtel Money', vars: ['AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET'] },
    { name: 'Airtel Webhook', vars: ['AIRTEL_WEBHOOK_SECRET'], security: true },
    { name: 'Wave', vars: ['WAVE_API_KEY'] },
    { name: 'Moov Money', vars: ['MOOV_CLIENT_ID', 'MOOV_CLIENT_SECRET'] },
    // Paiement par carte
    { name: 'CinetPay', vars: ['CINETPAY_SITE_ID', 'CINETPAY_API_KEY'] },
    { name: 'CinetPay Webhook', vars: ['CINETPAY_SECRET_KEY'], security: true },
    { name: 'Flutterwave', vars: ['FLUTTERWAVE_SECRET_KEY'] },
    { name: 'Flutterwave Webhook', vars: ['FLUTTERWAVE_WEBHOOK_HASH'], security: true },
  ];

  let configured = 0;
  let missing = 0;

  for (const check of checks) {
    const missingVars = check.vars.filter(v => !process.env[v]);
    if (missingVars.length === 0) {
      configured++;
      continue;
    }

    missing++;
    const mode = check.vars.length === missingVars.length ? 'sandbox actif' : 'partiel';
    const level = check.security && isProduction ? console.error : log;
    level(`[operator-health] ${check.name}: ${missingVars.join(', ')} manquant(s) — ${mode}`);
  }

  if (isProduction) {
    console.info(`[operator-health] ${configured}/${checks.length} opérateurs/secrets configurés`);
  }
}

module.exports = { checkOperatorCredentials };
