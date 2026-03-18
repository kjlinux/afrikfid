import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { Card, Badge, Spinner } from '../../components/ui.jsx'

const SEG_COLORS = { CHAMPIONS: 'green', FIDELES: 'blue', PROMETTEURS: 'yellow', A_RISQUE: 'orange', HIBERNANTS: 'gray', PERDUS: 'red' }
const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth', PREMIUM: 'Premium' }

export default function MerchantIntelligence() {
  const { user } = useAuth()
  const merchantId = user?.id
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!merchantId) return
    api.get(`/merchant-intelligence/${merchantId}`).then(r => setData(r.data)).finally(() => setLoading(false))
  }, [merchantId])

  if (loading) return <Spinner />
  if (!data) return <div className="text-center text-gray-500 py-8">Aucune donnee disponible</div>

  const m = data.modules

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard Intelligence</h1>
        <Badge color="purple">{PKG_LABELS[data.package] || data.package}</Badge>
      </div>

      {/* KPIs basiques — tous packages */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="text-sm text-gray-500">Transactions</div>
          <div className="text-2xl font-bold">{Number(data.kpis?.total_transactions || 0).toLocaleString()}</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Chiffre d'affaires</div>
          <div className="text-2xl font-bold text-green-600">{Number(data.kpis?.total_revenue || 0).toLocaleString()} FCFA</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Panier moyen</div>
          <div className="text-2xl font-bold">{Math.round(Number(data.kpis?.avg_basket || 0)).toLocaleString()} FCFA</div>
        </Card>
        <Card>
          <div className="text-sm text-gray-500">Clients uniques</div>
          <div className="text-2xl font-bold">{Number(data.kpis?.unique_clients || 0).toLocaleString()}</div>
        </Card>
      </div>

      {/* RFM simplifiée — STARTER_PLUS+ */}
      {m.rfm_simple && data.rfm_stats && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Segmentation RFM</h2>
          <div className="flex flex-wrap gap-3">
            {(data.rfm_stats.segments || []).map(s => (
              <div key={s.segment} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                <Badge color={SEG_COLORS[s.segment]}>{s.segment}</Badge>
                <span className="text-lg font-bold">{s.count}</span>
              </div>
            ))}
          </div>
          {!m.rfm_detailed && (
            <p className="mt-3 text-sm text-indigo-600">Passez au package Growth pour voir le detail par segment et les actions recommandees.</p>
          )}
        </Card>
      )}

      {!m.rfm_simple && (
        <Card className="mb-6 border-dashed border-2 border-indigo-300 bg-indigo-50">
          <div className="text-center py-6">
            <h3 className="text-lg font-semibold text-indigo-700">Segmentation RFM</h3>
            <p className="text-sm text-indigo-500 mt-1">Disponible a partir du package Starter Plus</p>
            <button className="mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">Upgrade</button>
          </div>
        </Card>
      )}

      {/* RFM détaillé + actions — GROWTH+ */}
      {m.rfm_detailed && data.rfm_details && (
        <>
          <Card className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Detail par segment</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Segment</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Clients</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Montant moyen</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Achats moyens</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action recommandee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.rfm_details.map(d => (
                    <tr key={d.segment}>
                      <td className="px-4 py-3"><Badge color={SEG_COLORS[d.segment]}>{d.segment}</Badge></td>
                      <td className="px-4 py-3 text-sm text-right font-bold">{d.count}</td>
                      <td className="px-4 py-3 text-sm text-right">{Number(d.avg_amount).toLocaleString()} FCFA</td>
                      <td className="px-4 py-3 text-sm text-right">{d.avg_purchases}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{data.recommended_actions?.[d.segment] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {data.recent_campaigns && data.recent_campaigns.length > 0 && (
            <Card className="mb-6">
              <h2 className="text-lg font-semibold mb-3">Campagnes recentes</h2>
              {data.recent_campaigns.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <span className="font-medium text-sm">{c.name}</span>
                    <Badge color="blue" className="ml-2">{c.target_segment}</Badge>
                  </div>
                  <div className="text-sm text-gray-500">{c.total_sent} envoyes / {c.total_converted} convertis</div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {/* Analytics avancés — PREMIUM */}
      {m.analytics_advanced && data.ltv_by_segment && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold mb-3">LTV par segment</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {data.ltv_by_segment.map(l => (
              <div key={l.segment} className="p-3 bg-gray-50 rounded-lg">
                <Badge color={SEG_COLORS[l.segment]}>{l.segment}</Badge>
                <div className="text-lg font-bold mt-1">{Number(l.avg_ltv).toLocaleString()} FCFA</div>
                <div className="text-xs text-gray-500">{l.avg_frequency} achats moy.</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!m.analytics_advanced && m.rfm_detailed && (
        <Card className="mb-6 border-dashed border-2 border-purple-300 bg-purple-50">
          <div className="text-center py-6">
            <h3 className="text-lg font-semibold text-purple-700">Analytics Avances (LTV, Elasticite)</h3>
            <p className="text-sm text-purple-500 mt-1">Disponible avec le package Premium</p>
            <button className="mt-3 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">Upgrade</button>
          </div>
        </Card>
      )}
    </div>
  )
}
