import React, { useEffect, useState } from 'react'
import api from '../../api.js'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const S_STYLE = { completed: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' }, failed: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' }, pending: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }, refunded: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' } }
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function MerchantTransactions() {
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(null)

  const load = () => {
    const params = new URLSearchParams({ page, limit: 20 })
    if (status) params.set('status', status)
    api.get(`/merchants/me/transactions?${params}`).then(r => {
      setTransactions(r.data.transactions)
      setTotal(r.data.total)
    })
  }

  useEffect(() => { load() }, [page, status])

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Mes Transactions ({total})</h1>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}
          style={{ padding: '10px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 14 }}>
          <option value="">Tous</option>
          <option value="completed">Complétées</option>
          <option value="pending">En attente</option>
          <option value="failed">Échouées</option>
        </select>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              {['Référence', 'Client', 'Statut', 'Montant brut', 'Reçu net', 'Remise Y%', 'Commission Z%', 'Opérateur', 'Date'].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => {
              const s = S_STYLE[tx.status] || S_STYLE.pending
              return (
                <tr key={tx.id} style={{ borderTop: '1px solid #334155', cursor: 'pointer' }} onClick={() => setSelected(tx)}>
                  <td style={{ padding: '12px 14px', fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{tx.reference?.slice(0, 16)}...</td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: 13, color: '#f1f5f9' }}>{tx.client_name || 'Invité'}</div>
                    {tx.client_loyalty_status && (
                      <div style={{ fontSize: 11, color: LOYALTY_COLOR[tx.client_loyalty_status] || '#64748b', marginTop: 2 }}>{tx.client_loyalty_status}</div>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ background: s.bg, color: s.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{tx.status}</span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>{fmt(tx.gross_amount)}</td>
                  <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#10b981' }}>{fmt(tx.merchant_receives)}</td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: LOYALTY_COLOR[tx.client_loyalty_status] || '#94a3b8' }}>
                    {tx.client_rebate_percent}% ({fmt(tx.client_rebate_amount)})
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#94a3b8' }}>
                    {tx.platform_commission_percent}% ({fmt(tx.platform_commission_amount)})
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

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Détail de la transaction</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ background: '#0f172a', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>X={selected.merchant_rebate_percent}%</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Remise accordée</div>
                  <div style={{ fontSize: 13, color: '#ef4444', marginTop: 4 }}>{fmt(selected.merchant_rebate_amount)} XOF</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: LOYALTY_COLOR[selected.client_loyalty_status] || '#94a3b8' }}>Y={selected.client_rebate_percent}%</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Remise client</div>
                  <div style={{ fontSize: 13, color: '#f59e0b', marginTop: 4 }}>{fmt(selected.client_rebate_amount)} XOF</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981' }}>Z={selected.platform_commission_percent}%</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Commission</div>
                  <div style={{ fontSize: 13, color: '#10b981', marginTop: 4 }}>{fmt(selected.platform_commission_amount)} XOF</div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid #334155', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#64748b' }}>Vous recevez</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>{fmt(selected.merchant_receives)} XOF</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[['Statut', selected.status], ['Mode', selected.rebate_mode], ['Client', selected.client_name || 'Invité'], ['Statut client', selected.client_loyalty_status || '—'], ['Opérateur', selected.payment_operator || '—'], ['Date', selected.initiated_at?.split('T')[0]]].map(([k, v]) => (
                <div key={k} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, color: '#f1f5f9' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
