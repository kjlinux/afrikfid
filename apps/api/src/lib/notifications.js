'use strict';

/**
 * Notifications — SMS (Africa's Talking) + Email (Mailgun)
 * File de notifications asynchrone avec queue en mémoire + persistance via notification_log
 */

const db = require('./db');
const FormData = require('form-data');

// ─── Config ──────────────────────────────────────────────────────────────────

const SMS_ENABLED  = process.env.AT_API_KEY && process.env.AT_USERNAME;
const MAIL_ENABLED = process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN;

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

// ─── Email via Mailgun ────────────────────────────────────────────────────────

async function sendEmail(to, subject, text, html) {
  if (!MAIL_ENABLED) {
    console.info(`[NOTIF/EMAIL] sandbox: to=${to} subject="${subject}"`);
    return { status: 'sandbox', to, subject };
  }

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

// ─── Templates ────────────────────────────────────────────────────────────────

const templates = {
  payment_confirmation: ({ clientName, amount, currency, merchantName, rebateAmount, rebatePercent, txId }) => ({
    sms: rebateAmount > 0
      ? `Afrik'Fid: Paiement de ${amount} ${currency} chez ${merchantName} confirme. Cashback: ${rebateAmount} ${currency} (${rebatePercent}%). Ref: ${txId.slice(0, 8)}`
      : `Afrik'Fid: Paiement de ${amount} ${currency} chez ${merchantName} confirme. Ref: ${txId.slice(0, 8)}`,
    subject: `Confirmation de paiement — ${merchantName}`,
    text: [
      `Bonjour ${clientName || 'Client'},`,
      ``,
      `Votre paiement de ${amount} ${currency} chez ${merchantName} a été confirmé.`,
      rebateAmount > 0 ? `Cashback crédité: ${rebateAmount} ${currency} (${rebatePercent}%)` : '',
      ``,
      `Référence: ${txId}`,
      ``,
      `Merci d'utiliser Afrik'Fid.`,
    ].filter(l => l !== null).join('\n'),
  }),

  cashback_credit: ({ clientName, rebateAmount, currency, merchantName, loyaltyStatus, txId }) => ({
    sms: `Afrik'Fid: Cashback de ${rebateAmount} ${currency} credite suite a votre achat chez ${merchantName}. Statut: ${loyaltyStatus}`,
    subject: `Cashback crédité — ${rebateAmount} ${currency}`,
    text: [
      `Bonjour ${clientName || 'Client'},`,
      ``,
      `Un cashback de ${rebateAmount} ${currency} a été crédité suite à votre achat chez ${merchantName}.`,
      `Votre statut fidélité actuel: ${loyaltyStatus}`,
      ``,
      `Référence transaction: ${txId}`,
    ].join('\n'),
  }),

  loyalty_upgrade: ({ clientName, oldStatus, newStatus, nextBenefit }) => ({
    sms: `Afrik'Fid: Felicitations! Votre statut fidelite passe de ${oldStatus} a ${newStatus}. ${nextBenefit}`,
    subject: `Votre statut fidélité a été amélioré: ${newStatus} !`,
    text: [
      `Bonjour ${clientName || 'Client'},`,
      ``,
      `Félicitations ! Votre statut fidélité Afrik'Fid vient de passer de ${oldStatus} à ${newStatus}.`,
      nextBenefit ? `\n${nextBenefit}` : '',
      ``,
      `Continuez vos achats pour profiter de encore plus d'avantages.`,
    ].join('\n'),
  }),

  fraud_alert: ({ amount, currency, merchantName, clientPhone, reason, riskScore }) => ({
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
  }),

  kyc_approved: ({ merchantName, email }) => ({
    sms: null, // KYC notifications envoyées par email uniquement
    subject: `Votre compte Afrik'Fid a été approuvé — ${merchantName}`,
    text: [
      `Bonjour,`,
      ``,
      `Nous avons le plaisir de vous informer que votre dossier KYC pour le compte marchand "${merchantName}" a été approuvé.`,
      ``,
      `Vous pouvez désormais accepter des paiements via Afrik'Fid.`,
      `Connectez-vous à votre tableau de bord pour accéder à vos clés API de production.`,
      ``,
      `Bienvenue dans l'écosystème Afrik'Fid !`,
      ``,
      `L'équipe Afrik'Fid`,
    ].join('\n'),
    html: `<p>Bonjour,</p><p>Votre dossier KYC pour le compte marchand <strong>${merchantName}</strong> a été <strong style="color:green">approuvé</strong>.</p><p>Vous pouvez désormais accepter des paiements. <a href="${process.env.DASHBOARD_URL || '#'}">Accéder au tableau de bord</a></p>`,
  }),

  kyc_rejected: ({ merchantName, reason }) => ({
    sms: null,
    subject: `Dossier KYC incomplet — ${merchantName}`,
    text: [
      `Bonjour,`,
      ``,
      `Votre dossier KYC pour le compte marchand "${merchantName}" n'a pas pu être approuvé.`,
      reason ? `\nMotif : ${reason}` : '',
      ``,
      `Vous pouvez soumettre un nouveau dossier en vous connectant à votre espace marchand.`,
      ``,
      `L'équipe Afrik'Fid`,
    ].filter(l => l !== null).join('\n'),
  }),

  payment_failed: ({ amount, currency, merchantName, errorMessage }) => ({
    sms: `Afrik'Fid: Echec paiement de ${amount} ${currency} chez ${merchantName}. ${errorMessage || 'Verifiez votre compte.'}`,
    subject: `Échec de paiement — ${merchantName}`,
    text: [
      `Votre paiement de ${amount} ${currency} chez ${merchantName} a échoué.`,
      errorMessage ? `Raison: ${errorMessage}` : '',
      ``,
      `Veuillez réessayer ou contacter votre opérateur.`,
    ].filter(Boolean).join('\n'),
  }),
};

// ─── File de notifications asynchrone ────────────────────────────────────────

const notificationQueue = [];
let processingQueue = false;

async function processNotificationQueue() {
  if (processingQueue || notificationQueue.length === 0) return;
  processingQueue = true;

  while (notificationQueue.length > 0) {
    const job = notificationQueue.shift();
    try {
      await job();
    } catch (err) {
      console.error('[NOTIF/QUEUE] job failed:', err.message);
    }
  }

  processingQueue = false;
}

function enqueue(fn) {
  notificationQueue.push(fn);
  // Non-blocking: process next tick
  setImmediate(processNotificationQueue);
}

// ─── Helpers de log ───────────────────────────────────────────────────────────

function logNotification(type, recipient, channel, status, errorMsg = null) {
  try {
    db.prepare(`
      INSERT INTO notification_log (id, type, recipient, channel, status, error, sent_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, datetime('now'))
    `).run(type, recipient, channel, status, errorMsg);
  } catch (e) {
    console.error('[NOTIF/LOG]', e.message);
  }
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Envoie une notification de confirmation de paiement au client (SMS + email si dispo).
 * Fire-and-forget via queue asynchrone.
 */
function notifyPaymentConfirmed({ client, transaction, distribution }) {
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
        await sendEmail(client.email, tpl.subject, tpl.text);
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
function notifyCashbackCredit({ client, transaction, distribution }) {
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
}

/**
 * Notifie le client d'une montée en statut fidélité.
 */
function notifyLoyaltyUpgrade({ client, oldStatus, newStatus }) {
  if (!client?.phone && !client?.email) return;

  const benefitMap = {
    LIVE:  'Vous bénéficiez désormais de 5% de cashback sur vos achats.',
    GOLD:  'Vous bénéficiez désormais de 8% de cashback sur vos achats.',
    ROYAL: 'Vous bénéficiez désormais de 10% de cashback sur vos achats. Félicitations !',
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
        await sendEmail(client.email, tpl.subject, tpl.text);
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
function notifyPaymentFailed({ client, transaction, errorMessage }) {
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
  // SMS si numéro disponible
  if (merchant.phone) {
    enqueue(async () => {
      try {
        await sendSMS(merchant.phone, `Afrik'Fid: Votre KYC pour ${merchant.name} a ete approuve. Connectez-vous pour acceder a vos cles API.`);
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
      await sendEmail(merchant.email, tpl.subject, tpl.text);
      logNotification('kyc_rejected', merchant.email, 'email', 'sent');
    } catch (e) {
      logNotification('kyc_rejected', merchant.email, 'email', 'failed', e.message);
    }
  });
}

/**
 * Alerte admin lors d'un blocage fraude.
 * Envoie un email aux admins et émet un événement SSE.
 */
async function notifyFraudBlocked({ amount, currency, merchantName, clientPhone, reason, riskScore }) {
  // Émettre SSE pour le dashboard admin
  try {
    const { emit, SSE_EVENTS } = require('./sse-emitter');
    emit(SSE_EVENTS.FRAUD_BLOCKED, { amount, currency, merchantName, clientPhone, reason, riskScore, blockedAt: new Date().toISOString() });
  } catch { /* SSE non critique */ }

  // Email aux admins (si ADMIN_ALERT_EMAIL configuré)
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!adminEmail) return;

  const tpl = templates.fraud_alert({ amount, currency, merchantName, clientPhone, reason, riskScore });
  enqueue(async () => {
    try {
      await sendEmail(adminEmail, tpl.subject, tpl.text);
      logNotification('fraud_alert', adminEmail, 'email', 'sent');
    } catch (e) {
      logNotification('fraud_alert', adminEmail, 'email', 'failed', e.message);
    }
  });
}

module.exports = {
  notifyPaymentConfirmed,
  notifyCashbackCredit,
  notifyLoyaltyUpgrade,
  notifyPaymentFailed,
  notifyKycApproved,
  notifyKycRejected,
  notifyFraudBlocked,
  // Exposed for testing
  sendSMS,
  sendEmail,
};
