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

  if (loading) return <Spinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Abonnements Marchands</h1>
        <div className="flex gap-2">
          <Select value={filterPkg} onChange={e => { setFilterPkg(e.target.value); setPage(1) }}>
            <option value="">Tous les packages</option>
            {PACKAGES.map(p => <option key={p} value={p}>{PKG_LABELS[p]}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {PACKAGES.map(pkg => {
          const count = subs.filter(s => s.package === pkg).length
          return (
            <Card key={pkg}>
              <div className="text-sm text-gray-500">{PKG_LABELS[pkg]}</div>
              <div className="text-2xl font-bold">{count}</div>
            </Card>
          )
        })}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marchand</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Package</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mensualité</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Réduction recrutement</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Prochaine facturation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {subs.map(s => (
                <tr key={s.id}>
                  <td className="px-4 py-3 text-sm font-medium">{s.merchant_name || s.merchant_email}</td>
                  <td className="px-4 py-3"><Badge color={PKG_COLORS[s.package]}>{PKG_LABELS[s.package] || s.package}</Badge></td>
                  <td className="px-4 py-3 text-sm">
                    {s.effective_monthly_fee !== s.base_monthly_fee ? (
                      <span>
                        <span className="line-through text-gray-400">{Number(s.base_monthly_fee).toLocaleString()} FCFA</span>{' '}
                        <span className="font-semibold text-green-600">{Number(s.effective_monthly_fee).toLocaleString()} FCFA</span>
                      </span>
                    ) : (
                      <span>{Number(s.base_monthly_fee).toLocaleString()} FCFA</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {s.recruitment_discount_percent > 0 ? (
                      <Badge color="green">-{s.recruitment_discount_percent}% ({s.recruited_clients_count} clients)</Badge>
                    ) : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3"><Badge color={s.status === 'active' ? 'green' : 'red'}>{s.status}</Badge></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.next_billing_at ? new Date(s.next_billing_at).toLocaleDateString() : '-'}</td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Aucun abonnement</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > limit && <Pagination page={page} total={total} limit={limit} onChange={setPage} />}
      </Card>
    </div>
  )
}
