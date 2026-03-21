import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'

const STEP_LABELS = [
  'Étape 1 — Win-back -15%',
  'Étape 2 — Vous nous manquez (-20%)',
  'Étape 3 — Dernière chance (-30%)',
  'Étape 4 — Enquête départ',
  'Étape 5 — PERDU définitif',
]

const STATUS_COLORS = { active: 'yellow', reactivated: 'green', lost: 'red', cancelled: 'gray' }

export default function AdminAbandonProtocol() {
  const [data, setData] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get('/campaigns/abandon', { params: { page, limit } }),
      api.get('/campaigns/abandon/stats').catch(() => ({ data: null })),
    ]).then(([res, statsRes]) => {
      setData(res.data.trackings || [])
      setTotal(res.data.total || 0)
      setStats(statsRes.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Protocole d'abandon</h1>
        <button
          onClick={load}
          disabled={loading}
          className={`text-sm text-blue-600 hover:underline ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {loading ? 'Chargement...' : 'Actualiser'}
        </button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {STEP_LABELS.map((label, i) => (
            <Card key={i} className="p-4 text-center">
              <div className="text-2xl font-bold text-gray-800">{stats[`step_${i + 1}`] || 0}</div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div className="p-4 font-semibold text-gray-700 border-b">Clients en protocole d'abandon</div>
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : data.length === 0 ? (
          <div className="text-center text-gray-500 py-12">Aucun client en protocole d'abandon</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Client', 'Marchand', 'Étape', 'Statut', 'Prochaine action', 'Démarré le'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.client_name || row.client_id}</td>
                    <td className="px-4 py-3 text-gray-600">{row.merchant_name || row.merchant_id}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                        Étape {row.current_step}/5
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={STATUS_COLORS[row.status] || 'gray'}>{row.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {row.next_step_at ? new Date(row.next_step_at).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(row.created_at).toLocaleDateString('fr-FR')}
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
