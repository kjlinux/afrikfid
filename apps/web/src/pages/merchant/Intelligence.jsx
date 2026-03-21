import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { Badge, Spinner } from '../../components/ui.jsx'

const SEG_COLOR = { CHAMPIONS: '#10b981', FIDELES: '#3b82f6', PROMETTEURS: '#f59e0b', A_RISQUE: '#f97316', HIBERNANTS: '#6b7280', PERDUS: '#ef4444' }
const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth', PREMIUM: 'Premium' }
const PKG_COLOR = { STARTER_BOOST: '#64748b', STARTER_PLUS: '#3b82f6', GROWTH: '#8b5cf6', PREMIUM: '#f59e0b' }
const PRIO_COLOR = { haute: '#ef4444', moyenne: '#f59e0b', faible: '#6b7280' }

const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }
const upgCard = { ...card, borderStyle: 'dashed', borderColor: '#8b5cf6', background: 'rgba(139,92,246,0.06)', textAlign: 'center', padding: '32px 24px' }

function AiInsightsSection() {
  const [insights, setInsights] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadInsights = useCallback(() => {
    setLoading(true)
    setError(null)
    api.get('/merchants/me/ai-insights')
      .then(r => setInsights(r.data))
      .catch(e => setError(e.response?.data?.message || 'Erreur lors de la génération des insights'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ ...card, borderColor: '#8b5cf6' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🤖</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Recommandations IA</div>
            <div style={{ fontSize: 11, color: '#8b5cf6' }}>Powered by Claude · Exclusif PREMIUM</div>
          </div>
        </div>
        <button onClick={loadInsights} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? '#334155' : '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading ? <Spinner size="sm" /> : '✨'}
          {loading ? 'Analyse...' : insights ? 'Régénérer' : 'Générer les insights'}
        </button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {!insights && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#8b5cf6' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🧠</div>
          <p style={{ fontSize: 13, color: '#64748b' }}>Cliquez sur "Générer les insights" pour obtenir des recommandations personnalisées basées sur vos données RFM.</p>
        </div>
      )}

      {insights && (
        <div>
          {insights.resume && (
            <div style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#c4b5fd', fontStyle: 'italic', marginBottom: 14 }}>{insights.resume}</div>
          )}
          {insights.alerte && (
            <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{insights.alerte}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(insights.recommandations || []).map((rec, i) => (
              <div key={i} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{rec.titre}</span>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (SEG_COLOR[rec.segment] || '#6b7280') + '22', color: SEG_COLOR[rec.segment] || '#6b7280', border: '1px solid ' + (SEG_COLOR[rec.segment] || '#6b7280') + '44' }}>{rec.segment}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (PRIO_COLOR[rec.priorite] || '#6b7280') + '22', color: PRIO_COLOR[rec.priorite] || '#6b7280', border: '1px solid ' + (PRIO_COLOR[rec.priorite] || '#6b7280') + '44' }}>{rec.priorite}</span>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>📋 {rec.action}</p>
                <p style={{ fontSize: 11, color: '#10b981' }}>🎯 {rec.objectif}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#475569' }}>
            <span>Généré le {new Date(insights.generated_at).toLocaleString('fr-FR')}</span>
            <span>{insights.context_snapshot?.total_clients_segmented || 0} clients analysés</span>
          </div>
        </div>
      )}
    </div>
  )
}

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
  if (!data) return <div style={{ textAlign: 'center', color: '#64748b', padding: 32 }}>Aucune donnée disponible</div>

  const m = data.modules
  const pkg = data.package
  const pkgColor = PKG_COLOR[pkg] || '#64748b'

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Dashboard Intelligence</h1>
        <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: pkgColor + '22', color: pkgColor, border: '1px solid ' + pkgColor + '44' }}>{PKG_LABELS[pkg] || pkg}</span>
      </div>

      {/* KPIs — tous packages */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Transactions', value: Number(data.kpis?.total_transactions || 0).toLocaleString(), color: '#f1f5f9' },
          { label: "Chiffre d'affaires", value: Number(data.kpis?.total_revenue || 0).toLocaleString() + ' FCFA', color: '#10b981' },
          { label: 'Panier moyen', value: Math.round(Number(data.kpis?.avg_basket || 0)).toLocaleString() + ' FCFA', color: '#f59e0b' },
          { label: 'Clients uniques', value: Number(data.kpis?.unique_clients || 0).toLocaleString(), color: '#3b82f6' },
        ].map(k => (
          <div key={k.label} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Segmentation RFM — STARTER_PLUS+ */}
      {m.rfm_simple && data.rfm_stats && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>Segmentation RFM</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {(data.rfm_stats.segments || []).map(s => (
              <div key={s.segment} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#0f172a', borderRadius: 8, border: '1px solid #334155' }}>
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (SEG_COLOR[s.segment] || '#6b7280') + '22', color: SEG_COLOR[s.segment] || '#6b7280' }}>{s.segment}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>{s.count}</span>
              </div>
            ))}
          </div>
          {!m.rfm_detailed && <p style={{ marginTop: 12, fontSize: 12, color: '#8b5cf6' }}>Passez au package Growth pour voir le détail par segment et les actions recommandées.</p>}
        </div>
      )}

      {!m.rfm_simple && (
        <div style={upgCard}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Segmentation RFM</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Disponible à partir du package Starter Plus</p>
          <a href="/merchant/settings" style={{ padding: '8px 18px', background: '#3b82f6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Upgrade</a>
        </div>
      )}

      {/* RFM détaillé — GROWTH+ */}
      {m.rfm_detailed && data.rfm_details && (
        <>
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>Détail par segment</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    {['Segment', 'Clients', 'Montant moyen', 'Achats moy.', 'Action recommandée'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: i > 0 && i < 4 ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rfm_details.map(d => (
                    <tr key={d.segment} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (SEG_COLOR[d.segment] || '#6b7280') + '22', color: SEG_COLOR[d.segment] || '#6b7280' }}>{d.segment}</span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#f1f5f9' }}>{d.count}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#94a3b8' }}>{Number(d.avg_amount).toLocaleString()} FCFA</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#94a3b8' }}>{d.avg_purchases}</td>
                      <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 12 }}>{data.recommended_actions?.[d.segment] || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.recent_campaigns && data.recent_campaigns.length > 0 && (
            <div style={card}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>Campagnes récentes</div>
              {data.recent_campaigns.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < data.recent_campaigns.length - 1 ? '1px solid #334155' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{c.name}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#3b82f622', color: '#3b82f6' }}>{c.target_segment}</span>
                  </div>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{c.total_sent} envoyés / {c.total_converted} convertis</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Analytics avancés LTV — PREMIUM */}
      {m.analytics_advanced && data.ltv_by_segment && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>LTV par segment</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {data.ltv_by_segment.map(l => (
              <div key={l.segment} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '14px 16px' }}>
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (SEG_COLOR[l.segment] || '#6b7280') + '22', color: SEG_COLOR[l.segment] || '#6b7280' }}>{l.segment}</span>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', marginTop: 8 }}>{Number(l.avg_ltv).toLocaleString()} FCFA</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{l.avg_frequency} achats moy.</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!m.analytics_advanced && m.rfm_detailed && (
        <div style={upgCard}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Analytics Avancés (LTV, Élasticité)</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Disponible avec le package Premium</p>
          <a href="/merchant/settings" style={{ padding: '8px 18px', background: '#8b5cf6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Upgrade</a>
        </div>
      )}

      {/* Recommandations IA — PREMIUM */}
      {m.analytics_advanced && <AiInsightsSection />}

      {!m.analytics_advanced && !m.rfm_simple && (
        <div style={upgCard}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Recommandations IA</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Analyse IA de votre portefeuille client — Package Premium</p>
          <a href="/merchant/settings" style={{ padding: '8px 18px', background: '#8b5cf6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Upgrade vers Premium</a>
        </div>
      )}
    </div>
  )
}
