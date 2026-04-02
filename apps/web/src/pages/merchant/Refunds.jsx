import React, { useEffect, useState } from 'react'
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline'
import api from '../../api.js'
import { Card, Badge, Pagination, Spinner, EmptyState, Modal } from '../../components/ui.jsx'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const STATUS_STYLE = {
  completed: { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'Complété' },
  pending:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  label: 'En attente' },
  failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   label: 'Échoué' },
  overdue:   { color: '#f97316', bg: 'rgba(249,115,22,0.1)',  label: 'En retard' },
}

const TYPE_LABEL = { full: 'Total', partial: 'Partiel' }
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6', ROYAL_ELITE: '#ec4899' }

export default function MerchantRefunds() {
  const [refunds, setRefunds] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [refundType, setRefundType] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 20 })
    if (status) params.set('status', status)
    if (refundType) params.set('refund_type', refundType)
    api.get(`/merchants/me/refunds?${params}`)
      .then(r => { setRefunds(r.data.refunds); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, status, refundType])

  const sel = s => STATUS_STYLE[s] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: s }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Mes Remboursements ({total})</h1>
      </div>

      {/* Filtres */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13 }}>
          <option value="">Tous les statuts</option>
          <option value="pending">En attente</option>
          <option value="completed">Complété</option>
          <option value="failed">Échoué</option>
          <option value="overdue">En retard</option>
        </select>
        <select value={refundType} onChange={e => { setRefundType(e.target.value); setPage(1) }}
          style={{ padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13 }}>
          <option value="">Tous les types</option>
          <option value="full">Remboursement total</option>
          <option value="partial">Remboursement partiel</option>
        </select>
      </div>

      {loading ? <Spinner /> : refunds.length === 0 ? (
        <EmptyState icon={<ArrowUturnLeftIcon style={{ width: 40, height: 40, color: '#334155' }} />} title="Aucun remboursement" description="Aucun remboursement trouvé pour les filtres sélectionnés." />
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Référence transaction', 'Type', 'Montant remboursé', 'Montant original', 'Client', 'Statut', 'Date', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {refunds.map(r => {
                const st = sel(r.status)
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '12px', color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{r.transaction_reference}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: r.refund_type === 'full' ? 'rgba(139,92,246,0.15)' : 'rgba(245,158,11,0.15)',
                        color: r.refund_type === 'full' ? '#8b5cf6' : '#f59e0b' }}>
                        {TYPE_LABEL[r.refund_type] || r.refund_type}
                      </span>
                    </td>
                    <td style={{ padding: '12px', color: '#ef4444', fontWeight: 600 }}>-{fmt(r.amount)} {r.currency}</td>
                    <td style={{ padding: '12px', color: '#94a3b8' }}>{fmt(r.original_amount)} {r.currency}</td>
                    <td style={{ padding: '12px' }}>
                      {r.client_name ? (
                        <span>
                          <span style={{ color: '#f1f5f9' }}>{r.client_name}</span>
                          {r.client_status && (
                            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: LOYALTY_COLOR[r.client_status] || '#94a3b8' }}>
                              {r.client_status}
                            </span>
                          )}
                        </span>
                      ) : <span style={{ color: '#475569' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px', color: '#64748b', fontSize: 12 }}>{fmtDate(r.created_at)}</td>
                    <td style={{ padding: '12px' }}>
                      <button onClick={() => setSelected(r)}
                        style={{ padding: '4px 10px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, color: '#818cf8', cursor: 'pointer', fontSize: 12 }}>
                        Détail
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination page={page} total={total} limit={20} onPage={setPage} />
        </Card>
      )}

      {/* Modal détail */}
      {selected && (
        <Modal title="Détail du remboursement" onClose={() => setSelected(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              ['ID remboursement', selected.id],
              ['Réf. transaction', selected.transaction_reference],
              ['Type', TYPE_LABEL[selected.refund_type] || selected.refund_type],
              ['Montant remboursé', `${fmt(selected.amount)} ${selected.currency}`],
              ['Montant original', `${fmt(selected.original_amount)} ${selected.currency}`],
              ['Statut', sel(selected.status).label],
              ['Client', selected.client_name || '—'],
              ['Statut fidélité', selected.client_status || '—'],
              ['Motif', selected.reason || '—'],
              ['Demandé le', fmtDate(selected.created_at)],
              ['Traité le', fmtDate(selected.processed_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 13, color: '#f1f5f9', wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
