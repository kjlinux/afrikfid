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

// ─── Helpers design ───────────────────────────────────────────────────────────

const DASHBOARD_URL  = () => process.env.DASHBOARD_URL  || '#';
const SUPPORT_EMAIL  = () => process.env.SUPPORT_EMAIL  || 'support@afrikfid.com';
const LOGO_URL       = () => process.env.LOGO_URL       || '';
const PUBLIC_WEB_URL = () => process.env.PUBLIC_WEB_URL || process.env.DASHBOARD_URL || 'https://app.afrikfid.com';

function baseLayout(content, title = '') {
  const logo = LOGO_URL()
    ? `<img src="${LOGO_URL()}" alt="Afrik'Fid" height="38" style="display:block;margin:0 auto;border:0;">`
    : `<span style="font-size:26px;font-weight:900;color:#1F2937;letter-spacing:-0.5px;font-family:'Helvetica Neue',Arial,sans-serif;">Afrik<span style="color:#E30613;">'Fid</span></span>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || "Afrik'Fid"}</title>
</head>
<body style="margin:0;padding:0;background:#F5F7FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FA;min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:#FFFFFF;text-align:center;padding:24px 32px;border-bottom:3px solid #E30613;border-radius:8px 8px 0 0;">
              ${logo}
              ${title ? `<p style="color:#6B7280;font-size:12px;margin:8px 0 0;letter-spacing:0.8px;text-transform:uppercase;font-weight:500;">${title}</p>` : ''}
            </td>
          </tr>
        </table>

        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:36px 40px;">
              ${content}
            </td>
          </tr>
        </table>

        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin-top:24px;">
          <tr>
            <td style="text-align:center;color:#9CA3AF;font-size:12px;padding:0 16px 32px;line-height:2;">
              &copy; ${new Date().getFullYear()} Afrik'Fid &mdash; Passerelle de Paiement Africaine<br>
              <a href="${DASHBOARD_URL()}" style="color:#6B7280;text-decoration:none;border-bottom:1px solid #D1D5DB;">Tableau de bord</a>
              &nbsp;&middot;&nbsp;
              <a href="mailto:${SUPPORT_EMAIL()}" style="color:#6B7280;text-decoration:none;border-bottom:1px solid #D1D5DB;">${SUPPORT_EMAIL()}</a>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

function statBox(label, value, color = '#E30613') {
  return `<div style="background:${color}0D;border-left:4px solid ${color};border-radius:0 6px 6px 0;padding:16px 20px;margin:16px 0;">
    <div style="color:#6B7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;font-weight:600;">${label}</div>
    <div style="color:${color};font-size:26px;font-weight:700;line-height:1.2;">${value}</div>
  </div>`;
}

function ctaButton(label, url, color = '#E30613') {
  return `<div style="text-align:center;margin:28px 0 8px;">
    <a href="${url}" style="display:inline-block;background:${color};color:#FFFFFF;font-weight:600;padding:14px 36px;border-radius:6px;text-decoration:none;font-size:15px;letter-spacing:0.3px;font-family:'Helvetica Neue',Arial,sans-serif;">${label}</a>
  </div>`;
}

function alertBanner(text, color = '#DC2626') {
  return `<div style="background:${color}0D;border-left:4px solid ${color};border-radius:0 6px 6px 0;padding:14px 18px;color:#1F2937;font-size:14px;margin:0 0 20px;line-height:1.6;">
    ${text}
  </div>`;
}

function infoTable(rows) {
  const rowsHtml = rows.map(([label, value], i) =>
    `<tr style="background:${i % 2 === 0 ? '#FFFFFF' : '#F9FAFB'};">
      <td style="color:#6B7280;font-size:13px;padding:10px 12px;width:42%;vertical-align:top;border-bottom:1px solid #F3F4F6;font-weight:500;">${label}</td>
      <td style="color:#1F2937;font-size:13px;padding:10px 12px;font-weight:500;border-bottom:1px solid #F3F4F6;">${value}</td>
    </tr>`
  ).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:6px;overflow:hidden;margin:16px 0;">
    ${rowsHtml}
  </table>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #E5E7EB;margin:28px 0;">`;
}

function bodyText(text, color = '#374151') {
  return `<p style="color:${color};font-size:15px;line-height:1.7;margin:12px 0;">${text}</p>`;
}

function sectionTitle(text, color = '#1F2937') {
  return `<h2 style="color:${color};font-size:22px;font-weight:700;margin:0 0 4px;line-height:1.3;font-family:'Helvetica Neue',Arial,sans-serif;">${text}</h2>`;
}

function badge(label, color) {
  return `<span style="display:inline-block;background:${color}15;color:${color};border:1px solid ${color}40;border-radius:20px;padding:3px 12px;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">${label}</span>`;
}

// ─── Fonctions de notification ────────────────────────────────────────────────

/**
 * Rappel d'expiration (J-10 / J-7 / J-3).
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

  const html = baseLayout(`
    ${alertBanner(`Votre abonnement <strong>${pkg}</strong> expire le <strong>${expiresOn}</strong> — dans <strong>${daysLeft} jours</strong>.`, '#D97706')}
    ${sectionTitle('Renouvellement requis')}
    ${bodyText(`Bonjour <strong style="color:#1F2937;">${merchant.name || ''}</strong>, votre abonnement arrive bientôt à échéance.`)}
    ${infoTable([
      ['Plan actuel', badge(pkg, '#D97706')],
      ["Date d'expiration", expiresOn],
      ['Jours restants', `${daysLeft} jours`],
    ])}
    ${divider()}
    ${bodyText(`Sans renouvellement avant cette date, votre compte sera automatiquement basculé sur le plan <strong style="color:#1F2937;">${packageLabel(FALLBACK_PACKAGE)}</strong>, entraînant la perte des fonctionnalités avancées.`)}
    ${ctaButton('Renouveler mon abonnement', `${PUBLIC_WEB_URL()}/merchant/subscription`, '#D97706')}
  `, 'Abonnement — Expiration proche');

  const smsText = `Afrik'Fid : votre abonnement ${pkg} expire le ${expiresOn}. Renouvelez sur ${PUBLIC_WEB_URL()}/merchant/subscription`;

  const results = await Promise.allSettled([
    merchant.email ? sendEmail(merchant.email, subject, text, html) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendWhatsApp(merchant.phone, text) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendSMS(merchant.phone, smsText) : Promise.resolve({ status: 'skipped' }),
  ]);
  return { email: results[0], whatsapp: results[1], sms: results[2] };
}

/**
 * Notification envoyée le jour J de l'expiration.
 */
async function sendExpired(merchant, sub) {
  const pkg = packageLabel(sub.package);
  const subject = `Votre abonnement ${pkg} a expiré`;

  const text =
    `Bonjour ${merchant.name || ''},\n\n` +
    `Votre abonnement ${pkg} est arrivé à échéance et n'a pas été renouvelé.\n` +
    `Vous êtes désormais sur le plan ${packageLabel(FALLBACK_PACKAGE)}.\n\n` +
    `Vous pouvez réactiver un plan supérieur à tout moment depuis votre espace marchand.\n\n` +
    `— Afrik'Fid`;

  const html = baseLayout(`
    ${alertBanner(`Votre abonnement <strong>${pkg}</strong> est arrivé à échéance et n'a pas été renouvelé.`, '#DC2626')}
    ${sectionTitle('Abonnement expiré')}
    ${bodyText(`Bonjour <strong style="color:#1F2937;">${merchant.name || ''}</strong>, votre accès aux fonctionnalités avancées a été suspendu.`)}
    ${infoTable([
      ['Plan précédent', badge(pkg, '#DC2626')],
      ['Plan actuel', badge(packageLabel(FALLBACK_PACKAGE), '#6B7280')],
      ["Date d'expiration", new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })],
    ])}
    ${divider()}
    ${bodyText('Vous pouvez réactiver un plan supérieur à tout moment pour récupérer l\'intégralité de vos fonctionnalités.')}
    ${ctaButton('Se réabonner maintenant', `${PUBLIC_WEB_URL()}/merchant/subscription`)}
  `, 'Abonnement expiré');

  const smsText = `Afrik'Fid : votre abonnement ${pkg} a expiré, vous êtes sur ${packageLabel(FALLBACK_PACKAGE)}.`;

  const results = await Promise.allSettled([
    merchant.email ? sendEmail(merchant.email, subject, text, html) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendWhatsApp(merchant.phone, text) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendSMS(merchant.phone, smsText) : Promise.resolve({ status: 'skipped' }),
  ]);
  return { email: results[0], whatsapp: results[1], sms: results[2] };
}

/**
 * Reçu de paiement (upgrade / renouvellement / avance).
 */
async function sendReceipt(merchant, payment) {
  const montant = Number(payment.effective_amount).toLocaleString('fr-FR');
  const pkg = packageLabel(payment.package);
  const cycle = payment.billing_cycle === 'annual' ? 'annuel' : 'mensuel';
  const subject = `Confirmation de paiement — ${montant} FCFA`;

  const text =
    `Bonjour ${merchant.name || ''},\n\n` +
    `Nous avons bien reçu votre paiement de ${montant} FCFA ` +
    `pour le plan ${pkg} (${cycle}).\n` +
    `Merci de votre confiance.\n\n— Afrik'Fid`;

  const html = baseLayout(`
    ${infoTable([
      ['Plan', badge(pkg, '#059669')],
      ['Cycle', cycle.charAt(0).toUpperCase() + cycle.slice(1)],
      ['Montant payé', `<strong style="color:#059669;font-size:16px;">${montant} FCFA</strong>`],
      ['Date', new Date().toLocaleString('fr-FR')],
      ['Statut', badge('PAYÉ', '#059669')],
    ])}
    ${sectionTitle('Paiement confirmé')}
    ${bodyText(`Bonjour <strong style="color:#1F2937;">${merchant.name || ''}</strong>, nous avons bien reçu votre paiement d'abonnement.`)}
    ${divider()}
    ${bodyText('Vous continuez à bénéficier de toutes les fonctionnalités incluses dans votre plan. Merci de votre confiance.')}
    ${ctaButton('Accéder à mon tableau de bord', `${DASHBOARD_URL()}/merchant`)}
  `, 'Confirmation de paiement');

  const results = await Promise.allSettled([
    merchant.email ? sendEmail(merchant.email, subject, text, html) : Promise.resolve({ status: 'skipped' }),
    merchant.phone ? lam.sendWhatsApp(merchant.phone, text) : Promise.resolve({ status: 'skipped' }),
  ]);
  return { email: results[0], whatsapp: results[1] };
}

module.exports = { sendReminder, sendExpired, sendReceipt };
