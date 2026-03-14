'use strict';

const { z } = require('zod');
const { LOYALTY_STATUSES, REBATE_MODES, MM_OPERATORS, CURRENCIES, MERCHANT_STATUSES, KYC_STATUSES } = require('./constants');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const positiveAmount = z.number({ required_error: 'amount requis', invalid_type_error: 'amount doit être un nombre' })
  .positive('Le montant doit être positif');

const phoneNumber = z.string().min(8, 'Numéro trop court').max(20, 'Numéro trop long')
  .regex(/^\+?[\d\s\-()]+$/, 'Format de numéro invalide');

const email = z.string().email('Email invalide');

const uuid = z.string().uuid('UUID invalide');

// ─── Paiements ───────────────────────────────────────────────────────────────

const InitiatePaymentSchema = z.object({
  amount: positiveAmount,
  currency: z.enum(CURRENCIES).default('XOF'),
  client_phone: phoneNumber.optional(),
  client_afrikfid_id: z.string().optional(),
  payment_method: z.enum(['mobile_money', 'card', 'payment_link'], { errorMap: () => ({ message: "payment_method doit être 'mobile_money', 'card' ou 'payment_link'" }) }),
  payment_operator: z.enum(MM_OPERATORS).optional(),
  description: z.string().max(255).optional(),
  idempotency_key: z.string().max(100).optional(),
  product_category: z.string().max(100).optional(),
}).refine(
  data => data.client_phone || data.client_afrikfid_id || true, // client optionnel (mode invité)
  { message: 'client_phone ou client_afrikfid_id recommandé' }
);

const RefundSchema = z.object({
  amount: positiveAmount.optional(),
  reason: z.string().max(500).optional(),
  refund_type: z.enum(['full', 'partial']).default('full'),
});

// ─── Marchands ───────────────────────────────────────────────────────────────

const CreateMerchantSchema = z.object({
  name: z.string().min(2, 'Nom trop court').max(100),
  email: email,
  phone: phoneNumber.optional(),
  country_id: z.string().length(2, 'country_id doit être un code ISO 2 lettres').optional(),
  category: z.string().max(50).default('general'),
  rebate_percent: z.number().min(0, 'rebate_percent minimum 0').max(30, 'rebate_percent maximum 30'),
  rebate_mode: z.enum(REBATE_MODES).default('cashback'),
  business_registration: z.string().max(100).optional(),
  address: z.string().max(255).optional(),
  website: z.string().url('URL invalide').optional().or(z.literal('')),
  mm_operator: z.enum(MM_OPERATORS).optional(),
  mm_phone: phoneNumber.optional(),
  bank_name: z.string().max(100).optional(),
  bank_account: z.string().max(50).optional(),
  webhook_url: z.string().url('URL webhook invalide').optional().or(z.literal('')),
  settlement_frequency: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  password: z.string().min(8, 'Mot de passe minimum 8 caractères').optional(),
});

const UpdateMerchantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: phoneNumber.optional(),
  rebate_percent: z.number().min(0).max(30).optional(),
  rebate_mode: z.enum(REBATE_MODES).optional(),
  status: z.enum(MERCHANT_STATUSES).optional(),
  kyc_status: z.enum(KYC_STATUSES).optional(),
  webhook_url: z.string().url().optional().or(z.literal('')),
  settlement_frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  mm_operator: z.enum(MM_OPERATORS).optional(),
  mm_phone: phoneNumber.optional(),
  bank_name: z.string().max(100).optional(),
  bank_account: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  address: z.string().max(255).optional(),
  max_transaction_amount: z.number().positive().nullable().optional(),
  daily_volume_limit: z.number().positive().nullable().optional(),
  allow_guest_mode: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'Au moins un champ à mettre à jour' });

const MerchantLoginSchema = z.object({
  email: email,
  password: z.string().min(1, 'Mot de passe requis'),
});

// ─── Clients ─────────────────────────────────────────────────────────────────

const CreateClientSchema = z.object({
  full_name: z.string().min(2, 'Nom trop court').max(100),
  phone: phoneNumber,
  email: email.optional(),
  country_id: z.string().length(2).optional(),
  password: z.string().min(8).optional(),
});

const UpdateLoyaltyStatusSchema = z.object({
  status: z.enum(LOYALTY_STATUSES, { required_error: `Statut invalide. Valeurs: ${LOYALTY_STATUSES.join(', ')}` }),
});

const LookupClientSchema = z.object({
  phone: phoneNumber.optional(),
  afrikfid_id: z.string().optional(),
}).refine(data => data.phone || data.afrikfid_id, { message: 'phone ou afrikfid_id requis' });

// ─── Auth ─────────────────────────────────────────────────────────────────────

const AdminLoginSchema = z.object({
  email: email,
  password: z.string().min(1, 'Mot de passe requis'),
});

// ─── Liens de paiement ───────────────────────────────────────────────────────

const CreatePaymentLinkSchema = z.object({
  amount: positiveAmount.optional(),
  currency: z.enum(CURRENCIES).default('XOF'),
  description: z.string().max(255).optional(),
  expires_in_hours: z.number().int().min(1).max(720).default(24),
  max_uses: z.number().int().min(1).max(1000).default(1),
});

// ─── Fidélité ─────────────────────────────────────────────────────────────────

const UpdateLoyaltyConfigSchema = z.object({
  client_rebate_percent: z.number().min(0).max(30),
  min_purchases: z.number().int().min(0),
  min_cumulative_amount: z.number().min(0),
  evaluation_months: z.number().int().min(1).max(24),
  inactivity_months: z.number().int().min(1).max(36),
  label: z.string().max(50).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur hex invalide').optional(),
});

const WalletPaySchema = z.object({
  merchant_id: z.string().min(1, 'merchant_id requis'),
  amount: positiveAmount,
  currency: z.enum(CURRENCIES).default('XOF'),
  description: z.string().max(255).optional(),
  idempotency_key: z.string().max(100).optional(),
});

module.exports = {
  WalletPaySchema,
  InitiatePaymentSchema,
  RefundSchema,
  CreateMerchantSchema,
  UpdateMerchantSchema,
  MerchantLoginSchema,
  CreateClientSchema,
  UpdateLoyaltyStatusSchema,
  LookupClientSchema,
  AdminLoginSchema,
  CreatePaymentLinkSchema,
  UpdateLoyaltyConfigSchema,
};
