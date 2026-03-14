'use strict';

/**
 * Worker de surveillance des remboursements en attente (CDC §4.4)
 *
 * Le CDC impose un délai maximum de traitement de 72h pour les remboursements.
 * Ce worker s'exécute toutes les heures et :
 *   1. Détecte les remboursements en statut 'pending' depuis plus de 72h
 *   2. Alerte l'équipe admin par email + SSE
 *   3. Marque les remboursements à l'état 'overdue' pour suivi
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { emit, SSE_EVENTS } = require('../lib/sse-emitter');

const REFUND_SLA_HOURS = parseInt(process.env.REFUND_SLA_HOURS || '72');

async function checkOverdueRefunds() {
  const cutoff = new Date(Date.now() - REFUND_SLA_HOURS * 3600 * 1000).toISOString();

  const overdueRes = await db.query(`
    SELECT r.id, r.transaction_id, r.amount, r.refund_type, r.reason, r.created_at,
           t.reference as tx_reference, t.currency,
           m.name as merchant_name, m.email as merchant_email
    FROM refunds r
    JOIN transactions t ON r.transaction_id = t.id
    JOIN merchants m ON t.merchant_id = m.id
    WHERE r.status = 'pending' AND r.created_at < $1
  `, [cutoff]);

  if (overdueRes.rows.length === 0) return { overdue: 0 };

  const overdueRefunds = overdueRes.rows;

  // Marquer comme 'overdue' en DB
  const ids = overdueRefunds.map(r => r.id);
  await db.query(
    `UPDATE refunds SET status = 'overdue' WHERE id = ANY($1::text[])`,
    [ids]
  );

  // Audit log
  for (const refund of overdueRefunds) {
    await db.query(
      `INSERT INTO audit_logs (id, action, entity_type, entity_id, actor_type, actor_id, metadata, created_at)
       VALUES ($1, 'refund.overdue', 'refund', $2, 'system', 'refund-monitor', $3, NOW())`,
      [uuidv4(), refund.id, JSON.stringify({
        tx_reference: refund.tx_reference,
        amount: refund.amount,
        currency: refund.currency,
        merchant: refund.merchant_name,
        created_at: refund.created_at,
        sla_hours: REFUND_SLA_HOURS,
      })]
    );
  }

  // SSE pour le dashboard admin
  try {
    emit(SSE_EVENTS.SYSTEM_ALERT || 'system_alert', {
      type: 'refund_overdue',
      count: overdueRefunds.length,
      refunds: overdueRefunds.map(r => ({
        id: r.id,
        txReference: r.tx_reference,
        amount: r.amount,
        currency: r.currency,
        merchant: r.merchant_name,
        createdAt: r.created_at,
      })),
      alertedAt: new Date().toISOString(),
    });
  } catch { /* SSE non critique */ }

  // Email admin
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (adminEmail) {
    try {
      const { sendEmail } = require('../lib/notifications');
      const list = overdueRefunds
        .map(r => `- ${r.tx_reference} | ${r.amount} ${r.currency} | Marchand: ${r.merchant_name} | Créé: ${new Date(r.created_at).toLocaleString('fr-FR')}`)
        .join('\n');
      await sendEmail(adminEmail, `⚠️ ${overdueRefunds.length} remboursement(s) en attente depuis plus de ${REFUND_SLA_HOURS}h`, `
Les remboursements suivants dépassent le délai SLA de ${REFUND_SLA_HOURS}h et ont été marqués "overdue" :

${list}

Veuillez les traiter immédiatement dans le panel admin.
`);
    } catch (err) {
      console.error('[REFUND-MONITOR] Erreur envoi email:', err.message);
    }
  }

  console.log(`⚠️  [REFUND-MONITOR] ${overdueRefunds.length} remboursement(s) overdue détecté(s) et notifiés`);
  return { overdue: overdueRefunds.length, ids };
}

module.exports = { checkOverdueRefunds };
