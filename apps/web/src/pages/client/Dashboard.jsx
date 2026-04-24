import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../App.jsx'
import api from '../../api.js'
import { InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'

// ─── Constantes ───────────────────────────────────────────────────────────────
const STATUS_META = {
  OPEN:        { color: '#6B7280', bg: '#6B728015', icon: '○', label: 'Démarrage',     pct: 0 },
  LIVE:        { color: '#3B82F6', bg: '#3B82F615', icon: '★', label: 'Actif',         pct: 5 },
  GOLD:        { color: '#F59E0B', bg: '#F59E0B15', icon: '◎', label: 'Premium',       pct: 8 },
  ROYAL:       { color: '#8B5CF6', bg: '#8B5CF615', icon: '♛', label: 'Élite',         pct: 12 },
  ROYAL_ELITE: { color: '#ec4899', bg: '#ec489915', icon: '♔', label: 'Élite Suprême', pct: 12 },
}
const STATUS_ORDER = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE']

const fmt = (n, currency = 'XOF') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0)

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── Sous-composants ──────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = 'var(--af-accent)' }) {
  return (
    <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ value, color }) {
  return (
    <div style={{ background: 'var(--af-surface-3)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.OPEN
  const tip = TOOLTIPS[status]
  const badge = (
    <span style={{ background: m.bg, border: `1px solid ${m.color}40`, borderRadius: 6, padding: '3px 10px', color: m.color, fontWeight: 700, fontSize: 13 }}>
      {m.icon} {status}
    </span>
  )
  if (!tip) return badge
  return <Tooltip text={tip}>{badge}</Tooltip>
}

function AfrikFidCardBlock({ data }) {
  if (!data) return null
  if (!data.available) {
    return (
      <div style={{ background: 'var(--af-surface)', border: '1px dashed var(--af-border)', borderRadius: 14, padding: '16px 20px', marginBottom: 24, color: 'var(--af-text-muted)', fontSize: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--af-text)', marginBottom: 4 }}>Carte AfrikFid physique</div>
        {data.reason === 'card_format_not_unified'
          ? 'Votre compte n\'est pas encore lié à une carte fidélité physique AfrikFid.'
          : 'Le service fidélité AfrikFid est temporairement indisponible — votre historique sera affiché au prochain chargement.'}
      </div>
    )
  }
  const { card, wallet } = data
  return (
    <div style={{ background: 'linear-gradient(135deg, #1F2937 0%, #0F1115 100%)', color: '#ffffff', borderRadius: 14, padding: '20px 24px', marginBottom: 24, border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'var(--af-shadow-elevated)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Carte fidélité AfrikFid</div>
          <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>
            {card?.numero?.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}
          </div>
        </div>
        <div style={{ width: 40, height: 26, background: 'linear-gradient(135deg, var(--af-accent), var(--af-kpi-yellow))', borderRadius: 4, opacity: 0.9 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, opacity: 0.65, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Points cumulés</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--af-kpi-yellow)' }}>{(card?.points || 0).toLocaleString('fr-FR')}</div>
        </div>
        {card?.reduction > 0 && (
          <div>
            <div style={{ fontSize: 10, opacity: 0.65, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Réduction active</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--af-accent)' }}>{card.reduction}%</div>
          </div>
        )}
        {wallet && (
          <div>
            <div style={{ fontSize: 10, opacity: 0.65, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Portefeuille XOF</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#ffffff' }}>
              {new Intl.NumberFormat('fr-FR').format(wallet.solde_xof || wallet.balance || 0)} <span style={{ fontSize: 11, opacity: 0.7 }}>XOF</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Timeline fusionnée gateway + business-api (achats multi-enseignes)
function UnifiedHistorySection({ history }) {
  if (!history) return null
  // On n'affiche cette section que si la carte fidélité est liée, sinon les
  // "Dernières transactions" ci-dessous suffisent et on évite un doublon.
  if (!history.sources?.afrikfid?.available) return null
  if (!history.items?.length) return null

  const sourceMeta = {
    gateway: { label: 'Passerelle', color: '#3b82f6', bg: '#3b82f615' },
    afrikfid: { label: 'Enseigne', color: '#8b5cf6', bg: '#8b5cf615' },
  }

  return (
    <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--af-text)' }}>Historique unifié</div>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>
            Paiements passerelle et achats dans le réseau Afrik'Fid
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
          <span style={{ color: sourceMeta.gateway.color }}>● Passerelle : {history.sources.gateway.count}</span>
          <span style={{ color: sourceMeta.afrikfid.color }}>● Enseignes : {history.sources.afrikfid.kept}</span>
        </div>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {history.items.map((it) => {
          const meta = sourceMeta[it.source]
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderBottom: '1px solid var(--af-surface)' }}>
              {it.merchantLogo ? (
                <img src={it.merchantLogo} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', background: 'var(--af-surface-3)' }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--af-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--af-text-muted)', fontWeight: 700 }}>
                  {(it.merchantName || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--af-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.merchantName || '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>{fmtDate(it.date)}</span>
                  <span style={{ background: meta.bg, color: meta.color, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{meta.label}</span>
                  {it.source === 'gateway' && <TxStatusBadge status={it.status} />}
                  {it.source === 'afrikfid' && it.pointsEarned > 0 && (
                    <span style={{ color: '#F59E0B' }}>+{it.pointsEarned} pts</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)' }}>{fmt(it.amountXof, it.currency)}</div>
                {it.clientRebateXof > 0 && (
                  <div style={{ fontSize: 11, color: '#10b981', marginTop: 2 }}>− {fmt(it.clientRebateXof, it.currency)}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TxStatusBadge({ status }) {
  const colors = {
    completed: ['#10b981', '#10b98115'],
    pending:   ['#F59E0B', 'rgba(245,158,11,0.15)'],
    failed:    ['#ef4444', '#ef444415'],
    expired:   ['#6B7280', '#6B728015'],
  }
  const [c, bg] = colors[status] || colors.pending
  return (
    <span style={{ background: bg, color: c, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {status}
    </span>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function ClientDashboard() {
  const { user, logout } = useAuth()
  const [profile, setProfile]       = useState(null)
  const [transactions, setTxs]      = useState([])
  const [afrikfidCard, setAfrikfidCard] = useState(null)
  const [unifiedHistory, setUnifiedHistory] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  // Litige
  const [disputeModal, setDisputeModal] = useState(null)
  const [disputes, setDisputes]         = useState([])
  const [disputeForm, setDisputeForm]   = useState({ reason: '', description: '' })
  const [disputeLoading, setDisputeLoading] = useState(false)
  const [disputeMsg, setDisputeMsg]     = useState('')
  // Remboursement
  const [refundModal, setRefundModal]   = useState(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundLoading, setRefundLoading] = useState(false)
  const [refundMsg, setRefundMsg]       = useState('')

  useEffect(() => {
    if (!user?.id) return
    Promise.all([
      api.get(`/clients/${user.id}/profile`),
      api.get(`/clients/${user.id}/transactions?limit=10`),
      api.get('/disputes/client/mine?limit=5'),
    ])
      .then(([p, t, d]) => {
        setProfile(p.data)
        setTxs(t.data.transactions || [])
        setDisputes(d.data.disputes || [])
      })
      .catch(() => setError('Impossible de charger vos données.'))
      .finally(() => setLoading(false))

    api.get('/clients/me/afrikfid-profile')
      .then(r => setAfrikfidCard(r.data))
      .catch(() => setAfrikfidCard({ available: false, reason: 'upstream_unavailable' }))

    api.get('/clients/me/unified-history?limit=30')
      .then(r => setUnifiedHistory(r.data))
      .catch(() => setUnifiedHistory(null))
  }, [user?.id])

  const handleLogout = () => {
    logout()
    window.location.href = '/login'
  }

  const submitRefundRequest = async () => {
    if (!refundReason.trim()) return setRefundMsg('Le motif est requis')
    setRefundLoading(true); setRefundMsg('')
    try {
      await api.post(`/payments/${refundModal.id}/refund/request`, { reason: refundReason })
      setRefundMsg('✓ Demande envoyée. Le marchand sera notifié et traitera votre demande.')
      setTimeout(() => { setRefundModal(null); setRefundReason(''); setRefundMsg('') }, 2500)
    } catch (err) {
      setRefundMsg(err.response?.data?.error || 'Erreur lors de la demande')
    } finally { setRefundLoading(false) }
  }

  const submitDispute = async () => {
    if (!disputeForm.reason) return setDisputeMsg('Choisissez un motif')
    setDisputeLoading(true); setDisputeMsg('')
    try {
      await api.post('/disputes', { transaction_id: disputeModal.id, ...disputeForm })
      setDisputeMsg('✓ Litige déclaré avec succès. L\'équipe Afrik\'Fid vous contactera.')
      setTimeout(() => {
        setDisputeModal(null)
        setDisputeMsg('')
        setDisputeForm({ reason: '', description: '' })
        api.get('/disputes/client/mine?limit=5').then(r => setDisputes(r.data.disputes || []))
      }, 2000)
    } catch (err) {
      setDisputeMsg(err.response?.data?.error || 'Erreur lors de la déclaration')
    } finally { setDisputeLoading(false) }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--af-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--af-text-muted)', fontSize: 14 }}>Chargement…</div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: 'var(--af-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#ef4444', fontSize: 14 }}>{error}</div>
    </div>
  )

  const { client, wallet, stats, nextStatusEligibility: next } = profile || {}
  const status = client?.loyaltyStatus || 'OPEN'
  const meta   = STATUS_META[status] || STATUS_META.OPEN
  const currentIdx = STATUS_ORDER.indexOf(status)

  // Montant total des remises reçues (estimation : Y% × montant total)
  const rebateTotal = (parseFloat(stats?.total || 0) * meta.pct) / 100

  return (
    <div style={{ minHeight: '100vh', background: 'var(--af-surface-3)', color: 'var(--af-text)', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ background: 'var(--af-surface)', borderBottom: '1px solid var(--af-border)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, var(--af-accent), var(--af-brand))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>A</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--af-text)' }}>Afrik'Fid</div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Espace client</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--af-text)' }}>{client?.fullName}</div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{client?.afrikfidId}</div>
          </div>
          <Link to="/client/profile"
            style={{ padding: '7px 14px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 7, color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>
            Sécurité
          </Link>
          <button onClick={handleLogout}
            style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
            Déconnexion
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px' }}>

        {/* Carte statut fidélité */}
        <div style={{ background: `linear-gradient(135deg, ${meta.color}20, var(--af-surface))`, border: `1px solid ${meta.color}40`, borderRadius: 16, padding: '24px 28px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>
              Votre statut fidélité<InfoTooltip text={TOOLTIPS[status]} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 36, lineHeight: 1 }}>{meta.icon}</span>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: meta.color }}>{status}</div>
                <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginTop: 2 }}>{meta.label} · {meta.pct}% de remise sur vos achats</div>
              </div>
            </div>
          </div>
          {/* Progression des statuts */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {STATUS_ORDER.map((s, i) => {
              const m = STATUS_META[s]
              const done = i <= currentIdx
              return (
                <React.Fragment key={s}>
                  <Tooltip text={TOOLTIPS[s] || s} position="bottom">
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: done ? m.color : 'var(--af-surface-3)',
                      border: `2px solid ${done ? m.color : 'var(--af-border)'}`,
                      fontSize: 13, fontWeight: 700,
                      color: done ? '#fff' : 'var(--af-text-muted)',
                    }}>
                      {m.icon}
                    </div>
                  </Tooltip>
                  {i < STATUS_ORDER.length - 1 && (
                    <div style={{ width: 20, height: 2, background: i < currentIdx ? 'var(--af-accent)' : 'var(--af-border)', borderRadius: 1 }} />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 16 }}>
          <KpiCard
            label="Solde portefeuille"
            value={fmt(wallet?.balance, wallet?.currency || 'XOF')}
            sub={`Total gagné : ${fmt(wallet?.totalEarned, wallet?.currency || 'XOF')}`}
            color="#10b981"
          />
          <KpiCard
            label="Achats complétés"
            value={parseInt(stats?.count || 0).toLocaleString('fr-FR')}
            sub="transactions réussies"
            color="#3b82f6"
          />
          <KpiCard
            label="Volume total"
            value={fmt(stats?.total)}
            sub="montant brut cumulé"
            color="var(--af-accent)"
          />
          <KpiCard
            label={<>Remises reçues (est.)<InfoTooltip text={TOOLTIPS.remise_y} /></>}
            value={fmt(rebateTotal)}
            sub={`Taux actuel : ${meta.pct}% (${status})`}
            color={meta.color}
          />
        </div>

        {/*— Points statut vs points récompense séparés */}
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '16px 20px', marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Points statut */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Points statut <span style={{ color: 'var(--af-border-strong)', fontWeight: 400, fontSize: 10, marginLeft: 6 }}>1 pt = 500 FCFA d'achat</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: meta.color }}>
                {(client?.statusPoints12m || 0).toLocaleString('fr-FR')}
              </span>
              <span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>pts (12 mois)</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--af-border-strong)', marginTop: 4 }}>
              Total cumulé : {(client?.lifetimeStatusPoints || 0).toLocaleString('fr-FR')} pts
            </div>
            <div style={{ fontSize: 11, color: 'var(--af-border-strong)', marginTop: 2 }}>
              Ces points servent uniquement à la qualification de statut et ne peuvent pas être dépensés.
            </div>
          </div>

          {/* Points récompense */}
          <div style={{ borderLeft: '1px solid var(--af-border)', paddingLeft: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Points récompense <span style={{ color: 'var(--af-border-strong)', fontWeight: 400, fontSize: 10, marginLeft: 6 }}>1 pt = 100 FCFA</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#10b981' }}>
                {(client?.rewardPoints || 0).toLocaleString('fr-FR')}
              </span>
              <span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>pts disponibles</span>
            </div>
            <div style={{ fontSize: 12, color: '#10b981', marginTop: 4, fontWeight: 600 }}>
              ≈ {fmt((client?.rewardPoints || 0) * 100)} utilisables
            </div>
            <div style={{ fontSize: 11, color: 'var(--af-border-strong)', marginTop: 2 }}>
              Utilisables chez tous les marchands du réseau sans affecter votre statut.
            </div>
          </div>
        </div>

        {/* Progression vers le prochain statut */}
        {next && (
          <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)' }}>
                  Progression vers <StatusBadge status={next.targetStatus} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 4 }}>
                  Évaluée sur les {next.evaluationMonths} derniers mois
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: next.eligible ? '#10b981' : 'var(--af-accent)' }}>
                {next.overallProgress}%
              </div>
            </div>

            {next.eligible ? (
              <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', color: '#10b981', fontSize: 13, fontWeight: 600 }}>
                ✓ Éligible au statut {next.targetStatus} — vous serez bientôt informé(e) de votre changement de statut par SMS et/ou email.
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                  <span>Points statut ({next.currentStatusPoints12m} / {next.requiredStatusPoints} pts)</span>
                  <span style={{ fontWeight: 600 }}>{next.pointsProgress}%</span>
                </div>
                <ProgressBar value={next.pointsProgress} color="#3b82f6" />
                {next.pointsNeeded > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
                    {next.pointsNeeded} point{next.pointsNeeded > 1 ? 's' : ''} restant{next.pointsNeeded > 1 ? 's' : ''} pour atteindre {next.targetStatus}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {status === 'ROYAL' && (
          <div style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 12, padding: '14px 20px', marginBottom: 24, color: '#8B5CF6', fontSize: 13, fontWeight: 600 }}>
            ♛ Vous êtes au statut maximum — profitez de 12% de remise sur chaque achat chez nos marchands partenaires.
          </div>
        )}

        {/* Carte AfrikFid physique (source : business-api) */}
        <AfrikFidCardBlock data={afrikfidCard} />

        {/* Mon segment RFM + offres personnalisées , §5.4) */}
        <ClientRfmSection rfmSegment={profile.rfmSegment} triggerHistory={profile.triggerHistory} />

        {/* Historique unifié (affiché uniquement si carte fidélité liée) */}
        <UnifiedHistorySection history={unifiedHistory} />

        {/* Dernières transactions */}
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--af-text)' }}>Dernières transactions</div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>{transactions.length} affichées</div>
          </div>

          {transactions.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--af-text-muted)', fontSize: 13 }}>
              Aucune transaction pour le moment.<br />
              <span style={{ fontSize: 12 }}>Effectuez votre premier achat chez un marchand partenaire Afrik'Fid.</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--af-border)' }}>
                  {['Date', 'Marchand', 'Montant', 'Remise', 'Statut'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr key={tx.id} style={{ borderBottom: i < transactions.length - 1 ? '1px solid var(--af-surface)' : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--af-text-muted)' }}>{fmtDate(tx.initiated_at)}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 500, color: 'var(--af-text)' }}>{tx.merchant_name || '—'}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: 'var(--af-text)' }}>{fmt(tx.gross_amount, tx.currency)}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: '#10b981', fontWeight: 600 }}>
                      {tx.client_discount > 0 ? `− ${fmt(tx.client_discount, tx.currency)}` : <span style={{ color: 'var(--af-border)' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px' }}><TxStatusBadge status={tx.status} /></td>
                    <td style={{ padding: '11px 16px', display: 'flex', gap: 6 }}>
                      {tx.status === 'completed' && (<>
                        <button onClick={() => { setRefundModal(tx); setRefundReason(''); setRefundMsg('') }}
                          title="Demander le remboursement de cette transaction au marchand"
                          style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', cursor: 'pointer' }}>
                          Remboursement
                        </button>
                        <Tooltip text={TOOLTIPS.litige}>
                          <button onClick={() => { setDisputeModal(tx); setDisputeMsg(''); setDisputeForm({ reason: '', description: '' }) }}
                            style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer' }}>
                            Litige
                          </button>
                        </Tooltip>
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      {/* ── Disputes list ── */}
      {disputes.length > 0 && (
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, overflow: 'hidden', marginTop: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--af-border)' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--af-text)' }}>Mes litiges</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--af-border)' }}>
                {['Date', 'Transaction', 'Motif', 'Montant', 'Statut'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {disputes.map((d, i) => (
                <tr key={d.id} style={{ borderBottom: i < disputes.length - 1 ? '1px solid var(--af-border)' : 'none' }}>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--af-text-muted)' }}>{fmtDate(d.created_at)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{d.tx_reference || '—'}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--af-text)' }}>{d.reason?.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: 'var(--af-text)' }}>{fmt(d.amount_disputed, d.currency)}</td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
                      background: d.status === 'resolved' ? 'rgba(16,185,129,0.15)' : d.status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                      color: d.status === 'resolved' ? '#10b981' : d.status === 'rejected' ? '#ef4444' : 'var(--af-accent)',
                    }}>{d.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Refund request modal ── */}
      {refundModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--af-text)', marginBottom: 4 }}>Demander un remboursement</div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 6 }}>Transaction : <span style={{ color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{refundModal.reference}</span></div>
            <div style={{ fontSize: 13, color: 'var(--af-text)', fontWeight: 600, marginBottom: 20 }}>{fmt(refundModal.gross_amount, refundModal.currency)}</div>
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--af-accent)', marginBottom: 16 }}>
              Votre demande sera transmise au marchand. Le remboursement n'est pas automatique — il doit être approuvé.
            </div>
            {refundMsg && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                background: refundMsg.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${refundMsg.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: refundMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                {refundMsg}
              </div>
            )}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: 'var(--af-text-muted)', display: 'block', marginBottom: 6 }}>Motif de la demande *</label>
              <textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} rows={3}
                placeholder="Expliquez la raison de votre demande de remboursement..."
                style={{ width: '100%', padding: '9px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setRefundModal(null)}
                style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', fontSize: 13, cursor: 'pointer' }}>
                Annuler
              </button>
              <button onClick={submitRefundRequest} disabled={refundLoading || !refundReason.trim()}
                style={{ padding: '8px 18px', background: '#3b82f6', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: refundLoading || !refundReason.trim() ? 0.6 : 1 }}>
                {refundLoading ? 'Envoi...' : 'Soumettre la demande'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dispute modal ── */}
      {disputeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--af-text)', marginBottom: 4 }}>Déclarer un litige</div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 20 }}>Transaction : <span style={{ color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{disputeModal.reference}</span> — {fmt(disputeModal.gross_amount, disputeModal.currency)}</div>

            {disputeMsg && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                background: disputeMsg.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${disputeMsg.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: disputeMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                {disputeMsg}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: 'var(--af-text-muted)', display: 'block', marginBottom: 6 }}>Motif *</label>
              <select value={disputeForm.reason} onChange={e => setDisputeForm(f => ({ ...f, reason: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13 }}>
                <option value="">Sélectionner un motif</option>
                <option value="incorrect_amount">Montant incorrect</option>
                <option value="service_not_rendered">Service non rendu</option>
                <option value="duplicate_payment">Paiement en double</option>
                <option value="fraud">Fraude suspectée</option>
                <option value="other">Autre</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: 'var(--af-text-muted)', display: 'block', marginBottom: 6 }}>Description (optionnel)</label>
              <textarea value={disputeForm.description} onChange={e => setDisputeForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="Décrivez le problème rencontré..."
                style={{ width: '100%', padding: '9px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDisputeModal(null)}
                style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', fontSize: 13, cursor: 'pointer' }}>
                Annuler
              </button>
              <button onClick={submitDispute} disabled={disputeLoading || !disputeForm.reason}
                style={{ padding: '8px 18px', background: '#ef4444', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: disputeLoading || !disputeForm.reason ? 0.6 : 1 }}>
                {disputeLoading ? 'Envoi...' : 'Soumettre le litige'}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  )
}

// ─── Section segment RFM client  ────────────────────────────────────
const RFM_META = {
  CHAMPIONS:   { color: '#10b981', icon: '🏆', label: 'Champion',     desc: 'Vous faites partie de nos meilleurs clients ! Continuez comme ça.' },
  FIDELES:     { color: '#3b82f6', icon: '⭐', label: 'Fidèle',        desc: 'Vous achetez régulièrement chez nos marchands partenaires.' },
  PROMETTEURS: { color: '#8b5cf6', icon: '🚀', label: 'Prometteur',   desc: 'Vous avez un panier élevé. Achetez plus souvent pour monter en grade !' },
  A_RISQUE:    { color: '#ef4444', icon: '⚠',  label: 'À Surveiller', desc: 'Vous étiez actif mais on ne vous a pas vu récemment. Des offres vous attendent !' },
  HIBERNANTS:  { color: 'var(--af-accent)', icon: '💤', label: 'Hibernant',    desc: 'Cela fait un moment. Revenez profiter de vos avantages fidélité !' },
  PERDUS:      { color: '#6B7280', icon: '🔔', label: 'Inactif',      desc: 'Votre compte est inactif. Revenez découvrir nos nouvelles offres !' },
}

function ClientRfmSection({ rfmSegment, triggerHistory }) {
  if (!rfmSegment && (!triggerHistory || triggerHistory.length === 0)) return null

  const meta = rfmSegment ? (RFM_META[rfmSegment.segment] || null) : null

  // Offres actives : triggers WIN_BACK ou ALERTE_R récents (< 30 jours)
  const activeOffers = (triggerHistory || []).filter(t =>
    ['WIN_BACK', 'ALERTE_R', 'A_RISQUE'].includes(t.trigger_type) &&
    t.status === 'sent' &&
    t.sent_at && new Date(t.sent_at) > new Date(Date.now() - 30 * 86400000)
  )

  return (
    <div style={{ marginBottom: 24 }}>
      {meta && (
        <div style={{ background: `${meta.color}11`, border: `1px solid ${meta.color}33`, borderRadius: 14, padding: '16px 20px', marginBottom: activeOffers.length ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{meta.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: meta.color }}>Mon profil fidélité · {meta.label}</div>
              <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 3 }}>{meta.desc}</div>
            </div>
          </div>
        </div>
      )}

      {activeOffers.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 14, padding: '14px 20px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--af-accent)', marginBottom: 10 }}>Offres personnalisées pour vous</div>
          {activeOffers.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < activeOffers.length - 1 ? '1px solid rgba(245,158,11,0.1)' : 'none' }}>
              <span style={{ fontSize: 18 }}>🎁</span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--af-text)', fontWeight: 600 }}>
                  {t.trigger_type === 'WIN_BACK' ? 'Offre de retour exclusive — profitez de réductions spéciales' : 'Nous vous avons réservé une offre spéciale'}
                </div>
                {t.merchant_name && <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>chez {t.merchant_name}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
