import React, { useEffect, useState, useCallback } from 'react'
import {
  ChartBarIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  ArrowPathIcon,
  ArrowUpCircleIcon,
} from '@heroicons/react/24/outline'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { Spinner, Badge, InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'

const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium' }
const PKG_HIERARCHY = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']

const LEVEL_CONFIG = {
  critical: { label: 'Critique', color: '#ef4444', bg: '#ef444422', border: '#ef444444' },
  high:     { label: 'Élevé',    color: '#f97316', bg: '#f9731622', border: '#f9731644' },
  medium:   { label: 'Modéré',   color: 'var(--af-accent)', bg: 'var(--af-accent-soft)', border: 'var(--af-accent-soft)' },
  low:      { label: 'Faible',   color: '#6b7280', bg: '#6b728022', border: '#6b728044' },
}

const card = { background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }

function ScoreBar({ score }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.8 ? '#ef4444' : score >= 0.6 ? '#f97316' : score >= 0.3 ? 'var(--af-accent)' : '#6b7280'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, height: 6, background: 'var(--af-surface-3)', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
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
    api.get(`/merchant-intelligence/me/churn`, { params: { level, limit: 50 } })
      .then(r => setData(r.data))
      .catch(e => {
        const err = e.response?.data?.error || e.message
        if (e.response?.status === 403 && e.response.data?.upgrade_needed) {
          setError({ upgrade: true, msg: e.response.data?.upgrade_to || 'STARTER_PLUS' })
        } else {
          setError({ msg: err })
        }
      })
      .finally(() => setLoading(false))
  }, [merchantId, level])

  useEffect(() => { load() }, [load])

  if (!merchantId) return <div style={{ padding: 32, color: 'var(--af-text-muted)' }}>Session expirée.</div>

  const minRequired = error?.upgrade ? (PKG_LABELS[error.msg] || error.msg) : null
  const upgradableTo = error?.upgrade ? PKG_HIERARCHY.slice(PKG_HIERARCHY.indexOf(error.msg)) : []

  if (error?.upgrade) return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)', marginBottom: 24 }}>Alertes Churn</h1>
      <div style={{ background: 'var(--af-surface)', border: '1px dashed #8b5cf6', borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
        <ChartBarIcon style={{ width: 48, height: 48, color: '#8b5cf6', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 700, color: '#8b5cf6', marginBottom: 8 }}>Fonctionnalité non incluse dans votre package actuel</div>
        <p style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 8 }}>
          Les alertes churn sont disponibles à partir du package <strong style={{ color: 'var(--af-text)' }}>{minRequired}</strong>.
        </p>
        <p style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 20 }}>
          Votre package actuel ne donne pas accès à cette fonctionnalité. Passez à un package supérieur pour identifier vos clients à risque avant qu'ils ne partent.
        </p>
        {upgradableTo.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {upgradableTo.map(pkg => (
              <span key={pkg} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#8b5cf622', color: '#8b5cf6', border: '1px solid #8b5cf644' }}>
                {PKG_LABELS[pkg]}
              </span>
            ))}
          </div>
        )}
        <a href="/merchant/settings" style={{ padding: '10px 24px', background: '#8b5cf6', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowUpCircleIcon style={{ width: 18, height: 18 }} />
          Upgrader mon package
        </a>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)', marginBottom: 4 }}>Alertes Churn<InfoTooltip text={TOOLTIPS.churn} /></h1>
          <p style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Clients susceptibles de partir — agissez avant qu'il ne soit trop tard</p>
        </div>
        <button onClick={load} disabled={loading}
          style={{ padding: '8px 16px', background: 'var(--af-surface)', color: 'var(--af-text)', border: '1px solid var(--af-border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading ? <Spinner size="sm" /> : <ArrowPathIcon style={{ width: 16, height: 16 }} />} Actualiser
        </button>
      </div>

      {/* Filtre niveau */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['medium', 'high', 'critical'].map(l => (
          <button key={l} onClick={() => setLevel(l)}
            style={{ padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid', background: level === l ? LEVEL_CONFIG[l].bg : 'transparent', color: level === l ? LEVEL_CONFIG[l].color : 'var(--af-text-muted)', borderColor: level === l ? LEVEL_CONFIG[l].border : 'var(--af-border)' }}>
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
              { label: 'Modérés+', value: data.summary?.total_at_risk ?? 0, color: 'var(--af-text)', sub: `(${data.summary?.total_including_low ?? 0} avec faibles)`, tip: TOOLTIPS.churn },
              { label: 'Critiques', value: data.summary?.by_level?.critical ?? 0, color: '#ef4444', sub: 'score ≥ 80%', tip: null },
              { label: 'Élevés', value: data.summary?.by_level?.high ?? 0, color: '#f97316', sub: 'score 60-79%', tip: null },
              { label: 'Score moyen', value: data.summary?.avg_churn_score ? Math.round(data.summary.avg_churn_score * 100) + '%' : '—', color: 'var(--af-accent)', sub: 'tous niveaux', tip: TOOLTIPS.score_churn },
            ].map(k => (
              <div key={k.label} style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>
                  {k.label}{k.tip && <InfoTooltip text={k.tip} />}
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--af-border-strong)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Liste clients */}
          {(data.predictions || []).length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: '40px 32px' }}>
              <CheckCircleIcon style={{ width: 40, height: 40, color: '#10b981', margin: '0 auto 12px' }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#10b981', marginBottom: 4 }}>Aucun client à risque détecté</div>
              <p style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Avec le filtre "{LEVEL_CONFIG[level].label}+" — essayez un filtre moins strict.</p>
            </div>
          ) : (
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                {data.predictions.length} client{data.predictions.length > 1 ? 's' : ''} à risque {LEVEL_CONFIG[level].label.toLowerCase()}+
                <span style={{ fontSize: 11, color: 'var(--af-border-strong)', fontWeight: 400 }}>/ {data.summary?.total_at_risk ?? '?'} modérés+ au total</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--af-border)' }}>
                      {[
                        { label: 'Client', tip: null },
                        { label: 'Risque', tip: TOOLTIPS.churn },
                        { label: 'Score', tip: TOOLTIPS.score_churn },
                        { label: 'Segment RFM', tip: TOOLTIPS.RFM },
                        { label: 'Action recommandée', tip: null },
                      ].map(h => (
                        <th key={h.label} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase' }}>
                          {h.tip ? <>{h.label}<InfoTooltip text={h.tip} /></> : h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.predictions.map(p => {
                      const lvl = LEVEL_CONFIG[p.churn_level] || LEVEL_CONFIG.medium
                      return (
                        <tr key={p.client_id}
                          onClick={() => setSelected(selected?.client_id === p.client_id ? null : p)}
                          style={{ borderBottom: '1px solid var(--af-surface)', cursor: 'pointer', background: selected?.client_id === p.client_id ? 'var(--af-surface-3)' : 'transparent' }}>
                          <td style={{ padding: '10px 12px', color: 'var(--af-text)', fontWeight: 600 }}>{p.client_name || 'Anonyme'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: lvl.bg, color: lvl.color, border: `1px solid ${lvl.border}` }}>{lvl.label}</span>
                          </td>
                          <td style={{ padding: '10px 12px' }}><ScoreBar score={p.churn_score} /></td>
                          <td style={{ padding: '10px 12px', color: 'var(--af-text-muted)' }}>{p.rfm_context?.segment || '—'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--af-text-muted)', maxWidth: 280, fontSize: 12 }}>{p.recommendation}</td>
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
            <div style={{ ...card, borderColor: LEVEL_CONFIG[selected.churn_level]?.border || 'var(--af-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>{selected.client_name || 'Client anonyme'} — Détail des signaux</div>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--af-text-muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 8 }}>Signaux détectés</div>
                {(selected.signals || []).map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < selected.signals.length - 1 ? '1px solid var(--af-surface)' : 'none' }}>
                    <ExclamationTriangleIcon style={{ width: 14, height: 14, color: '#f97316', flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 12, color: 'var(--af-text)' }}>{s}</span>
                  </div>
                ))}
              </div>
              {selected.rfm_context && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                  {[
                    { label: 'Récence', value: selected.rfm_context.r, max: 5, tip: 'Score de 1 à 5 : à quel point ce client a acheté récemment. 5 = très récent.' },
                    { label: 'Fréquence', value: selected.rfm_context.f, max: 5, tip: 'Score de 1 à 5 : combien de fois ce client achète. 5 = très fréquent.' },
                    { label: 'Montant', value: selected.rfm_context.m, max: 5, tip: 'Score de 1 à 5 : combien ce client dépense au total. 5 = gros dépenseur.' },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginBottom: 4 }}>{s.tip ? <Tooltip text={s.tip}>{s.label}</Tooltip> : s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: s.value >= 4 ? '#10b981' : s.value >= 3 ? 'var(--af-accent)' : '#ef4444' }}>{s.value}<span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>/5</span></div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ padding: '10px 14px', background: '#3b82f611', border: '1px solid #3b82f633', borderRadius: 8, fontSize: 12, color: '#93c5fd', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <LightBulbIcon style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
                {selected.recommendation}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
