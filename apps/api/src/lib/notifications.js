'use strict';

/**
 * Notifications — SMS (Africa's Talking) + Email (Mailgun/SMTP)
 * File de notifications asynchrone avec queue en mémoire + persistance via notification_log
 */

const db = require('./db');
const FormData = require('form-data');
const { enqueue } = require('./notification-queue');
const { decrypt } = require('./crypto');

// ─── Helper : déchiffre phone/email d'un objet client (stockés AES-256-GCM) ──
// Si les valeurs sont déjà en clair (appelant les ayant déjà déchiffrées),
// decrypt() échouera et on conserve la valeur originale.
function decryptClient(client) {
  if (!client) return client;
  let phone = client.phone || null;
  let email = client.email || null;
  if (phone) { try { phone = decrypt(phone); } catch { /* valeur déjà en clair ou corrompue — on conserve */ } }
  if (email) { try { email = decrypt(email); } catch { /* valeur déjà en clair ou corrompue — on conserve */ } }
  return { ...client, phone, email };
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SMS_ENABLED = process.env.AT_API_KEY && process.env.AT_USERNAME;
const MAIL_ENABLED = process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN;
// SMTP générique (Mailtrap, Sendgrid SMTP, etc.) — prioritaire si configuré
const SMTP_ENABLED = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

// ─── SMS via Africa's Talking ─────────────────────────────────────────────────

async function sendSMS(to, message) {
  if (!SMS_ENABLED) {
    console.info(`[NOTIF/SMS] sandbox: to=${to} msg="${message.slice(0, 50)}..."`);
    return { status: 'sandbox', to, message };
  }

  const axios = require('axios');
  const params = new URLSearchParams({
    username: process.env.AT_USERNAME,
    to,
    message,
    ...(process.env.AT_SENDER_ID && { from: process.env.AT_SENDER_ID }),
  });

  const res = await axios.post(
    'https://api.africastalking.com/version1/messaging',
    params.toString(),
    {
      headers: {
        apiKey: process.env.AT_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 10000,
    }
  );

  const recipient = res.data?.SMSMessageData?.Recipients?.[0];
  if (!recipient || recipient.statusCode !== 101) {
    throw new Error(`AT SMS failed: ${recipient?.status || 'unknown error'}`);
  }

  return { status: 'sent', messageId: recipient.messageId, to };
}

// ─── Email (SMTP générique prioritaire, sinon Mailgun) ───────────────────────

async function sendEmail(to, subject, text, html) {
  // 1. SMTP générique (Mailtrap, SendGrid SMTP, etc.)
  if (SMTP_ENABLED) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const from = process.env.SMTP_FROM || `Afrik'Fid <noreply@afrikfid.com>`;
    const info = await transporter.sendMail({ from, to, subject, text, html });
    console.info(`[NOTIF/EMAIL] SMTP sent: to=${to} messageId=${info.messageId}`);
    return { status: 'sent', messageId: info.messageId, to };
  }

  // 2. Mailgun API
  if (MAIL_ENABLED) {
    const axios = require('axios');
    const form = new FormData();
    form.append('from', process.env.MAILGUN_FROM || `Afrik'Fid <noreply@${process.env.MAILGUN_DOMAIN}>`);
    form.append('to', to);
    form.append('subject', subject);
    form.append('text', text);
    if (html) form.append('html', html);

    const res = await axios.post(
      `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
      form,
      {
        auth: { username: 'api', password: process.env.MAILGUN_API_KEY },
        headers: form.getHeaders(),
        timeout: 10000,
      }
    );
    return { status: 'sent', messageId: res.data.id, to };
  }

  // 3. Aucun transport configuré — log console uniquement
  console.info(`[NOTIF/EMAIL] sandbox (no transport): to=${to} subject="${subject}"`);
  return { status: 'sandbox', to, subject };
}

// ─── Constantes fidélité ──────────────────────────────────────────────────────

const LOYALTY_COLORS = {
  OPEN: '#6B7280',
  LIVE: '#2563EB',
  GOLD: '#D97706',
  ROYAL: '#7C3AED',
  ROYAL_ELITE: '#B45309',
};

// ─── Config liens et identité (tous configurables via .env) ───────────────────

const SUPPORT_EMAIL = () => process.env.SUPPORT_EMAIL || 'support@afrikfid.com';
const COMPLIANCE_EMAIL = () => process.env.COMPLIANCE_EMAIL || 'compliance@afrikfid.com';
const FINANCE_EMAIL = () => process.env.FINANCE_EMAIL || 'finance@afrikfid.com';
const SECURITY_EMAIL = () => process.env.SECURITY_EMAIL || 'security@afrikfid.com';
const DASHBOARD_URL = () => process.env.DASHBOARD_URL || '#';
const ADMIN_DASH_URL = () => process.env.ADMIN_DASHBOARD_URL || process.env.DASHBOARD_URL || '#';
const LOGO_URL = () => process.env.LOGO_URL || '';

// ─── HTML Email Helpers ───────────────────────────────────────────────────────

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

        <!-- Header -->
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:#FFFFFF;text-align:center;padding:24px 32px;border-bottom:3px solid #E30613;border-radius:8px 8px 0 0;">
              ${logo}
              ${title ? `<p style="color:#6B7280;font-size:12px;margin:8px 0 0;letter-spacing:0.8px;text-transform:uppercase;font-weight:500;">${title}</p>` : ''}
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 8px 8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:36px 40px;">
              ${content}
            </td>
          </tr>
        </table>

        <!-- Footer -->
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

function badge(label, color) {
  return `<span style="display:inline-block;background:${color}15;color:${color};border:1px solid ${color}40;border-radius:20px;padding:3px 12px;font-size:11px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">${label}</span>`;
}

function alertBanner(text, color = '#DC2626') {
  return `<div style="background:${color}0D;border-left:4px solid ${color};border-radius:0 6px 6px 0;padding:14px 18px;color:#1F2937;font-size:14px;margin:0 0 20px;line-height:1.6;">
    ${text}
  </div>`;
}

function sectionTitle(text, color = '#1F2937') {
  return `<h2 style="color:${color};font-size:22px;font-weight:700;margin:0 0 4px;line-height:1.3;font-family:'Helvetica Neue',Arial,sans-serif;">${text}</h2>`;
}

function bodyText(text, color = '#374151') {
  return `<p style="color:${color};font-size:15px;line-height:1.7;margin:12px 0;">${text}</p>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #E5E7EB;margin:28px 0;">`;
}

function stepList(steps) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
    ${steps.map((step, i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #F3F4F6;vertical-align:top;">
        <span style="display:inline-block;background:#E30613;color:#FFFFFF;border-radius:50%;width:24px;height:24px;text-align:center;line-height:24px;font-weight:700;font-size:12px;margin-right:14px;vertical-align:middle;flex-shrink:0;">${i + 1}</span>
        <span style="color:#1F2937;font-size:14px;vertical-align:middle;font-weight:500;">${step}</span>
      </td>
    </tr>`).join('')}
  </table>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

const templates = {
  payment_confirmation: ({ clientName, amount, currency, merchantName, rebateAmount, rebatePercent, txId }) => {
    const hasCashback = rebateAmount > 0;
    const html = baseLayout(`
      ${sectionTitle('Paiement confirmé')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${clientName || 'Client'}</strong>, votre paiement a bien ete reçu.`)}
      ${statBox('Montant payé', `${amount} ${currency}`, '#059669')}
      ${hasCashback ? statBox('Cashback crédité', `${rebateAmount} ${currency} (${rebatePercent}%)`, '#E30613') : ''}
      ${infoTable([
      ['Marchand', merchantName],
      ['Référence', `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${txId}</code>`],
      ['Date', new Date().toLocaleString('fr-FR')],
      ['Statut', badge('COMPLÉTÉ', '#059669')],
    ])}
      ${divider()}
      ${bodyText('Merci d\'utiliser Afrik\'Fid pour vos paiements. Continuez à acheter chez nos marchands partenaires pour accumuler du cashback.')}
    `, 'Confirmation de paiement');
    return {
      sms: hasCashback
        ? `Afrik'Fid: Paiement ${amount} ${currency} chez ${merchantName} confirmé. Cashback: ${rebateAmount} ${currency}. Ref: ${txId.slice(0, 8)}`
        : `Afrik'Fid: Paiement ${amount} ${currency} chez ${merchantName} confirmé. Ref: ${txId.slice(0, 8)}`,
      subject: `Paiement confirmé — ${merchantName}`,
      text: [
        `Bonjour ${clientName || 'Client'},`,
        ``,
        `Votre paiement de ${amount} ${currency} chez ${merchantName} a ete confirmé.`,
        hasCashback ? `Cashback crédité: ${rebateAmount} ${currency} (${rebatePercent}%)` : '',
        ``,
        `Référence: ${txId}`,
        ``,
        `Merci d'utiliser Afrik'Fid.`,
      ].filter(l => l !== null).join('\n'),
      html,
    };
  },

  cashback_credit: ({ clientName, rebateAmount, currency, merchantName, loyaltyStatus, txId }) => {
    const loyaltyColor = LOYALTY_COLORS[loyaltyStatus] || '#E30613';
    const html = baseLayout(`
      ${sectionTitle('Cashback crédité')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${clientName || 'Client'}</strong>, votre cashback vient d'être crédité.`)}
      ${statBox('Cashback reçu', `${rebateAmount} ${currency}`, '#059669')}
      ${infoTable([
      ['Chez le marchand', merchantName],
      ['Transaction', `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${txId}</code>`],
      ['Votre statut', badge(loyaltyStatus, loyaltyColor)],
    ])}
      ${divider()}
      ${bodyText('Continuez vos achats chez nos marchands partenaires pour accumuler encore plus de cashback et progresser vers le statut ROYAL (12% de cashback).')}
    `, 'Cashback crédité');
    return {
      sms: `Afrik'Fid: Cashback de ${rebateAmount} ${currency} crédité suite à votre achat chez ${merchantName}. Statut: ${loyaltyStatus}`,
      subject: `Cashback de ${rebateAmount} ${currency} crédité`,
      text: [
        `Bonjour ${clientName || 'Client'},`,
        ``,
        `Un cashback de ${rebateAmount} ${currency} a été crédité suite à votre achat chez ${merchantName}.`,
        `Votre statut fidélité actuel: ${loyaltyStatus}`,
        ``,
        `Référence transaction: ${txId}`,
      ].join('\n'),
      html,
    };
  },

  loyalty_upgrade: ({ clientName, oldStatus, newStatus, nextBenefit }) => {
    const color = LOYALTY_COLORS[newStatus] || '#E30613';
    const oldColor = LOYALTY_COLORS[oldStatus] || '#6B7280';
    const html = baseLayout(`
      ${sectionTitle(`Félicitations, ${clientName || 'Client'} !`)}
      ${bodyText('Votre fidélité a été récompensée. Votre statut vient d\'etre ameliore.')}
      <div style="text-align:center;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:24px;margin:20px 0;">
        <span style="color:${oldColor};font-size:15px;font-weight:600;">${oldStatus}</span>
        <span style="color:#9CA3AF;font-size:20px;margin:0 16px;">&rarr;</span>
        <span style="color:${color};font-size:18px;font-weight:700;border-bottom:2px solid ${color};padding-bottom:2px;">${newStatus}</span>
      </div>
      ${statBox('Votre avantage', nextBenefit || `Statut ${newStatus} actif`, color)}
      ${divider()}
      ${bodyText('Continuez à effectuer des achats chez nos marchands partenaires pour maintenir et améliorer votre statut fidélité.')}
      ${ctaButton('Voir mes avantages', DASHBOARD_URL(), color)}
    `, 'Montée en statut fidélité');
    return {
      sms: `Afrik'Fid: Félicitations ! Votre statut passé de ${oldStatus} a ${newStatus}. ${nextBenefit || ''}`,
      subject: `Félicitations — Votre nouveau statut : ${newStatus}`,
      text: [
        `Bonjour ${clientName || 'Client'},`,
        ``,
        `Félicitations ! Votre statut fidélité Afrik'Fid vient de passér de ${oldStatus} a ${newStatus}.`,
        nextBenefit ? `\n${nextBenefit}` : '',
        ``,
        `Continuez vos achats pour profiter de encore plus d'avantages.`,
      ].join('\n'),
      html,
    };
  },

  loyalty_downgrade: ({ clientName, oldStatus, newStatus, inactivityMonths }) => {
    const oldColor = LOYALTY_COLORS[oldStatus] || '#6B7280';
    const newColor = LOYALTY_COLORS[newStatus] || '#6B7280';
    const html = baseLayout(`
      ${alertBanner(`Votre statut fidélité a été mis à jour suite à ${inactivityMonths || '?'} mois d'inactivité.`, '#D97706')}
      ${sectionTitle('Mise à jour de votre statut')}
      <div style="text-align:center;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:24px;margin:20px 0;">
        <span style="color:${oldColor};font-size:15px;font-weight:600;">${oldStatus}</span>
        <span style="color:#D97706;font-size:20px;margin:0 16px;">&darr;</span>
        <span style="color:${newColor};font-size:15px;font-weight:600;">${newStatus}</span>
      </div>
      ${bodyText('Cette modification est due à une période d\'inactivité sans achat via la plateforme.')}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Bonne nouvelle.</strong> Vous pouvez retrouver votre statut précédent en reprenant vos achats chez nos marchands partenaires.')}
      ${ctaButton('Reprendre mes achats', DASHBOARD_URL(), '#D97706')}
    `, 'Mise à jour statut fidélité');
    return {
      sms: `Afrik'Fid: Votre statut fidélité a été mis à jour: ${oldStatus} vers ${newStatus} (${inactivityMonths}m inactivité). Achetez pour progresser.`,
      subject: `Mise à jour de votre statut fidélité Afrik'Fid`,
      text: [
        `Bonjour ${clientName || 'Client'},`,
        ``,
        `Votre statut fidélité Afrik'Fid a été mis à jour de ${oldStatus} a ${newStatus}.`,
        ``,
        `Cette modification est due à une période d'inactivité de ${inactivityMonths} mois sans achat via la plateforme.`,
        ``,
        `Bonne nouvelle : vous pouvez retrouver votre statut précédent en effectuant de nouveaux achats chez nos marchands partenaires.`,
        ``,
        `L'équipe Afrik'Fid`,
      ].join('\n'),
      html,
    };
  },

  fraud_alert: ({ amount, currency, merchantName, clientPhone, reason, riskScore }) => {
    const html = baseLayout(`
      ${alertBanner(`Transaction bloquée automatiquement — Score de risque : <strong>${riskScore}/100</strong>`, '#DC2626')}
      ${sectionTitle('Alerte Anti-Fraude', '#DC2626')}
      ${bodyText('Une transaction suspecte a été bloquée par le système anti-fraude Afrik\'Fid.')}
      ${statBox('Score de risque', `${riskScore} / 100`, '#DC2626')}
      ${infoTable([
      ['Marchand', merchantName || 'Inconnu'],
      ['Montant', `${amount} ${currency}`],
      ['Téléphone client', clientPhone || 'N/A'],
      ['Raison', reason],
      ['Date', new Date().toLocaleString('fr-FR')],
    ])}
      ${divider()}
      ${ctaButton('Accéder au tableau de bord admin', `${ADMIN_DASH_URL()}/admin/fraud`, '#DC2626')}
    `, 'Alerte Fraude');
    return {
      sms: null,
      subject: `[ALERTE FRAUDE] Transaction bloquée — Score ${riskScore}/100`,
      text: [
        `Une transaction a été bloquée par le système anti-fraude.`,
        ``,
        `Marchand   : ${merchantName || 'Inconnu'}`,
        `Montant    : ${amount} ${currency}`,
        `Téléphone  : ${clientPhone || 'N/A'}`,
        `Score      : ${riskScore}/100`,
        `Raison     : ${reason}`,
        `Date       : ${new Date().toISOString()}`,
        ``,
        `Connectez-vous au tableau de bord admin pour consulter les détails.`,
      ].join('\n'),
      html,
    };
  },

  kyc_approved: ({ merchantName }) => {
    const html = baseLayout(`
      ${statBox('Statut KYC', 'APPROUVÉ', '#059669')}
      ${sectionTitle('Compte approuvé !')}
      ${bodyText(`Félicitations ! Le dossier KYC de <strong style="color:#1F2937;">${merchantName}</strong> a été validé par notre équipe de conformité.`)}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Vous pouvez désormais accepter des paiements en production.</strong> Voici vos prochaines étapes :')}
      ${stepList([
      'Récuperez vos clés API de production dans votre espace marchand',
      'Testez votre intégration en environnement sandbox',
      'Passez en production et acceptez vos premiers paiements',
    ])}
      ${ctaButton('Accéder à mon espace marchand', DASHBOARD_URL())}
      ${divider()}
      ${bodyText(`Notre équipe reste disponible à <a href="mailto:${SUPPORT_EMAIL()}" style="color:#E30613;text-decoration:none;border-bottom:1px solid #E30613;">${SUPPORT_EMAIL()}</a> pour vous accompagner.`)}
    `, 'Validation KYC');
    return {
      sms: `Afrik'Fid: Votre KYC pour ${merchantName} a été approuvé. Connectez-vous pour accéder a vos clés API de production.`,
      subject: `Compte approuvé — ${merchantName}`,
      text: [
        `Bonjour,`,
        ``,
        `Nous avons le plaisir de vous informer que votre dossier KYC pour le compte marchand "${merchantName}" a été approuvé.`,
        ``,
        `Vous pouvez désormais accepter des paiements via Afrik'Fid.`,
        `Connectez-vous à votre tableau de bord pour accéder a vos clés API de production.`,
        ``,
        `Bienvenue dans l'écosystème Afrik'Fid !`,
        ``,
        `L'équipe Afrik'Fid`,
      ].join('\n'),
      html,
    };
  },

  kyc_rejected: ({ merchantName, reason }) => {
    const html = baseLayout(`
      ${alertBanner(`Le dossier KYC de <strong>${merchantName}</strong> n'a pas pu être approuvé en l'etat.`, '#D97706')}
      ${sectionTitle('Dossier KYC — Action requise')}
      ${bodyText('Notre équipe a examiné votre dossier et a identifié des informations manquantes ou incorrectes.')}
      ${reason ? statBox('Motif du rejet', reason, '#D97706') : ''}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Que faire maintenant ?</strong>')}
      ${stepList([
      'Connectez-vous à votre espace marchand',
      'Corrigez les informations signalées',
      'Soumettez un nouveau dossier KYC complet',
    ])}
      ${ctaButton('Soumettre un nouveau dossier', DASHBOARD_URL(), '#D97706')}
      ${divider()}
      ${bodyText(`Pour toute question, contactez-nous à <a href="mailto:${COMPLIANCE_EMAIL()}" style="color:#E30613;text-decoration:none;border-bottom:1px solid #E30613;">${COMPLIANCE_EMAIL()}</a>.`)}
    `, 'Dossier KYC');
    return {
      sms: `Afrik'Fid: Votre dossier KYC pour ${merchantName} n'a pas été approuvé.${reason ? ' Motif: ' + reason.slice(0, 50) : ''} Soumettez un nouveau dossier.`,
      subject: `Dossier KYC incomplet — Action requise`,
      text: [
        `Bonjour,`,
        ``,
        `Votre dossier KYC pour le compte marchand "${merchantName}" n'a pas pu être approuvé.`,
        reason ? `\nMotif : ${reason}` : '',
        ``,
        `Vous pouvez soumettre un nouveau dossier en vous connectant a votre espace marchand.`,
        ``,
        `L'équipe Afrik'Fid`,
      ].filter(l => l !== null).join('\n'),
      html,
    };
  },

  payment_failed: ({ amount, currency, merchantName, errorMessage }) => {
    const html = baseLayout(`
      ${alertBanner(`Votre paiement de <strong>${amount} ${currency}</strong> chez <strong>${merchantName}</strong> a échoué.`, '#DC2626')}
      ${sectionTitle('Échec de paiement')}
      ${statBox('Montant concerné', `${amount} ${currency}`, '#DC2626')}
      ${errorMessage ? infoTable([['Raison', errorMessage]]) : ''}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Que faire ?</strong>')}
      ${stepList([
      'Vérifiez que votre solde mobile money est suffisant',
      'Assurez-vous d\'avoir confirme la demande sur votre téléphone',
      'Reessayez la transaction',
      'Contactez votre opérateur mobile money si le problème persiste',
    ])}
      ${bodyText('Aucun montant n\'a été débité de votre compte.')}
    `, 'Échec de paiement');
    return {
      sms: `Afrik'Fid: Échec paiement ${amount} ${currency} chez ${merchantName}. ${errorMessage || 'Vérifiez votre solde.'} Aucun debit effectue.`,
      subject: `Échec de paiement — ${merchantName}`,
      text: [
        `Votre paiement de ${amount} ${currency} chez ${merchantName} a échoué.`,
        errorMessage ? `Raison: ${errorMessage}` : '',
        ``,
        `Veuillez réessayer ou contacter votre opérateur.`,
      ].filter(Boolean).join('\n'),
      html,
    };
  },

  api_key_rotated: ({ merchantName, newApiKeyPublic }) => {
    const html = baseLayout(`
      ${sectionTitle('Renouvellement de vos clés API')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${merchantName}</strong>, vos clés API ont été automatiquement renouvelées conformément à notre politique de sécurité (rotation tous les 90 jours).`)}
      ${statBox('Nouvelle clé publique', `<span style="font-family:'Courier New',monospace;font-size:14px;">${newApiKeyPublic}</span>`, '#2563EB')}
      ${alertBanner('Votre nouvelle clé secrete est disponible uniquement dans votre espace marchand securise. Mettez a jour vos intégrations immédiatement.', '#D97706')}
      ${divider()}
      ${bodyText(`Si vous n'etes pas a l'origine de cette action, contactez immédiatement <a href="mailto:${SECURITY_EMAIL()}" style="color:#E30613;text-decoration:none;border-bottom:1px solid #E30613;">${SECURITY_EMAIL()}</a>.`)}
      ${ctaButton('Accéder à mon espace marchand', DASHBOARD_URL(), '#2563EB')}
    `, 'Sécurité — Rotation des clés');
    return {
      sms: null,
      subject: `Renouvellement automatique de vos clés API — Action requise`,
      text: `Bonjour ${merchantName},\n\nVos clés API ont été automatiquement renouvelées (rotation 90 jours).\n\nNouvelle clé publique : ${newApiKeyPublic}\nVotre nouvelle clé secrete est disponible dans votre espace marchand.\n\nMettez a jour vos intégrations dans les plus brefs délais.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  // ─── 10 Nouveaux templates ────────────────────────────────────────────────

  client_welcome: ({ clientName, afrikfidId }) => {
    const html = baseLayout(`
      ${sectionTitle(`Bienvenue, ${clientName || 'cher Client'} !`)}
      ${bodyText('Votre compte Afrik\'Fid est créé. Profitez du cashback à chaque paiement chez nos marchands partenaires.')}
      ${statBox('Votre identifiant Afrik\'Fid', afrikfidId, '#E30613')}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Comment ça marche ?</strong>')}
      ${stepList([
      'Payez chez un marchand partenaire Afrik\'Fid',
      'Recevez automatiquement du cashback sur chaque achat',
      'Progressez vers le statut ROYAL et gagnez jusqu\'a 12% de cashback',
    ])}
      ${divider()}
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:6px;overflow:hidden;margin:16px 0;">
        <tr style="background:#F9FAFB;">
          <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;" colspan="2">Votre parcours fidélité</td>
        </tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#6B7280;font-weight:600;font-size:13px;">OPEN</td><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#6B7280;font-size:13px;">Statut de départ</td></tr>
        <tr style="background:#F9FAFB;"><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#2563EB;font-weight:600;font-size:13px;">LIVE</td><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#374151;font-size:13px;">5% de cashback</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#D97706;font-weight:600;font-size:13px;">GOLD</td><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#374151;font-size:13px;">8% de cashback</td></tr>
        <tr style="background:#F9FAFB;"><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#7C3AED;font-weight:600;font-size:13px;">ROYAL</td><td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;color:#374151;font-size:13px;">12% de cashback</td></tr>
        <tr><td style="padding:10px 14px;color:#B45309;font-weight:600;font-size:13px;">ROYAL ELITE</td><td style="padding:10px 14px;color:#374151;font-size:13px;">12% + avantages exclusifs</td></tr>
      </table>
    `, 'Bienvenue sur Afrik\'Fid');
    return {
      sms: `Afrik'Fid: Bienvenue ${clientName || ''}! Votre compte (${afrikfidId}) est active. Payez chez nos marchands et recevez du cashback automatique.`,
      subject: `Bienvenue sur Afrik'Fid — ${clientName || 'Client'}`,
      text: `Bonjour ${clientName || 'Client'},\n\nBienvenue sur Afrik'Fid !\nVotre ID: ${afrikfidId}\n\nProfitez du cashback à chaque paiement chez nos marchands partenaires.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  merchant_welcome: ({ merchantName, email, sandboxKeyPublic, tempPassword, createdByAdmin }) => {
    const credentialsBlock = tempPassword ? `
      ${divider()}
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;padding:20px;margin:16px 0;">
        <div style="color:#92400E;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">Vos identifiants de connexion</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="color:#6B7280;font-size:13px;padding:5px 0;width:40%;font-weight:500;">Email</td>
            <td style="color:#1F2937;font-size:13px;padding:5px 0;font-family:'Courier New',monospace;">${email}</td>
          </tr>
          <tr>
            <td style="color:#6B7280;font-size:13px;padding:5px 0;font-weight:500;">Mot de passé temporaire</td>
            <td style="color:#92400E;font-size:14px;padding:5px 0;font-family:'Courier New',monospace;font-weight:700;">${tempPassword}</td>
          </tr>
        </table>
      </div>
      ${alertBanner('Ce mot de passé est temporaire. Changez-le immédiatement après votre première connexion.', '#D97706')}
    ` : '';
    const html = baseLayout(`
      ${sectionTitle(`Bienvenue, ${merchantName} !`)}
      ${bodyText(createdByAdmin
      ? 'Un administrateur Afrik\'Fid a créé votre compte marchand. Vous pouvez dès maintenant accéder a votre espace.'
      : 'Votre compte marchand Afrik\'Fid a été créé avec succes. Voici votre parcours d\'intégration :'
    )}
      ${credentialsBlock}
      ${sandboxKeyPublic ? statBox('Votre clé sandbox publique', `<span style="font-family:'Courier New',monospace;font-size:13px;">${sandboxKeyPublic}</span>`, '#2563EB') : ''}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Prochaines étapes :</strong>')}
      ${stepList([
      'Compte créé — votre espace est pret',
      'Soumettez votre dossier KYC (documents d\'identite + justificatif d\'activite)',
      'Testez votre intégration avec vos clés sandbox',
      'Passez en production et acceptez vos premiers paiements',
    ])}
      ${ctaButton('Accéder à mon espace marchand', `${DASHBOARD_URL()}/merchant`)}
      ${divider()}
      ${bodyText(`Votre clé secrete sandbox est disponible dans votre espace marchand apres connexion. <strong style="color:#DC2626;">Ne la partagez jamais.</strong>`)}
      ${bodyText(`Pour toute question : <a href="mailto:${SUPPORT_EMAIL()}" style="color:#E30613;text-decoration:none;border-bottom:1px solid #E30613;">${SUPPORT_EMAIL()}</a>`)}
    `, 'Bienvenue sur Afrik\'Fid');
    return {
      sms: tempPassword
        ? `Afrik'Fid: Bonjour ${merchantName}! Votre compte marchand a été créé. Email: ${email} | MDP temp: ${tempPassword} Connectez-vous sur ${DASHBOARD_URL()}`
        : `Afrik'Fid: Bonjour ${merchantName}! Votre compte marchand Afrik'Fid est prêt. Connectez-vous sur ${DASHBOARD_URL()}`,
      subject: `Votre compte marchand Afrik'Fid est créé — ${merchantName}`,
      text: [
        `Bonjour ${merchantName},`,
        ``,
        `Votre compte marchand Afrik'Fid a été créé${createdByAdmin ? ' par un administrateur' : ''}.`,
        ``,
        tempPassword ? `Identifiants de connexion:\n  Email: ${email}\n  Mot de passé temporaire: ${tempPassword}\n\n  Changez ce mot de passé des votre première connexion.` : '',
        ``,
        `Clé sandbox publique: ${sandboxKeyPublic || 'Disponible dans votre espace'}`,
        ``,
        `Prochaines étapes: Soumettez votre KYC, testez en sandbox, puis Passez en production.`,
        ``,
        `L'équipe Afrik'Fid`,
      ].filter(l => l !== null).join('\n'),
      html,
    };
  },

  refund_approved: ({ clientName, amount, currency, merchantName, transactionRef, refundId }) => {
    const html = baseLayout(`
      ${statBox('Montant remboursé', `${amount} ${currency}`, '#059669')}
      ${sectionTitle('Remboursement approuvé')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${clientName || 'Client'}</strong>, votre demande de remboursement a été approuvée.`)}
      ${infoTable([
      ['Marchand', merchantName],
      ['Transaction', `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${transactionRef || refundId}</code>`],
      ['Date d\'approbation', new Date().toLocaleString('fr-FR')],
      ['Statut', badge('REMBOURSÉ', '#059669')],
    ])}
      ${divider()}
      ${bodyText('Le crédit sera effectué sur votre compte mobile money sous <strong style="color:#1F2937;">24 a 72 heures ouvrées</strong> selon votre opérateur.')}
      ${bodyText(`Si vous ne recevez pas le credit dans ce délai, contactez <a href="mailto:${SUPPORT_EMAIL()}" style="color:#E30613;text-decoration:none;border-bottom:1px solid #E30613;">${SUPPORT_EMAIL()}</a>.`)}
    `, 'Remboursement');
    return {
      sms: `Afrik'Fid: Remboursement de ${amount} ${currency} approuvé par ${merchantName}. Crédit sous 24-72h sur votre mobile money.`,
      subject: `Remboursement approuvé — ${amount} ${currency}`,
      text: `Bonjour ${clientName || 'Client'},\n\nVotre demande de remboursement de ${amount} ${currency} chez ${merchantName} a été approuvée.\n\nLe crédit sera effectué sur votre compte mobile money sous 24 a 72 heures ouvrées.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  refund_rejected: ({ clientName, amount, currency, merchantName, transactionRef }) => {
    const html = baseLayout(`
      ${alertBanner(`Votre demande de remboursement de <strong>${amount} ${currency}</strong> chez <strong>${merchantName}</strong> n'a pas été approuvée.`, '#DC2626')}
      ${sectionTitle('Demande de remboursement refusée')}
      ${infoTable([
      ['Montant demandé', `${amount} ${currency}`],
      ['Marchand', merchantName],
      ['Référence', transactionRef ? `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${transactionRef}</code>` : 'N/A'],
      ['Date', new Date().toLocaleString('fr-FR')],
    ])}
      ${divider()}
      ${bodyText('Si vous pensez que cette decision est incorrecte, vous pouvez contacter notre équipe de support en referençant votre transaction.')}
      ${ctaButton('Contacter le support', `mailto:${SUPPORT_EMAIL()}`, '#6B7280')}
    `, 'Remboursement');
    return {
      sms: `Afrik'Fid: Votre demande de remboursement de ${amount} ${currency} chez ${merchantName} a été refusée. Contactez ${SUPPORT_EMAIL()}`,
      subject: `Demande de remboursement refusée`,
      text: `Bonjour ${clientName || 'Client'},\n\nVotre demande de remboursement de ${amount} ${currency} chez ${merchantName} a été refusée.\n\nContactez notre support si vous pensez que cette decision est erronée.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  disbursement_completed: ({ merchantName, amount, currency, operatorRef, operator, executedAt }) => {
    const html = baseLayout(`
      ${statBox('Montant versé', `${amount} ${currency}`, '#059669')}
      ${sectionTitle('Règlement reçu')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${merchantName}</strong>, votre règlement a été traité avec succes.`)}
      ${infoTable([
      ['Opérateur', operator || 'Mobile Money'],
      ['Référence opérateur', operatorRef ? `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${operatorRef}</code>` : 'Manuel'],
      ['Date d\'execution', executedAt ? new Date(executedAt).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR')],
      ['Statut', badge('COMPLÉTÉ', '#059669')],
    ])}
      ${divider()}
      ${bodyText('Ce règlement correspond à vos transactions complétées selon votre fréquence de règlement configurée.')}
      ${ctaButton('Voir mes transactions', `${DASHBOARD_URL()}/merchant/transactions`)}
    `, 'Règlement marchand');
    return {
      sms: `Afrik'Fid: Règlement de ${amount} ${currency} reçu via ${operator || 'Mobile Money'}. Ref: ${(operatorRef || '').slice(0, 12)}`,
      subject: `Règlement reçu — ${amount} ${currency}`,
      text: `Bonjour ${merchantName},\n\nVotre règlement de ${amount} ${currency} a été traité.\nOpérateur: ${operator || 'Manuel'}\nRéférence: ${operatorRef || 'N/A'}\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  disbursement_failed: ({ merchantName, amount, currency, errorMessage, disbursementId }) => {
    const html = baseLayout(`
      ${alertBanner('Votre règlement automatique a échoué. Notre équipe a été notifiée.', '#DC2626')}
      ${sectionTitle('Échec du règlement automatique')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${merchantName}</strong>, nous n\'avons pas pu traitér votre règlement automatique.`)}
      ${statBox('Montant concerné', `${amount} ${currency}`, '#DC2626')}
      ${errorMessage ? infoTable([['Raison de l\'échec', errorMessage], ['Ref. interne', disbursementId ? disbursementId.slice(0, 12) : 'N/A']]) : ''}
      ${divider()}
      ${bodyText('<strong style="color:#1F2937;">Notre équipe effectuera un virement manuel dans les 48 heures ouvrées.</strong>')}
      ${bodyText('Si vous souhaitez accélérer le traitément, contactez-nous directement :')}
      ${ctaButton('Contacter le support financier', `mailto:${FINANCE_EMAIL()}`, '#D97706')}
    `, 'Règlement marchand');
    return {
      sms: null,
      subject: `Échec du règlement automatique — Intervention requise`,
      text: `Bonjour ${merchantName},\n\nVotre règlement automatique de ${amount} ${currency} a échoué.\n${errorMessage ? 'Raison: ' + errorMessage + '\n' : ''}\nNotre équipe effectuera un virement manuel sous 48h.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  transaction_expiréd: ({ amount, currency, merchantName, txRef }) => ({
    sms: `Afrik'Fid: Transaction ${amount} ${currency} chez ${merchantName} expirée (timeout opérateur). Aucun debit effectue. Ref: ${(txRef || '').slice(0, 8)}`,
    subject: `Transaction expirée — ${amount} ${currency}`,
    text: `Votre transaction de ${amount} ${currency} chez ${merchantName} a expiré.\n\nAucun montant n'a été débité de votre compte.\n\nVous pouvez réessayer le paiement.\n\nL'équipe Afrik'Fid`,
    html: null,
  }),

  twofa_enabled: ({ userName, backupCodes, ip }) => {
    const codesHtml = (backupCodes || []).map(c =>
      `<span style="display:inline-block;background:#F3F4F6;color:#1F2937;font-family:'Courier New',monospace;font-size:13px;padding:6px 12px;border-radius:4px;margin:4px;border:1px solid #E5E7EB;font-weight:600;">${c}</span>`
    ).join('');
    const html = baseLayout(`
      ${sectionTitle('Double authentification activée')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${userName || 'Utilisateur'}</strong>, la double authentification a été activée sur votre compte.`)}
      ${infoTable([
      ['Date d\'activation', new Date().toLocaleString('fr-FR')],
      ['Adresse IP', ip || 'N/A'],
      ['Statut', badge('ACTIF', '#059669')],
    ])}
      ${backupCodes && backupCodes.length ? `
      ${divider()}
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:20px;margin:16px 0;">
        <div style="color:#6B7280;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px;">Codes de secours — a conserver en lieu sûr</div>
        <div style="line-height:2.4;">${codesHtml}</div>
      </div>
      ${alertBanner('Conservez ces codes en lieu sûr. Ils ne peuvent pas être régénérés et vous permettent d\'accéder a votre compte si vous perdez votre téléphone.', '#D97706')}
      ` : ''}
      ${divider()}
      ${bodyText(`Si vous n'etes pas a l'origine de cette activation, contactez immédiatement <a href="mailto:${SECURITY_EMAIL()}" style="color:#E30613;text-decoration:none;border-bottom:1px solid #E30613;">${SECURITY_EMAIL()}</a>.`)}
      ${ctaButton('Gérer la sécurité de mon compte', DASHBOARD_URL(), '#2563EB')}
    `, 'Sécurité du compte');
    return {
      sms: null,
      subject: `Double authentification activée sur votre compte`,
      text: `Bonjour ${userName || 'Utilisateur'},\n\nLa double authentification a été activée sur votre compte.\nIP: ${ip || 'N/A'}\n${backupCodes ? '\nCodes de secours:\n' + backupCodes.join('\n') : ''}\n\nConservez ces codes en lieu sûr.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  twofa_disabled: ({ userName, ip }) => {
    const html = baseLayout(`
      ${alertBanner('La double authentification a ete <strong>désactivée</strong> sur votre compte. Si ce n\'est pas vous, agissez immédiatement.', '#DC2626')}
      ${sectionTitle('Alerte sécurité — 2FA désactivé')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${userName || 'Utilisateur'}</strong>, votre compte est désormais moins protégé.`)}
      ${infoTable([
      ['Date de desactivation', new Date().toLocaleString('fr-FR')],
      ['Adresse IP', ip || 'N/A'],
      ['Statut 2FA', badge('INACTIF', '#DC2626')],
    ])}
      ${divider()}
      ${bodyText('<strong style="color:#DC2626;">Si vous n\'avez pas effectue cette action</strong>, votre compte est peut-etre compromis. Changez immédiatement votre mot de passé et contactez notre équipe sécurité.')}
      ${ctaButton('Réactiver la 2FA maintenant', DASHBOARD_URL(), '#D97706')}
      ${ctaButton(`Contacter la sécurité`, `mailto:${SECURITY_EMAIL()}`, '#DC2626')}
    `, 'Alerte sécurité');
    return {
      sms: null,
      subject: `Alerte sécurité : Double authentification désactivée`,
      text: `Bonjour ${userName || 'Utilisateur'},\n\nLa double authentification a été désactivée sur votre compte.\nIP: ${ip || 'N/A'}\n\nSi ce n'est pas vous, contactez ${SECURITY_EMAIL()} immédiatement.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  refund_requested: ({ merchantName, clientName, amount, currency, reason, txRef, refundId }) => {
    const html = baseLayout(`
      ${alertBanner(`Une demande de remboursement de <strong>${amount} ${currency}</strong> a été soumise pour votre transaction.`, '#D97706')}
      ${sectionTitle('Nouvelle demande de remboursement')}
      ${bodyText(`Le client <strong style="color:#1F2937;">${clientName || 'un client'}</strong> a soumis une demande de remboursement sur l'une de vos transactions.`)}
      ${statBox('Montant demandé', `${amount} ${currency}`, '#D97706')}
      ${infoTable([
      ['Client', clientName || 'N/A'],
      ['Motif', reason],
      ['Transaction', txRef ? `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${txRef}</code>` : 'N/A'],
      ['Date de la demande', new Date().toLocaleString('fr-FR')],
      ['Délai de reponse', badge('72h max', '#D97706')],
    ])}
      ${divider()}
      ${bodyText('Vous devez approuvér ou rejeter cette demande dans les <strong style="color:#1F2937;">72 heures</strong>. Passé ce délai, notre équipe peut intervenir.')}
      ${ctaButton('Gérer la demande', `${DASHBOARD_URL()}/merchant/refunds`, '#D97706')}
    `, 'Demande de remboursement');
    return {
      sms: `Afrik'Fid: ${clientName || 'Un client'} demande le remboursement de ${amount} ${currency}. Motif: ${reason.slice(0, 50)}. Répondez sous 72h.`,
      subject: `Nouvelle demande de remboursement — ${amount} ${currency}`,
      text: `Bonjour ${merchantName},\n\nUne demande de remboursement de ${amount} ${currency} a été soumise par ${clientName || 'un client'}.\nMotif: ${reason}\nTransaction: ${txRef || refundId}\n\nVous devez répondre sous 72h dans votre espace marchand.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },

  dispute_opened: ({ adminEmail, initiatedBy, merchantName, clientName, amount, currency, txRef, reason, description, disputeId }) => {
    const initiatedByLabel = initiatedBy === 'merchant' ? `Marchand (${merchantName || 'N/A'})` : initiatedBy === 'client' ? `Client (${clientName || 'N/A'})` : 'Admin';
    const html = baseLayout(`
      ${alertBanner(`Un nouveau litige a ete ouvert sur une transaction de <strong>${amount} ${currency}</strong>.`, '#DC2626')}
      ${sectionTitle('Nouveau litige déclaré')}
      ${bodyText('Un litige vient d\'etre enregistre sur la plateforme et nécessite votre attention.')}
      ${statBox('Montant contesté', `${amount} ${currency}`, '#DC2626')}
      ${infoTable([
      ['Initie par', initiatedByLabel],
      ['Marchand', merchantName || 'N/A'],
      ['Client', clientName || 'N/A'],
      ['Motif', reason],
      ['Description', description || 'Non renseignée'],
      ['Transaction', txRef ? `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${txRef}</code>` : 'N/A'],
      ['Ref. litige', `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${disputeId.slice(0, 12)}</code>`],
      ['Date d\'ouverture', new Date().toLocaleString('fr-FR')],
      ['Statut', badge('OUVERT', '#DC2626')],
    ])}
      ${divider()}
      ${bodyText('Examinéz ce litige et Passez-le en statut investigating, resolved ou rejected selon votre analyse.')}
      ${ctaButton('Gérer le litige', `${ADMIN_DASH_URL()}/admin/disputes`, '#DC2626')}
    `, 'Litige — Action requise');
    return {
      sms: null,
      subject: `[LITIGE] Nouveau litige — ${amount} ${currency} (${reason})`,
      text: `Un nouveau litige a ete ouvert.\nInitie par: ${initiatedByLabel}\nMarchand: ${merchantName || 'N/A'}\nMontant: ${amount} ${currency}\nMotif: ${reason}\nTransaction: ${txRef || 'N/A'}\n\nConnectez-vous au tableau de bord pour gérer ce litige.\n\nAfrik'Fid`,
      html,
    };
  },

  wallet_cap_reached: ({ clientName, rawRebate, créditédRebate, lostRebate, currency, merchantName, cap, txId }) => {
    const html = baseLayout(`
      ${alertBanner('Votre portefeuille cashback est plein. Une partie du cashback n\'a pas pu etre créditée.', '#D97706')}
      ${sectionTitle('Plafond portefeuille atteint')}
      ${bodyText(`Bonjour <strong style="color:#1F2937;">${clientName || 'Client'}</strong>, votre portefeuille cashback a atteint son plafond lors de cette transaction.`)}
      ${statBox('Cashback dû', `${rawRebate} ${currency}`, '#D97706')}
      ${statBox('Cashback crédité', `${créditédRebate} ${currency}`, '#059669')}
      ${statBox('Non crédité (plafond)', `${lostRebate} ${currency}`, '#DC2626')}
      ${infoTable([
      ['Marchand', merchantName],
      ['Plafond wallet', `${cap} ${currency}`],
      ['Transaction', `<code style="font-family:'Courier New',monospace;font-size:12px;color:#374151;">${txId}</code>`],
      ['Date', new Date().toLocaleString('fr-FR')],
    ])}
      ${divider()}
      ${bodyText('Pour éviter de perdre du cashback, utilisez votre solde lors de vos prochains achats chez nos marchands partenaires.')}
      ${ctaButton('Utiliser mon cashback', DASHBOARD_URL(), '#D97706')}
    `, 'Plafond portefeuille cashback atteint');
    return {
      sms: `Afrik'Fid: Plafond wallet atteint. Cashback dû: ${rawRebate} ${currency}, crédité: ${créditédRebate} ${currency} (plafond: ${cap} ${currency}). Utilisez votre solde.`,
      subject: `Plafond wallet atteint — ${lostRebate} ${currency} non crédités`,
      text: [
        `Bonjour ${clientName || 'Client'},`,
        ``,
        `Votre portefeuille cashback a atteint son plafond (${cap} ${currency}) lors d'une transaction chez ${merchantName}.`,
        ``,
        `Cashback dû     : ${rawRebate} ${currency}`,
        `Cashback crédité: ${créditédRebate} ${currency}`,
        `Non crédité     : ${lostRebate} ${currency}`,
        ``,
        `Utilisez votre solde lors de vos prochains achats pour libérer de la place.`,
        `Référence: ${txId}`,
      ].join('\n'),
      html,
    };
  },

  account_suspended: ({ merchantName, reason }) => {
    const html = baseLayout(`
      ${alertBanner(`Le compte marchand <strong>${merchantName}</strong> a été suspendu. Toutes les transactions sont temporairement désactivées.`, '#DC2626')}
      ${sectionTitle('Compte marchand suspendu')}
      ${bodyText(`Bonjour, nous vous informons que le compte marchand <strong style="color:#1F2937;">${merchantName}</strong> a fait l'objet d'une suspension.`)}
      ${reason ? statBox('Motif de la suspension', reason, '#DC2626') : ''}
      ${infoTable([
      ['Date de suspension', new Date().toLocaleString('fr-FR')],
      ['Statut', badge('SUSPENDU', '#DC2626')],
    ])}
      ${divider()}
      ${bodyText('Pour contestér cette decision ou fournir des documents complémentaires, veuillez contacter notre équipe Conformité :')}
      ${ctaButton(`Contacter ${COMPLIANCE_EMAIL()}`, `mailto:${COMPLIANCE_EMAIL()}`, '#DC2626')}
      ${bodyText('Nous nous engageons a traitér votre dossier dans les meilleurs délais.')}
    `, 'Suspension de compte');
    return {
      sms: null,
      subject: `Votre compte marchand a été suspendu`,
      text: `Bonjour,\n\nLe compte marchand "${merchantName}" a été suspendu.\n${reason ? 'Motif: ' + reason + '\n' : ''}\nContactez ${COMPLIANCE_EMAIL()} pour plus d'informations.\n\nL'équipe Afrik'Fid`,
      html,
    };
  },
};

// ─── Helpers de log ───────────────────────────────────────────────────────────

function logNotification(type, recipient, channel, status, errorMsg = null) {
  db.query(
    `INSERT INTO notification_log (id, type, recipient, channel, status, error, sent_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
    [type, recipient, channel, status, errorMsg]
  ).catch(e => console.error('[NOTIF/LOG]', e.message));
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Envoie une notification de confirmation de paiement au client (SMS + email si dispo).
 */
function notifyPaymentConfirmed({ client: _c, transaction, distribution }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;

  const tplData = {
    clientName: client.full_name,
    amount: transaction.gross_amount,
    currency: transaction.currency || 'XOF',
    merchantName: transaction.merchant_name || 'le marchand',
    rebateAmount: distribution?.client_rebate_amount || 0,
    rebatePercent: distribution?.client_rebate_percent || 0,
    txId: transaction.id,
  };
  const tpl = templates.payment_confirmation(tplData);

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('payment_confirmation', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('payment_confirmation', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('payment_confirmation', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('payment_confirmation', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie le client d'un cashback crédité.
 */
function notifyCashbackCredit({ client: _c, transaction, distribution }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;
  if (!distribution?.client_rebate_amount || distribution.client_rebate_amount <= 0) return;

  const tplData = {
    clientName: client.full_name,
    rebateAmount: distribution.client_rebate_amount,
    currency: transaction.currency || 'XOF',
    merchantName: transaction.merchant_name || 'le marchand',
    loyaltyStatus: client.loyalty_status,
    txId: transaction.id,
  };
  const tpl = templates.cashback_credit(tplData);

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('cashback_credit', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('cashback_credit', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('cashback_credit', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('cashback_credit', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie le client d'une montée en statut fidélité.
 */
function notifyLoyaltyUpgrade({ client: _c, oldStatus, newStatus }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;

  const benefitMap = {
    LIVE: 'Vous bénéficiez désormais de 5% de cashback sur vos achats.',
    GOLD: 'Vous bénéficiez désormais de 8% de cashback sur vos achats.',
    ROYAL: 'Vous bénéficiez désormais de 12% de cashback sur vos achats. Félicitations !',
    ROYAL_ELITE: 'Bienvenue dans le cerclé ROYAL ELITE. Profitez de 12% de cashback, d\'avantages exclusifs et d\'un accès prioritaire aux offres marchands.',
  };

  const tplData = {
    clientName: client.full_name,
    oldStatus,
    newStatus,
    nextBenefit: benefitMap[newStatus] || '',
  };
  const tpl = templates.loyalty_upgrade(tplData);

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('loyalty_upgrade', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('loyalty_upgrade', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('loyalty_upgrade', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('loyalty_upgrade', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie le client d'un échec de paiement.
 */
function notifyPaymentFailed({ client: _c, transaction, errorMessage }) {
  const client = decryptClient(_c);
  if (!client?.phone) return;

  const tpl = templates.payment_failed({
    amount: transaction.gross_amount,
    currency: transaction.currency || 'XOF',
    merchantName: transaction.merchant_name || 'le marchand',
    errorMessage,
  });

  enqueue(async () => {
    try {
      await sendSMS(client.phone, tpl.sms);
      logNotification('payment_failed', client.phone, 'sms', 'sent');
    } catch (e) {
      logNotification('payment_failed', client.phone, 'sms', 'failed', e.message);
    }
  });

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('payment_failed', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('payment_failed', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie un marchand de l'approbation de son KYC.
 */
function notifyKycApproved({ merchant }) {
  if (!merchant?.email) return;
  const tpl = templates.kyc_approved({ merchantName: merchant.name, email: merchant.email });
  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('kyc_approved', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('kyc_approved', merchant.email, 'email', 'failed', e.message);
    }
  });
  if (merchant.phone) {
    enqueue(async () => {
      try {
        await sendSMS(merchant.phone, tpl.sms);
        logNotification('kyc_approved', merchant.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('kyc_approved', merchant.phone, 'sms', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie un marchand du rejet de son KYC.
 */
function notifyKycRejected({ merchant, reason }) {
  if (!merchant?.email) return;
  const tpl = templates.kyc_rejected({ merchantName: merchant.name, reason });
  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('kyc_rejected', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('kyc_rejected', merchant.email, 'email', 'failed', e.message);
    }
  });
}

/**
 * Alerte admin lors d'un blocage fraude.
 */
async function notifyFraudBlocked({ amount, currency, merchantName, clientPhone, reason, riskScore }) {
  try {
    const { emit, SSE_EVENTS } = require('./sse-emitter');
    emit(SSE_EVENTS.FRAUD_BLOCKED, { amount, currency, merchantName, clientPhone, reason, riskScore, blockedAt: new Date().toISOString() });
  } catch { /* SSE non critique */ }

  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return;

  const tpl = templates.fraud_alert({ amount, currency, merchantName, clientPhone, reason, riskScore });
  enqueue(async () => {
    try {
      await sendEmail(adminEmail, tpl.subject, tpl.text, tpl.html);
      logNotification('fraud_alert', adminEmail, 'email', 'sent');
    } catch (e) {
      logNotification('fraud_alert', adminEmail, 'email', 'failed', e.message);
    }
  });
}

/**
 * Notifie le client, le marchand (webhook) et l'admin lorsque le plafond du portefeuille
 * cashback est atteint et qu'une partie du cashback n'a pas pu être créditée.
 */
async function notifyWalletCapReached({ client: _c, merchant, transaction, rawRebate, créditédRebate, cap, currency }) {
  const client = decryptClient(_c);
  const lostRebate = rawRebate - créditédRebate;
  if (lostRebate <= 0) return;

  const tplData = {
    clientName: client?.full_name,
    rawRebate,
    créditédRebate,
    lostRebate,
    currency,
    merchantName: merchant?.name || 'le marchand',
    cap,
    txId: transaction?.id || '',
  };
  const tpl = templates.wallet_cap_reached(tplData);

  // 1. Notifier le client (SMS + email)
  if (client?.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('wallet_cap_reached', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('wallet_cap_reached', client.phone, 'sms', 'failed', e.message);
      }
    });
  }
  if (client?.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('wallet_cap_reached', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('wallet_cap_reached', client.email, 'email', 'failed', e.message);
      }
    });
  }

  // 2. Webhook marchand : wallet.cap_reached
  if (merchant?.id) {
    const { dispatchWebhook } = require('../workers/webhook-dispatcher');
    dispatchWebhook(merchant.id, 'wallet.cap_reached', {
      transaction_id: transaction?.id,
      client_id: client?.id,
      raw_rebate: rawRebate,
      créditéd_rebate: créditédRebate,
      lost_rebate: lostRebate,
      wallet_cap: cap,
      currency,
    }).catch(() => { });
  }

  // 3. Alerte admin par email
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (adminEmail) {
    const adminSubject = `[WALLET CAP] ${lostRebate} ${currency} non crédités — client ${client?.id || 'inconnu'}`;
    const adminText = [
      `Plafond portefeuille cashback atteint.`,
      ``,
      `Client      : ${client?.full_name || client?.id || 'N/A'} (${client?.phone || ''})`,
      `Marchand    : ${merchant?.name || merchant?.id || 'N/A'}`,
      `Transaction : ${transaction?.id || 'N/A'}`,
      `Cashback dû : ${rawRebate} ${currency}`,
      `Crédité     : ${créditédRebate} ${currency}`,
      `Non crédité : ${lostRebate} ${currency}`,
      `Plafond     : ${cap} ${currency}`,
    ].join('\n');
    enqueue(async () => {
      try {
        await sendEmail(adminEmail, adminSubject, adminText);
        logNotification('wallet_cap_reached_admin', adminEmail, 'email', 'sent');
      } catch (e) {
        logNotification('wallet_cap_reached_admin', adminEmail, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie le client d'une rétrogradation de statut fidélité.
 */
function notifyLoyaltyDowngrade({ client: _c, oldStatus, newStatus, inactivityMonths }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;

  const tplData = {
    clientName: client.full_name,
    oldStatus,
    newStatus,
    inactivityMonths: inactivityMonths || '?',
  };
  const tpl = templates.loyalty_downgrade(tplData);

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('loyalty_downgrade', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('loyalty_downgrade', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('loyalty_downgrade', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('loyalty_downgrade', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie un marchand que ses clés API ont été automatiquement renouvelées.
 */
function notifyApiKeyRotated({ merchant, newApiKeyPublic }) {
  if (!merchant?.email) return;
  const tpl = templates.api_key_rotated({ merchantName: merchant.name || merchant.email, newApiKeyPublic });

  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('api_key_rotated', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('api_key_rotated', merchant.email, 'email', 'failed', e.message);
    }
  });
}

// ─── 10 Nouvelles fonctions notify ───────────────────────────────────────────

/**
 * Bienvenue client — envoyé à la création du compte.
 */
function notifyClientWelcome({ client: _c }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;

  const tpl = templates.client_welcome({
    clientName: client.full_name,
    afrikfidId: client.afrikfid_id,
  });

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('client_welcome', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('client_welcome', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('client_welcome', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('client_welcome', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Bienvenue marchand — envoyé après auto-inscription OU création par admin.
 * @param {object} merchant - objet marchand (email, name, phone, sandbox_key_public)
 * @param {string} [tempPassword] - mot de passé temporaire généré si absent à la création
 * @param {boolean} [createdByAdmin] - true si créé par un admin
 */
function notifyMerchantWelcome({ merchant, tempPassword = null, createdByAdmin = false }) {
  if (!merchant?.email) return;

  const tpl = templates.merchant_welcome({
    merchantName: merchant.name,
    email: merchant.email,
    sandboxKeyPublic: merchant.sandbox_key_public,
    tempPassword,
    createdByAdmin,
  });

  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('merchant_welcome', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('merchant_welcome', merchant.email, 'email', 'failed', e.message);
    }
  });

  if (merchant.phone && tpl.sms) {
    enqueue(async () => {
      try {
        await sendSMS(merchant.phone, tpl.sms);
        logNotification('merchant_welcome', merchant.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('merchant_welcome', merchant.phone, 'sms', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie le client de l'approbation de son remboursement.
 */
function notifyRefundApproved({ client: _c, refund, merchantName }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;

  const tpl = templates.refund_approved({
    clientName: client.full_name,
    amount: refund.amount || refund.gross_amount,
    currency: refund.currency || 'XOF',
    merchantName,
    transactionRef: refund.transaction_id,
    refundId: refund.id,
  });

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('refund_approved', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('refund_approved', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('refund_approved', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('refund_approved', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie le client du rejet de son remboursement.
 */
function notifyRefundRejected({ client: _c, refund, merchantName }) {
  const client = decryptClient(_c);
  if (!client?.phone && !client?.email) return;

  const tpl = templates.refund_rejected({
    clientName: client.full_name,
    amount: refund.amount || refund.gross_amount,
    currency: refund.currency || 'XOF',
    merchantName,
    transactionRef: refund.transaction_id,
  });

  if (client.phone) {
    enqueue(async () => {
      try {
        await sendSMS(client.phone, tpl.sms);
        logNotification('refund_rejected', client.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('refund_rejected', client.phone, 'sms', 'failed', e.message);
      }
    });
  }

  if (client.email) {
    enqueue(async () => {
      try {
        await sendEmail(client.email, tpl.subject, tpl.text, tpl.html);
        logNotification('refund_rejected', client.email, 'email', 'sent');
      } catch (e) {
        logNotification('refund_rejected', client.email, 'email', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie un marchand que son règlement a été exécuté avec succès.
 */
function notifyDisbursementCompleted({ merchant, disbursement }) {
  if (!merchant?.email) return;

  const tpl = templates.disbursement_completed({
    merchantName: merchant.name,
    amount: disbursement.amount,
    currency: disbursement.currency || 'XOF',
    operatorRef: disbursement.operator_ref,
    operator: disbursement.operator || merchant.mm_operator,
    executedAt: disbursement.executed_at,
  });

  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('disbursement_completed', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('disbursement_completed', merchant.email, 'email', 'failed', e.message);
    }
  });

  if (merchant.phone) {
    enqueue(async () => {
      try {
        await sendSMS(merchant.phone, tpl.sms);
        logNotification('disbursement_completed', merchant.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('disbursement_completed', merchant.phone, 'sms', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie un marchand de l'échec de son règlement automatique.
 */
function notifyDisbursementFailed({ merchant, disbursement, errorMessage }) {
  if (!merchant?.email) return;

  const tpl = templates.disbursement_failed({
    merchantName: merchant.name,
    amount: disbursement.amount,
    currency: disbursement.currency || 'XOF',
    errorMessage,
    disbursementId: disbursement.id,
  });

  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('disbursement_failed', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('disbursement_failed', merchant.email, 'email', 'failed', e.message);
    }
  });
}

/**
 * Notifie le client de l'expiration d'une transaction (SMS uniquement).
 */
function notifyTransactionExpiréd({ client: _c, transaction }) {
  const client = decryptClient(_c);
  if (!client?.phone) return;

  const tpl = templates.transaction_expiréd({
    amount: transaction.gross_amount,
    currency: transaction.currency || 'XOF',
    merchantName: transaction.merchant_name || 'le marchand',
    txRef: transaction.référence || transaction.id,
  });

  enqueue(async () => {
    try {
      await sendSMS(client.phone, tpl.sms);
      logNotification('transaction_expiréd', client.phone, 'sms', 'sent');
    } catch (e) {
      logNotification('transaction_expiréd', client.phone, 'sms', 'failed', e.message);
    }
  });
}

/**
 * Notifie l'utilisateur de l'activation du 2FA sur son compte.
 */
function notify2FAEnabled({ user, backupCodes, ip }) {
  if (!user?.email) return;

  const tpl = templates.twofa_enabled({
    userName: user.full_name || user.name || user.email,
    backupCodes,
    ip,
  });

  enqueue(async () => {
    try {
      await sendEmail(user.email, tpl.subject, tpl.text, tpl.html);
      logNotification('2fa_enabled', user.email, 'email', 'sent');
    } catch (e) {
      logNotification('2fa_enabled', user.email, 'email', 'failed', e.message);
    }
  });
}

/**
 * Notifie l'utilisateur de la désactivation du 2FA (alerte sécurité).
 */
function notify2FADisabled({ user, ip }) {
  if (!user?.email) return;

  const tpl = templates.twofa_disabled({
    userName: user.full_name || user.name || user.email,
    ip,
  });

  enqueue(async () => {
    try {
      await sendEmail(user.email, tpl.subject, tpl.text, tpl.html);
      logNotification('2fa_disabled', user.email, 'email', 'sent');
    } catch (e) {
      logNotification('2fa_disabled', user.email, 'email', 'failed', e.message);
    }
  });
}

/**
 * Notifie un marchand de la suspension de son compte.
 */
function notifyAccountSuspended({ merchant, reason }) {
  if (!merchant?.email) return;

  const tpl = templates.account_suspended({
    merchantName: merchant.name,
    reason,
  });

  enqueue(async () => {
    try {
      await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
      logNotification('account_suspended', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('account_suspended', merchant.email, 'email', 'failed', e.message);
    }
  });
}

/**
 * Notifie le marchand d'une nouvelle demande de remboursement client.
 */
function notifyRefundRequested({ merchant, client: _c, transaction, refundId, reason }) {
  const client = decryptClient(_c);
  if (!merchant?.email && !merchant?.phone) return;

  const tpl = templates.refund_requested({
    merchantName: merchant.name,
    clientName: client?.full_name,
    amount: transaction.gross_amount,
    currency: transaction.currency || 'XOF',
    reason,
    txRef: transaction.référence || transaction.id,
    refundId,
  });

  if (merchant.email) {
    enqueue(async () => {
      try {
        await sendEmail(merchant.email, tpl.subject, tpl.text, tpl.html);
        logNotification('refund_requested', merchant.email, 'email', 'sent');
      } catch (e) {
        logNotification('refund_requested', merchant.email, 'email', 'failed', e.message);
      }
    });
  }

  if (merchant.phone) {
    enqueue(async () => {
      try {
        await sendSMS(merchant.phone, tpl.sms);
        logNotification('refund_requested', merchant.phone, 'sms', 'sent');
      } catch (e) {
        logNotification('refund_requested', merchant.phone, 'sms', 'failed', e.message);
      }
    });
  }
}

/**
 * Notifie l'admin de l'ouverture d'un nouveau litige.
 */
function notifyDisputeOpened({ dispute, transaction, merchant, client: _c, initiatedBy }) {
  const client = decryptClient(_c);
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return;

  const tpl = templates.dispute_opened({
    adminEmail,
    initiatedBy,
    merchantName: merchant?.name,
    clientName: client?.full_name,
    amount: dispute.amount_disputed || transaction?.gross_amount,
    currency: transaction?.currency || 'XOF',
    txRef: transaction?.référence || dispute.transaction_id,
    reason: dispute.reason,
    description: dispute.description,
    disputeId: dispute.id,
  });

  enqueue(async () => {
    try {
      await sendEmail(adminEmail, tpl.subject, tpl.text, tpl.html);
      logNotification('dispute_opened', adminEmail, 'email', 'sent');
    } catch (e) {
      logNotification('dispute_opened', adminEmail, 'email', 'failed', e.message);
    }
  });
}

/**
 * Notifications de requalification statut (CDC v3 §2.4.3)
 * Envoyées J-90, J-30, J-7 avant évaluation, J+1 après
 */
function notifyRequalificationReminder({ client: _c, daysRemaining, currentStatus, pointsNeeded }) {
  const client = decryptClient(_c);
  setImmediate(async () => {
    try {
      const statusLabel = currentStatus || 'votre statut';
      let message;
      if (daysRemaining > 0) {
        message = `Bonjour ${client.full_name}, il vous reste ${daysRemaining} jours pour maintenir votre statut ${statusLabel}. Il vous manque ${pointsNeeded} points statut. Continuez vos achats !`;
      } else {
        message = `Bonjour ${client.full_name}, votre statut fidélité a été réévalué. Votre nouveau statut est ${statusLabel}. Merci de votre fidélité !`;
      }

      if (client.phone) {
        await sendSMS(client.phone, message);
      }
      if (client.email) {
        await sendEmail(client.email, `Afrik'Fid — Statut fidélité`, message, `<p>${message}</p>`);
      }
    } catch (err) {
      console.error('[NOTIFY] Erreur notification requalification:', err.message);
    }
  });
}

// Alerte interne admin — subject+body ou string brute
async function notifyAdminAlert(payload) {
  const subject = typeof payload === 'string' ? 'Alerte système Afrik\'Fid' : payload.subject;
  const body = typeof payload === 'string' ? payload : payload.body;
  const adminEmail = process.env.ADMIN_EMAIL || process.env.MAILGUN_ADMIN_EMAIL;
  if (adminEmail) {
    await sendEmail(adminEmail, subject, body, `<pre>${body}</pre>`);
  } else {
    console.warn('[NOTIFY] notifyAdminAlert (no ADMIN_EMAIL):', subject, body);
  }
}

module.exports = {
  // Existants
  notifyPaymentConfirmed,
  notifyCashbackCredit,
  notifyLoyaltyUpgrade,
  notifyLoyaltyDowngrade,
  notifyPaymentFailed,
  notifyKycApproved,
  notifyKycRejected,
  notifyFraudBlocked,
  notifyApiKeyRotated,
  // Nouveaux
  notifyClientWelcome,
  notifyMerchantWelcome,
  notifyRefundApproved,
  notifyRefundRejected,
  notifyDisbursementCompleted,
  notifyDisbursementFailed,
  notifyTransactionExpiréd,
  notify2FAEnabled,
  notify2FADisabled,
  notifyAccountSuspended,
  notifyRefundRequested,
  notifyDisputeOpened,
  notifyWalletCapReached,
  notifyRequalificationReminder,
  notifyAdminAlert,
  // Exposed for testing
  sendSMS,
  sendEmail,
};
