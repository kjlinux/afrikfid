import React, { useEffect, useState, useCallback } from 'react'
import {
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowRightIcon,
  BoltIcon,
  ClipboardDocumentListIcon,
  CpuChipIcon,
  SparklesIcon,
  ArrowUpCircleIcon,
} from '@heroicons/react/24/outline'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { Badge, Spinner, InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'

const SEG_COLOR = { CHAMPIONS: '#10b981', FIDELES: '#3b82f6', PROMETTEURS: '#f59e0b', A_RISQUE: '#f97316', HIBERNANTS: '#6b7280', PERDUS: '#ef4444' }

// CDC §5.6 — Actions recommandées par segment
const SEG_ACTIONS = {
  CHAMPIONS: {
    label: 'Champions',
    priority: 'VIP',
    priorityColor: '#10b981',
    actions: [
      'Inviter au programme ambassadeur (parrainage VIP)',
      'Accès prioritaire aux nouveautés et événements privés',
      'Programme de fidélité exclusif avec avantages personnalisés',
    ],
    objectif: 'Maintenir R≥4, F≥4 — Transformer en ambassadeurs de la marque',
  },
  FIDELES: {
    label: 'Fidèles',
    priority: 'HAUTE',
    priorityColor: '#3b82f6',
    actions: [
      'Cross-sell et upsell sur le panier actuel',
      'Challenges fréquence : "Achetez X fois ce mois pour débloquer Y"',
      'Offres de parrainage pour recruter de nouveaux clients',
    ],
    objectif: 'Augmenter M vers ≥4 — Pousser vers le segment Champions',
  },
  PROMETTEURS: {
    label: 'Prometteurs',
    priority: 'HAUTE',
    priorityColor: '#f59e0b',
    actions: [
      'Offres "revenez vite" : points bonus si retour < 15 jours',
      'Stimuler la fréquence avec des promotions flash',
      'Rappels personnalisés sur les produits consultés',
    ],
    objectif: 'Augmenter F vers ≥4 — Transformer en Fidèles',
  },
  A_RISQUE: {
    label: 'À Risque',
    priority: 'URGENTE',
    priorityColor: '#f97316',
    actions: [
      'ACTION URGENTE : offre forte ciblée (réduction -20% ou points x3)',
      'Contact direct par SMS ou appel personnalisé',
      'Alerte équipe commerciale pour suivi individuel',
    ],
    objectif: 'Remonter R vers ≥4 — Sauver ces clients VIP avant qu\'ils ne partent',
  },
  HIBERNANTS: {
    label: 'Hibernants',
    priority: 'MOYENNE',
    priorityColor: '#6b7280',
    actions: [
      'Campagne de réactivation : rappel des avantages non utilisés',
      'Email/SMS : "Vos points expirent bientôt, profitez-en !"',
      'Offre de bienvenue retour avec remise -15%',
    ],
    objectif: 'Générer 1 achat dans les 30 prochains jours',
  },
  PERDUS: {
    label: 'Perdus',
    priority: 'FAIBLE',
    priorityColor: '#ef4444',
    actions: [
      'Win-back 1x/trimestre max avec offre choc (-30%)',
      'Enquête de satisfaction : "Pourquoi nous avez-vous quitté ?"',
      'Archiver si aucune réponse après 3 tentatives',
    ],
    objectif: 'Réactiver 5-10% de ce segment — Archiver le reste',
  },
}

function SegmentActionsPanel({ rfmDetails }) {
  const [open, setOpen] = React.useState(null)
  const segments = (rfmDetails || []).filter(d => d.count > 0)
  if (segments.length === 0) return null

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Actions Recommandées par Segment</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>CDC §5.6 — Playbook opérationnel pour chaque segment RFM</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {segments.sort((a, b) => {
          const prio = { URGENTE: 0, VIP: 0, HAUTE: 1, MOYENNE: 2, FAIBLE: 3 }
          return (prio[SEG_ACTIONS[a.segment]?.priority] ?? 4) - (prio[SEG_ACTIONS[b.segment]?.priority] ?? 4)
        }).map(d => {
          const info = SEG_ACTIONS[d.segment]
          if (!info) return null
          const isOpen = open === d.segment
          return (
            <div key={d.segment} style={{ background: '#0f172a', border: `1px solid ${info.priorityColor}33`, borderRadius: 10 }}>
              <button
                onClick={() => setOpen(isOpen ? null : d.segment)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: SEG_COLOR[d.segment] + '22', color: SEG_COLOR[d.segment] }}>{info.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{d.count} client{d.count > 1 ? 's' : ''}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: info.priorityColor + '22', color: info.priorityColor, border: `1px solid ${info.priorityColor}44` }}>{info.priority}</span>
                </div>
                {isOpen ? <ChevronUpIcon style={{ width: 16, height: 16, color: '#64748b' }} /> : <ChevronDownIcon style={{ width: 16, height: 16, color: '#64748b' }} />}
              </button>
              {isOpen && (
                <div style={{ padding: '0 16px 16px' }}>
                  <div style={{ marginBottom: 10 }}>
                    {info.actions.map((action, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: i < info.actions.length - 1 ? '1px solid #1e293b' : 'none' }}>
                        <ArrowRightIcon style={{ width: 14, height: 14, color: info.priorityColor, flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 12, color: '#cbd5e1' }}>{action}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: '8px 12px', background: info.priorityColor + '11', border: `1px solid ${info.priorityColor}33`, borderRadius: 8, fontSize: 11, color: info.priorityColor, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <BoltIcon style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />
                    {info.objectif}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
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
          <CpuChipIcon style={{ width: 28, height: 28, color: '#8b5cf6' }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Recommandations IA</div>
            <div style={{ fontSize: 11, color: '#8b5cf6' }}>Powered by Claude · Exclusif PREMIUM</div>
          </div>
        </div>
        <button onClick={loadInsights} disabled={loading}
          style={{ padding: '8px 16px', background: loading ? '#334155' : '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {loading ? <Spinner size="sm" /> : <SparklesIcon style={{ width: 16, height: 16 }} />}
          {loading ? 'Analyse...' : insights ? 'Régénérer' : 'Générer les insights'}
        </button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {!insights && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#8b5cf6' }}>
          <CpuChipIcon style={{ width: 40, height: 40, color: '#8b5cf6', margin: '0 auto 12px' }} />
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
                <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 6 }}><ClipboardDocumentListIcon style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1 }} />{rec.action}</p>
                <p style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'flex-start', gap: 6 }}><BoltIcon style={{ width: 12, height: 12, flexShrink: 0, marginTop: 1 }} />{rec.objectif}</p>
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
  const merchantId = user?.merchantId || user?.id
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [recommendations, setRecommendations] = useState(null)

  useEffect(() => {
    if (!merchantId) { setLoading(false); return }
    api.get(`/merchant-intelligence/me`)
      .then(r => {
        setData(r.data)
        const pkgIndex = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM'].indexOf(r.data.package)
        if (pkgIndex >= 2) {
          api.get(`/merchant-intelligence/me/recommendations`).then(rr => setRecommendations(rr.data)).catch(() => {})
        }
      })
      .catch(e => setError(e.response?.data?.error || e.message || 'Erreur inconnue'))
      .finally(() => setLoading(false))
  }, [merchantId])

  if (loading) return <Spinner />
  if (error) return (
    <div style={{ padding: '40px 32px' }}>
      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '16px 20px', color: '#ef4444', fontSize: 14 }}>
        <strong>Erreur :</strong> {error}
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>merchantId utilisé : {merchantId || '(non défini)'}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
          Token merchant présent : {localStorage.getItem('afrikfid_token_merchant') ? 'OUI' : 'NON'} |
          User role : {user?.role || '(non défini)'}
        </div>
        <button onClick={() => { localStorage.removeItem('afrikfid_token_merchant'); localStorage.removeItem('afrikfid_user_merchant'); window.location.href = '/merchant/login'; }}
          style={{ marginTop: 12, padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          Se reconnecter en tant que marchand
        </button>
      </div>
    </div>
  )
  if (!data) return <div style={{ textAlign: 'center', color: '#64748b', padding: 32 }}>Aucune donnée disponible — merchantId : {merchantId || '(non défini)'}</div>

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
          { label: 'Transactions', value: Number(data.kpis?.total_transactions || 0).toLocaleString(), color: '#f1f5f9', tip: null },
          { label: "Chiffre d'affaires", value: Number(data.kpis?.total_revenue || 0).toLocaleString() + ' FCFA', color: '#10b981', tip: TOOLTIPS.chiffre_affaires },
          { label: 'Panier moyen', value: Math.round(Number(data.kpis?.avg_basket || 0)).toLocaleString() + ' FCFA', color: '#f59e0b', tip: TOOLTIPS.panier_moyen },
          { label: 'Clients uniques', value: Number(data.kpis?.unique_clients || 0).toLocaleString(), color: '#3b82f6', tip: null },
        ].map(k => (
          <div key={k.label} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>
              {k.label}{k.tip && <InfoTooltip text={k.tip} />}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Segmentation RFM — STARTER_PLUS+ */}
      {m.rfm_simple && data.rfm_stats && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>Segmentation RFM<InfoTooltip text={TOOLTIPS.RFM} /></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {(data.rfm_stats.segments || []).map(s => (
              <div key={s.segment} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#0f172a', borderRadius: 8, border: '1px solid #334155' }}>
                <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: (SEG_COLOR[s.segment] || '#6b7280') + '22', color: SEG_COLOR[s.segment] || '#6b7280' }}>{s.segment}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>{s.count}</span>
              </div>
            ))}
          </div>
          {!m.rfm_detailed && <p style={{ marginTop: 12, fontSize: 12, color: '#8b5cf6', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowUpCircleIcon style={{ width: 14, height: 14, flexShrink: 0 }} />Passez au package Growth Intelligent pour voir le détail par segment et les actions recommandées.</p>}
        </div>
      )}

      {!m.rfm_simple && (
        <div style={upgCard}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Segmentation RFM</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Disponible à partir du package Starter Plus — inclus dans Growth Intelligent et Premium.</p>
          <a href="/merchant/settings" style={{ padding: '8px 18px', background: '#3b82f6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowUpCircleIcon style={{ width: 16, height: 16 }} />Upgrade
          </a>
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

          <SegmentActionsPanel rfmDetails={data.rfm_details} />

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

      {/* Taux de retour + Top clients — STARTER_PLUS+ */}
      {m.return_rate && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 20 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
              Taux de retour clients<InfoTooltip text={TOOLTIPS.taux_retour} />
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, color: data.return_rate >= 50 ? '#10b981' : data.return_rate >= 25 ? '#f59e0b' : '#ef4444' }}>{data.return_rate ?? '—'}%</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>% clients avec ≥2 achats (12 mois)</div>
          </div>
          {data.top_clients && data.top_clients.length > 0 && (
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>Top 5 clients fidèles</div>
              {data.top_clients.map((c, i) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < data.top_clients.length - 1 ? '1px solid #334155' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#64748b', width: 18 }}>#{i + 1}</span>
                    <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>{c.full_name || 'Client anonyme'}</span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10, background: '#3b82f622', color: '#3b82f6', fontWeight: 700 }}>{c.loyalty_status}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>{Number(c.total_spent).toLocaleString()} FCFA</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{c.tx_count} achats</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Alertes churn — STARTER_PLUS+ */}
      {m.churn_alerts && data.churn_alerts && (data.churn_alerts.critical > 0 || data.churn_alerts.high > 0 || data.churn_alerts.medium > 0) && (
        <div style={{ background: '#1e293b', border: '1px solid #f9731633', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f97316', marginBottom: 2 }}>
                Alertes Churn<InfoTooltip text={TOOLTIPS.churn} /> — {data.churn_alerts.total_at_risk} clients à risque
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Clients susceptibles de partir — action recommandée</div>
            </div>
            <a href="/merchant/churn-alerts" style={{ padding: '6px 14px', background: '#f97316', color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Voir détails</a>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {data.churn_alerts.critical > 0 && <div style={{ flex: 1, padding: '10px 14px', background: '#ef444422', border: '1px solid #ef444444', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#ef4444' }}>{data.churn_alerts.critical}</div>
              <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>CRITIQUE</div>
            </div>}
            {data.churn_alerts.high > 0 && <div style={{ flex: 1, padding: '10px 14px', background: '#f9731622', border: '1px solid #f9731644', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f97316' }}>{data.churn_alerts.high}</div>
              <div style={{ fontSize: 11, color: '#f97316', fontWeight: 600 }}>ÉLEVÉ</div>
            </div>}
            {data.churn_alerts.medium > 0 && <div style={{ flex: 1, padding: '10px 14px', background: '#f59e0b22', border: '1px solid #f59e0b44', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f59e0b' }}>{data.churn_alerts.medium}</div>
              <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>MODÉRÉ</div>
            </div>}
          </div>
        </div>
      )}

      {/* Churn Predictions détaillées — GROWTH+ */}
      {m.churn_prediction && data.churn_predictions && data.churn_predictions.length > 0 && (
        <div style={{ ...card, borderColor: '#f9731633' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Prédiction Churn<InfoTooltip text={TOOLTIPS.churn} /> — Top clients à risque</div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>Modèle basé sur 5 signaux RFM — CDC §6.1 Growth+</div>
          {data.churn_predictions.slice(0, 5).map((p, i) => (
            <div key={p.client_id} style={{ padding: '12px 0', borderBottom: i < 4 ? '1px solid #1e293b' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{p.client_name || 'Client anonyme'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${p.churn_score * 100}%`, height: '100%', background: p.churn_level === 'critical' ? '#ef4444' : p.churn_level === 'high' ? '#f97316' : '#f59e0b', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: p.churn_level === 'critical' ? '#ef4444' : p.churn_level === 'high' ? '#f97316' : '#f59e0b' }}>{Math.round(p.churn_score * 100)}%</span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{p.recommendation}</div>
            </div>
          ))}
          <a href="/merchant/churn-alerts" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, color: '#3b82f6', textDecoration: 'none' }}>Voir tous les clients à risque →</a>
        </div>
      )}

      {/* Recommandations IA hebdo — GROWTH+ (CDC §6.1) */}
      {m.ai_recommendations && recommendations && recommendations.recommendations?.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 2 }}>Recommandations IA — Semaine du {recommendations.week}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{recommendations.recommendations.length} actions prioritaires · {recommendations.context?.total_rfm_clients} clients analysés</div>
            </div>
            <span style={{ padding: '3px 10px', background: '#8b5cf622', color: '#8b5cf6', border: '1px solid #8b5cf644', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>IA</span>
          </div>
          {recommendations.recommendations.map((r, i) => {
            const impactColor = r.impact === 'HIGH' ? '#ef4444' : r.impact === 'MEDIUM' ? '#f59e0b' : '#6b7280'
            return (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < recommendations.recommendations.length - 1 ? '1px solid #1e293b' : 'none' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#0f172a', border: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', flexShrink: 0 }}>{r.priority}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', marginBottom: 3 }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{r.action}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {r.segment && <span style={{ fontSize: 10, fontWeight: 700, color: SEG_COLOR[r.segment] || '#6b7280', background: (SEG_COLOR[r.segment] || '#6b7280') + '22', padding: '1px 6px', borderRadius: 10 }}>{r.segment}</span>}
                    <span style={{ fontSize: 10, fontWeight: 700, color: impactColor, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: impactColor, display: 'inline-block' }} />
                      {r.impact === 'HIGH' ? 'Critique' : r.impact === 'MEDIUM' ? 'Modéré' : 'Faible'}
                    </span>
                    {r.deadline && <span style={{ fontSize: 10, color: '#64748b' }}>Avant le {r.deadline}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Analytics avancés LTV — PREMIUM */}
      {m.analytics_advanced && data.ltv_by_segment && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 14 }}>LTV par segment<InfoTooltip text={TOOLTIPS.LTV} /></div>
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

      {/* Élasticité-prix — PREMIUM */}
      {m.analytics_advanced && data.price_elasticity && !data.price_elasticity.insufficient_data && !data.price_elasticity.error && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Élasticité-Prix<InfoTooltip text={TOOLTIPS.elasticite_prix} /></div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 16 }}>Sensibilité de vos clients aux remises — CDC §6.1 Premium</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Panier moyen', value: Number(data.price_elasticity.avg_basket).toLocaleString() + ' FCFA', color: '#f1f5f9' },
              { label: 'Sensibilité prix', value: data.price_elasticity.sensitivity_label, color: data.price_elasticity.price_sensitivity_score >= 70 ? '#ef4444' : data.price_elasticity.price_sensitivity_score >= 40 ? '#f59e0b' : '#10b981' },
              { label: 'Remise optimale', value: data.price_elasticity.optimal_discount_pct + '%', color: '#8b5cf6' },
              { label: 'Transactions analysées', value: Number(data.price_elasticity.total_transactions).toLocaleString(), color: '#94a3b8' },
            ].map(k => (
              <div key={k.label} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>
          {data.price_elasticity.recommendation && (
            <div style={{ padding: '10px 14px', background: '#8b5cf611', border: '1px solid #8b5cf633', borderRadius: 8, fontSize: 12, color: '#c4b5fd' }}>{data.price_elasticity.recommendation}</div>
          )}
        </div>
      )}

      {/* Zones chalandise — PREMIUM */}
      {m.analytics_advanced && data.trade_zones && data.trade_zones.total_zones > 0 && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Zones de Chalandise<InfoTooltip text={TOOLTIPS.zones_chalandise} /></div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 16 }}>Répartition géographique de votre clientèle — CDC §6.1 Premium</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Zones mappées', value: data.trade_zones.total_zones },
              { label: 'Clients cartographiés', value: Number(data.trade_zones.total_clients_mapped).toLocaleString() },
              { label: 'CA cartographié', value: Number(data.trade_zones.total_revenue_mapped).toLocaleString() + ' FCFA' },
            ].map(k => (
              <div key={k.label} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>{k.value}</div>
              </div>
            ))}
          </div>
          {/* Top zones CA */}
          {data.trade_zones.insights?.top_revenue_zones?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>Top zones par CA</div>
              {data.trade_zones.insights.top_revenue_zones.map((z, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ fontSize: 13, color: '#f1f5f9' }}>{z.city}{z.district ? ` — ${z.district}` : ''}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>{Number(z.revenue).toLocaleString()} FCFA</span>
                </div>
              ))}
            </div>
          )}
          {/* Zones à fort potentiel */}
          {data.trade_zones.insights?.high_potential_zones?.length > 0 && (
            <div style={{ padding: '10px 14px', background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 6 }}>Zones à fort potentiel non exploité</div>
              {data.trade_zones.insights.high_potential_zones.map((z, i) => (
                <div key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>• {z.recommendation}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {!m.analytics_advanced && m.rfm_detailed && (
        <div style={upgCard}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Analytics Avancés (LTV, Élasticité, Zones)</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Disponible avec le package Premium</p>
          <a href="/merchant/settings" style={{ padding: '8px 18px', background: '#8b5cf6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Upgrade</a>
        </div>
      )}

      {/* Recommandations IA — PREMIUM */}
      {m.analytics_advanced && <AiInsightsSection />}

      {!m.analytics_advanced && !m.rfm_simple && (
        <div style={upgCard}>
          <CpuChipIcon style={{ width: 32, height: 32, color: '#8b5cf6', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>Recommandations IA</div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Analyse IA de votre portefeuille client — disponible à partir du package Growth Intelligent.</p>
          <a href="/merchant/settings" style={{ padding: '8px 18px', background: '#8b5cf6', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowUpCircleIcon style={{ width: 16, height: 16 }} />Upgrade
          </a>
        </div>
      )}
    </div>
  )
}
