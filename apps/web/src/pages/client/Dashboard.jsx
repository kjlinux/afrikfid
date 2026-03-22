import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../App.jsx'
import api from '../../api.js'

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
function KpiCard({ label, value, sub, color = '#f59e0b' }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ value, color }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 99, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
    </div>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.OPEN
  return (
    <span style={{ background: m.bg, border: `1px solid ${m.color}40`, borderRadius: 6, padding: '3px 10px', color: m.color, fontWeight: 700, fontSize: 13 }}>
      {m.icon} {status}
    </span>
  )
}

function TxStatusBadge({ status }) {
  const colors = {
    completed: ['#10b981', '#10b98115'],
    pending:   ['#f59e0b', '#f59e0b15'],
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
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#64748b', fontSize: 14 }}>Chargement…</div>
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <header style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>A</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Afrik'Fid</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Espace client</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{client?.fullName}</div>
            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{client?.afrikfidId}</div>
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
        <div style={{ background: `linear-gradient(135deg, ${meta.color}20, #1e293b)`, border: `1px solid ${meta.color}40`, borderRadius: 16, padding: '24px 28px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>Votre statut fidélité</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 36, lineHeight: 1 }}>{meta.icon}</span>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: meta.color }}>{status}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{meta.label} · {meta.pct}% de remise sur vos achats</div>
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
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? m.color : '#0f172a',
                    border: `2px solid ${done ? m.color : '#334155'}`,
                    fontSize: 13, fontWeight: 700,
                    color: done ? '#fff' : '#64748b',
                  }} title={s}>
                    {m.icon}
                  </div>
                  {i < STATUS_ORDER.length - 1 && (
                    <div style={{ width: 20, height: 2, background: i < currentIdx ? '#f59e0b' : '#334155', borderRadius: 1 }} />
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
            color="#f59e0b"
          />
          <KpiCard
            label="Remises reçues (est.)"
            value={fmt(rebateTotal)}
            sub={`Taux actuel : ${meta.pct}% (${status})`}
            color={meta.color}
          />
        </div>

        {/* CDC §2.3 — Points statut vs points récompense séparés */}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: '16px 20px', marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Points statut */}
          <div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Points statut <span style={{ color: '#475569', fontWeight: 400, fontSize: 10, marginLeft: 6 }}>1 pt = 500 FCFA d'achat</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: meta.color }}>
                {(client?.statusPoints12m || 0).toLocaleString('fr-FR')}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>pts (12 mois)</span>
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Total cumulé : {(client?.lifetimeStatusPoints || 0).toLocaleString('fr-FR')} pts
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
              Ces points servent uniquement à la qualification de statut et ne peuvent pas être dépensés.
            </div>
          </div>

          {/* Points récompense */}
          <div style={{ borderLeft: '1px solid #334155', paddingLeft: 20 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Points récompense <span style={{ color: '#475569', fontWeight: 400, fontSize: 10, marginLeft: 6 }}>1 pt = 100 FCFA</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#10b981' }}>
                {(client?.rewardPoints || 0).toLocaleString('fr-FR')}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>pts disponibles</span>
            </div>
            <div style={{ fontSize: 12, color: '#10b981', marginTop: 4, fontWeight: 600 }}>
              ≈ {fmt((client?.rewardPoints || 0) * 100)} utilisables
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
              Utilisables chez tous les marchands du réseau sans affecter votre statut.
            </div>
          </div>
        </div>

        {/* Progression vers le prochain statut */}
        {next && (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: '20px 24px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>
                  Progression vers <StatusBadge status={next.targetStatus} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  Évaluée sur les {next.evaluationMonths} derniers mois
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: next.eligible ? '#10b981' : '#f59e0b' }}>
                {next.overallProgress}%
              </div>
            </div>

            {next.eligible ? (
              <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', color: '#10b981', fontSize: 13, fontWeight: 600 }}>
                ✓ Éligible au statut {next.targetStatus} — vous serez bientôt informé(e) de votre changement de statut par SMS et/ou email.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                    <span>Achats ({next.currentPurchases}/{next.requiredPurchases})</span>
                    <span style={{ fontWeight: 600 }}>{next.purchasesProgress}%</span>
                  </div>
                  <ProgressBar value={next.purchasesProgress} color="#3b82f6" />
                  {next.purchasesNeeded > 0 && (
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{next.purchasesNeeded} achat(s) restant(s)</div>
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
                    <span>Volume ({fmt(next.currentAmount)}/{fmt(next.requiredAmount)})</span>
                    <span style={{ fontWeight: 600 }}>{next.amountProgress}%</span>
                  </div>
                  <ProgressBar value={next.amountProgress} color="#f59e0b" />
                  {next.amountNeeded > 0 && (
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{fmt(next.amountNeeded)} restants</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'ROYAL' && (
          <div style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 12, padding: '14px 20px', marginBottom: 24, color: '#8B5CF6', fontSize: 13, fontWeight: 600 }}>
            ♛ Vous êtes au statut maximum — profitez de 12% de remise sur chaque achat chez nos marchands partenaires.
          </div>
        )}

        {/* Mon segment RFM + offres personnalisées (CDC §5.3, §5.4) */}
        <ClientRfmSection rfmSegment={profile.rfmSegment} triggerHistory={profile.triggerHistory} />

        {/* Dernières transactions */}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Dernières transactions</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{transactions.length} affichées</div>
          </div>

          {transactions.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              Aucune transaction pour le moment.<br />
              <span style={{ fontSize: 12 }}>Effectuez votre premier achat chez un marchand partenaire Afrik'Fid.</span>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Date', 'Marchand', 'Montant', 'Remise', 'Statut'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr key={tx.id} style={{ borderBottom: i < transactions.length - 1 ? '1px solid #1e293b' : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ padding: '11px 16px', fontSize: 12, color: '#94a3b8' }}>{fmtDate(tx.initiated_at)}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 500, color: '#f1f5f9' }}>{tx.merchant_name || '—'}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{fmt(tx.gross_amount, tx.currency)}</td>
                    <td style={{ padding: '11px 16px', fontSize: 13, color: '#10b981', fontWeight: 600 }}>
                      {tx.client_discount > 0 ? `− ${fmt(tx.client_discount, tx.currency)}` : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '11px 16px' }}><TxStatusBadge status={tx.status} /></td>
                    <td style={{ padding: '11px 16px', display: 'flex', gap: 6 }}>
                      {tx.status === 'completed' && (<>
                        <button onClick={() => { setRefundModal(tx); setRefundReason(''); setRefundMsg('') }}
                          style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', cursor: 'pointer' }}>
                          Remboursement
                        </button>
                        <button onClick={() => { setDisputeModal(tx); setDisputeMsg(''); setDisputeForm({ reason: '', description: '' }) }}
                          style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer' }}>
                          Litige
                        </button>
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
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, overflow: 'hidden', marginTop: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Mes litiges</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Date', 'Transaction', 'Motif', 'Montant', 'Statut'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {disputes.map((d, i) => (
                <tr key={d.id} style={{ borderBottom: i < disputes.length - 1 ? '1px solid #334155' : 'none' }}>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: '#94a3b8' }}>{fmtDate(d.created_at)}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{d.tx_reference || '—'}</td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: '#f1f5f9' }}>{d.reason?.replace(/_/g, ' ')}</td>
                  <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{fmt(d.amount_disputed, d.currency)}</td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
                      background: d.status === 'resolved' ? 'rgba(16,185,129,0.15)' : d.status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                      color: d.status === 'resolved' ? '#10b981' : d.status === 'rejected' ? '#ef4444' : '#f59e0b',
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
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9', marginBottom: 4 }}>Demander un remboursement</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Transaction : <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{refundModal.reference}</span></div>
            <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600, marginBottom: 20 }}>{fmt(refundModal.gross_amount, refundModal.currency)}</div>
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f59e0b', marginBottom: 16 }}>
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
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Motif de la demande *</label>
              <textarea value={refundReason} onChange={e => setRefundReason(e.target.value)} rows={3}
                placeholder="Expliquez la raison de votre demande de remboursement..."
                style={{ width: '100%', padding: '9px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setRefundModal(null)}
                style={{ padding: '8px 18px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
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
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#f1f5f9', marginBottom: 4 }}>Déclarer un litige</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>Transaction : <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{disputeModal.reference}</span> — {fmt(disputeModal.gross_amount, disputeModal.currency)}</div>

            {disputeMsg && (
              <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
                background: disputeMsg.startsWith('✓') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${disputeMsg.startsWith('✓') ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color: disputeMsg.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                {disputeMsg}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Motif *</label>
              <select value={disputeForm.reason} onChange={e => setDisputeForm(f => ({ ...f, reason: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13 }}>
                <option value="">Sélectionner un motif</option>
                <option value="incorrect_amount">Montant incorrect</option>
                <option value="service_not_rendered">Service non rendu</option>
                <option value="duplicate_payment">Paiement en double</option>
                <option value="fraud">Fraude suspectée</option>
                <option value="other">Autre</option>
              </select>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Description (optionnel)</label>
              <textarea value={disputeForm.description} onChange={e => setDisputeForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="Décrivez le problème rencontré..."
                style={{ width: '100%', padding: '9px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDisputeModal(null)}
                style={{ padding: '8px 18px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
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

// ─── Section segment RFM client (CDC §5.3) ────────────────────────────────────
const RFM_META = {
  CHAMPIONS:   { color: '#10b981', icon: '🏆', label: 'Champion',     desc: 'Vous faites partie de nos meilleurs clients ! Continuez comme ça.' },
  FIDELES:     { color: '#3b82f6', icon: '⭐', label: 'Fidèle',        desc: 'Vous achetez régulièrement chez nos marchands partenaires.' },
  PROMETTEURS: { color: '#8b5cf6', icon: '🚀', label: 'Prometteur',   desc: 'Vous avez un panier élevé. Achetez plus souvent pour monter en grade !' },
  A_RISQUE:    { color: '#ef4444', icon: '⚠',  label: 'À Surveiller', desc: 'Vous étiez actif mais on ne vous a pas vu récemment. Des offres vous attendent !' },
  HIBERNANTS:  { color: '#f59e0b', icon: '💤', label: 'Hibernant',    desc: 'Cela fait un moment. Revenez profiter de vos avantages fidélité !' },
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
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{meta.desc}</div>
            </div>
          </div>
        </div>
      )}

      {activeOffers.length > 0 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 14, padding: '14px 20px' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#f59e0b', marginBottom: 10 }}>Offres personnalisées pour vous</div>
          {activeOffers.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < activeOffers.length - 1 ? '1px solid rgba(245,158,11,0.1)' : 'none' }}>
              <span style={{ fontSize: 18 }}>🎁</span>
              <div>
                <div style={{ fontSize: 12, color: '#f1f5f9', fontWeight: 600 }}>
                  {t.trigger_type === 'WIN_BACK' ? 'Offre de retour exclusive — profitez de réductions spéciales' : 'Nous vous avons réservé une offre spéciale'}
                </div>
                {t.merchant_name && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>chez {t.merchant_name}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
