'use strict';

/**
 * Notifications dédiées au cycle de vie des abonnements marchands.
 *
 * Canaux :
 *  - Email   : via lib/notifications.sendEmail (Mailgun/SMTP)
 *  - SMS     : via lib/adapters/lafricamobile.sendSMS
 *  - WhatsApp: via lib/adapters/lafricamobile.sendWhatsApp
 */

const { sendEmail } = require('./notifications');
const lam = require('./adapters/lafricamobile');
const { PACKAGE_LABELS, FALLBACK_PACKAGE } = require('../config/constants');

function fmtDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function packageLabel(pkg) {
  return PACKAGE_LABELS[pkg] || pkg;
}

/**
 * Rappel d'expiration (J-10 / J-7 / J-3).
 * Les trois canaux sont fire-and-forget : un échec n'empêche pas les autres.
 */
async function sendReminder(merchant, sub, daysLeft) {
  const expiresOn = fmtDate(sub.current_period_end);
  const pkg = packageLabel(sub.package);
  const subject = `Votre abonnement ${pkg} expire dans ${daysLeft} jours`;
  const text =
    `Bonjour ${merchant.name || ''},\n\n` +
    `Votre abonnement ${pkg} expire le ${expiresOn} (dans ${daysLeft} jours).\n` +
    `Renouvelez-le dans votre espace marchand pour continuer à profiter des fonctionnalités avancées.\n\n` +
    `Sans renouvellement, votre compte sera automatiquement basculé sur ${packageLabel(FALLBACK_PACKAGE)} le jour J.\n\n` +
    `— Afrik'Fid`;
  const html =
    `<p>Bonjour ${merchant.name || ''},</p>` +
    `<p>Votre abonnement <b>${pkg}</b> expire le <b>${expiresOn}</b> (dans ${daysLeft} jours).</p>` +
    `<p>Renouvelez-le dans votre <a href="${process.env.PUBLIC_WEB_URL || 'https://app.afrikfid.com'}/merchant/subscription">espace marchand</a> ` +
    `pour conserver vos fonctionnalités avancées.</p>` +
    `<p>Sans renouvellement, votre compte sera automatiquement basculé sur <b>${packageLabel(FALLBACK_PACKAGE)}</b> le jour J.</p>` +
    `<p>— Afrik'Fid</p>`;

  const results = await Promise.allSettled([
    merchant.email ? sendEmail(merchant.email, subject, text, html) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendWhatsApp(merchant.phone, text) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendSMS(merchant.phone, `Afrik'Fid : votre abonnement ${pkg} expire le ${expiresOn}. Renouvelez sur app.afrikfid.com.`) : Promise.resolve({ status: 'skipped' }),
  ]);
  return { email: results[0], whatsapp: results[1], sms: results[2] };
}

/**
 * Notification envoyée le jour J de l'expiration : downgrade automatique en STARTER_BOOST.
 */
async function sendExpired(merchant, sub) {
  const pkg = packageLabel(sub.package);
  const subject = `Votre abonnement ${pkg} a expiré — bascule sur ${packageLabel(FALLBACK_PACKAGE)}`;
  const text =
    `Bonjour ${merchant.name || ''},\n\n` +
    `Votre abonnement ${pkg} est arrivé à échéance et n'a pas été renouvelé.\n` +
    `Vous êtes désormais sur le plan ${packageLabel(FALLBACK_PACKAGE)}.\n\n` +
    `Vous pouvez réactiver un plan supérieur à tout moment depuis votre espace marchand.\n\n` +
    `— Afrik'Fid`;
  const html =
    `<p>Bonjour ${merchant.name || ''},</p>` +
    `<p>Votre abonnement <b>${pkg}</b> est arrivé à échéance et n'a pas été renouvelé.</p>` +
    `<p>Vous êtes désormais sur le plan <b>${packageLabel(FALLBACK_PACKAGE)}</b>.</p>` +
    `<p><a href="${process.env.PUBLIC_WEB_URL || 'https://app.afrikfid.com'}/merchant/subscription">Réactivez un plan supérieur</a> à tout moment.</p>`;

  const results = await Promise.allSettled([
    merchant.email ? sendEmail(merchant.email, subject, text, html) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendWhatsApp(merchant.phone, text) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendSMS(merchant.phone, `Afrik'Fid : votre abonnement ${pkg} a expiré, vous êtes sur ${packageLabel(FALLBACK_PACKAGE)}.`) : Promise.resolve({ status: 'skipped' }),
  ]);
  return { email: results[0], whatsapp: results[1], sms: results[2] };
}

/**
 * Reçu de paiement (upgrade / renouvellement / avance).
 */
async function sendReceipt(merchant, payment) {
  const subject = `Paiement reçu — ${Number(payment.effective_amount).toLocaleString('fr-FR')} FCFA`;
  const text =
    `Bonjour ${merchant.name || ''},\n\n` +
    `Nous avons bien reçu votre paiement de ${Number(payment.effective_amount).toLocaleString('fr-FR')} FCFA ` +
    `pour le plan ${packageLabel(payment.package)} (${payment.billing_cycle === 'annual' ? 'annuel' : 'mensuel'}).\n` +
    `Merci de votre confiance.\n\n— Afrik'Fid`;
  const html = `<p>${text.replace(/\n/g, '<br/>')}</p>`;

  const results = await Promise.allSettled([
    merchant.email ? sendEmail(merchant.email, subject, text, html) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendWhatsApp(merchant.phone, text) : Promise.resolve({ status: 'skipped' }),
  ]);
  return { email: results[0], whatsapp: results[1] };
}

module.exports = { sendReminder, sendExpired, sendReceipt };
