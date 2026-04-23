'use strict';

/**
 * Réconciliation quotidienne afrikid ↔ business-api.
 *
 * Compare pour un jour donné :
 *   - côté afrikid : transactions synchronisées (business_api_synced_at IS NOT NULL)
 *   - côté business-api : transactions reçues avec reference_afrikid
 *
 * Alerte si l'écart relatif dépasse 0.5% sur le nombre ou la somme.
 * Trace le résultat dans audit_logs quoi qu'il arrive (observabilité).
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const afrikfidClient = require('../lib/afrikfid-client');

const ALERT_THRESHOLD = 0.005; // 0.5%

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

async function runDailyReconciliation(targetDate) {
  const day = targetDate || (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  })();
  const iso = fmtDate(day);
  const dayStart = new Date(`${iso}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const localRes = await db.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(gross_amount), 0)::bigint AS sum
     FROM transactions
     WHERE status = 'completed'
       AND business_api_synced_at >= $1
       AND business_api_synced_at < $2`,
    [dayStart.toISOString(), dayEnd.toISOString()]
  );
  const local = localRes.rows[0] || { count: 0, sum: 0 };

  const remote = await afrikfidClient.getDailyReconciliation(iso);

  const report = {
    date: iso,
    local: { count: Number(local.count), sum: Number(local.sum) },
    remote: remote
      ? { count: Number(remote.count || 0), sum: Number(remote.sum_xof || 0) }
      : null,
    upstream_available: !!remote,
  };

  let alerted = false;
  if (report.remote && report.local.count > 0) {
    const diffCount = Math.abs(report.local.count - report.remote.count) / report.local.count;
    const diffSum = report.local.sum > 0
      ? Math.abs(report.local.sum - report.remote.sum) / report.local.sum
      : 0;
    report.diff_count_ratio = Number(diffCount.toFixed(4));
    report.diff_sum_ratio = Number(diffSum.toFixed(4));
    alerted = diffCount > ALERT_THRESHOLD || diffSum > ALERT_THRESHOLD;
    report.alerted = alerted;
  }

  try {
    await db.query(
      `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload)
       VALUES ($1, 'system', 'reconciliation-worker', $2, 'business_api', $3, $4)`,
      [
        uuidv4(),
        alerted ? 'business_api_reconciliation_alert' : 'business_api_reconciliation_ok',
        iso,
        JSON.stringify(report),
      ]
    );
  } catch (e) {
    console.error('[business-api-reconciliation] audit insert failed:', e.message);
  }

  return report;
}

module.exports = { runDailyReconciliation };
