import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { fmt, Card, Spinner, LoyaltyBadge, Pagination, exportCsv } from '../../components/ui.jsx'

const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function MerchantClients() {
  const [clients, setClients] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)

  const LIMIT = 20

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: LIMIT })
    if (filter !== 'all') params.set('loyalty_status', filter)
    api.get(`/merchants/me/clients?${params}`).then(r => {
      setClients(r.data.clients || [])
      setTotal(r.data.total || 0)
      setStats(r.data.stats || null)
    }).finally(() => setLoading(false))
  }, [page, filter])

  useEffect(() => { load() }, [load])

  const handleExport = () => {
    exportCsv(clients, [
      { label: 'ID Afrik\'Fid', key: 'afrikfidId' },
      { label: 'Nom', key: 'clientName' },
      { label: 'Statut fidélité', key: 'loyaltyStatus' },
      { label: 'Transactions', key: 'txCount' },
      { label: 'Volume total', key: 'totalVolume' },
      { label: 'Dernière transaction', key: 'lastTx' },
    ], 'mes-clients-fideles.csv')
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Clients Fidélisés</h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Clients Afrik'Fid ayant effectué au moins une transaction chez vous</p>
        </div>
        <button onClick={handleExport}
          style={{ padding: '8px 16px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          ↓ Export CSV
        </button>
      </div>

      {/* Stats par statut */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {['OPEN', 'LIVE', 'GOLD', 'ROYAL'].map(s => {
            const count = stats.byStatus?.find(b => b.loyalty_status === s)?.count || 0
            const color = LOYALTY_COLOR[s]
            const icon = s === 'ROYAL' ? '👑' : s === 'GOLD' ? '🥇' : s === 'LIVE' ? '⭐' : '○'
            return (
              <button key={s} onClick={() => { setFilter(s === filter ? 'all' : s); setPage(1) }}
                style={{
                  background: filter === s ? `${color}22` : '#1e293b',
                  border: `1px solid ${filter === s ? color : '#334155'}`,
                  borderRadius: 12, padding: '16px 20px', cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color }}>{count}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{s}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filtre actif */}
      {filter !== 'all' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Filtré par :</span>
          <span style={{ background: `${LOYALTY_COLOR[filter]}22`, color: LOYALTY_COLOR[filter], padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{filter}</span>
          <button onClick={() => { setFilter('all'); setPage(1) }}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}>✕ effacer</button>
        </div>
      )}

      <Card title={`${total} client${total > 1 ? 's' : ''} fidélisé${total > 1 ? 's' : ''}`}>
        {loading ? <Spinner /> : clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b', fontSize: 14 }}>
            Aucun client pour ce filtre.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Client', 'Statut fidélité', 'Transactions', 'Volume total', 'Remises reçues', 'Dernière visite'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.clientId} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px 12px' }}>
                    <div style={{ fontWeight: 600, color: '#f1f5f9' }}>{c.clientName || 'Client anonyme'}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{c.afrikfidId}</div>
                  </td>
                  <td style={{ padding: '12px 12px' }}>
                    <LoyaltyBadge status={c.loyaltyStatus} />
                  </td>
                  <td style={{ padding: '12px 12px', color: '#f1f5f9', fontWeight: 600 }}>{c.txCount}</td>
                  <td style={{ padding: '12px 12px', color: '#10b981', fontWeight: 600 }}>{fmt(c.totalVolume)} XOF</td>
                  <td style={{ padding: '12px 12px', color: '#3b82f6' }}>{fmt(c.totalRebates)} XOF</td>
                  <td style={{ padding: '12px 12px', color: '#64748b', fontSize: 12 }}>
                    {c.lastTx ? new Date(c.lastTx).toLocaleDateString('fr-FR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > LIMIT && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
            <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  )
}
