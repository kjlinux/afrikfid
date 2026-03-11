import React, { useEffect, useState } from 'react'
import api from '../../api.js'

const BADGE = { OPEN: { color: '#6B7280', bg: 'rgba(107,114,128,0.15)' }, LIVE: { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' }, GOLD: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' }, ROYAL: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)' } }
const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

export default function AdminClients() {
  const [clients, setClients] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [clientDetail, setClientDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 15 })
    if (q) params.set('q', q)
    if (statusFilter) params.set('status', statusFilter)
    api.get(`/clients?${params}`).then(r => {
      setClients(r.data.clients)
      setTotal(r.data.total)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [page, q, statusFilter])

  const openDetail = async client => {
    setSelected(client)
    const r = await api.get(`/clients/${client.id}/profile`)
    setClientDetail(r.data)
  }

  const updateStatus = async (id, status) => {
    await api.patch(`/clients/${id}/loyalty-status`, { status })
    load()
    if (selected?.id === id) openDetail({ id })
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Clients Afrik'Fid ({total})</h1>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Rechercher (nom, téléphone, ID Afrik'Fid)..."
          style={{ flex: 1, padding: '10px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          style={{ padding: '10px 14px', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 14 }}>
          <option value="">Tous les statuts</option>
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
              {['ID Afrik\'Fid', 'Nom', 'Téléphone', 'Statut fidélité', 'Achats', 'Volume', 'Wallet', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Chargement...</td></tr>
            ) : clients.map(c => {
              const badge = BADGE[c.loyaltyStatus] || BADGE.OPEN
              return (
                <tr key={c.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>{c.afrikfidId}</td>
                  <td style={{ padding: '12px 16px', fontSize: 14, color: '#f1f5f9', fontWeight: 500 }}>{c.fullName}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8' }}>{c.phone}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ background: badge.bg, color: badge.color, padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                      {c.loyaltyStatus}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#94a3b8' }}>{c.totalPurchases}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>{fmt(c.totalAmount)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: '#10b981', fontWeight: 600 }}>{fmt(c.walletBalance)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button onClick={() => openDetail(c)}
                      style={{ padding: '4px 10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>
                      Détails
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{total} clients</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              style={{ padding: '6px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page === 1 ? '#334155' : '#94a3b8', cursor: page === 1 ? 'default' : 'pointer' }}>←</button>
            <button disabled={page * 15 >= total} onClick={() => setPage(p => p + 1)}
              style={{ padding: '6px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page * 15 >= total ? '#334155' : '#94a3b8', cursor: page * 15 >= total ? 'default' : 'pointer' }}>→</button>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 }}>
          <div style={{ width: 480, background: '#1e293b', borderLeft: '1px solid #334155', padding: 28, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{selected.fullName}</h2>
              <button onClick={() => { setSelected(null); setClientDetail(null) }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            {clientDetail && (
              <>
                <div style={{ background: '#0f172a', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {[
                      ['ID Afrik\'Fid', selected.afrikfidId],
                      ['Téléphone', selected.phone],
                      ['Email', selected.email || '—'],
                      ['Pays', selected.countryId],
                      ['Inscrit le', selected.createdAt?.split('T')[0]],
                      ['Statut depuis', selected.statusSince?.split('T')[0]],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>{k}</div>
                        <div style={{ fontSize: 13, color: '#f1f5f9' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Loyalty status */}
                <div style={{ background: '#0f172a', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12, fontWeight: 600 }}>STATUT FIDÉLITÉ</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['OPEN', 'LIVE', 'GOLD', 'ROYAL'].map(s => {
                      const b = BADGE[s]
                      const isCurrent = selected.loyaltyStatus === s
                      return (
                        <button key={s} onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, loyaltyStatus: s })) }}
                          style={{ padding: '6px 14px', border: `2px solid ${isCurrent ? b.color : '#334155'}`, borderRadius: 20, background: isCurrent ? b.bg : 'transparent', color: isCurrent ? b.color : '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                          {s}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Achats', value: clientDetail.stats?.count || 0 },
                    { label: 'Volume XOF', value: fmt(clientDetail.stats?.total) },
                    { label: 'Wallet', value: `${fmt(clientDetail.wallet?.balance)} XOF` },
                  ].map(s => (
                    <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
