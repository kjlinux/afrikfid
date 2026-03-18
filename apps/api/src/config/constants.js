'use strict';

// ─── Statuts de fidélité ─────────────────────────────────────────────────────
const LOYALTY_STATUSES = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];

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

// ─── Seuils de points statut par niveau (CDC v3 §2.2) ─────────────────────
const LOYALTY_POINTS_THRESHOLDS = {
  OPEN: 0,
  LIVE: 1000,
  GOLD: 5000,
  ROYAL: 15000,
  ROYAL_ELITE: 50000, // OU 3 ans ROYAL consécutifs
};

// ─── Conversion points (CDC v3 §2.3) ─────────────────────────────────────
const POINTS_PER_STATUS_UNIT = 500;   // 1 point statut = 500 FCFA d'achat
const POINTS_PER_REWARD_UNIT = 100;   // 1 point récompense = 100 FCFA

// ─── Packages marchands (CDC v3 §1.4) ─────────────────────────────────────
const MERCHANT_PACKAGES = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM'];

// ─── Barème Starter Boost — réduction par recrutement (CDC v3 §2.6) ───────
const STARTER_BOOST_TIERS = [
  { minClients: 100, discountPercent: 50 },
  { minClients: 50,  discountPercent: 35 },
  { minClients: 25,  discountPercent: 20 },
  { minClients: 10,  discountPercent: 10 },
  { minClients: 0,   discountPercent: 0 },
];

// ─── Segments RFM (CDC v3 §5.3) ──────────────────────────────────────────
const RFM_SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS'];

// ─── Secteurs marchands pour seuils RFM (CDC v3 §5.2) ────────────────────
const MERCHANT_SECTORS = ['station_service', 'epicerie', 'restaurant', 'beaute', 'mode', 'pharmacie', 'informatique', 'general'];

// ─── Seuils RFM par défaut (CDC v3 §5.2) ────────────────────────────────
const RFM_DEFAULT_THRESHOLDS = {
  recency:   { 5: 7, 4: 14, 3: 30, 2: 60, 1: Infinity },
  frequency: { 5: 20, 4: 10, 3: 5, 2: 2, 1: 0 },
  monetary:  { 5: 500000, 4: 200000, 3: 100000, 2: 50000, 1: 0 },
};

// ─── Mapping segments RFM (CDC v3 §5.3) ─────────────────────────────────
const RFM_SEGMENT_RULES = [
  { segment: 'CHAMPIONS',   minR: 4, minF: 4, minM: 4 },
  { segment: 'FIDELES',     minR: 3, minF: 3, minM: 3 },
  { segment: 'PROMETTEURS', minR: 4, minF: 1, minM: 1 },
  { segment: 'A_RISQUE',    minR: 2, minF: 3, minM: 3 },
  { segment: 'HIBERNANTS',  minR: 1, minF: 2, minM: 1 },
  { segment: 'PERDUS',      minR: 1, minF: 1, minM: 1 },
];

// ─── Triggers automatiques (CDC v3 §5.4) ────────────────────────────────
const TRIGGER_TYPES = [
  'BIENVENUE', '1ER_ACHAT', 'ABSENCE', 'ALERTE_R',
  'A_RISQUE', 'WIN_BACK', 'ANNIVERSAIRE', 'PALIER',
];

// ─── Protocole d'abandon (CDC v3 §5.5) ──────────────────────────────────
const ABANDON_PROTOCOL_STEPS = [
  { step: 1, delay_days: 0,  channel: 'sms', label: 'Alerte immédiate' },
  { step: 2, delay_days: 7,  channel: 'sms', label: 'Rappel J+7' },
  { step: 3, delay_days: 15, channel: 'sms', label: 'Offre incentive J+15' },
  { step: 4, delay_days: 30, channel: 'sms', label: 'Dernière chance J+30' },
  { step: 5, delay_days: 60, channel: 'sms', label: 'Classement PERDU J+60' },
];

module.exports = {
  LOYALTY_STATUSES,
  LOYALTY_POINTS_THRESHOLDS,
  POINTS_PER_STATUS_UNIT,
  POINTS_PER_REWARD_UNIT,
  MERCHANT_PACKAGES,
  STARTER_BOOST_TIERS,
  RFM_SEGMENTS,
  RFM_DEFAULT_THRESHOLDS,
  RFM_SEGMENT_RULES,
  MERCHANT_SECTORS,
  TRIGGER_TYPES,
  ABANDON_PROTOCOL_STEPS,
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
