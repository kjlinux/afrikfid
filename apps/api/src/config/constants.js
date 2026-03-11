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
const TX_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes

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

module.exports = {
  LOYALTY_STATUSES,
  TX_STATUSES,
  REBATE_MODES,
  MM_OPERATORS,
  CURRENCIES,
  ZONES,
  TX_EXPIRY_MS,
  PAGINATION,
  JWT,
  MERCHANT_STATUSES,
  KYC_STATUSES,
};
