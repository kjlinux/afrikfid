import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { Spinner, Badge } from '../../components/ui.jsx'

const LEVEL_CONFIG = {
  critical: { label: 'Critique', color: '#ef4444', bg: '#ef444422', border: '#ef444444' },
  high:     { label: 'Élevé',    color: '#f97316', bg: '#f9731622', border: '#f9731644' },
  medium:   { label: 'Modéré',   color: '#f59e0b', bg: '#f59e0b22', border: '#f59e0b44' },
  low:      { label: 'Faible',   color: '#6b7280', bg: '#6b728022', border: '#6b728044' },
}

const card = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }

function ScoreBar({ score }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.8 ? '#ef4444' : score >= 0.6 ? '#f97316' : score >= 0.3 ? '#f59e0b' : '#6b7280'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 34 }}>{pct}%</span>
    </div>
  )
}

export default function MerchantChurnAlerts() {
  const { user } = useAuth()
  const merchantId = user?.merchantId || user?.id
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [level, setLevel] = useState('medium')
  const [selected, setSelected] = useState(null)

  const load = useCallback(() => {
    if (!merchantId) return
    setLoading(true)
    setError(null)
    api.get(`/merchant-intelligence/${merchantId}/churn`, { params: { level, limit: 50 } })
      .then(r => setData(r.data))
      .catch(e => {
        const err = e.response?.data?.error || e.message
        if (e.response?.status === 403) {
          setError({ upgrade: true, msg: e.response.data?.upgrade_to || 'STARTER_PLUS' })
        } else {
          setError({ msg: err })
        }
      })
      .finally(() => setLoading(false))
  }, [merchantId, level])

  useEffect(() => { load() }, [load])

  if (!merchantId) return <div style={{ padding: 32, color: '#64748b' }}>Session expirée.</div>

  if (error?.upgrade) return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 24 }}>Alertes Churn</h1>
      <div style={{ background: '#1e293b', border: '1px dashed #8b5cf6', borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#8b5cf6', marginBottom: 8 }}>Fonctionnalité {error.msg}</div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          La prédiction churn est disponible à partir du package <strong style={{ color: '#f1f5f9' }}>Starter Plus</strong>.
          <br />Passez à un package supérieur pour identifier vos clients à risque avant qu'ils ne partent.
        </p>
        <a href="/merchant/settings" style={{ padding: '10px 24px', background: '#8b5cf6', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          Upgrader mon package
        </a>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Alertes Churn</h1>
          <p style={{ fontSize: 12, color: '#64748b' }}>Clients susceptibles de partir — agissez avant qu'il ne soit trop tard</p>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 16px', background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading ? <Spinner size="sm" /> : '↻'} Actualiser
        </button>
      </div>

      {/* Filtre niveau */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['medium', 'high', 'critical'].map(l => (
          <button key={l} onClick={() => setLevel(l)}
            style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid', background: level === l ? LEVEL_CONFIG[l].bg : 'transparent', color: level === l ? LEVEL_CONFIG[l].color : '#64748b', borderColor: level === l ? LEVEL_CONFIG[l].border : '#334155' }}>
            {LEVEL_CONFIG[l].label}+
          </button>
        ))}
      </div>

      {error?.msg && !error?.upgrade && (
        <div style={{ background: '#ef444411', border: '1px solid #ef444433', color: '#ef4444', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error.msg}</div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>}

      {!loading && data && (
        <>
          {/* Résumé */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total à risque', value: data.summary?.total_at_risk ?? 0, color: '#f1f5f9' },
              { label: 'Critiques', value: data.summary?.by_level?.critical ?? 0, color: '#ef4444' },
              { label: 'Élevés', value: data.summary?.by_level?.high ?? 0, color: '#f97316' },
              { label: 'Score moyen', value: data.summary?.avg_churn_score ? Math.round(data.summary.avg_churn_score * 100) + '%' : '—', color: '#f59e0b' },
            ].map(k => (
              <div key={k.label} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Liste clients */}
          {(data.predictions || []).length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: '40px 32px' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#10b981', marginBottom: 4 }}>Aucun client à risque détecté</div>
              <p style={{ fontSize: 12, color: '#64748b' }}>Avec le filtre "{LEVEL_CONFIG[level].label}+" — essayez un filtre moins strict.</p>
            </div>
          ) : (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>
                {data.predictions.length} client{data.predictions.length > 1 ? 's' : ''} à risque
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['Client', 'Risque', 'Score', 'Segment RFM', 'Action recommandée'].map((h, i) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.predictions.map(p => {
                      const lvl = LEVEL_CONFIG[p.churn_level] || LEVEL_CONFIG.medium
                      return (
                        <tr key={p.client_id}
                          onClick={() => setSelected(selected?.client_id === p.client_id ? null : p)}
                          style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer', background: selected?.client_id === p.client_id ? '#0f172a' : 'transparent' }}>
                          <td style={{ padding: '10px 12px', color: '#f1f5f9', fontWeight: 600 }}>{p.client_name || 'Anonyme'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: lvl.bg, color: lvl.color, border: `1px solid ${lvl.border}` }}>{lvl.label}</span>
                          </td>
                          <td style={{ padding: '10px 12px' }}><ScoreBar score={p.churn_score} /></td>
                          <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{p.rfm_context?.segment || '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#64748b', maxWidth: 280, fontSize: 12 }}>{p.recommendation}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Détail client sélectionné */}
          {selected && (
            <div style={{ ...card, borderColor: LEVEL_CONFIG[selected.churn_level]?.border || '#334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{selected.client_name || 'Client anonyme'} — Détail des signaux</div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>Signaux détectés</div>
                {(selected.signals || []).map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < selected.signals.length - 1 ? '1px solid #1e293b' : 'none' }}>
                    <span style={{ color: '#f97316', flexShrink: 0 }}>⚠</span>
                    <span style={{ fontSize: 12, color: '#cbd5e1' }}>{s}</span>
                  </div>
                ))}
              </div>
              {selected.rfm_context && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: 'Récence', value: selected.rfm_context.r, max: 5 },
                    { label: 'Fréquence', value: selected.rfm_context.f, max: 5 },
                    { label: 'Montant', value: selected.rfm_context.m, max: 5 },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.value >= 4 ? '#10b981' : s.value >= 3 ? '#f59e0b' : '#ef4444' }}>{s.value}<span style={{ fontSize: 12, color: '#64748b' }}>/5</span></div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 14px', background: '#3b82f611', border: '1px solid #3b82f633', borderRadius: 8, fontSize: 12, color: '#93c5fd' }}>
                💡 {selected.recommendation}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
