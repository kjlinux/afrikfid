import React, { useEffect, useState, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, Cell } from 'recharts'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { fmt, KpiCard, Card, CopyButton, Spinner, PeriodSelector, exportCsv, InfoTooltip, Tooltip as HelpTooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'
import { useSSE } from '../../hooks/useSSE.js'
import { useToast } from '../../components/ToastNotification.jsx'
import { Link } from 'react-router-dom'
import {
  CurrencyDollarIcon,
  ChartBarIcon,
  GiftIcon,
  CheckCircleIcon,
  ShieldExclamationIcon,
  LinkIcon,
  ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline'

const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6', ROYAL_ELITE: '#ec4899' }

// Ordre et labels des packages (CDC v3 §6.1)
const PKG_ORDER = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']
const PKG_LABEL = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium Performance' }
const PKG_COLOR = { STARTER_BOOST: 'var(--af-text-muted)', STARTER_PLUS: '#3b82f6', GROWTH: '#8b5cf6', PREMIUM: 'var(--af-accent)' }

// Matrice des fonctionnalités par package (CDC v3 §6.1)
const FEATURE_MATRIX = [
  { key: 'taux_retour',   label: 'Taux de retour clients',          tip: 'taux_retour',     min: 'STARTER_PLUS', path: '/merchant/clients' },
  { key: 'top_clients',   label: 'Top clients fidèles',             tip: null,              min: 'STARTER_PLUS', path: '/merchant/clients' },
  { key: 'rfm',           label: 'Segmentation RFM automatique',    tip: 'RFM',             min: 'GROWTH',        path: '/merchant/intelligence' },
  { key: 'campaigns',     label: 'Campagnes automatisées',          tip: null,              min: 'GROWTH',        path: '/merchant/intelligence' },
  { key: 'churn',         label: 'Prédiction churn & alertes',      tip: 'churn',           min: 'GROWTH',        path: '/merchant/intelligence' },
  { key: 'ltv',           label: 'LTV par client et statut',        tip: 'LTV',             min: 'PREMIUM',       path: '/merchant/intelligence' },
  { key: 'elasticite',    label: 'Élasticité-prix & prévisions',    tip: 'elasticite_prix', min: 'PREMIUM',       path: '/merchant/intelligence' },
  { key: 'erp',           label: 'Intégration ERP / CRM',           tip: null,              min: 'PREMIUM',       path: '/merchant/settings' },
]

function PackageBadge({ pkg }) {
  return (
    <span style={{
      background: `${PKG_COLOR[pkg]}22`, color: PKG_COLOR[pkg],
      padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
      border: `1px solid ${PKG_COLOR[pkg]}44`,
    }}>
      {PKG_LABEL[pkg] || pkg}
    </span>
  )
}

function FeatureAccessPanel({ pkg }) {
  const pkgIdx = PKG_ORDER.indexOf(pkg)
  const accessible = FEATURE_MATRIX.filter(f => PKG_ORDER.indexOf(f.min) <= pkgIdx)
  const locked = FEATURE_MATRIX.filter(f => PKG_ORDER.indexOf(f.min) > pkgIdx)
  if (locked.length === 0) return null
  return (
    <div style={{ background: 'var(--afrikfid-surface)', border: '1px solid var(--afrikfid-border)', borderRadius: 12, padding: '16px 20px', marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)', marginBottom: 12, fontFamily: 'Montserrat, sans-serif' }}>
        Fonctionnalités de votre plan · <PackageBadge pkg={pkg} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {accessible.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(16,185,129,0.06)', borderRadius: 6, border: '1px solid rgba(16,185,129,0.15)' }}>
            <span style={{ color: '#10b981', fontSize: 14 }}>✓</span>
            <a href={f.path} style={{ fontSize: 12, color: 'var(--af-text-muted)', textDecoration: 'none' }}>
              {f.label}{f.tip && TOOLTIPS[f.tip] && <InfoTooltip text={TOOLTIPS[f.tip]} />}
            </a>
          </div>
        ))}
        {locked.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(107,114,128,0.06)', borderRadius: 6, border: '1px solid rgba(107,114,128,0.15)' }}>
            <span style={{ color: 'var(--af-border-strong)', fontSize: 14 }}>🔒</span>
            <span style={{ fontSize: 12, color: 'var(--af-border-strong)' }}>
              {f.label}{f.tip && TOOLTIPS[f.tip] && <InfoTooltip text={TOOLTIPS[f.tip]} />}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: PKG_COLOR[f.min], fontWeight: 700 }}>{PKG_LABEL[f.min]}</span>
          </div>
        ))}
      </div>
      {locked.length > 0 && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <a href="/merchant/settings" style={{ fontSize: 12, color: 'var(--af-accent)', fontWeight: 600, textDecoration: 'none' }}>
            Découvrir les plans supérieurs →
          </a>
        </div>
      )}
    </div>
  )
}

export default function MerchantDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [profile, setProfile] = useState(null)
  const [daily, setDaily] = useState([])
  const [period, setPeriod] = useState('30')
  const [showKey, setShowKey] = useState(false)
  const { toast } = useToast()

  const token = localStorage.getItem('afrikfid_token_merchant')

  useEffect(() => {
    api.get('/merchants/me/profile').then(r => setProfile(r.data.merchant))
  }, [])

  const loadStats = useCallback(() => {
    api.get(`/merchants/me/stats?period=${period}d`).then(r => {
      setStats(r.data)
      setDaily(r.data.dailyVolume || [])
    })
  }, [period])

  useEffect(() => { loadStats() }, [loadStats])

  // SSE — notifications temps réel
  useSSE('merchant', token, {
    'payment.success': (payload) => {
      toast(`Paiement reçu : ${payload.amount} ${payload.currency}`, 'success')
      setTimeout(loadStats, 1000)
    },
    'payment.failed': (payload) => {
      toast(`Paiement échoué (${payload.reference || payload.transactionId})`, 'error')
    },
    'webhook.failed': (payload) => {
      toast(`Webhook non livré : ${payload.eventType}`, 'warning', 6000)
    },
  }, !!token)

  if (!stats || !profile) return <Spinner />

  const { stats: s, byLoyaltyStatus } = stats

  const handleExport = () => {
    exportCsv(daily, [
      { label: 'Date', key: 'day' },
      { label: 'Volume', key: 'volume' },
      { label: 'Transactions', key: 'count' },
    ], `mes-ventes-${period}j.csv`)
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      {/* Bannière KYC */}
      {profile.kycStatus !== 'approved' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          background: profile.kycStatus === 'rejected' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
          border: `1px solid ${profile.kycStatus === 'rejected' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
          borderRadius: 12, padding: '14px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ShieldExclamationIcon style={{ width: 22, color: profile.kycStatus === 'rejected' ? '#ef4444' : '#F59E0B', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: profile.kycStatus === 'rejected' ? '#ef4444' : '#F59E0B' }}>
                {profile.kycStatus === 'submitted' && 'KYC en cours d\'examen'}
                {profile.kycStatus === 'rejected' && 'KYC rejeté — action requise'}
                {profile.kycStatus === 'pending' && 'Vérification KYC requise'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>
                {profile.kycStatus === 'submitted' && 'Notre équipe examine votre dossier. Vous serez notifié sous 24–48h.'}
                {profile.kycStatus === 'rejected' && 'Votre dossier a été rejeté. Soumettez un nouveau dossier pour activer votre compte.'}
                {profile.kycStatus === 'pending' && 'Soumettez vos documents pour activer les paiements sur votre compte.'}
              </div>
            </div>
          </div>
          {profile.kycStatus !== 'submitted' && (
            <Link to="/merchant/kyc" style={{
              padding: '8px 18px', background: profile.kycStatus === 'rejected' ? '#ef4444' : '#F59E0B',
              color: 'var(--af-surface-3)', borderRadius: 8, fontWeight: 700, fontSize: 13,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
              {profile.kycStatus === 'rejected' ? 'Resoumettre' : 'Compléter mon KYC'}
            </Link>
          )}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>Bonjour, {profile.name}</h1>
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <HelpTooltip text={TOOLTIPS.remise_x}>
              <span style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--af-accent)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
                Remise X = {profile.rebatePercent}%
              </span>
            </HelpTooltip>
            <HelpTooltip text={profile.rebateMode === 'cashback' ? TOOLTIPS.cashback : TOOLTIPS.remise_immediate}>
              <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                {profile.rebateMode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'}
              </span>
            </HelpTooltip>
            <span style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
              {profile.countryId} · {profile.currency}
            </span>
            {profile.package && <PackageBadge pkg={profile.package} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {daily.length > 0 && (
            <button onClick={handleExport}
              style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ↓ Export CSV
            </button>
          )}
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <KpiCard label={<>Volume total<InfoTooltip text={TOOLTIPS.chiffre_affaires} /></>} value={`${fmt(s.total_volume)} XOF`} icon={<CurrencyDollarIcon />} color="var(--af-accent)" />
        <KpiCard label={<>Reçu net<InfoTooltip text={TOOLTIPS.recu_net} /></>} value={`${fmt(s.total_received)} XOF`} icon={<CheckCircleIcon />} color="#10b981" sub={`Après remise X=${profile.rebatePercent}%`} />
        <KpiCard label={<>Remises accordées<InfoTooltip text={TOOLTIPS.remise_y} /></>} value={`${fmt(s.total_rebate_given)} XOF`} icon={<GiftIcon />} color="#3b82f6" sub="Cashback clients (Y%)" />
        <KpiCard label="Transactions" value={s.completed_count} icon={<ChartBarIcon />} color="#8b5cf6" sub={`sur ${period} jours`} />
      </div>

      {/* Graphiques */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Volume quotidien */}
        {daily.length > 0 ? (
          <Card title={`Volume quotidien — ${period} jours`}>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E30613" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#E30613" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--af-border)" />
                <XAxis dataKey="day" tick={{ fill: 'var(--af-text-muted)', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--af-text-muted)', fontSize: 10 }} tickLine={false} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)' }}
                  formatter={v => [`${fmt(v)} XOF`]} />
                <Area type="monotone" dataKey="volume" stroke="#E30613" strokeWidth={2.5} fill="url(#mGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        ) : (
          <Card title="Volume par statut fidélité client">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byLoyaltyStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--af-border)" />
                <XAxis dataKey="client_loyalty_status" tick={{ fill: 'var(--af-text-muted)', fontSize: 12 }} />
                <YAxis tick={{ fill: 'var(--af-text-muted)', fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)' }}
                  formatter={v => [`${fmt(v)} XOF`]} />
                <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
                  {byLoyaltyStatus.map((e, i) => <Cell key={i} fill={LOYALTY_COLOR[e.client_loyalty_status] || '#6B7280'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Fidélité + clé API */}
        <Card title="Clients par statut">
          {byLoyaltyStatus.map(row => (
            <div key={row.client_loyalty_status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: LOYALTY_COLOR[row.client_loyalty_status] || '#6B7280' }} />
                <span style={{ fontSize: 13, color: 'var(--afrikfid-muted)' }}>{row.client_loyalty_status}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--afrikfid-text)' }}>{row.count} tx</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>{fmt(row.volume)} XOF</div>
              </div>
            </div>
          ))}

          {/* Clés API */}
          <div style={{ marginTop: 16, background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: 12, border: '1px solid var(--afrikfid-border)' }}>
            <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>CLÉ API SANDBOX<InfoTooltip text={TOOLTIPS.sandbox} position="left" /></span>
              <CopyButton text={profile.sandboxKeyPublic} />
            </div>
            <code style={{ fontSize: 11, color: 'var(--af-accent)', wordBreak: 'break-all', display: showKey ? 'block' : 'none' }}>{profile.sandboxKeyPublic}</code>
            {!showKey && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button onClick={() => setShowKey(true)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Afficher la clé
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Volume par fidélité si daily affiché avant */}
      {daily.length > 0 && (
        <Card title="Volume par statut fidélité client">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byLoyaltyStatus}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--af-border)" />
              <XAxis dataKey="client_loyalty_status" tick={{ fill: 'var(--af-text-muted)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'var(--af-text-muted)', fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)' }}
                formatter={v => [`${fmt(v)} XOF`]} />
              <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
                {byLoyaltyStatus.map((e, i) => <Cell key={i} fill={LOYALTY_COLOR[e.client_loyalty_status] || '#6B7280'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Bonus recrutement + Success Fee + RFM/Triggers */}
      <MerchantIntelligenceSection pkg={profile.package} period={period} merchantId={user?.merchantId || user?.id} />

      {/* Liens rapides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
        <a href="/merchant/links" style={{ background: 'var(--afrikfid-surface)', border: '1px solid var(--afrikfid-border)', borderRadius: 12, padding: '16px 20px', textDecoration: 'none', display: 'block', boxShadow: '0 2px 8px rgba(15, 17, 21,0.06)' }}>
          <LinkIcon style={{ width: 24, height: 24, marginBottom: 6, color: 'var(--af-accent)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--af-accent)' }}>Liens de paiement</div>
          <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginTop: 2 }}>Créer et gérer vos liens</div>
        </a>
        <a href="/merchant/transactions" style={{ background: 'var(--afrikfid-surface)', border: '1px solid var(--afrikfid-border)', borderRadius: 12, padding: '16px 20px', textDecoration: 'none', display: 'block', boxShadow: '0 2px 8px rgba(15, 17, 21,0.06)' }}>
          <ClipboardDocumentListIcon style={{ width: 24, height: 24, marginBottom: 6, color: '#3b82f6' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>Transactions</div>
          <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginTop: 2 }}>Historique complet</div>
        </a>
      </div>

      {/* Panneau d'accès aux fonctionnalités selon package (CDC v3 §6.1) */}
      {profile.package && <FeatureAccessPanel pkg={profile.package} />}
    </div>
  )
}

const RFM_COLORS = { CHAMPIONS: '#10b981', FIDELES: '#3b82f6', PROMETTEURS: '#8b5cf6', A_RISQUE: '#ef4444', HIBERNANTS: '#F59E0B', PERDUS: '#6B7280' }
const RFM_LABELS = { CHAMPIONS: 'Champions', FIDELES: 'Fidèles', PROMETTEURS: 'Prometteurs', A_RISQUE: 'À Risque', HIBERNANTS: 'Hibernants', PERDUS: 'Perdus' }

// ─── Section Intelligence Marchand : Bonus, Success Fee, RFM ─────────────────
function MerchantIntelligenceSection({ pkg, period, merchantId }) {
  const [subData, setSubData] = useState(null)
  const [sfData, setSfData] = useState(null)
  const [rfmData, setRfmData] = useState(null)
  const [loyaltyScore, setLoyaltyScore] = useState(null)
  const pkgIdx = PKG_ORDER.indexOf(pkg)
  const isGrowthPlus = pkgIdx >= PKG_ORDER.indexOf('GROWTH')

  useEffect(() => {
    api.get('/merchants/me/subscription').then(r => setSubData(r.data)).catch(() => {})
    api.get('/merchants/me/success-fees').then(r => setSfData(r.data)).catch(() => {})
    if (isGrowthPlus) {
      api.get('/merchants/me/rfm-summary').then(r => setRfmData(r.data)).catch(() => {})
    }
    if (merchantId) {
      api.get(`/merchant-intelligence/${merchantId}/loyalty-score`).then(r => setLoyaltyScore(r.data)).catch(() => {})
    }
  }, [isGrowthPlus, merchantId])

  const sub = subData?.subscription
  const STARTER_TIERS = [
    { min: 0,   max: 9,   discount: 0,  label: '0–9' },
    { min: 10,  max: 24,  discount: 10, label: '10–24' },
    { min: 25,  max: 49,  discount: 20, label: '25–49' },
    { min: 50,  max: 99,  discount: 35, label: '50–99' },
    { min: 100, max: null, discount: 50, label: '100+' },
  ]

  return (
    <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: isGrowthPlus ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 16 }}>

      {/* Abonnement + Bonus recrutement  */}
      <Card title={<>{`Abonnement — ${PKG_LABEL[pkg] || pkg}`}<InfoTooltip text={TOOLTIPS[`pkg_${pkg?.toLowerCase()}`] || 'Votre formule d\'abonnement Afrik\'Fid.'} /></>}>
        {sub ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6' }}>{fmt(sub.effective_monthly_fee)}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>mensualité effective</div>
              </div>
              {parseFloat(sub.recruitment_discount_percent) > 0 && (
                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#10b981' }}>-{sub.recruitment_discount_percent}%</div>
                  <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)' }}>réduction</div>
                </div>
              )}
            </div>
            {pkg === 'STARTER_BOOST' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 8, fontWeight: 600 }}>
                CLIENTS RECRUTÉS CE MOIS<InfoTooltip text={TOOLTIPS.bonus_recrutement} />
              </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--af-accent)' }}>{sub.recruited_clients_count || 0}</span>
                  <span style={{ fontSize: 12, color: 'var(--af-text-muted)', alignSelf: 'flex-end' }}>clients</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {STARTER_TIERS.map((tier, i) => {
                    const active = sub.recruited_clients_count >= tier.min && (tier.max === null || sub.recruited_clients_count <= tier.max)
                    return (
                      <div key={i} style={{ flex: 1, textAlign: 'center', background: active ? 'rgba(16,185,129,0.12)' : 'var(--afrikfid-surface-2)', borderRadius: 4, padding: '4px 2px', border: active ? '1px solid rgba(16,185,129,0.35)' : '1px solid var(--afrikfid-border)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: active ? 'var(--afrikfid-success)' : 'var(--afrikfid-muted)' }}>-{tier.discount}%</div>
                        <div style={{ fontSize: 8, color: 'var(--afrikfid-muted)' }}>{tier.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--af-text-muted)', padding: '4px 0', borderTop: '1px solid var(--afrikfid-border)' }}>
              <span>Prochain prélèvement</span>
              <span style={{ color: 'var(--af-text-muted)' }}>{sub.next_billing_at ? new Date(sub.next_billing_at).toLocaleDateString('fr-FR') : '—'}</span>
            </div>
          </div>
        ) : <div style={{ color: 'var(--afrikfid-muted)', fontSize: 12, textAlign: 'center', paddingTop: 16 }}>Aucun abonnement actif</div>}
      </Card>

      {/* Success Fee  */}
      <Card title={<>Success Fee<InfoTooltip text={TOOLTIPS.success_fee} /></>}>
        {sfData ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444' }}>{fmt(sfData.kpis?.pending || 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', textTransform: 'uppercase', marginTop: 2 }}>En attente</div>
              </div>
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#10b981' }}>{fmt(sfData.kpis?.total_paid || 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', textTransform: 'uppercase', marginTop: 2 }}>Payé</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>
              Le success fee est prélevé uniquement sur la croissance réelle de votre CA .
            </div>
            {sfData.fees?.slice(0, 3).map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--afrikfid-border)', fontSize: 12 }}>
                <span style={{ color: 'var(--afrikfid-muted)' }}>{f.period_start?.slice(0, 7)}</span>
                <span style={{ color: f.status === 'paid' ? '#10b981' : 'var(--af-accent)', fontWeight: 600 }}>{fmt(f.fee_amount)}</span>
              </div>
            ))}
            {!sfData.fees?.length && <p style={{ fontSize: 11, color: 'var(--af-border-strong)', textAlign: 'center', marginTop: 8 }}>Aucun success fee calculé</p>}
          </div>
        ) : <div style={{ color: 'var(--afrikfid-muted)', fontSize: 12, textAlign: 'center', paddingTop: 16 }}>Chargement...</div>}
      </Card>

      {/* Score fidélité mensuel — tous packages) */}
      {loyaltyScore && (
        <Card title={<>Score fidélité mensuel<InfoTooltip text={TOOLTIPS.score_fidelite} /></>}>
          <div style={{ textAlign: 'center', paddingBottom: 8 }}>
            <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color: (loyaltyScore.loyalty_score ?? loyaltyScore.score) >= 70 ? '#10b981' : (loyaltyScore.loyalty_score ?? loyaltyScore.score) >= 40 ? 'var(--af-accent)' : '#ef4444' }}>
              {loyaltyScore.loyalty_score ?? loyaltyScore.score ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>/100</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            {(loyaltyScore.score_breakdown || loyaltyScore.breakdown) && Object.entries(loyaltyScore.score_breakdown || loyaltyScore.breakdown).map(([k, v]) => (
              <div key={k} style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 6, padding: '6px 8px', border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ fontSize: 9, color: 'var(--afrikfid-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{k.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--afrikfid-text)' }}>{typeof v === 'number' ? (v <= 1 && k.includes('rate') ? Math.round(v * 100) + '%' : fmt(v)) : v ?? '—'}</div>
              </div>
            ))}
          </div>
          {loyaltyScore.stats && (
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 6, padding: '5px 8px', fontSize: 11, border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ color: 'var(--afrikfid-muted)' }}>Clients actifs</div>
                <div style={{ color: 'var(--afrikfid-text)', fontWeight: 700 }}>{loyaltyScore.stats.active_clients}</div>
              </div>
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 6, padding: '5px 8px', fontSize: 11, border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ color: 'var(--afrikfid-muted)' }}>Clients fidèles</div>
                <div style={{ color: '#10b981', fontWeight: 700 }}>{loyaltyScore.stats.loyal_clients}</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Segmentation RFM — GROWTH+ uniquement –5.3) */}
      {isGrowthPlus && (
        <Card title={<>Segmentation RFM clients<InfoTooltip text={TOOLTIPS.RFM} /></>}>
          {rfmData ? (
            <div>
              {rfmData.segments?.map(seg => (
                <div key={seg.segment} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: RFM_COLORS[seg.segment] || '#6B7280', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--afrikfid-muted)', flex: 1 }}>{RFM_LABELS[seg.segment] || seg.segment}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--afrikfid-text)' }}>{seg.count}</span>
                  <span style={{ fontSize: 11, color: 'var(--afrikfid-muted)', width: 34, textAlign: 'right' }}>{seg.pct}%</span>
                  <div style={{ width: 60, height: 4, borderRadius: 2, background: 'var(--afrikfid-border)', overflow: 'hidden' }}>
                    <div style={{ width: `${seg.pct}%`, height: '100%', background: RFM_COLORS[seg.segment] || '#6B7280' }} />
                  </div>
                </div>
              ))}
              {rfmData.abandonStats?.some(a => a.status === 'active') && (
                <div style={{ marginTop: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>
                  Protocole abandon actif<InfoTooltip text={TOOLTIPS.protocole_abandon} />
                </div>
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)' }}>
                    {rfmData.abandonStats?.filter(a => a.status === 'active').reduce((s, a) => s + parseInt(a.count), 0)} clients en cours de réactivation
                  </div>
                </div>
              )}
              {!rfmData.segments?.length && <p style={{ fontSize: 11, color: 'var(--afrikfid-muted)', textAlign: 'center' }}>Aucun score RFM disponible. Le batch s'exécute à 06h00.</p>}
            </div>
          ) : <div style={{ color: 'var(--afrikfid-muted)', fontSize: 12, textAlign: 'center', paddingTop: 16 }}>Chargement...</div>}
        </Card>
      )}
    </div>
  )
}
