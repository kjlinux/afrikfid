import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Modal, Spinner, Pagination, Alert, EmptyState, CopyButton } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import { BellSlashIcon } from '@heroicons/react/24/outline'

const STATUS_LABEL = { pending: 'En attente', delivered: 'Livré', failed: 'Échoué', retry: 'Retry' }

export default function AdminWebhooks() {
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ status: '' })
  const [selected, setSelected] = useState(null)
  const [stats, setStats] = useState(null)
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    const params = new URLSearchParams({ page, limit: 25 })
    if (filters.status) params.set('status', filters.status)
    setLoading(true)
    Promise.all([
      api.get(`/webhooks?${params}`),
      api.get('/webhooks/stats/summary'),
    ]).then(([ev, st]) => {
      setEvents(ev.data.events)
      setTotal(ev.data.total)
      setStats(st.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, filters])

  const retry = async (id) => {
    try {
      await api.post(`/webhooks/${id}/retry`)
      setAlert({ type: 'success', text: 'Webhook remis en file de livraison.' })
      load()
    } catch {
      setAlert({ type: 'error', text: 'Impossible de relancer ce webhook.' })
    }
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <Breadcrumb title="Webhooks" segments={[{ label: 'Suivi des événements et livraisons' }]} />

      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.text}</Alert>}

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          {stats.byStatus.map(s => (
            <div key={s.status} style={{ background: 'var(--af-surface)', borderRadius: 10, padding: '14px 18px', border: '1px solid var(--af-border)' }}>
              <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 6 }}>{STATUS_LABEL[s.status] || s.status}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.status === 'delivered' ? '#10b981' : s.status === 'failed' ? '#ef4444' : 'var(--af-accent)' }}>{s.count}</div>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Moy. {Math.round(s.avg_attempts * 10) / 10} tentatives</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select value={filters.status} onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1) }}
          style={{ padding: '9px 14px', background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', fontSize: 13 }}>
          <option value="">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="delivered">Livrés</option>
          <option value="failed">Échoués</option>
          <option value="retry">En retry</option>
        </select>
      </div>

      {loading ? <Spinner /> : (
        <Card>
          {events.length === 0 ? (
            <EmptyState icon={<BellSlashIcon style={{ width: 40, height: 40, color: 'var(--af-border)' }} />} title="Aucun événement" desc="Les webhooks apparaîtront ici après les transactions." />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--af-surface-3)' }}>
                  {['Marchand', 'Type', 'Statut', 'Tentatives', 'Créé', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--af-border)' }}>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--af-text)' }}>{e.merchant_name}</td>
                    <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{e.event_type}</td>
                    <td style={{ padding: '11px 14px' }}><Badge status={e.status} label={STATUS_LABEL[e.status] || e.status} /></td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--af-text-muted)' }}>{e.attempts} / 4</td>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--af-text-muted)' }}>{e.created_at?.split('T')[0]}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setSelected(e)}
                          style={{ padding: '4px 10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                          Détail
                        </button>
                        {(e.status === 'failed') && (
                          <button onClick={() => retry(e.id)}
                            style={{ padding: '4px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, color: 'var(--af-accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ padding: '12px 0 0', borderTop: '1px solid var(--af-border)', marginTop: 8 }}>
            <Pagination page={page} total={total} limit={25} onPage={setPage} />
          </div>
        </Card>
      )}

      {/* Détail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title="Détail Webhook" maxWidth={600}>
        {selected && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                ['Marchand', selected.merchant_name],
                ['Type', selected.event_type],
                ['Statut', selected.status],
                ['Tentatives', `${selected.attempts} / 4`],
                ['Créé', selected.created_at],
                ['Dernier essai', selected.last_attempted_at || '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, color: 'var(--af-text)', fontFamily: k === 'Type' ? 'monospace' : 'inherit' }}>{v}</div>
                </div>
              ))}
            </div>
            {selected.error_log && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>ERREUR</div>
                <pre style={{ fontSize: 11, color: '#ef4444', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{selected.error_log}</pre>
              </div>
            )}
            {selected.parsedPayload || selected.payload ? (
              <div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  PAYLOAD
                  <CopyButton text={selected.payload || JSON.stringify(selected.parsedPayload, null, 2)} />
                </div>
                <pre style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: 12, fontSize: 11, color: '#10b981', margin: 0, overflowX: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(selected.parsedPayload || JSON.parse(selected.payload || '{}'), null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  )
}
