import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Button, Spinner, Pagination, Select } from '../../components/ui.jsx'

const PACKAGES = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']
const PKG_COLORS = { STARTER_BOOST: 'yellow', STARTER_PLUS: 'blue', GROWTH: 'green', PREMIUM: 'purple' }
const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium Performance' }

export default function AdminSubscriptions() {
  const [subs, setSubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterPkg, setFilterPkg] = useState('')
  const limit = 20

  const load = () => {
    setLoading(true)
    const params = { page, limit }
    if (filterPkg) params.package = filterPkg
    api.get('/subscriptions', { params }).then(r => {
      setSubs(r.data.subscriptions || [])
      setTotal(r.data.total || 0)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, filterPkg])

  const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #334155', textAlign: 'left' }
  const td = { padding: '10px 14px', fontSize: 13, color: '#94a3b8', borderBottom: '1px solid #1e293b' }
  const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }
  const PKG_HEX = { STARTER_BOOST: '#64748b', STARTER_PLUS: '#3b82f6', GROWTH: '#10b981', PREMIUM: '#f59e0b' }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Abonnements Marchands</h1>
        <Select value={filterPkg} onChange={e => { setFilterPkg(e.target.value); setPage(1) }}>
          <option value="">Tous les packages</option>
          {PACKAGES.map(p => <option key={p} value={p}>{PKG_LABELS[p]}</option>)}
        </Select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {PACKAGES.map(pkg => {
          const count = subs.filter(s => s.package === pkg).length
          const hex = PKG_HEX[pkg] || '#64748b'
          return (
            <div key={pkg} style={{ ...card }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{PKG_LABELS[pkg]}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: hex }}>{count}</div>
            </div>
          )
        })}
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Marchand', 'Package', 'Mensualité', 'Réduction recrutement', 'Statut', 'Prochaine facturation'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id}>
                  <td style={{ ...td, color: '#f1f5f9', fontWeight: 600 }}>{s.merchant_name || s.merchant_email}</td>
                  <td style={td}><Badge color={PKG_COLORS[s.package]}>{PKG_LABELS[s.package] || s.package}</Badge></td>
                  <td style={td}>
                    {s.effective_monthly_fee !== s.base_monthly_fee ? (
                      <span>
                        <span style={{ textDecoration: 'line-through', color: '#475569' }}>{Number(s.base_monthly_fee).toLocaleString()} FCFA</span>{' '}
                        <span style={{ fontWeight: 700, color: '#10b981' }}>{Number(s.effective_monthly_fee).toLocaleString()} FCFA</span>
                      </span>
                    ) : <span>{Number(s.base_monthly_fee).toLocaleString()} FCFA</span>}
                  </td>
                  <td style={td}>
                    {s.recruitment_discount_percent > 0
                      ? <Badge color="green">-{s.recruitment_discount_percent}% ({s.recruited_clients_count} clients)</Badge>
                      : <span style={{ color: '#475569' }}>—</span>}
                  </td>
                  <td style={td}><Badge color={s.status === 'active' ? 'green' : 'red'}>{s.status}</Badge></td>
                  <td style={td}>{s.next_billing_at ? new Date(s.next_billing_at).toLocaleDateString('fr-FR') : '—'}</td>
                </tr>
              ))}
              {subs.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 32 }}>Aucun abonnement</td></tr>}
            </tbody>
          </table>
        </div>
        {total > limit && <Pagination page={page} total={total} limit={limit} onChange={setPage} />}
      </div>
    </div>
  )
}
