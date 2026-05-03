'use strict';

// ─── Statuts de fidélité ─────────────────────────────────────────────────────
const LOYALTY_STATUSES = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE'];

// ─── Statuts de transaction ──────────────────────────────────────────────────
const TX_STATUSES = ['pending', 'processing', 'completed', 'failed', 'refunded', 'expired'];

// ─── Modes de remise ─────────────────────────────────────────────────────────
const REBATE_MODES = ['cashback', 'immediate'];

// ─── Opérateurs Mobile Money supportés ──────────────────────────────────────
const MM_OPERATORS = ['ORANGE', 'MTN', 'AIRTEL', 'MPESA', 'WAVE', 'MOOV'];

// ─── Devises supportées ──────────────────────────────────────────────────────
const CURRENCIES = ['XOF', 'XAF', 'KES'];

// ─── Zones géographiques ─────────────────────────────────────────────────────
const ZONES = ['UEMOA', 'CEMAC', 'EAST_AFRICA'];

// ─── Durée d'expiration d'une transaction (ms) ───────────────────────────────
const TX_EXPIRY_MS = 2 * 60 * 1000; // 120s avant premier retry opérateur 
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
  MTN: { SUCCESSFUL: 'completed', FAILED: 'failed', REJECTED: 'failed', TIMEOUT: 'failed', EXPIRED: 'failed', PENDING: 'pending' },
  WAVE: { complete: 'completed', error: 'failed', cancelled: 'failed', processing: 'pending', open: 'pending' },
  MOOV: { SUCCESS: 'completed', FAILED: 'failed', CANCELLED: 'failed', PENDING: 'pending', PROCESSING: 'pending' },
  AIRTEL: { TS: 'completed', SUCCESS: 'completed', TF: 'failed', FAILED: 'failed', CANCELLED: 'failed' },
  ORANGE: { SUCCESS: 'completed', SUCCESSFULL: 'completed', '00': 'completed', FAILED: 'failed', CANCELLED: 'failed', EXPIRED: 'failed' },
};

// ─── Table des codes résultat M-Pesa Daraja (STK Push) ───────────────────────
const MPESA_RESULT_CODES = {
  0: 'Paiement réussi',
  1: 'Solde insuffisant',
  17: 'Limite de transfert dépassée',
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

// ─── Tarifs mensuels FCFA (source unique de vérité) ───────────────────────
// STARTER_BOOST = 0 : plan gratuit de base, aucun paiement requis
const PACKAGE_PRICES_FCFA = {
  STARTER_BOOST: 0,
  STARTER_PLUS: 19900,
  GROWTH: 39900,
  PREMIUM: 79900,
};

const PACKAGE_LABELS = {
  STARTER_BOOST: 'Starter Boost',
  STARTER_PLUS: 'Starter Plus',
  GROWTH: 'Growth Intelligent',
  PREMIUM: 'Premium Performance',
};

// Index pour comparer les rangs (upgrade vs downgrade)
const PACKAGE_RANK = { STARTER_BOOST: 0, STARTER_PLUS: 1, GROWTH: 2, PREMIUM: 3 };

// Cycle de facturation
const BILLING_CYCLES = ['monthly', 'annual'];
// Annuel = 11 mois payés (1er mois offert)
const ANNUAL_PAID_MONTHS = 11;
const FALLBACK_PACKAGE = 'STARTER_BOOST';

// Rappels d'expiration (jours avant current_period_end)
const SUBSCRIPTION_REMINDER_DAYS = [10, 7, 3];

// ─── Barème Starter Boost — réduction par recrutement (CDC v3 §2.6) ───────
const STARTER_BOOST_TIERS = [
  { minClients: 100, discountPercent: 50 },
  { minClients: 50, discountPercent: 35 },
  { minClients: 25, discountPercent: 20 },
  { minClients: 10, discountPercent: 10 },
  { minClients: 0, discountPercent: 0 },
];

// ─── Segments RFM (CDC v3 §5.3) ──────────────────────────────────────────
const RFM_SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS'];

// ─── Secteurs marchands pour seuils RFM (CDC v3 §5.2) ────────────────────
const MERCHANT_SECTORS = ['station_service', 'epicerie', 'restaurant', 'beaute', 'mode', 'pharmacie', 'informatique', 'general'];

// ─── Seuils RFM par défaut (CDC v3 §5.2) ────────────────────────────────
const RFM_DEFAULT_THRESHOLDS = {
  recency: { 5: 7, 4: 14, 3: 30, 2: 60, 1: Infinity },
  frequency: { 5: 20, 4: 10, 3: 5, 2: 2, 1: 0 },
  monetary: { 5: 500000, 4: 200000, 3: 100000, 2: 50000, 1: 0 },
};

// ─── Mapping segments RFM (CDC v3 §5.3) ─────────────────────────────────
const RFM_SEGMENT_RULES = [
  { segment: 'CHAMPIONS', minR: 4, minF: 4, minM: 4 },
  { segment: 'FIDELES', minR: 4, minF: 4, minM: 2, maxM: 3 },
  { segment: 'PROMETTEURS', minR: 4, minF: 2, maxF: 3, minM: 4 },
  { segment: 'A_RISQUE', minR: 2, maxR: 3, minF: 4, minM: 4 },
  { segment: 'HIBERNANTS', minR: 2, maxR: 3, minF: 2, maxF: 3 },
  { segment: 'PERDUS', maxR: 2, maxF: 2, maxM: 2 },
];

// ─── Triggers automatiques (CDC v3 §5.4) ────────────────────────────────
const TRIGGER_TYPES = [
  'BIENVENUE', '1ER_ACHAT', 'ABSENCE', 'ALERTE_R',
  'A_RISQUE', 'WIN_BACK', 'ANNIVERSAIRE', 'PALIER',
];

// ─── Protocole d'abandon (CDC v3 §5.5) ──────────────────────────────────
const ABANDON_PROTOCOL_STEPS = [
  { step: 1, delay_days: 0, channel: 'sms', label: 'Win-back 1 — Offre -15% ou points x2', message: 'Bonjour {client_name}, profitez de -15% chez {merchant_name} ! Votre fidélité compte.' },
  { step: 2, delay_days: 14, channel: 'sms', label: 'Win-back 2 — Vous nous manquez', message: 'Vous nous manquez {client_name} ! -20% chez {merchant_name} pour votre retour.' },
  { step: 3, delay_days: 14, channel: 'sms', label: 'Win-back 3 — Dernière chance -30%', message: 'Dernière chance {client_name} ! -30% chez {merchant_name}. Offre limitée.' },
  { step: 4, delay_days: 7, channel: 'sms', label: 'Enquête — Pourquoi êtes-vous parti ?', message: '{client_name}, pourquoi êtes-vous parti ? Répondez pour nous aider à améliorer votre expérience chez {merchant_name}.' },
  { step: 5, delay_days: 30, channel: 'sms', label: 'Classement PERDU définitif', message: null },
];

// ─── Notifications de statut planifiées (CDC v3 §2.4.3) ────────────────
const STATUS_NOTIFICATION_SCHEDULE = [
  { days_before: 90, channels: ['push', 'email'], label: 'Rappel objectif de requalification' },
  { days_before: 30, channels: ['push', 'sms'], label: 'Alerte proximité échéance' },
  { days_before: 7, channels: ['push', 'sms', 'email'], label: 'Dernière chance de requalification' },
  { days_after: 1, channels: ['push', 'email'], label: 'Confirmation nouveau statut' },
];

module.exports = {
  LOYALTY_STATUSES,
  LOYALTY_POINTS_THRESHOLDS,
  POINTS_PER_STATUS_UNIT,
  POINTS_PER_REWARD_UNIT,
  MERCHANT_PACKAGES,
  PACKAGE_PRICES_FCFA,
  PACKAGE_LABELS,
  PACKAGE_RANK,
  BILLING_CYCLES,
  ANNUAL_PAID_MONTHS,
  FALLBACK_PACKAGE,
  SUBSCRIPTION_REMINDER_DAYS,
  STARTER_BOOST_TIERS,
  RFM_SEGMENTS,
  RFM_DEFAULT_THRESHOLDS,
  RFM_SEGMENT_RULES,
  MERCHANT_SECTORS,
  TRIGGER_TYPES,
  ABANDON_PROTOCOL_STEPS,
  STATUS_NOTIFICATION_SCHEDULE,
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
