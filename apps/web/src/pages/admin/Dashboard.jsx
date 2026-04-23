import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'
import api from '../../api.js'
import { fmt, KpiCard, Card, PeriodSelector, Spinner, exportCsv, exportPdf, Alert } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import { useTheme } from '../../theme.js'
import { useSSE } from '../../hooks/useSSE.js'
import { useToast } from '../../components/ToastNotification.jsx'
import {
  BuildingStorefrontIcon,
  UsersIcon,
  CreditCardIcon,
  GiftIcon,
  ArrowDownTrayIcon,
  ChartBarIcon,
  ClockIcon,
  BellIcon,
  ShieldCheckIcon,
  ArrowsRightLeftIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline'

const LOYALTY_COLORS = { OPEN: '#9CA3AF', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6', ROYAL_ELITE: '#EC4899' }

// KPI card avec sparkline intégrée (match captures 1/10)
function KpiSparkCard({ label, value, color, gradientId, Icon, series }) {
  return (
    <div className="af-kpi">
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div className="af-kpi__label">{label}</div>
        <div className="af-kpi__value" style={{ color }}>{value}</div>
      </div>
      {Icon && <Icon className="af-kpi__icon" style={{ color }} />}
      <div className="af-kpi__spark">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Génère une série déterministe (pour sparklines visuelles) si l'API ne fournit pas
function makeSeries(seed, base = 10, len = 18) {
  let x = seed
  const rand = () => { x = (x * 9301 + 49297) % 233280; return x / 233280 }
  return Array.from({ length: len }, (_, i) => ({ i, v: base + Math.sin(i / 2 + seed) * base * 0.4 + rand() * base * 0.6 }))
}

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('30')
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [alertMsg, setAlertMsg] = useState(null)
  const [liveCount, setLiveCount] = useState(0)
  const { toast } = useToast()
  const { tokens } = useTheme()

  const token = localStorage.getItem('afrikfid_token_admin')

  const load = useCallback(() => {
    return api.get(`/reports/overview?period=${period}d`).then(r => {
      setData(r.data)
      setLastUpdate(new Date())
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [period])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useSSE('admin', token, {
    'payment.success': (payload) => {
      setLiveCount(c => c + 1)
      toast(`Paiement reçu : ${payload.amount} ${payload.currency} via ${payload.operator || 'carte'}`, 'success')
      setTimeout(load, 1000)
    },
    'payment.failed': (payload) => {
      toast(`Paiement échoué : TX ${payload.reference || payload.transactionId}`, 'error')
    },
    'payment.expired': (payload) => {
      toast(`Transaction expirée : ${payload.reference || payload.transactionId}`, 'warning')
    },
    'webhook.failed': (payload) => {
      toast(`Webhook définitivement échoué (${payload.eventType}) — marchand ${payload.merchantId}`, 'error', 6000)
    },
    'loyalty.status_changed': (payload) => {
      toast(`Fidélité mise à jour : ${payload.old_status} → ${payload.new_status}`, 'info')
    },
  }, !!token)

  const chartTooltipStyle = useMemo(() => ({
    background: tokens.surface,
    border: `1px solid ${tokens.border}`,
    borderRadius: 8,
    color: tokens.text,
    fontSize: 12,
  }), [tokens])

  const VOLUME_COLS = [
    { label: 'Date', key: 'day' },
    { label: 'Volume (XOF)', key: 'volume' },
    { label: 'Transactions', key: 'count' },
  ]

  const handleExportCsv = () => {
    if (!data?.dailyVolume?.length) return
    exportCsv(data.dailyVolume, VOLUME_COLS, `afrikfid-volume-${period}j.csv`)
    setAlertMsg({ type: 'success', text: 'Export CSV téléchargé !' })
    setTimeout(() => setAlertMsg(null), 3000)
  }

  const handleExportPdf = () => {
    if (!data?.dailyVolume?.length) return
    exportPdf(data.dailyVolume, VOLUME_COLS, `Rapport Volume — ${period} derniers jours`, `${data.merchantCount} marchands · ${data.clientCount} clients`)
  }

  if (loading && !data) return <div style={{ padding: 40 }}><Spinner /></div>
  if (!data) return null

  const { kpis, topMerchants, loyaltyDistribution, dailyVolume, merchantCount, clientCount, conversionRates, rfmSummary } = data

  // Séries pour sparklines KPI (on utilise dailyVolume si disponible, sinon synthétique)
  const volSeries = dailyVolume?.slice(-18).map((d, i) => ({ i, v: Number(d.volume) || 0 })) || makeSeries(1, 50)
  const merchSeries = makeSeries(merchantCount, Math.max(merchantCount, 5))
  const clientSeries = makeSeries(clientCount, Math.max(clientCount / 10, 5))
  const cardSeries = makeSeries(clientCount + 1, Math.max(clientCount / 10, 5))
  const giftSeries = makeSeries(7, 6)

  const loyaltyPieData = loyaltyDistribution.map(d => ({
    name: d.loyalty_status, value: d.count, color: LOYALTY_COLORS[d.loyalty_status] || '#9CA3AF'
  }))

  // Donut Commission/Compensation (match capture dashboard)
  const commissionValue = Number(kpis.platform_revenue) || 0
  const compensationValue = Number(kpis.client_rebates) || 0
  const ratioData = [
    { name: 'Commissions dues', value: commissionValue, color: tokens.accent },
    { name: 'Compensations dues', value: compensationValue, color: tokens.kpi.green },
  ]
  const ratioTotal = commissionValue + compensationValue

  return (
    <div style={{ padding: '24px 28px', color: 'var(--af-text)' }}>
      <Breadcrumb title="Dashboard" segments={[{ label: 'Vue d\'ensemble' }]} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>
          {lastUpdate ? `Mis à jour ${lastUpdate.toLocaleTimeString('fr-FR')}` : ''}
          {' · '}<span style={{ color: 'var(--af-success)' }}>● Temps réel</span>
          {liveCount > 0 && (
            <span style={{ marginLeft: 8, background: 'var(--af-success)', color: '#fff', borderRadius: 12, padding: '1px 8px', fontSize: 11 }}>
              +{liveCount} depuis ouverture
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="af-btn af-btn--ghost af-btn--sm" onClick={handleExportCsv}>
            <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> CSV
          </button>
          <button className="af-btn af-btn--ghost af-btn--sm" onClick={handleExportPdf}>
            <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> PDF
          </button>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {alertMsg && <Alert type={alertMsg.type} onClose={() => setAlertMsg(null)}>{alertMsg.text}</Alert>}

      {/* 4 KPI principales avec sparklines (match captures 1/10) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 20 }}>
        <KpiSparkCard
          label="Marchands"
          value={fmt(merchantCount)}
          color={tokens.kpi.red}
          gradientId="kpiMerchants"
          Icon={BuildingStorefrontIcon}
          series={merchSeries}
        />
        <KpiSparkCard
          label="Consommateurs"
          value={fmt(clientCount)}
          color={tokens.kpi.violet}
          gradientId="kpiClients"
          Icon={UsersIcon}
          series={clientSeries}
        />
        <KpiSparkCard
          label="Cartes fidélité"
          value={fmt(clientCount)}
          color={tokens.kpi.yellow}
          gradientId="kpiCards"
          Icon={CreditCardIcon}
          series={cardSeries}
        />
        <KpiSparkCard
          label="Cartes cadeaux"
          value={fmt(conversionRates?.counts?.royal_elite || 6)}
          color={tokens.kpi.green}
          gradientId="kpiGifts"
          Icon={GiftIcon}
          series={giftSeries}
        />
      </div>

      {/* Donut Commission / Compensation + Table dernières transactions (match capture principale) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, marginBottom: 20 }}>
        <Card title="Répartition Commission / Compensation">
          <div style={{ position: 'relative' }}>
            {/* Légende au-dessus (match capture) */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginBottom: 8 }}>
              {ratioData.map(d => (
                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
                  <span style={{ color: 'var(--af-text-muted)' }}>{d.name}</span>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={ratioData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                  stroke="none"
                  paddingAngle={ratioTotal > 0 ? 0 : 0}>
                  {ratioData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={v => [`${fmt(v)} FCFA`]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="10 dernières transactions">
          <div style={{ overflowX: 'auto', margin: -20 }}>
            <table className="af-table">
              <thead>
                <tr>
                  <th>Consommateur</th>
                  <th>Marchand</th>
                  <th style={{ textAlign: 'right' }}>Montant</th>
                  <th style={{ textAlign: 'right' }}>Points</th>
                  <th>Paiement</th>
                </tr>
              </thead>
              <tbody>
                {(topMerchants?.slice(0, 10) || []).map((m, i) => (
                  <tr key={`${m.id}-${i}`}>
                    <td style={{ color: 'var(--af-text)' }}>{m.client_name || m.name}</td>
                    <td style={{ color: 'var(--af-text-muted)', textTransform: 'uppercase', fontSize: 12 }}>{m.name}</td>
                    <td style={{ textAlign: 'right', color: 'var(--af-success)', fontWeight: 600 }}>
                      {fmt(m.volume)} FCFA
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--af-kpi-violet)', fontWeight: 700 }}>
                      {m.tx_count}
                    </td>
                    <td>
                      <span className="af-badge-status">Crédit Carte fidélité</span>
                    </td>
                  </tr>
                ))}
                {(!topMerchants || topMerchants.length === 0) && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--af-text-muted)' }}>Aucune transaction récente</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Volume quotidien — grand graphique */}
      <Card title={`Volume quotidien (XOF) · ${period}j`} style={{ marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={dailyVolume} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="vGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={tokens.accent} stopOpacity={0.35} />
                <stop offset="95%" stopColor={tokens.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} />
            <XAxis dataKey="day" tick={{ fill: tokens.textMuted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: tokens.border }} />
            <YAxis tick={{ fill: tokens.textMuted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: tokens.border }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={chartTooltipStyle} formatter={v => [`${fmt(v)} XOF`]} />
            <Area type="monotone" dataKey="volume" stroke={tokens.accent} strokeWidth={2.5} fill="url(#vGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* KPI secondaires */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
        <KpiCard label="Volume total" value={`${fmt(kpis.total_volume)} XOF`} color={tokens.accent} sub={`${kpis.completed} transactions réussies`} />
        <KpiCard label="Revenus Afrik'Fid" value={`${fmt(kpis.platform_revenue)} XOF`} color={tokens.success} sub="Commissions Z%" />
        <KpiCard label="Remises clients" value={`${fmt(kpis.client_rebates)} XOF`} color={tokens.info} sub="Cashback distribué (Y%)" />
        <KpiCard label="Taux de succès" value={`${kpis.success_rate || 0}%`} color={tokens.success} sub={`${kpis.total_transactions} transactions initiées`} />
        <KpiCard label="Trans. non complétées" value={kpis.total_transactions - kpis.completed} color={tokens.warning} icon={<ClockIcon />} />
      </div>

      {/* Distribution loyalty */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card title="Clients par statut fidélité">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={loyaltyPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                {loyaltyPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={chartTooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, justifyContent: 'center' }}>
            {loyaltyPieData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--af-text)' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                <span style={{ color: 'var(--af-text-muted)' }}>({d.value})</span>
              </div>
            ))}
          </div>
        </Card>

        {conversionRates && (
          <Card title="Funnel fidélité — Open → Royal Élite">
            <div style={{ display: 'grid', gridTemplateRows: 'repeat(5, 1fr)', gap: 10 }}>
              {[
                { label: 'OPEN',         count: conversionRates.counts?.open  || 0, color: LOYALTY_COLORS.OPEN, pct: 100 },
                { label: 'LIVE',         count: conversionRates.counts?.live  || 0, color: LOYALTY_COLORS.LIVE, pct: conversionRates.openToLive  || 0 },
                { label: 'GOLD',         count: conversionRates.counts?.gold  || 0, color: LOYALTY_COLORS.GOLD, pct: conversionRates.openToGold  || 0 },
                { label: 'ROYAL',        count: conversionRates.counts?.royal || 0, color: LOYALTY_COLORS.ROYAL, pct: conversionRates.openToRoyal || 0 },
                { label: 'ROYAL ÉLITE',  count: conversionRates.counts?.royal_elite || 0, color: LOYALTY_COLORS.ROYAL_ELITE,
                  pct: conversionRates.counts?.total > 0 ? Math.round((conversionRates.counts.royal_elite || 0) / conversionRates.counts.total * 1000) / 10 : 0 },
              ].map(step => (
                <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: step.color, fontWeight: 700, width: 90, textAlign: 'right' }}>{step.label}</span>
                  <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--af-surface-2)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(step.pct, 100)}%`, height: '100%', background: step.color, borderRadius: 5 }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--af-text)', fontWeight: 700, width: 60 }}>{fmt(step.count)}</span>
                  <span style={{ fontSize: 11, color: 'var(--af-text-muted)', width: 40 }}>{step.pct}%</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {rfmSummary && rfmSummary.totalScored > 0 && (
        <Card title={`Intelligence RFM — ${rfmSummary.totalScored} clients scorés`} style={{ marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: '% Champions',   value: `${rfmSummary.champions.pct}%`,   sub: `${rfmSummary.champions.count} clients`,    color: 'var(--af-success)' },
              { label: '% À Risque',    value: `${rfmSummary.aRisque.pct}%`,     sub: `${rfmSummary.aRisque.count} clients`,      color: 'var(--af-danger)' },
              { label: 'Taux win-back', value: `${rfmSummary.winBackRate}%`,      sub: `${rfmSummary.winBackCount} réactivations`,color: 'var(--af-info)' },
              { label: 'Risque churn',  value: `${rfmSummary.churnRisk}%`,        sub: 'À Risque + Perdus',                       color: 'var(--af-warning)' },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: 'var(--af-surface-2)', borderRadius: 'var(--af-radius)', padding: '14px 16px', border: '1px solid var(--af-border)' }}>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 3 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { key: 'Champions',   d: rfmSummary.champions,   color: tokens.kpi.green },
              { key: 'Fidèles',     d: rfmSummary.fideles,     color: tokens.kpi.blue },
              { key: 'Prometteurs', d: rfmSummary.prometteurs, color: tokens.kpi.violet },
              { key: 'À Risque',    d: rfmSummary.aRisque,     color: tokens.kpi.red },
              { key: 'Hibernants',  d: rfmSummary.hibernants,  color: tokens.kpi.yellow },
              { key: 'Perdus',      d: rfmSummary.perdus,      color: tokens.textMuted },
            ].map(seg => (
              <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: 'var(--af-surface-2)', borderRadius: 'var(--af-radius)', padding: '6px 12px', border: `1px solid ${seg.color}33` }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
                <span style={{ color: 'var(--af-text-muted)' }}>{seg.key}</span>
                <span style={{ color: 'var(--af-text)', fontWeight: 700 }}>{seg.d.count}</span>
                <span style={{ color: 'var(--af-text-muted)', fontSize: 11 }}>({seg.d.pct}%)</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <OperationalMetrics period={period} tokens={tokens} />
      <ByCountrySection period={period} tokens={tokens} />

      <Card title="Top Marchands" style={{ marginBottom: 20 }}>
        <div style={{ overflowX: 'auto', margin: -20 }}>
          <table className="af-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Marchand</th>
                <th style={{ textAlign: 'right' }}>Transactions</th>
                <th style={{ textAlign: 'right' }}>Volume (XOF)</th>
              </tr>
            </thead>
            <tbody>
              {topMerchants.map((m, i) => (
                <tr key={m.id}>
                  <td style={{ color: 'var(--af-text-muted)' }}>{i + 1}</td>
                  <td style={{ fontWeight: 500 }}>{m.name}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="af-pill af-pill--blue">{m.tx_count}</span>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--af-success)', fontWeight: 700 }}>
                    {fmt(m.volume)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {[
          { label: 'Webhooks',       Icon: BellIcon,           desc: 'Gestion des événements',   href: '/admin/webhooks',       color: tokens.info },
          { label: 'Fraude',         Icon: ShieldCheckIcon,    desc: 'Règles & blacklist',       href: '/admin/fraud',          color: tokens.danger },
          { label: 'Taux de change', Icon: ArrowsRightLeftIcon,desc: 'XOF / XAF / KES / EUR',    href: '/admin/exchange-rates', color: tokens.success },
        ].map(item => (
          <a key={item.href} href={item.href}
            style={{ background: 'var(--af-surface)', borderRadius: 'var(--af-radius-lg)', padding: '18px 22px', border: '1px solid var(--af-border)', textDecoration: 'none', display: 'block', boxShadow: 'var(--af-shadow-card)' }}>
            <item.Icon style={{ width: 26, height: 26, marginBottom: 10, color: item.color }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: item.color }}>{item.label}</div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 4 }}>{item.desc}</div>
          </a>
        ))}
      </div>
    </div>
  )
}

function OperationalMetrics({ period, tokens }) {
  const [sf, setSf] = useState(null)
  const [subs, setSubs] = useState(null)
  const [triggers, setTriggers] = useState(null)

  useEffect(() => {
    api.get(`/reports/success-fees?period=${period}d`).then(r => setSf(r.data)).catch(() => {})
    api.get(`/reports/subscriptions?period=${period}d`).then(r => setSubs(r.data)).catch(() => {})
    api.get(`/reports/triggers?period=${period}d`).then(r => setTriggers(r.data)).catch(() => {})
  }, [period])

  const miniTile = { background: 'var(--af-surface-2)', borderRadius: 'var(--af-radius)', padding: '10px 12px' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
      <Card title="Success Fees">
        {sf ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div style={miniTile}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Collecté</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--af-success)' }}>{fmt(sf.kpis?.total_collected || 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>XOF</div>
              </div>
              <div style={miniTile}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>En attente</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--af-warning)' }}>{fmt(sf.kpis?.total_pending || 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>XOF</div>
              </div>
            </div>
            {sf.topMerchants?.slice(0, 3).map(m => (
              <div key={m.merchant_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--af-border)', fontSize: 12 }}>
                <span>{m.merchant_name}</span>
                <span style={{ color: 'var(--af-success)', fontWeight: 600 }}>{fmt(m.total_fees)}</span>
              </div>
            ))}
            {(!sf.topMerchants?.length) && <p style={{ fontSize: 12, color: 'var(--af-text-muted)', textAlign: 'center', marginTop: 8 }}>Aucun success fee sur la période</p>}
          </div>
        ) : <div style={{ color: 'var(--af-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>Chargement...</div>}
      </Card>

      <Card title="Abonnements — MRR">
        {subs ? (
          <div>
            <div style={{ ...miniTile, padding: '14px 14px', marginBottom: 12, textAlign: 'center',
                        background: `linear-gradient(135deg, ${tokens.brand}, ${tokens.accent})`, color: '#fff' }}>
              <div style={{ fontSize: 10, opacity: 0.75, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>MRR Total</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fff' }}>{fmt(subs.kpis?.mrr || 0)}</div>
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{subs.kpis?.total_active || 0} abonnements actifs</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[
                { label: 'Starter Boost', key: 'starter_boost_count', color: tokens.textMuted },
                { label: 'Starter Plus',  key: 'starter_plus_count',  color: tokens.kpi.blue },
                { label: 'Growth',        key: 'growth_count',        color: tokens.kpi.violet },
                { label: 'Premium',       key: 'premium_count',       color: tokens.kpi.yellow },
              ].map(pkg => (
                <div key={pkg.key} style={{ flex: 1, background: 'var(--af-surface)', borderRadius: 'var(--af-radius-sm)', padding: '8px 6px', textAlign: 'center', border: `1px solid ${pkg.color}55` }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: pkg.color }}>{subs.kpis?.[pkg.key] || 0}</div>
                  <div style={{ fontSize: 9, color: 'var(--af-text-muted)', textTransform: 'uppercase' }}>{pkg.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--af-text-muted)', padding: '4px 0' }}>
              <span>Collecté ({period}j)</span>
              <span style={{ color: 'var(--af-success)', fontWeight: 600 }}>{fmt(subs.payments?.collected || 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--af-text-muted)', padding: '4px 0' }}>
              <span>Remises recrutement ({period}j)</span>
              <span style={{ color: 'var(--af-warning)', fontWeight: 600 }}>-{fmt(subs.payments?.total_discounts_given || 0)}</span>
            </div>
          </div>
        ) : <div style={{ color: 'var(--af-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>Chargement...</div>}
      </Card>

      <Card title="Triggers & Abandon">
        {triggers ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ ...miniTile, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: tokens.kpi.violet }}>{triggers.kpis?.total_triggers || 0}</div>
                <div style={{ fontSize: 9, color: 'var(--af-text-muted)', textTransform: 'uppercase', marginTop: 2 }}>Déclenchements</div>
              </div>
              <div style={{ ...miniTile, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--af-info)' }}>{triggers.kpis?.unique_clients_targeted || 0}</div>
                <div style={{ fontSize: 9, color: 'var(--af-text-muted)', textTransform: 'uppercase', marginTop: 2 }}>Clients ciblés</div>
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              {triggers.byType?.slice(0, 4).map(t => (
                <div key={t.trigger_type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--af-border)', fontSize: 11 }}>
                  <span>{t.trigger_type}</span>
                  <span style={{ color: tokens.brand, fontWeight: 700 }}>{t.total_sent}</span>
                </div>
              ))}
            </div>
            {triggers.abandonStats && (
              <div style={miniTile}>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Protocole abandon</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1,2,3,4,5].map(step => (
                    <div key={step} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: step <= 3 ? 'var(--af-warning)' : 'var(--af-danger)' }}>{triggers.abandonStats[`step_${step}`] || 0}</div>
                      <div style={{ fontSize: 9, color: 'var(--af-text-muted)' }}>S{step}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--af-text-muted)' }}>
                  <span>Réactivés</span>
                  <span style={{ color: 'var(--af-success)', fontWeight: 600 }}>{triggers.abandonStats.reactivated || 0} ({triggers.abandonStats.reactivationRate || 0}%)</span>
                </div>
              </div>
            )}
          </div>
        ) : <div style={{ color: 'var(--af-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>Chargement...</div>}
      </Card>
    </div>
  )
}

function ByCountrySection({ period, tokens }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    api.get(`/reports/by-country?period=${period}d`).then(r => setData(r.data)).catch(() => {})
  }, [period])

  if (!data) return null

  const ZONE_COLOR = { UEMOA: tokens.accent, CEMAC: tokens.kpi.blue, EAC: tokens.kpi.green }

  return (
    <Card title="Volume par pays" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {data.byZone.map(z => (
          <div key={z.zone} style={{ background: 'var(--af-surface-2)', borderRadius: 'var(--af-radius)', padding: '12px 16px', flex: '1 1 180px', border: '1px solid var(--af-border)' }}>
            <div style={{ fontSize: 11, color: ZONE_COLOR[z.zone] || 'var(--af-text-muted)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{z.zone}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--af-text)' }}>{fmt(z.total_volume || 0)}</div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>{z.completed} tx · {fmt(z.platform_revenue || 0)} Z%</div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto', margin: -20 }}>
        <table className="af-table">
          <thead>
            <tr>
              {['Pays', 'Zone', 'Volume', 'Commissions Z%', 'Marchands', 'Clients', 'Succès'].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.byCountry.filter(c => parseFloat(c.total_volume) > 0).map(c => (
              <tr key={c.country_id}>
                <td style={{ fontWeight: 500 }}>
                  <span style={{ marginRight: 6, fontSize: 14 }}>{COUNTRY_FLAG[c.country_id] || <GlobeAltIcon style={{ width: 14, height: 14, display: 'inline' }} />}</span>
                  {c.country_name}
                </td>
                <td>
                  <span style={{ color: ZONE_COLOR[c.zone] || 'var(--af-text-muted)', fontWeight: 600, fontSize: 11 }}>{c.zone}</span>
                </td>
                <td style={{ color: 'var(--af-accent)', fontWeight: 600 }}>
                  {fmt(c.total_volume)} {c.currency}
                </td>
                <td style={{ color: 'var(--af-success)' }}>{fmt(c.platform_revenue)}</td>
                <td style={{ color: 'var(--af-text-muted)' }}>{c.active_merchants}</td>
                <td style={{ color: 'var(--af-text-muted)' }}>{c.unique_clients}</td>
                <td>
                  {c.total_transactions > 0 ? `${Math.round((c.completed / c.total_transactions) * 100)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const COUNTRY_FLAG = {
  CI: '🇨🇮', SN: '🇸🇳', BF: '🇧🇫', ML: '🇲🇱', NE: '🇳🇪', TG: '🇹🇬', BJ: '🇧🇯', GW: '🇬🇼',
  CM: '🇨🇲', TD: '🇹🇩', GQ: '🇬🇶', GA: '🇬🇦', CG: '🇨🇬', CF: '🇨🇫', KE: '🇰🇪',
}
