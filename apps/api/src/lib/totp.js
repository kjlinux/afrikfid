'use strict';

/**
 * 2FA TOTP — RFC 6238 (Time-Based One-Time Password)
 * Compatible avec Google Authenticator, Authy, etc.
 *
 * Dépendance : speakeasy (npm install speakeasy qrcode)
 */

let speakeasy;
let QRCode;
try {
  speakeasy = require('speakeasy');
  QRCode = require('qrcode');
} catch {
  console.warn('[2FA] speakeasy ou qrcode non installé. 2FA désactivé.');
}

const APP_NAME = "Afrik'Fid";

/**
 * Génère un nouveau secret TOTP pour un admin.
 * @returns {{ secret: string, otpauth_url: string }}
 */
function generateTotpSecret(adminEmail) {
  if (!speakeasy) throw new Error('2FA non disponible: installez speakeasy');
  const secret = speakeasy.generateSecret({
    name: `${APP_NAME} (${adminEmail})`,
    length: 32,
  });
  return {
    secret: secret.base32,
    otpauth_url: secret.otpauth_url,
  };
}

/**
 * Génère le QR code PNG en base64 pour l'enrollment 2FA.
 * @param {string} otpauth_url
 * @returns {Promise<string>} dataURL base64
 */
async function generateQrCode(otpauth_url) {
  if (!QRCode) throw new Error('qrcode non disponible');
  return QRCode.toDataURL(otpauth_url);
}

/**
 * Vérifie un token TOTP fourni par l'utilisateur.
 * @param {string} secret — secret base32 de l'admin
 * @param {string} token  — code à 6 chiffres
 * @returns {boolean}
 */
function verifyTotp(secret, token) {
  if (!speakeasy) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token),
    window: 1, // Tolérance ±30s
  });
}

/**
 * Génère des codes de secours (backup codes) pour l'admin.
 * @returns {string[]} 8 codes alphanumériques
 */
function generateBackupCodes() {
  const crypto = require('crypto');
  return Array.from({ length: 8 }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase()
  );
}

module.exports = { generateTotpSecret, generateQrCode, verifyTotp, generateBackupCodes };
