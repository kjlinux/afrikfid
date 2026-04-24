'use strict';

/**
 * Helpers de synchronisation entre la passerelle et business-api (cartes fidélité).
 *
 * Un client passerelle peut être créé "au vol" lors d'un lookup ou d'un paiement
 * quand le client présente une carte fidélité que nous ne connaissons pas encore
 * localement. La source de vérité des cartes/consommateurs reste business-api.
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { encrypt, hashField } = require('./crypto');

/**
 * Upsert un client local à partir du payload `/info/carte-fidelite/{numero}`.
 * Shape Laravel attendue :
 *   {
 *     numero: "201412345678",
 *     points: number,
 *     reduction: number,
 *     consommateur: { id, nom, prenom, telephone?, whatsapp?, email? }
 *   }
 *
 * @param {object} info
 * @param {string} numeroCarte — 12 chiffres
 * @returns {Promise<object|null>} ligne clients (avec currency jointe) ou null
 */
async function upsertClientFromCarteInfo(info, numeroCarte) {
  const c = (info && info.consommateur) || {};
  const consommateurId = c.id != null ? parseInt(c.id, 10) : null;

  if (consommateurId) {
    const existing = (await db.query(
      `SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id
       WHERE c.business_api_consommateur_id = $1 AND c.is_active = TRUE`,
      [consommateurId]
    )).rows[0];
    if (existing) {
      if (existing.afrikfid_id !== numeroCarte) {
        await db.query(
          `UPDATE clients SET legacy_afrikfid_id = COALESCE(legacy_afrikfid_id, afrikfid_id),
                              afrikfid_id = $1, updated_at = NOW() WHERE id = $2`,
          [numeroCarte, existing.id]
        );
        existing.afrikfid_id = numeroCarte;
      }
      return existing;
    }
  }

  const id = uuidv4();
  const fullName = [c.prenom, c.nom].filter(Boolean).join(' ').trim() || `Carte ${numeroCarte}`;
  const rawPhone = c.telephone || c.whatsapp || null;
  const encPhone = rawPhone ? encrypt(rawPhone) : null;
  const phoneHash = rawPhone ? hashField(rawPhone) : null;
  const encEmail = c.email ? encrypt(c.email) : null;
  const emailHash = c.email ? hashField(c.email) : null;
  // Enrichissement démographique pour les campagnes marchand ciblées.
  // Source : business-api consommateur (sexe, date_naissance, ville).
  const birthDate = c.date_naissance || null;
  const city = c.ville || null;
  const gender = normalizeGender(c.sexe);

  await db.query(
    `INSERT INTO clients (
       id, afrikfid_id, full_name, phone, phone_hash, email, email_hash,
       birth_date, city, gender,
       loyalty_status, is_active, business_api_consommateur_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'OPEN', TRUE, $11, NOW(), NOW())
     ON CONFLICT (afrikfid_id) DO UPDATE SET
       business_api_consommateur_id = EXCLUDED.business_api_consommateur_id,
       birth_date = COALESCE(clients.birth_date, EXCLUDED.birth_date),
       city       = COALESCE(clients.city,       EXCLUDED.city),
       gender     = COALESCE(clients.gender,     EXCLUDED.gender),
       updated_at = NOW()
     RETURNING id`,
    [id, numeroCarte, fullName, encPhone, phoneHash, encEmail, emailHash,
     birthDate, city, gender, consommateurId]
  );

  return (await db.query(
    `SELECT c.*, co.currency FROM clients c LEFT JOIN countries co ON c.country_id = co.id
     WHERE c.afrikfid_id = $1`,
    [numeroCarte]
  )).rows[0];
}

function normalizeGender(raw) {
  if (!raw) return null;
  const v = String(raw).trim().toUpperCase();
  if (v === 'M' || v === 'H' || v === 'HOMME' || v === 'MALE') return 'M';
  if (v === 'F' || v === 'FEMME' || v === 'FEMALE') return 'F';
  return 'X';
}

module.exports = { upsertClientFromCarteInfo, normalizeGender };
