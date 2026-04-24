'use strict';

/**
 * Détection automatique du type d'identifiant client saisi à l'achat.
 *
 * Trois formats acceptés sur un champ unique côté page de paiement :
 *   - Carte de fidélité : 12 chiffres, préfixe "2014" (source de vérité : business-api.carte_fidelites.numero).
 *     Depuis la migration 031, clients.afrikfid_id est aligné sur ce même format.
 *   - AfrikFid ID legacy : format AFD-XXXX-XXXX conservé dans clients.legacy_afrikfid_id pour la transition.
 *   - Numéro de téléphone : E.164 (+22501020304) ou local (0102030405) — normalisation déléguée à l'appelant.
 */

const CARD_REGEX = /^2014\d{8}$/;
const LEGACY_AFRIKFID_REGEX = /^AFD-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

/**
 * @param {string} raw — valeur saisie par l'utilisateur
 * @returns {{ type: 'card' | 'afrikfid_legacy' | 'phone' | 'unknown', normalized: string }}
 */
function detectIdentifier(raw) {
  if (raw == null) return { type: 'unknown', normalized: '' };
  const trimmed = String(raw).trim();
  if (!trimmed) return { type: 'unknown', normalized: '' };

  // Carte fidélité : on retire les espaces éventuels saisis par le client ("2014 1234 5678")
  const digitsOnly = trimmed.replace(/\s+/g, '');
  if (CARD_REGEX.test(digitsOnly)) {
    return { type: 'card', normalized: digitsOnly };
  }

  if (LEGACY_AFRIKFID_REGEX.test(trimmed)) {
    return { type: 'afrikfid_legacy', normalized: trimmed.toUpperCase() };
  }

  if (E164_REGEX.test(digitsOnly)) {
    return { type: 'phone', normalized: digitsOnly };
  }

  // Téléphone local (7-15 chiffres sans préfixe international) — laissé à l'appelant pour normalisation E.164.
  if (/^\d{7,15}$/.test(digitsOnly)) {
    return { type: 'phone', normalized: digitsOnly };
  }

  return { type: 'unknown', normalized: trimmed };
}

module.exports = { detectIdentifier, CARD_REGEX, LEGACY_AFRIKFID_REGEX };
