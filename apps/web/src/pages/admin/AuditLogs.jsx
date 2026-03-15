import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Spinner, Pagination, EmptyState, exportCsv, exportPdf } from '../../components/ui.jsx'

const ACTOR_COLORS = { admin: '#f59e0b', merchant: '#3b82f6', system: '#8b5cf6' }
const ACTION_COLORS = { create: '#10b981', update: '#3b82f6', delete: '#ef4444', login: '#f59e0b', refund: '#8b5cf6' }

function actionColor(action = '') {
  const key = Object.keys(ACTION_COLORS).find(k => action.toLowerCase().includes(k))
  return ACTION_COLORS[key] || '#94a3b8'
}

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ actor_type: '', action: '', resource_type: '', date_from: '', date_to: '' })
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    const params = new URLSearchParams({ page, limit: 50 })
    if (filters.actor_type) params.set('actor_type', filters.actor_type)
    if (filters.action) params.set('action', filters.action)
    if (filters.resource_type) params.set('resource_type', filters.resource_type)
    if (filters.date_from) params.set('date_from', filters.date_from)
    if (filters.date_to) params.set('date_to', filters.date_to)
    setLoading(true)
    api.get(`/audit-logs?${params}`)
      .then(r => { setLogs(r.data.logs); setTotal(r.data.pagination.total) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, filters])

  const COLS = [
    { label: 'Date', value: r => r.created_at ? new Date(r.created_at).toLocaleString('fr-FR') : '' },
    { label: 'Acteur', value: r => `${r.actor_type} / ${r.actor_id}` },
    { label: 'Action', key: 'action' },
    { label: 'Ressource', value: r => r.resource_type ? `${r.resource_type} ${r.resource_id || ''}` : '' },
    { label: 'IP', key: 'ip_address' },
  ]

  const inp = { padding: '9px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 13 }

  return (
    <div style={{ padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Journal d'audit</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{total} entrée{total > 1 ? 's' : ''} — traçabilité complète</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportCsv(logs, COLS, 'audit-logs.csv')}
            style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ CSV
          </button>
          <button onClick={() => exportPdf(logs, COLS, 'Journal d\'audit', `${total} entrées`)}
            style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ PDF
          </button>
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={filters.actor_type} onChange={e => { setFilters(f => ({ ...f, actor_type: e.target.value })); setPage(1) }} style={inp}>
          <option value="">Tous les acteurs</option>
          <option value="admin">Admin</option>
          <option value="merchant">Marchand</option>
          <option value="system">Système</option>
        </select>
        <input placeholder="Action (ex: create, login...)" value={filters.action}
          onChange={e => { setFilters(f => ({ ...f, action: e.target.value })); setPage(1) }}
          style={{ ...inp, width: 200 }} />
        <input placeholder="Ressource (ex: merchant, client...)" value={filters.resource_type}
          onChange={e => { setFilters(f => ({ ...f, resource_type: e.target.value })); setPage(1) }}
          style={{ ...inp, width: 200 }} />
        <input type="date" value={filters.date_from}
          onChange={e => { setFilters(f => ({ ...f, date_from: e.target.value })); setPage(1) }}
          style={inp} title="Date début" />
        <input type="date" value={filters.date_to}
          onChange={e => { setFilters(f => ({ ...f, date_to: e.target.value })); setPage(1) }}
          style={inp} title="Date fin" />
        {(filters.actor_type || filters.action || filters.resource_type || filters.date_from || filters.date_to) && (
          <button onClick={() => { setFilters({ actor_type: '', action: '', resource_type: '', date_from: '', date_to: '' }); setPage(1) }}
            style={{ ...inp, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', cursor: 'pointer' }}>
            ✕ Réinitialiser
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? <Spinner /> : logs.length === 0 ? (
        <EmptyState icon="📋" title="Aucune entrée" desc="Le journal d'audit est vide ou aucun résultat ne correspond aux filtres." />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  {['Date', 'Acteur', 'Action', 'Ressource', 'IP', ''].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} style={{ borderTop: '1px solid #334155', cursor: 'pointer' }}
                    onClick={() => setSelected(log)}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {log.created_at ? new Date(log.created_at).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: ACTOR_COLORS[log.actor_type] || '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 4 }}>
                        {log.actor_type}
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>{log.actor_id?.slice(0, 8)}…</span>
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: actionColor(log.action) }}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: '#94a3b8' }}>
                      {log.resource_type && (
                        <span>{log.resource_type}{log.resource_id ? <span style={{ color: '#64748b', marginLeft: 4, fontSize: 11 }}>{log.resource_id?.slice(0, 8)}…</span> : null}</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                      {log.ip_address || '—'}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <button style={{ padding: '4px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, color: '#f59e0b', cursor: 'pointer', fontSize: 11 }}>
                        Détail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} limit={50} onPage={setPage} />
        </Card>
      )}

      {/* Modal détail */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setSelected(null)}>
          <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 28, width: 600, maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 700 }}>Détail de l'entrée</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>

            {[
              ['Date', selected.created_at ? new Date(selected.created_at).toLocaleString('fr-FR') : '—'],
              ['Acteur', `${selected.actor_type} — ${selected.actor_id}`],
              ['Action', selected.action],
              ['Ressource', selected.resource_type ? `${selected.resource_type} / ${selected.resource_id || 'N/A'}` : '—'],
              ['IP', selected.ip_address || '—'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', gap: 16, marginBottom: 14, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 12, color: '#64748b', width: 100, flexShrink: 0, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 13, color: '#f1f5f9', wordBreak: 'break-all' }}>{value}</span>
              </div>
            ))}

            {selected.payload && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>Payload</div>
                <pre style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 14, fontSize: 11, color: '#94a3b8', overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
                  {typeof selected.payload === 'string' ? selected.payload : JSON.stringify(selected.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
