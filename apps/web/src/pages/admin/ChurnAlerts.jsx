import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'

const SEGMENT_COLORS = { A_RISQUE: 'red', HIBERNANTS: 'orange', PERDUS: 'gray', CHAMPIONS: 'green', FIDELES: 'blue', PROMETTEURS: 'yellow' }

export default function AdminChurnAlerts() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = () => {
    setLoading(true)
    api.get('/campaigns/churn-alerts', { params: { page, limit } })
      .then(r => {
        setData(r.data.data || r.data.clients || r.data.alerts || [])
        setTotal(r.data.pagination?.total || r.data.total || 0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Alertes Churn</h1>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Actualiser</button>
      </div>

      <Card>
        <div className="p-4 font-semibold text-gray-700 border-b">
          Clients à risque de churn (segments A_RISQUE & HIBERNANTS)
        </div>
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : data.length === 0 ? (
          <div className="text-center text-gray-500 py-12">Aucune alerte de churn en ce moment</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Client', 'Marchand', 'Segment RFM', 'Score R', 'Score F', 'Score M', 'Dernier achat'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.map((row, i) => (
                  <tr key={row.id || i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.client_name || row.full_name || row.client_id}</td>
                    <td className="px-4 py-3 text-gray-600">{row.merchant_name || row.merchant_id}</td>
                    <td className="px-4 py-3">
                      <Badge color={SEGMENT_COLORS[row.segment] || 'gray'}>{row.segment}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center font-mono">{row.r_score ?? '—'}</td>
                    <td className="px-4 py-3 text-center font-mono">{row.f_score ?? '—'}</td>
                    <td className="px-4 py-3 text-center font-mono">{row.m_score ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {row.last_purchase_at ? new Date(row.last_purchase_at).toLocaleDateString('fr-FR') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > limit && (
          <div className="p-4 border-t">
            <Pagination page={page} total={total} limit={limit} onChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  )
}
