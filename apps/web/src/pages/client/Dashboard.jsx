import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../App.jsx'
import { useTheme } from '../../theme.js'
import api from '../../api.js'
import { InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline'

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

const PAYMENT_METHOD_LABELS = {
  mobile_money:  { label: 'Mobile Money', color: '#f59e0b' },
  card:          { label: 'Carte bancaire', color: '#635bff' },
  reward_points: { label: 'Points',         color: '#10b981' },
  wallet:        { label: 'Wallet',         color: '#8b5cf6' },
  gift_card:     { label: 'Carte cadeau',   color: '#f59e0b' },
  cash:          { label: 'Espèces',        color: '#6b7280' },
}
const OPERATOR_LABELS = {
  ORANGE: 'Orange Money', MTN: 'MTN MoMo', WAVE: 'Wave',
  AIRTEL: 'Airtel Money', MOOV: 'Moov Money', MPESA: 'M-Pesa',
}
function PaymentMethodBadge({ method, operator }) {
  const meta = PAYMENT_METHOD_LABELS[method]
  if (!meta) return null
  const label = (method === 'mobile_money' && operator)
    ? (OPERATOR_LABELS[operator] || operator)
    : meta.label
  return (
    <span style={{ background: meta.color + '18', color: meta.color, padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ─── Sous-composants ──────────────────────────────────────────────────────────
function ProgressBar({ value, color }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(value, 100)}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
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

// ─── Carte physique ───────────────────────────────────────────────────────────
function AfrikFidCardBlock({ data }) {
  if (!data) return null
  if (!data.available) return (
    <div style={{ background: 'var(--af-surface)', border: '1px dashed var(--af-border)', borderRadius: 14, padding: '14px 18px', color: 'var(--af-text-muted)', fontSize: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--af-text)', marginBottom: 4 }}>Carte AfrikFid physique</div>
      {data.reason === 'card_format_not_unified'
        ? "Votre compte n'est pas encore lié à une carte fidélité physique AfrikFid."
        : 'Le service fidélité AfrikFid est temporairement indisponible — votre historique sera affiché au prochain chargement.'}
    </div>
  )
  const { card, wallet } = data
  return (
    <div style={{ background: 'linear-gradient(135deg, #1F2937 0%, #0F1115 100%)', color: '#fff', borderRadius: 14, padding: '20px 24px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'var(--af-shadow-elevated)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Carte fidélité AfrikFid</div>
          <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>
            {card?.numero?.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')}
          </div>
        </div>
        <div style={{ width: 40, height: 26, background: 'linear-gradient(135deg, var(--af-accent), var(--af-kpi-yellow))', borderRadius: 4, opacity: 0.9 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 16 }}>
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
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {new Intl.NumberFormat('fr-FR').format(wallet.solde_xof || wallet.balance || 0)} <span style={{ fontSize: 11, opacity: 0.7 }}>XOF</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Historique unifié ────────────────────────────────────────────────────────
function UnifiedHistorySection({ history }) {
  if (!history?.sources?.afrikfid?.available) return null
  if (!history.items?.length) return null
  const sourceMeta = {
    gateway: { label: 'Passerelle', color: '#3b82f6', bg: '#3b82f615' },
    afrikfid: { label: 'Enseigne',  color: '#8b5cf6', bg: '#8b5cf615' },
  }
  return (
    <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--af-text)' }}>Historique unifié</div>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>Paiements passerelle et achats dans le réseau Afrik'Fid</div>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
          <span style={{ color: sourceMeta.gateway.color }}>● Passerelle : {history.sources.gateway.count}</span>
          <span style={{ color: sourceMeta.afrikfid.color }}>● Enseignes : {history.sources.afrikfid.kept}</span>
        </div>
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {history.items.map((it) => {
          const meta = sourceMeta[it.source]
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--af-surface)' }}>
              {it.merchantLogo
                ? <img src={it.merchantLogo} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', background: 'var(--af-surface-3)' }} />
                : <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--af-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--af-text-muted)', fontWeight: 700 }}>
                    {(it.merchantName || '?').slice(0, 1).toUpperCase()}
                  </div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--af-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.merchantName || '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>{fmtDate(it.date)}</span>
                  <span style={{ background: meta.bg, color: meta.color, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{meta.label}</span>
                  <PaymentMethodBadge method={it.paymentMethod} operator={it.paymentOperator} />
                  {it.source === 'gateway' && <TxStatusBadge status={it.status} />}
                  {it.source === 'afrikfid' && it.pointsEarned > 0 && <span style={{ color: '#F59E0B' }}>+{it.pointsEarned} pts</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)' }}>{fmt(it.amountXof, it.currency)}</div>
                {it.clientRebateXof > 0 && <div style={{ fontSize: 11, color: '#10b981', marginTop: 2 }}>− {fmt(it.clientRebateXof, it.currency)}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── RFM section ─────────────────────────────────────────────────────────────
const RFM_META = {
  CHAMPIONS:   { color: '#10b981', icon: '🏆', label: 'Champion',     desc: 'Vous faites partie de nos meilleurs clients !' },
  FIDELES:     { color: '#3b82f6', icon: '⭐', label: 'Fidèle',        desc: 'Vous achetez régulièrement chez nos marchands partenaires.' },
  PROMETTEURS: { color: '#8b5cf6', icon: '🚀', label: 'Prometteur',   desc: 'Panier élevé — achetez plus souvent pour monter en grade !' },
  A_RISQUE:    { color: '#ef4444', icon: '⚠',  label: 'À Surveiller', desc: 'On ne vous a pas vu récemment. Des offres vous attendent !' },
  HIBERNANTS:  { color: 'var(--af-accent)', icon: '💤', label: 'Hibernant', desc: "Revenez profiter de vos avantages fidélité !" },
  PERDUS:      { color: '#6B7280', icon: '🔔', label: 'Inactif',      desc: 'Revenez découvrir nos nouvelles offres !' },
}

function ClientRfmSection({ rfmSegment, triggerHistory }) {
  if (!rfmSegment && (!triggerHistory || triggerHistory.length === 0)) return null
  const meta = rfmSegment ? (RFM_META[rfmSegment.segment] || null) : null
  const activeOffers = (triggerHistory || []).filter(t =>
    ['WIN_BACK', 'ALERTE_R', 'A_RISQUE'].includes(t.trigger_type) &&
    t.status === 'sent' && t.sent_at && new Date(t.sent_at) > new Date(Date.now() - 30 * 86400000)
  )
  return (
    <>
      {meta && (
        <div style={{ background: `${meta.color}11`, border: `1px solid ${meta.color}33`, borderRadius: 14, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>{meta.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: meta.color }}>Profil fidélité · {meta.label}</div>
              <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>{meta.desc}</div>
            </div>
          </div>
        </div>
      )}
      {activeOffers.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 14, padding: '14px 18px' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--af-accent)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Offres pour vous</div>
          {activeOffers.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: i < activeOffers.length - 1 ? '1px solid rgba(245,158,11,0.1)' : 'none' }}>
              <span style={{ fontSize: 16 }}>🎁</span>
              <div>
                <div style={{ fontSize: 12, color: 'var(--af-text)', fontWeight: 600 }}>
                  {t.trigger_type === 'WIN_BACK' ? 'Offre de retour exclusive — réductions spéciales' : 'Offre spéciale réservée pour vous'}
                </div>
                {t.merchant_name && <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 1 }}>chez {t.merchant_name}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────
export default function ClientDashboard() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const [profile, setProfile]             = useState(null)
  const [transactions, setTxs]            = useState([])
  const [afrikfidCard, setAfrikfidCard]   = useState(null)
  const [unifiedHistory, setUnifiedHistory] = useState(null)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [disputeModal, setDisputeModal]   = useState(null)
  const [disputes, setDisputes]           = useState([])
  const [disputeForm, setDisputeForm]     = useState({ reason: '', description: '' })
  const [disputeLoading, setDisputeLoading] = useState(false)
  const [disputeMsg, setDisputeMsg]       = useState('')
  const [refundModal, setRefundModal]     = useState(null)
  const [refundReason, setRefundReason]   = useState('')
  const [refundLoading, setRefundLoading] = useState(false)
  const [refundMsg, setRefundMsg]         = useState('')

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

  const handleLogout = () => { logout(); window.location.href = '/login' }

  const submitRefundRequest = async () => {
    if (!refundReason.trim()) return setRefundMsg('Le motif est requis')
    setRefundLoading(true); setRefundMsg('')
    try {
      await api.post(`/payments/${refundModal.id}/refund/request`, { reason: refundReason })
      setRefundMsg('✓ Demande envoyée. Le marchand sera notifié.')
      setTimeout(() => { setRefundModal(null); setRefundReason(''); setRefundMsg('') }, 2500)
    } catch (err) { setRefundMsg(err.response?.data?.error || 'Erreur lors de la demande') }
    finally { setRefundLoading(false) }
  }

  const submitDispute = async () => {
    if (!disputeForm.reason) return setDisputeMsg('Choisissez un motif')
    setDisputeLoading(true); setDisputeMsg('')
    try {
      await api.post('/disputes', { transaction_id: disputeModal.id, ...disputeForm })
      setDisputeMsg("✓ Litige déclaré. L'équipe Afrik'Fid vous contactera.")
      setTimeout(() => {
        setDisputeModal(null); setDisputeMsg(''); setDisputeForm({ reason: '', description: '' })
        api.get('/disputes/client/mine?limit=5').then(r => setDisputes(r.data.disputes || []))
      }, 2000)
    } catch (err) { setDisputeMsg(err.response?.data?.error || 'Erreur lors de la déclaration') }
    finally { setDisputeLoading(false) }
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
  const status     = client?.loyaltyStatus || 'OPEN'
  const meta       = STATUS_META[status] || STATUS_META.OPEN
  const currentIdx = STATUS_ORDER.indexOf(status)
  const rebateTotal = parseFloat(stats?.total_rebate || 0)
  const rebatePct  = client?.clientRebatePercent ?? meta.pct

  return (
    <div style={{ minHeight: '100vh', background: 'var(--af-surface-3)', color: 'var(--af-text)', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Header compact ── */}
      <header style={{ background: 'var(--af-surface)', borderBottom: '1px solid var(--af-border)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/afrikfid-logo.png" alt="Afrik'Fid" style={{ height: 32, width: 'auto', display: 'block' }} />
          <div style={{ fontSize: 10, color: 'var(--af-text-muted)' }}>Espace client</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text)' }}>{client?.fullName}</div>
            <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{client?.afrikfidId}</div>
          </div>
          <Link to="/client/profile" style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 7, color: '#3b82f6', fontSize: 11, fontWeight: 500, textDecoration: 'none' }}>
            Sécurité
          </Link>
          <button onClick={toggle} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            style={{ padding: '6px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 7, color: 'var(--af-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            {theme === 'dark' ? <SunIcon style={{ width: 16, height: 16 }} /> : <MoonIcon style={{ width: 16, height: 16 }} />}
          </button>
          <button onClick={handleLogout} style={{ padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, color: '#ef4444', cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>
            Déconnexion
          </button>
        </div>
      </header>

      {/* ── Corps principal ── */}
      <div style={{ padding: '20px 20px' }}>

        {/* ════════════════════════════════════════════
            GRILLE PRINCIPALE — layout asymétrique
            Col gauche (large) | Col droite (étroite)
        ════════════════════════════════════════════ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>

          {/* ── COL GAUCHE ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Hero statut — grand, plein */}
            <div style={{
              background: `linear-gradient(135deg, ${meta.color}25 0%, var(--af-surface) 60%)`,
              border: `1.5px solid ${meta.color}50`,
              borderRadius: 18,
              padding: '24px 28px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Fond décoratif */}
              <div style={{ position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: '50%', background: `${meta.color}10`, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', fontSize: 80, opacity: 0.06, lineHeight: 1, pointerEvents: 'none' }}>
                {meta.icon}
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                    Statut fidélité <InfoTooltip text={TOOLTIPS[status]} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontSize: 44, lineHeight: 1 }}>{meta.icon}</span>
                    <div>
                      <div style={{ fontSize: 30, fontWeight: 900, color: meta.color, lineHeight: 1 }}>{status}</div>
                      <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 4 }}>
                        {meta.label} · <span style={{ color: meta.color, fontWeight: 700 }}>{rebatePct}%</span> de remise sur vos achats
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stepper horizontal */}
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                  {STATUS_ORDER.map((s, i) => {
                    const m = STATUS_META[s]
                    const done = i <= currentIdx
                    return (
                      <React.Fragment key={s}>
                        <Tooltip text={TOOLTIPS[s] || s} position="bottom">
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: done ? m.color : 'var(--af-surface-3)',
                            border: `2px solid ${done ? m.color : 'var(--af-border)'}`,
                            fontSize: 12, fontWeight: 700, color: done ? '#fff' : 'var(--af-text-muted)',
                            transition: 'all .2s',
                          }}>{m.icon}</div>
                        </Tooltip>
                        {i < STATUS_ORDER.length - 1 && (
                          <div style={{ width: 16, height: 2, background: i < currentIdx ? meta.color : 'var(--af-border)', borderRadius: 1 }} />
                        )}
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* KPIs — grille 2×2 compacte avec tailles variées */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto', gap: 12 }}>

              {/* Grand — portefeuille */}
              <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '20px 22px', gridRow: 'span 2', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>Solde portefeuille</div>
                  <div style={{ fontSize: 34, fontWeight: 900, color: '#10b981', lineHeight: 1 }}>{fmt(wallet?.balance, wallet?.currency || 'XOF')}</div>
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>Total gagné : <span style={{ color: '#10b981', fontWeight: 600 }}>{fmt(wallet?.totalEarned, wallet?.currency || 'XOF')}</span></div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Remises reçues <InfoTooltip text={TOOLTIPS.remise_y} /></div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: meta.color }}>{fmt(rebateTotal)}</div>
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 3 }}>Taux actuel : {rebatePct}% · {status}</div>
                </div>
              </div>

              {/* Court — achats */}
              <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Achats</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: '#3b82f6' }}>{parseInt(stats?.count || 0).toLocaleString('fr-FR')}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 3 }}>transactions réussies</div>
              </div>

              {/* Long — volume + barre */}
              <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Volume total</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--af-accent)', lineHeight: 1.2 }}>{fmt(stats?.total)}</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 3 }}>montant brut cumulé</div>
              </div>
            </div>

            {/* Points statut / récompense — 2 colonnes */}
            <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <div style={{ paddingRight: 20 }}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                  Points statut <span style={{ color: 'var(--af-border-strong)', fontWeight: 400, fontSize: 9 }}></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: meta.color }}>{(client?.statusPoints12m || 0).toLocaleString('fr-FR')}</span>
                  <span style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>pts (12 mois)</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--af-border-strong)', marginTop: 4 }}>
                  Lifetime : {(client?.lifetimeStatusPoints || 0).toLocaleString('fr-FR')} pts
                </div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 3 }}>Servent à la qualification statut uniquement.</div>
              </div>

              <div style={{ borderLeft: '1px solid var(--af-border)', paddingLeft: 20 }}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                  Points récompense <span style={{ color: 'var(--af-border-strong)', fontWeight: 400, fontSize: 9 }}></span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 28, fontWeight: 900, color: '#10b981' }}>{(client?.rewardPoints || 0).toLocaleString('fr-FR')}</span>
                  <span style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>pts disponibles</span>
                </div>
                <div style={{ fontSize: 12, color: '#10b981', marginTop: 4, fontWeight: 600 }}>≈ {fmt((client?.rewardPoints || 0) * 100)} utilisables</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 3 }}>1 pt = 100 FCFA · utilisables chez tous les marchands.</div>
              </div>
            </div>

            {/* Dernières transactions — table compacte */}
            <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--af-text)' }}>Dernières transactions</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>{transactions.length} affichées</div>
              </div>
              {transactions.length === 0 ? (
                <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--af-text-muted)', fontSize: 13 }}>
                  Aucune transaction.<br /><span style={{ fontSize: 12 }}>Effectuez votre premier achat chez un marchand partenaire.</span>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--af-bg)' }}>
                        {['Date', 'Marchand', 'Moyen', 'Montant', 'Remise', 'Statut', ''].map(h => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx, i) => (
                        <tr key={tx.id} style={{ borderTop: '1px solid var(--af-border)', background: i % 2 === 0 ? 'transparent' : 'var(--af-bg)' }}>
                          <td style={{ padding: '10px 14px', color: 'var(--af-text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(tx.initiated_at)}</td>
                          <td style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--af-text)', whiteSpace: 'nowrap' }}>{tx.merchant_name || '—'}</td>
                          <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><PaymentMethodBadge method={tx.payment_method} operator={tx.payment_operator} /></td>
                          <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--af-text)', whiteSpace: 'nowrap' }}>{fmt(tx.gross_amount, tx.currency)}</td>
                          <td style={{ padding: '10px 14px', color: '#10b981', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {tx.client_discount > 0 ? `− ${fmt(tx.client_discount, tx.currency)}` : <span style={{ color: 'var(--af-border)' }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px' }}><TxStatusBadge status={tx.status} /></td>
                          <td style={{ padding: '10px 14px' }}>
                            {tx.status === 'completed' && (
                              <div style={{ display: 'flex', gap: 5 }}>
                                <button onClick={() => { setRefundModal(tx); setRefundReason(''); setRefundMsg('') }}
                                  style={{ fontSize: 10, padding: '3px 7px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 5, color: '#3b82f6', cursor: 'pointer' }}>
                                  Remb.
                                </button>
                                <Tooltip text={TOOLTIPS.litige}>
                                  <button onClick={() => { setDisputeModal(tx); setDisputeMsg(''); setDisputeForm({ reason: '', description: '' }) }}
                                    style={{ fontSize: 10, padding: '3px 7px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, color: '#ef4444', cursor: 'pointer' }}>
                                    Litige
                                  </button>
                                </Tooltip>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Litiges */}
            {disputes.length > 0 && (
              <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--af-border)' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--af-text)' }}>Mes litiges</div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--af-bg)' }}>
                      {['Date', 'Transaction', 'Motif', 'Montant', 'Statut'].map(h => (
                        <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map((d, i) => (
                      <tr key={d.id} style={{ borderTop: '1px solid var(--af-border)' }}>
                        <td style={{ padding: '10px 14px', color: 'var(--af-text-muted)' }}>{fmtDate(d.created_at)}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--af-text-muted)', fontFamily: 'monospace', fontSize: 10 }}>{d.tx_reference || '—'}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--af-text)' }}>{d.reason?.replace(/_/g, ' ')}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--af-text)' }}>{fmt(d.amount_disputed, d.currency)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
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

          </div>{/* fin col gauche */}

          {/* ── COL DROITE ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Carte physique */}
            <AfrikFidCardBlock data={afrikfidCard} />

            {/* Progression statut — court */}
            {next && (
              <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
                  Progression vers <StatusBadge status={next.targetStatus} />
                </div>
                {next.eligible ? (
                  <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 12px', color: '#10b981', fontSize: 12, fontWeight: 600 }}>
                    ✓ Éligible au statut {next.targetStatus} — vous serez informé(e) prochainement.
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                      <span>{next.currentStatusPoints12m} / {next.requiredStatusPoints} pts</span>
                      <span style={{ fontWeight: 700, color: 'var(--af-accent)' }}>{next.pointsProgress}%</span>
                    </div>
                    <ProgressBar value={next.pointsProgress} color="#3b82f6" />
                    {next.pointsNeeded > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
                        Encore <span style={{ fontWeight: 700, color: 'var(--af-text)' }}>{next.pointsNeeded}</span> pt{next.pointsNeeded > 1 ? 's' : ''} pour {next.targetStatus}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 4 }}>Évalué sur {next.evaluationMonths} mois</div>
                  </div>
                )}
              </div>
            )}

            {/* Badges statut haut de gamme */}
            {status === 'ROYAL' && (
              <div style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 12, padding: '12px 16px', color: '#8B5CF6', fontSize: 12, fontWeight: 600 }}>
                ♛ Statut Élite — 12% de remise. Maintenez ce niveau 3 ans pour atteindre ROYAL ÉLITE.
              </div>
            )}
            {status === 'ROYAL_ELITE' && (
              <div style={{ background: 'rgba(236,72,153,0.1)', border: '1px solid rgba(236,72,153,0.3)', borderRadius: 12, padding: '12px 16px', color: '#ec4899', fontSize: 12, fontWeight: 600 }}>
                ♔ Statut Élite Suprême — remise maximum sur chaque achat chez nos marchands partenaires.
              </div>
            )}

            {/* RFM / offres */}
            <ClientRfmSection rfmSegment={profile.rfmSegment} triggerHistory={profile.triggerHistory} />

            {/* Historique unifié — colonne droite, scrollable */}
            <UnifiedHistorySection history={unifiedHistory} />

          </div>{/* fin col droite */}

        </div>{/* fin grille principale */}
      </div>{/* fin body */}

      {/* ── Modal remboursement ── */}
      {refundModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--af-text)', marginBottom: 4 }}>Demander un remboursement</div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 4 }}>Transaction : <span style={{ fontFamily: 'monospace' }}>{refundModal.reference}</span></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--af-text)', marginBottom: 20 }}>{fmt(refundModal.gross_amount, refundModal.currency)}</div>
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--af-accent)', marginBottom: 16 }}>
              Votre demande sera transmise au marchand. Le remboursement n'est pas automatique.
            </div>
            {refundMsg && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                background: refundMsg.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${refundMsg.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: refundMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{refundMsg}</div>
            )}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: 'var(--af-text-muted)', display: 'block', marginBottom: 6 }}>Motif *</label>
              <textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} rows={3}
                placeholder="Expliquez la raison de votre demande..."
                style={{ width: '100%', padding: '9px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setRefundModal(null)} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', fontSize: 13, cursor: 'pointer' }}>Annuler</button>
              <button onClick={submitRefundRequest} disabled={refundLoading || !refundReason.trim()}
                style={{ padding: '8px 18px', background: '#3b82f6', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: refundLoading || !refundReason.trim() ? 0.6 : 1 }}>
                {refundLoading ? 'Envoi...' : 'Soumettre'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal litige ── */}
      {disputeModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--af-text)', marginBottom: 4 }}>Déclarer un litige</div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 20 }}>
              Transaction : <span style={{ fontFamily: 'monospace' }}>{disputeModal.reference}</span> — {fmt(disputeModal.gross_amount, disputeModal.currency)}
            </div>
            {disputeMsg && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                background: disputeMsg.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${disputeMsg.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: disputeMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{disputeMsg}</div>
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
              <button onClick={() => setDisputeModal(null)} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', fontSize: 13, cursor: 'pointer' }}>Annuler</button>
              <button onClick={submitDispute} disabled={disputeLoading || !disputeForm.reason}
                style={{ padding: '8px 18px', background: '#ef4444', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: disputeLoading || !disputeForm.reason ? 0.6 : 1 }}>
                {disputeLoading ? 'Envoi...' : 'Soumettre le litige'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
