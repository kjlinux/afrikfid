import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination, Select } from '../../components/ui.jsx'

const SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS']
const SEG_COLORS = { CHAMPIONS: 'green', FIDELES: 'blue', PROMETTEURS: 'yellow', A_RISQUE: 'orange', HIBERNANTS: 'gray', PERDUS: 'red' }

export default function AdminRFM() {
  const [stats, setStats] = useState(null)
  const [merchants, setMerchants] = useState([])
  const [selectedMerchant, setSelectedMerchant] = useState('')
  const [scores, setScores] = useState([])
  const [segment, setSegment] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const limit = 20

  useEffect(() => {
    api.get('/rfm/stats').then(r => setStats(r.data))
    api.get('/merchants', { params: { limit: 200 } }).then(r => setMerchants(r.data.merchants || []))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedMerchant) { setScores([]); setTotal(0); return }
    setLoading(true)
    const params = { page, limit }
    if (segment) params.segment = segment
    api.get(`/rfm/merchant/${selectedMerchant}`, { params }).then(r => {
      setScores(r.data.scores || [])
      setTotal(r.data.total || 0)
    }).finally(() => setLoading(false))
  }, [selectedMerchant, segment, page])

  const recalculate = () => {
    if (!selectedMerchant) return
    setLoading(true)
    api.post(`/rfm/merchant/${selectedMerchant}/calculate`).then(() => {
      setPage(1)
      api.get(`/rfm/merchant/${selectedMerchant}`, { params: { page: 1, limit } }).then(r => {
        setScores(r.data.scores || [])
        setTotal(r.data.total || 0)
      })
      api.get('/rfm/stats').then(r => setStats(r.data))
    }).finally(() => setLoading(false))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Segmentation RFM</h1>
        <div className="flex gap-2">
          <Select value={selectedMerchant} onChange={e => { setSelectedMerchant(e.target.value); setPage(1) }}>
            <option value="">Choisir un marchand</option>
            {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Select value={segment} onChange={e => { setSegment(e.target.value); setPage(1) }}>
            <option value="">Tous segments</option>
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          {selectedMerchant && (
            <button onClick={recalculate} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
              Recalculer
            </button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <div className="text-sm text-gray-500">Clients scores</div>
            <div className="text-2xl font-bold">{stats.total_clients}</div>
          </Card>
          <Card>
            <div className="text-sm text-gray-500">Marchands</div>
            <div className="text-2xl font-bold">{stats.total_merchants}</div>
          </Card>
          {(stats.segments || []).slice(0, 2).map(s => (
            <Card key={s.segment}>
              <div className="text-sm text-gray-500">{s.segment}</div>
              <div className="text-2xl font-bold"><Badge color={SEG_COLORS[s.segment]}>{s.count}</Badge></div>
            </Card>
          ))}
        </div>
      )}

      {stats && stats.segments && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Répartition globale</h2>
          <div className="flex flex-wrap gap-3">
            {stats.segments.map(s => (
              <div key={s.segment} className="flex items-center gap-2">
                <Badge color={SEG_COLORS[s.segment]}>{s.segment}</Badge>
                <span className="text-sm font-medium">{s.count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading && <Spinner />}

      {selectedMerchant && !loading && (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">R</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">F</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">M</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Segment</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Achats</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Montant total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {scores.map(s => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 text-sm font-medium">{s.full_name}<br/><span className="text-xs text-gray-400">{s.afrikfid_id}</span></td>
                    <td className="px-4 py-3 text-center text-sm font-bold">{s.r_score}</td>
                    <td className="px-4 py-3 text-center text-sm font-bold">{s.f_score}</td>
                    <td className="px-4 py-3 text-center text-sm font-bold">{s.m_score}</td>
                    <td className="px-4 py-3 text-center text-sm font-bold text-indigo-600">{s.rfm_total}</td>
                    <td className="px-4 py-3"><Badge color={SEG_COLORS[s.segment]}>{s.segment}</Badge></td>
                    <td className="px-4 py-3 text-sm text-right">{s.purchase_count}</td>
                    <td className="px-4 py-3 text-sm text-right">{Number(s.total_amount).toLocaleString()} FCFA</td>
                  </tr>
                ))}
                {scores.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Aucun score RFM</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onChange={setPage} />}
        </Card>
      )}
    </div>
  )
}
