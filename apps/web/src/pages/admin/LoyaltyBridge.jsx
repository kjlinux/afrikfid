import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Breadcrumb } from '../../App.jsx'
import { LinkIcon, ArrowPathIcon, ExclamationTriangleIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const fmtDate = s => s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

const S = {
  card: { background: 'var(--afrikfid-surface)', border: '1px solid var(--afrikfid-border)', borderRadius: 10, padding: 18, marginBottom: 16 },
  kpi: { flex: 1, minWidth: 120, background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: 14, textAlign: 'center' },
  kpiVal: { fontSize: 20, fontWeight: 700, color: 'var(--afrikfid-text)', marginBottom: 4 },
  kpiLbl: { fontSize: 11, color: 'var(--afrikfid-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  btn: { padding: '8px 14px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, color: 'var(--afrikfid-info)', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  th: { padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--afrikfid-muted)', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid var(--afrikfid-border)' },
  td: { padding: '8px 10px', fontSize: 12, color: 'var(--afrikfid-text)', borderBottom: '1px solid var(--afrikfid-border)' },
}

function StatusDot({ ok, warn }) {
  const color = ok ? '#10b981' : warn ? '#f59e0b' : '#ef4444'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }} />
}

export default function AdminLoyaltyBridge() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reconLoading, setReconLoading] = useState(false)
  const [reconDate, setReconDate] = useState('')
  const [retryId, setRetryId] = useState('')
  const [actionMsg, setActionMsg] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/loyalty-bridge/health').then(r => { setData(r.data); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const runRecon = async () => {
    setReconLoading(true); setActionMsg(null)
    try {
      const { data: r } = await api.post('/loyalty-bridge/reconcile', reconDate ? { date: reconDate } : {})
      setActionMsg({ ok: true, text: `Réconciliation du ${r.report?.date} terminée${r.report?.alerted ? ' — écart détecté !' : ''}` })
      load()
    } catch (e) {
      setActionMsg({ ok: false, text: e.response?.data?.error || 'Erreur réconciliation' })
    } finally { setReconLoading(false) }
  }

  const retryTx = async (id) => {
    setActionMsg(null)
    try {
      await api.post(`/loyalty-bridge/retry/${id}`)
      setActionMsg({ ok: true, text: `Transaction ${id.slice(0, 8)}… resynchronisée.` })
      setRetryId('')
      load()
    } catch (e) {
      setActionMsg({ ok: false, text: e.response?.data?.error || 'Erreur retry' })
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Chargement…</div>
  if (!data) return <div style={{ padding: 24, color: '#ef4444' }}>Impossible de charger les données du pont.</div>

  const syncRate = data.coverage.eligible > 0
    ? Math.round((data.coverage.synced / data.coverage.eligible) * 1000) / 10
    : null

  return (
    <div style={{ padding: '24px 28px' }}>
      <Breadcrumb title="Pont plateforme fidélité" segments={[{ label: 'Supervision' }]} />

      {/* Config & état global */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <LinkIcon style={{ width: 18, height: 18, color: 'var(--afrikfid-text)' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Configuration</h3>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
          <div><StatusDot ok={data.config.enabled} /> Intégration : <strong>{data.config.enabled ? 'activée' : 'désactivée'}</strong></div>
          <div><StatusDot ok={data.config.configured} warn={!data.config.configured} /> Credentials : <strong>{data.config.configured ? 'présents' : 'absents (BUSINESS_API_URL/TOKEN/HMAC)'}</strong></div>
          <div style={{ color: 'var(--afrikfid-muted)' }}>Environnement : <strong style={{ color: 'var(--afrikfid-text)' }}>{data.config.sandbox ? 'sandbox' : 'production'}</strong></div>
        </div>
      </div>

      {/* KPIs sync 30j */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Synchronisation transactions (30j)</h3>
          <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)' }}>Dernière sync : {fmtDate(data.coverage.last_sync_at)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={S.kpi}>
            <div style={S.kpiVal}>{fmt(data.coverage.eligible)}</div>
            <div style={S.kpiLbl}>Éligibles</div>
          </div>
          <div style={S.kpi}>
            <div style={{ ...S.kpiVal, color: '#10b981' }}>{fmt(data.coverage.synced)}</div>
            <div style={S.kpiLbl}>Synchronisées</div>
          </div>
          <div style={S.kpi}>
            <div style={{ ...S.kpiVal, color: '#f59e0b' }}>{fmt(data.coverage.pending)}</div>
            <div style={S.kpiLbl}>En attente</div>
          </div>
          <div style={S.kpi}>
            <div style={{ ...S.kpiVal, color: '#ef4444' }}>{fmt(data.coverage.retry_exhausted)}</div>
            <div style={S.kpiLbl}>Retries épuisés</div>
          </div>
          <div style={S.kpi}>
            <div style={{ ...S.kpiVal, color: syncRate >= 99 ? '#10b981' : syncRate >= 90 ? '#f59e0b' : '#ef4444' }}>
              {syncRate != null ? `${syncRate}%` : '—'}
            </div>
            <div style={S.kpiLbl}>Taux de sync</div>
          </div>
        </div>
      </div>

      {/* Adoption cartes */}
      <div style={S.card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Adoption cartes fidélité</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={S.kpi}>
            <div style={{ ...S.kpiVal, color: '#8b5cf6' }}>{fmt(data.linkage.linked)}</div>
            <div style={S.kpiLbl}>Comptes avec carte</div>
          </div>
          <div style={S.kpi}>
            <div style={S.kpiVal}>{fmt(data.linkage.unlinked)}</div>
            <div style={S.kpiLbl}>Sans carte liée</div>
          </div>
          <div style={S.kpi}>
            <div style={{ ...S.kpiVal, color: '#3b82f6' }}>
              {data.linkage.linked + data.linkage.unlinked > 0
                ? `${Math.round((data.linkage.linked * 1000) / (data.linkage.linked + data.linkage.unlinked)) / 10}%`
                : '—'}
            </div>
            <div style={S.kpiLbl}>Pénétration</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={S.card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Actions</h3>
        {actionMsg && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12,
            background: actionMsg.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color: actionMsg.ok ? '#10b981' : '#ef4444',
          }}>{actionMsg.text}</div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--afrikfid-muted)' }}>Réconcilier le jour :</label>
          <input type="date" value={reconDate} onChange={e => setReconDate(e.target.value)}
            style={{ padding: '6px 10px', background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)', borderRadius: 6, color: 'var(--afrikfid-text)', fontSize: 12 }} />
          <button onClick={runRecon} disabled={reconLoading} style={S.btn}>
            <ArrowPathIcon style={{ width: 14, height: 14, display: 'inline', verticalAlign: -3, marginRight: 6 }} />
            {reconLoading ? 'En cours…' : 'Lancer réconciliation'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--afrikfid-muted)' }}>(vide = hier)</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--afrikfid-muted)' }}>Retry transaction :</label>
          <input value={retryId} onChange={e => setRetryId(e.target.value)} placeholder="transaction UUID"
            style={{ padding: '6px 10px', background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)', borderRadius: 6, color: 'var(--afrikfid-text)', fontSize: 12, width: 280 }} />
          <button onClick={() => retryTx(retryId)} disabled={!retryId} style={S.btn}>Forcer la sync</button>
        </div>
      </div>

      {/* Erreurs récentes */}
      <div style={S.card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Erreurs de synchronisation récentes</h3>
        {data.recentErrors.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', fontStyle: 'italic' }}>Aucune erreur.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>Transaction</th>
                <th style={S.th}>Erreur</th>
                <th style={S.th}>Tentatives</th>
                <th style={S.th}>Dernière tentative</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {data.recentErrors.map(e => (
                <tr key={e.transactionId}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{e.reference || e.transactionId.slice(0, 8)}</td>
                  <td style={{ ...S.td, color: '#ef4444' }}>{e.error}</td>
                  <td style={S.td}>{e.attempts}</td>
                  <td style={S.td}>{fmtDate(e.at)}</td>
                  <td style={S.td}>
                    <button onClick={() => retryTx(e.transactionId)} style={{ ...S.btn, padding: '4px 10px' }}>Retry</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Réconciliations récentes */}
      <div style={S.card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Réconciliations quotidiennes (14 derniers rapports)</h3>
        {data.reconciliation.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', fontStyle: 'italic' }}>Aucun rapport.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>État</th>
                <th style={S.th}>Jour</th>
                <th style={S.th}>Local (n / XOF)</th>
                <th style={S.th}>Business-api (n / XOF)</th>
                <th style={S.th}>Écart</th>
                <th style={S.th}>Exécuté</th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliation.map((r, i) => {
                const alerted = r.action === 'business_api_reconciliation_alert'
                const unavail = !r.report?.upstream_available
                return (
                  <tr key={i}>
                    <td style={S.td}>
                      {unavail ? <ExclamationTriangleIcon style={{ width: 14, height: 14, color: '#f59e0b' }} />
                        : alerted ? <XCircleIcon style={{ width: 14, height: 14, color: '#ef4444' }} />
                        : <CheckCircleIcon style={{ width: 14, height: 14, color: '#10b981' }} />}
                    </td>
                    <td style={S.td}>{r.day}</td>
                    <td style={S.td}>{fmt(r.report?.local?.count)} / {fmt(r.report?.local?.sum)}</td>
                    <td style={S.td}>
                      {r.report?.remote
                        ? `${fmt(r.report.remote.count)} / ${fmt(r.report.remote.sum)}`
                        : <span style={{ color: 'var(--afrikfid-muted)' }}>indispo</span>}
                    </td>
                    <td style={S.td}>
                      {r.report?.diff_count_ratio != null
                        ? `${(r.report.diff_count_ratio * 100).toFixed(2)}% / ${(r.report.diff_sum_ratio * 100).toFixed(2)}%`
                        : '—'}
                    </td>
                    <td style={S.td}>{fmtDate(r.at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Derniers appels HTTP signés */}
      <div style={S.card}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px' }}>Derniers appels HTTP signés (20)</h3>
        {data.recentCalls.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', fontStyle: 'italic' }}>Aucun appel journalisé.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>État</th>
                <th style={S.th}>Méthode</th>
                <th style={S.th}>Path</th>
                <th style={S.th}>HTTP</th>
                <th style={S.th}>Latence</th>
                <th style={S.th}>Erreur</th>
                <th style={S.th}>À</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCalls.map((c, i) => {
                const failed = c.action === 'business_api_call_failed'
                return (
                  <tr key={i}>
                    <td style={S.td}>
                      {failed
                        ? <XCircleIcon style={{ width: 14, height: 14, color: '#ef4444' }} />
                        : <CheckCircleIcon style={{ width: 14, height: 14, color: '#10b981' }} />}
                    </td>
                    <td style={S.td}>{c.meta?.method || '—'}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{c.path}</td>
                    <td style={S.td}>{c.meta?.status ?? '—'}</td>
                    <td style={S.td}>{c.meta?.latency_ms != null ? `${c.meta.latency_ms} ms` : '—'}</td>
                    <td style={{ ...S.td, color: failed ? '#ef4444' : 'var(--afrikfid-muted)' }}>{c.meta?.error || '—'}</td>
                    <td style={S.td}>{fmtDate(c.at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
