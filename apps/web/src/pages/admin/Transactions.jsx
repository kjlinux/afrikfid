import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { exportCsv, exportPdf } from '../../components/ui.jsx'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const STATUS_STYLE = { completed: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' }, failed: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' }, pending: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }, refunded: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' } }
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function AdminTransactions() {
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ status: '', loyalty_status: '' })
  const [selected, setSelected] = useState(null)

  const load = () => {
    const params = new URLSearchParams({ page, limit: 20 })
    if (filters.status) params.set('status', filters.status)
    if (filters.loyalty_status) params.set('loyalty_status', filters.loyalty_status)
    api.get(`/reports/transactions?${params}`).then(r => {
      setTransactions(r.data.transactions)
      setTotal(r.data.total)
    })
  }

  useEffect(() => { load() }, [page, filters])

  const TX_COLS = [
    { label: 'Référence', key: 'reference' },
    { label: 'Marchand', key: 'merchant_name' },
    { label: 'Client', key: 'client_name' },
    { label: 'Montant brut', value: r => fmt(r.gross_amount) },
    { label: 'X%', key: 'merchant_rebate_percent' },
    { label: 'Y%', key: 'client_rebate_percent' },
    { label: 'Z%', key: 'platform_commission_percent' },
    { label: 'Statut client', key: 'client_loyalty_status' },
    { label: 'Statut tx', key: 'status' },
    { label: 'Opérateur', key: 'payment_operator' },
    { label: 'Date', value: r => r.initiated_at ? new Date(r.initiated_at).toLocaleDateString('fr-FR') : '' },
  ]

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Transactions ({total})</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportCsv(transactions, TX_COLS, 'transactions.csv')}
            style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ CSV
          </button>
          <button onClick={() => exportPdf(transactions, TX_COLS, 'Rapport Transactions', `${total} transactions`)}
            style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ PDF
          </button>
          <button onClick={() => { const params = new URLSearchParams(filters); window.location.href = `/api/v1/reports/transactions/excel?${params}` }}
            style={{ padding: '7px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, color: '#22c55e', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ Excel
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          style={{ padding: '10px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 14 }}>
          <option value="">Tous les statuts</option>
          <option value="completed">Complétées</option>
          <option value="pending">En attente</option>
          <option value="failed">Échouées</option>
          <option value="refunded">Remboursées</option>
        </select>
        <select value={filters.loyalty_status} onChange={e => setFilters(f => ({ ...f, loyalty_status: e.target.value }))}
          style={{ padding: '10px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 14 }}>
          <option value="">Tous statuts client</option>
          <option value="OPEN">Open</option>
          <option value="LIVE">Live</option>
          <option value="GOLD">Gold</option>
          <option value="ROYAL">Royal</option>
        </select>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              {['Référence', 'Marchand', 'Client', 'Montant', 'X%', 'Y%', 'Z%', 'Statut', 'Opérateur', 'Date'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => {
              const s = STATUS_STYLE[tx.status] || STATUS_STYLE.pending
              const lc = LOYALTY_COLOR[tx.client_loyalty_status] || '#6B7280'
              return (
                <tr key={tx.id} style={{ borderTop: '1px solid #334155', cursor: 'pointer' }} onClick={() => setSelected(tx)}>
                  <td style={{ padding: '12px 14px', fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{tx.reference}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: '#f1f5f9' }}>{tx.merchant_name}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: '#94a3b8' }}>{tx.client_name || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>{fmt(tx.gross_amount)}</td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#ef4444' }}>{tx.merchant_rebate_percent}%</td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: lc }}>{tx.client_rebate_percent}%</td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#10b981' }}>{tx.platform_commission_percent}%</td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ background: s.bg, color: s.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{tx.status}</span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#94a3b8' }}>{tx.payment_operator || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: 11, color: '#64748b' }}>{tx.initiated_at?.split('T')[0]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{total} transactions</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={{ padding: '6px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page === 1 ? '#334155' : '#94a3b8', cursor: page === 1 ? 'default' : 'pointer' }}>←</button>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page * 20 >= total ? '#334155' : '#94a3b8', cursor: page * 20 >= total ? 'default' : 'pointer' }}>→</button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, width: '100%', maxWidth: 540, border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Détail Transaction</h2>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#f59e0b', marginBottom: 16, background: '#0f172a', padding: 10, borderRadius: 8 }}>
              {selected.reference}
            </div>

            {/* Distribution visuelle X/Y/Z */}
            <div style={{ background: '#0f172a', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16, fontWeight: 600 }}>RÉPARTITION X/Y/Z</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: 12, border: '1px solid rgba(239,68,68,0.3)' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>X = {selected.merchant_rebate_percent}%</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Remise marchand</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444', marginTop: 6 }}>{fmt(selected.merchant_rebate_amount)} XOF</div>
                </div>
                <div style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: 12, border: `1px solid ${LOYALTY_COLOR[selected.client_loyalty_status]}44` }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: LOYALTY_COLOR[selected.client_loyalty_status] || '#94a3b8' }}>Y = {selected.client_rebate_percent}%</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Remise client ({selected.client_loyalty_status})</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: LOYALTY_COLOR[selected.client_loyalty_status], marginTop: 6 }}>{fmt(selected.client_rebate_amount)} XOF</div>
                </div>
                <div style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: 12, border: '1px solid rgba(16,185,129,0.3)' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>Z = {selected.platform_commission_percent}%</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Commission Afrik'Fid</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#10b981', marginTop: 6 }}>{fmt(selected.platform_commission_amount)} XOF</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid #334155' }}>
                <span style={{ color: '#64748b', fontSize: 13 }}>Montant brut</span>
                <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 16 }}>{fmt(selected.gross_amount)} XOF</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: '#64748b', fontSize: 13 }}>Marchand reçoit</span>
                <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 15 }}>{fmt(selected.merchant_receives)} XOF</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Marchand', selected.merchant_name],
                ['Client', selected.client_name || 'Invité'],
                ['Opérateur', selected.payment_operator || '—'],
                ['Mode remise', selected.rebate_mode],
                ['Date', selected.initiated_at?.split('T')[0]],
              ].map(([k, v]) => (
                <div key={k} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
