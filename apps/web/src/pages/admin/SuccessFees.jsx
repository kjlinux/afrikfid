import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'

const STATUS_COLORS = { calculated: 'blue', invoiced: 'yellow', paid: 'green', waived: 'gray' }

export default function AdminSuccessFees() {
  const [fees, setFees] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = () => {
    setLoading(true)
    api.get('/success-fees', { params: { page, limit } }).then(r => {
      setFees(r.data.fees || [])
      setTotal(r.data.total || 0)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/success-fees/${id}/status`, { status })
      load()
    } catch { /* ignore */ }
  }

  if (loading) return <Spinner />

  const totalFees = fees.reduce((s, f) => s + parseFloat(f.fee_amount || 0), 0)
  const totalGrowth = fees.reduce((s, f) => s + parseFloat(f.growth_amount || 0), 0)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Success Fees</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="text-sm text-gray-500">Total Fees (page)</div>
          <div className="text-2xl font-bold text-green-600">{totalFees.toLocaleString()} FCFA</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Croissance Cumulee (page)</div>
          <div className="text-2xl font-bold">{totalGrowth.toLocaleString()} FCFA</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Nombre de fees</div>
          <div className="text-2xl font-bold">{total}</div>
        </Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marchand</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Periode</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Panier ref.</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Panier actuel</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Croissance</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Fee ({`%`})</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Montant fee</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {fees.map(f => (
                <tr key={f.id}>
                  <td className="px-4 py-3 text-sm font-medium">{f.merchant_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(f.period_start).toLocaleDateString()} - {new Date(f.period_end).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-right">{Number(f.reference_avg_basket).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right">{Number(f.current_avg_basket).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-green-600">+{Number(f.growth_amount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right">{f.fee_percent}%</td>
                  <td className="px-4 py-3 text-sm text-right font-bold">{Number(f.fee_amount).toLocaleString()} FCFA</td>
                  <td className="px-4 py-3"><Badge color={STATUS_COLORS[f.status]}>{f.status}</Badge></td>
                  <td className="px-4 py-3 text-sm">
                    {f.status === 'calculated' && (
                      <button onClick={() => updateStatus(f.id, 'invoiced')} className="text-blue-600 hover:underline text-xs">Facturer</button>
                    )}
                    {f.status === 'invoiced' && (
                      <button onClick={() => updateStatus(f.id, 'paid')} className="text-green-600 hover:underline text-xs">Marquer paye</button>
                    )}
                  </td>
                </tr>
              ))}
              {fees.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Aucun success fee calcule</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > limit && <Pagination page={page} total={total} limit={limit} onChange={setPage} />}
      </Card>
    </div>
  )
}
