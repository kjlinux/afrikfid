'use strict';

// ─── Statuts de fidélité ─────────────────────────────────────────────────────
const LOYALTY_STATUSES = ['OPEN', 'LIVE', 'GOLD', 'ROYAL'];

// ─── Statuts de transaction ──────────────────────────────────────────────────
const TX_STATUSES = ['pending', 'completed', 'failed', 'refunded', 'expired'];

// ─── Modes de remise ─────────────────────────────────────────────────────────
const REBATE_MODES = ['cashback', 'immediate'];

// ─── Opérateurs Mobile Money supportés ──────────────────────────────────────
const MM_OPERATORS = ['ORANGE', 'MTN', 'AIRTEL', 'MPESA', 'WAVE', 'MOOV'];

// ─── Devises supportées ──────────────────────────────────────────────────────
const CURRENCIES = ['XOF', 'XAF', 'KES'];

// ─── Zones géographiques ─────────────────────────────────────────────────────
const ZONES = ['UEMOA', 'CEMAC', 'EAST_AFRICA'];

// ─── Durée d'expiration d'une transaction (ms) ───────────────────────────────
const TX_EXPIRY_MS = 2 * 60 * 1000; // 120s avant premier retry opérateur (CDC §4.1.4)
const TX_RETRY_WINDOW_MS = 10 * 60 * 1000; // 10min de fenêtre de retry opérateur
const TX_RETRY_INTERVAL_MS = 30 * 1000;    // polling opérateur toutes les 30s

// ─── Limites de pagination ───────────────────────────────────────────────────
const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

// ─── JWT ─────────────────────────────────────────────────────────────────────
const JWT = {
  ACCESS_EXPIRY: '15m',
  REFRESH_EXPIRY: '7d',
};

// ─── Statuts KYC / Marchands ─────────────────────────────────────────────────
const MERCHANT_STATUSES = ['pending', 'active', 'suspended', 'rejected'];
const KYC_STATUSES = ['pending', 'submitted', 'approved', 'rejected'];

// ─── Mapping statuts opérateurs Mobile Money → statuts internes ──────────────
const MM_STATUS_MAPS = {
  MTN:    { SUCCESSFUL: 'completed', FAILED: 'failed', REJECTED: 'failed', TIMEOUT: 'failed', EXPIRED: 'failed', PENDING: 'pending' },
  WAVE:   { complete: 'completed', error: 'failed', cancelled: 'failed', processing: 'pending', open: 'pending' },
  MOOV:   { SUCCESS: 'completed', FAILED: 'failed', CANCELLED: 'failed', PENDING: 'pending', PROCESSING: 'pending' },
  AIRTEL: { TS: 'completed', SUCCESS: 'completed', TF: 'failed', FAILED: 'failed', CANCELLED: 'failed' },
  ORANGE: { SUCCESS: 'completed', SUCCESSFULL: 'completed', '00': 'completed', FAILED: 'failed', CANCELLED: 'failed', EXPIRED: 'failed' },
};

// ─── Table des codes résultat M-Pesa Daraja (STK Push) ───────────────────────
const MPESA_RESULT_CODES = {
  0:    'Paiement réussi',
  1:    'Solde insuffisant',
  17:   'Limite de transfert dépassée',
  1001: 'Numéro de bénéficiaire invalide',
  1032: 'Transaction annulée par l\'utilisateur',
  1037: 'Timeout — aucune réponse de l\'utilisateur',
  2001: 'Numéro initiant invalide',
};

module.exports = {
  LOYALTY_STATUSES,
  TX_STATUSES,
  REBATE_MODES,
  MM_OPERATORS,
  CURRENCIES,
  ZONES,
  TX_EXPIRY_MS,
  TX_RETRY_WINDOW_MS,
  TX_RETRY_INTERVAL_MS,
  PAGINATION,
  JWT,
  MERCHANT_STATUSES,
  KYC_STATUSES,
  MM_STATUS_MAPS,
  MPESA_RESULT_CODES,
};
