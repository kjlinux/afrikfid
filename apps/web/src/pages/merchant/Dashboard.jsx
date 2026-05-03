import React, { useEffect, useState, useCallback } from 'react'
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts'
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
  LockClosedIcon,
} from '@heroicons/react/24/outline'

const PKG_ORDER = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']
const PKG_LABEL = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium Performance' }
const PKG_COLOR = { STARTER_BOOST: 'var(--af-text-muted)', STARTER_PLUS: 'var(--af-text-muted)', GROWTH: 'var(--af-text-muted)', PREMIUM: 'var(--af-accent)' }

const RFM_COLORS = {
  CHAMPIONS: 'var(--af-text-muted)',
  FIDELES: 'var(--af-text-muted)',
  PROMETTEURS: 'var(--af-text-muted)',
  A_RISQUE: 'var(--af-danger)',
  HIBERNANTS: 'var(--af-text-muted)',
  PERDUS: 'var(--af-danger)',
}
const RFM_LABELS = { CHAMPIONS: 'Champions', FIDELES: 'Fidèles', PROMETTEURS: 'Prometteurs', A_RISQUE: 'À Risque', HIBERNANTS: 'Hibernants', PERDUS: 'Perdus' }

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

function MetaTag({ children }) {
  return <span style={{ fontSize: 12, color: 'var(--af-text-muted)', fontWeight: 500 }}>{children}</span>
}

function StatBar({ pct }) {
  return (
    <div style={{ height: 3, borderRadius: 2, background: 'var(--af-border)', flex: 1, overflow: 'hidden', minWidth: 60 }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: 'var(--af-border-strong)', borderRadius: 2 }} />
    </div>
  )
}

function PackageBadge({ pkg }) {
  return (
    <span style={{
      background: `${PKG_COLOR[pkg]}14`, color: PKG_COLOR[pkg],
      padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      border: `1px solid ${PKG_COLOR[pkg]}30`,
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
    <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '16px 20px', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--af-text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        Fonctionnalités · <PackageBadge pkg={pkg} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {accessible.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--af-text-muted)', flexShrink: 0 }} />
            <a href={f.path} style={{ fontSize: 12, color: 'var(--af-text-muted)', textDecoration: 'none', flex: 1 }}>
              {f.label}{f.tip && TOOLTIPS[f.tip] && <InfoTooltip text={TOOLTIPS[f.tip]} />}
            </a>
          </div>
        ))}
        {locked.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6 }}>
            <LockClosedIcon style={{ width: 12, height: 12, color: 'var(--af-text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--af-text-muted)', flex: 1 }}>
              {f.label}{f.tip && TOOLTIPS[f.tip] && <InfoTooltip text={TOOLTIPS[f.tip]} />}
            </span>
            <span style={{ fontSize: 10, background: 'var(--af-surface-3)', color: 'var(--af-text)', fontWeight: 600, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--af-border)', whiteSpace: 'nowrap' }}>{PKG_LABEL[f.min]}</span>
          </div>
        ))}
      </div>
      {locked.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--af-border)' }}>
          <a href="/merchant/subscription" style={{ fontSize: 12, color: 'var(--af-accent)', fontWeight: 600, textDecoration: 'none' }}>
            Passer à un plan supérieur →
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
  const totalLoyaltyCount = byLoyaltyStatus.reduce((a, r) => a + Number(r.count), 0) || 1

  const handleExport = () => {
    exportCsv(daily, [
      { label: 'Date', key: 'day' },
      { label: 'Volume', key: 'volume' },
      { label: 'Transactions', key: 'count' },
    ], `mes-ventes-${period}j.csv`)
  }

  const kycIsDanger = profile.kycStatus === 'rejected'

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* [A] KYC Banner — left-border uniquement */}
      {profile.kycStatus !== 'approved' && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          background: 'var(--af-surface)',
          border: '1px solid var(--af-border)',
          borderLeft: `4px solid ${kycIsDanger ? 'var(--af-danger)' : 'var(--af-warning)'}`,
          borderRadius: 12, padding: '14px 20px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ShieldExclamationIcon style={{ width: 20, color: kycIsDanger ? 'var(--af-danger)' : 'var(--af-warning)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: kycIsDanger ? 'var(--af-danger)' : 'var(--af-warning)' }}>
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
              padding: '8px 18px', background: 'var(--af-accent)',
              color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
              {profile.kycStatus === 'rejected' ? 'Resoumettre' : 'Compléter mon KYC'}
            </Link>
          )}
        </div>
      )}

      {/* [B] Command Bar — 1 ligne */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif', marginBottom: 6 }}>
            {profile.name}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <HelpTooltip text={TOOLTIPS.remise_x}>
              <MetaTag>Remise X = {profile.rebatePercent}%</MetaTag>
            </HelpTooltip>
            <MetaTag>·</MetaTag>
            <HelpTooltip text={profile.rebateMode === 'cashback' ? TOOLTIPS.cashback : TOOLTIPS.remise_immediate}>
              <MetaTag>{profile.rebateMode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'}</MetaTag>
            </HelpTooltip>
            <MetaTag>·</MetaTag>
            <MetaTag>{profile.countryId} · {profile.currency}</MetaTag>
            {profile.package && <><MetaTag>·</MetaTag><PackageBadge pkg={profile.package} /></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {daily.length > 0 && (
            <button onClick={handleExport}
              style={{ padding: '7px 14px', background: 'var(--af-surface-2)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              ↓ Export CSV
            </button>
          )}
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* [C] KPI Row — volume en accent, reste en neutre */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <KpiCard label={<>Volume total<InfoTooltip text={TOOLTIPS.chiffre_affaires} /></>} value={`${fmt(s.total_volume)} XOF`} icon={<CurrencyDollarIcon />} color="var(--af-accent)" />
        <KpiCard label={<>Reçu net<InfoTooltip text={TOOLTIPS.recu_net} /></>} value={`${fmt(s.total_received)} XOF`} icon={<CheckCircleIcon />} color="var(--af-text)" sub={`Remise X = ${profile.rebatePercent}%`} />
        <KpiCard label={<>Remises accordées<InfoTooltip text={TOOLTIPS.remise_y} /></>} value={`${fmt(s.total_rebate_given)} XOF`} icon={<GiftIcon />} color="var(--af-text)" sub="Cashback clients (Y%)" />
        <KpiCard label="Transactions" value={s.completed_count} icon={<ChartBarIcon />} color="var(--af-text)" sub={`sur ${period} jours`} />
      </div>

      {/* [D] Graphique + Panel Fidélité */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>
            Volume quotidien — {period} jours
          </div>
          {daily.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E30613" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#E30613" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="none" stroke="var(--af-border)" strokeOpacity={0.5} />
                <XAxis dataKey="day" tick={{ fill: 'var(--af-text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: 'var(--af-text-muted)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)' }}
                  formatter={v => [`${fmt(v)} XOF`]} />
                <Area type="monotone" dataKey="volume" stroke="#E30613" strokeWidth={2} fill="url(#mGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <ChartBarIcon style={{ width: 40, height: 40, marginBottom: 8, opacity: 0.3, color: 'var(--af-text-muted)' }} />
                <div style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>Aucune donnée sur la période</div>
              </div>
            </div>
          )}
        </Card>

        {/* [E] Panel Fidélité + Clé API */}
        <Card>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>
            Clients par statut
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {byLoyaltyStatus.map(row => {
              const pct = (Number(row.count) / totalLoyaltyCount) * 100
              return (
                <div key={row.client_loyalty_status}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text)' }}>{row.client_loyalty_status}</span>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text)' }}>{row.count} tx</span>
                      <span style={{ fontSize: 11, color: 'var(--af-text-muted)', marginLeft: 8 }}>{fmt(row.volume)} XOF</span>
                    </div>
                  </div>
                  <StatBar pct={pct} />
                </div>
              )
            })}
          </div>

          {/* Clé API Sandbox */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--af-border)' }}>
            <div style={{ fontSize: 9, color: 'var(--af-text-faint)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Clé API Sandbox<InfoTooltip text={TOOLTIPS.sandbox} position="left" /></span>
              <CopyButton text={profile.sandboxKeyPublic} />
            </div>
            {showKey ? (
              <code style={{ fontSize: 11, color: 'var(--af-accent)', wordBreak: 'break-all', display: 'block' }}>{profile.sandboxKeyPublic}</code>
            ) : (
              <button onClick={() => setShowKey(true)} style={{ background: 'none', border: 'none', color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}>
                Afficher la clé
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* [F] Intelligence Strip */}
      <MerchantIntelligenceSection pkg={profile.package} period={period} merchantId={user?.merchantId || user?.id} />

      {/* [G] Bottom Rail — 3 colonnes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 14, marginTop: 20 }}>
        <a href="/merchant/links" style={{
          background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12,
          padding: '16px 20px', textDecoration: 'none', display: 'block',
          transition: 'border-color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--af-accent)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--af-border)'}
        >
          <LinkIcon style={{ width: 22, height: 22, marginBottom: 6, color: 'var(--af-text-muted)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--af-text)' }}>Liens de paiement</div>
          <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>Créer et gérer vos liens</div>
        </a>
        <a href="/merchant/transactions" style={{
          background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12,
          padding: '16px 20px', textDecoration: 'none', display: 'block',
          transition: 'border-color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--af-accent)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--af-border)'}
        >
          <ClipboardDocumentListIcon style={{ width: 22, height: 22, marginBottom: 6, color: 'var(--af-text-muted)' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--af-text)' }}>Transactions</div>
          <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>Historique complet</div>
        </a>
        {profile.package && <FeatureAccessPanel pkg={profile.package} />}
      </div>
    </div>
  )
}

const RFM_COLORS_MAP = RFM_COLORS

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

      {/* Abonnement */}
      <Card title={<>{`Abonnement — ${PKG_LABEL[pkg] || pkg}`}<InfoTooltip text={TOOLTIPS[`pkg_${pkg?.toLowerCase()}`] || 'Votre formule d\'abonnement Afrik\'Fid.'} /></>}>
        {sub ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>{fmt(sub.effective_monthly_fee)}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>mensualité effective</div>
              </div>
              {parseFloat(sub.recruitment_discount_percent) > 0 && (
                <span style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600 }}>
                  -{sub.recruitment_discount_percent}% recrutement
                </span>
              )}
            </div>
            {pkg === 'STARTER_BOOST' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Clients recrutés ce mois<InfoTooltip text={TOOLTIPS.bonus_recrutement} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>{sub.recruited_clients_count || 0}</span>
                  <span style={{ fontSize: 12, color: 'var(--af-text-muted)', alignSelf: 'flex-end' }}>clients</span>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {STARTER_TIERS.map((tier, i) => {
                    const active = sub.recruited_clients_count >= tier.min && (tier.max === null || sub.recruited_clients_count <= tier.max)
                    return (
                      <div key={i} style={{ flex: 1, textAlign: 'center', background: active ? 'var(--af-accent-soft)' : 'var(--af-surface-2)', borderRadius: 4, padding: '4px 2px', border: active ? '1px solid var(--af-accent)' : '1px solid var(--af-border)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: active ? 'var(--af-accent)' : 'var(--af-text-muted)' }}>-{tier.discount}%</div>
                        <div style={{ fontSize: 8, color: 'var(--af-text-faint)' }}>{tier.label}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--af-text-muted)', padding: '8px 0', borderTop: '1px solid var(--af-border)', marginTop: 4 }}>
              <span>Prochain prélèvement</span>
              <span>{sub.next_billing_at ? new Date(sub.next_billing_at).toLocaleDateString('fr-FR') : '—'}</span>
            </div>
          </div>
        ) : <div style={{ color: 'var(--af-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 16 }}>Aucun abonnement actif</div>}
      </Card>

      {/* Success Fee */}
      <Card title={<>Success Fee<InfoTooltip text={TOOLTIPS.success_fee} /></>}>
        {sfData ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ background: 'var(--af-surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--af-border)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>{fmt(sfData.kpis?.pending || 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>En attente</div>
              </div>
              <div style={{ background: 'var(--af-surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center', border: '1px solid var(--af-border)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>{fmt(sfData.kpis?.total_paid || 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>Payé</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 8 }}>
              Prélevé uniquement sur la croissance réelle de votre CA.
            </div>
            {sfData.fees?.slice(0, 3).map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--af-border)', fontSize: 12 }}>
                <span style={{ color: 'var(--af-text-muted)' }}>{f.period_start?.slice(0, 7)}</span>
                <span style={{ color: f.status === 'paid' ? 'var(--af-success)' : 'var(--af-text)', fontWeight: 600 }}>{fmt(f.fee_amount)}</span>
              </div>
            ))}
            {!sfData.fees?.length && <p style={{ fontSize: 11, color: 'var(--af-text-faint)', textAlign: 'center', marginTop: 8 }}>Aucun success fee calculé</p>}
          </div>
        ) : <div style={{ color: 'var(--af-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 16 }}>Chargement...</div>}
      </Card>

      {/* Score fidélité mensuel */}
      {loyaltyScore && (
        <Card title={<>Score fidélité mensuel<InfoTooltip text={TOOLTIPS.score_fidelite} /></>}>
          <div style={{ textAlign: 'center', paddingBottom: 8 }}>
            <div style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, fontFamily: 'Montserrat, sans-serif', color: (loyaltyScore.loyalty_score ?? loyaltyScore.score) >= 70 ? 'var(--af-text)' : (loyaltyScore.loyalty_score ?? loyaltyScore.score) >= 40 ? 'var(--af-text-muted)' : 'var(--af-danger)' }}>
              {loyaltyScore.loyalty_score ?? loyaltyScore.score ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 4 }}>/100</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            {(loyaltyScore.score_breakdown || loyaltyScore.breakdown) && Object.entries(loyaltyScore.score_breakdown || loyaltyScore.breakdown).map(([k, v]) => (
              <div key={k} style={{ background: 'var(--af-surface-2)', borderRadius: 6, padding: '6px 8px', border: '1px solid var(--af-border)' }}>
                <div style={{ fontSize: 9, color: 'var(--af-text-muted)', marginBottom: 2 }}>{k.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)' }}>{typeof v === 'number' ? (v <= 1 && k.includes('rate') ? Math.round(v * 100) + '%' : fmt(v)) : v ?? '—'}</div>
              </div>
            ))}
          </div>
          {loyaltyScore.stats && (
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div style={{ background: 'var(--af-surface-2)', borderRadius: 6, padding: '5px 8px', fontSize: 11, border: '1px solid var(--af-border)' }}>
                <div style={{ color: 'var(--af-text-muted)' }}>Clients actifs</div>
                <div style={{ color: 'var(--af-text)', fontWeight: 700 }}>{loyaltyScore.stats.active_clients}</div>
              </div>
              <div style={{ background: 'var(--af-surface-2)', borderRadius: 6, padding: '5px 8px', fontSize: 11, border: '1px solid var(--af-border)' }}>
                <div style={{ color: 'var(--af-text-muted)' }}>Clients fidèles</div>
                <div style={{ color: 'var(--af-success)', fontWeight: 700 }}>{loyaltyScore.stats.loyal_clients}</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Segmentation RFM — GROWTH+ */}
      {isGrowthPlus && (
        <Card title={<>Segmentation RFM clients<InfoTooltip text={TOOLTIPS.RFM} /></>}>
          {rfmData ? (
            <div>
              {rfmData.segments?.map(seg => (
                <div key={seg.segment} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: RFM_COLORS_MAP[seg.segment] || 'var(--af-text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--af-text-muted)', flex: 1 }}>{RFM_LABELS[seg.segment] || seg.segment}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text)' }}>{seg.count}</span>
                  <span style={{ fontSize: 11, color: 'var(--af-text-muted)', width: 34, textAlign: 'right' }}>{seg.pct}%</span>
                  <div style={{ width: 60, height: 3, borderRadius: 2, background: 'var(--af-border)', overflow: 'hidden' }}>
                    <div style={{ width: `${seg.pct}%`, height: '100%', background: 'var(--af-border-strong)' }} />
                  </div>
                </div>
              ))}
              {rfmData.abandonStats?.some(a => a.status === 'active') && (
                <div style={{ marginTop: 12, background: 'var(--af-danger-soft)', border: '1px solid var(--af-danger)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 11, color: 'var(--af-danger)', fontWeight: 600, marginBottom: 4 }}>
                    Protocole abandon actif<InfoTooltip text={TOOLTIPS.protocole_abandon} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>
                    {rfmData.abandonStats?.filter(a => a.status === 'active').reduce((s, a) => s + parseInt(a.count), 0)} clients en cours de réactivation
                  </div>
                </div>
              )}
              {!rfmData.segments?.length && <p style={{ fontSize: 11, color: 'var(--af-text-muted)', textAlign: 'center' }}>Aucun score RFM disponible. Le batch s'exécute à 06h00.</p>}
            </div>
          ) : <div style={{ color: 'var(--af-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 16 }}>Chargement...</div>}
        </Card>
      )}
    </div>
  )
}
