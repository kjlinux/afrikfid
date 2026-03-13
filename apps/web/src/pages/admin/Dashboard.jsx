import React, { useEffect, useState, useRef, useCallback } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../../api.js'
import { fmt, KpiCard, Card, PeriodSelector, Spinner, exportCsv, exportPdf, Alert, Badge } from '../../components/ui.jsx'

const POLL_INTERVAL = 30000 // 30s auto-refresh
const STATUS_COLORS = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('30')
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [alertMsg, setAlertMsg] = useState(null)
  const timerRef = useRef(null)

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
    timerRef.current = setInterval(load, POLL_INTERVAL)
    return () => clearInterval(timerRef.current)
  }, [load])

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
    exportPdf(data.dailyVolume, VOLUME_COLS, `Rapport Volume — ${period} derniers jours`, `${merchantCount} marchands · ${clientCount} clients`)
  }

  if (loading && !data) return <Spinner />
  if (!data) return null

  const { kpis, topMerchants, loyaltyDistribution, dailyVolume, merchantCount, clientCount } = data

  const loyaltyPieData = loyaltyDistribution.map(d => ({
    name: d.loyalty_status, value: d.count, color: STATUS_COLORS[d.loyalty_status] || '#6B7280'
  }))

  return (
    <div style={{ padding: '28px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Dashboard Afrik'Fid</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>
            Vue d'ensemble · {lastUpdate ? `Mis à jour ${lastUpdate.toLocaleTimeString('fr-FR')}` : ''} · Rafraîchissement auto 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={handleExportCsv}
            style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ Export CSV
          </button>
          <button onClick={handleExportPdf}
            style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            ↓ Export PDF
          </button>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
      </div>

      {alertMsg && <Alert type={alertMsg.type} onClose={() => setAlertMsg(null)}>{alertMsg.text}</Alert>}

      {/* KPIs ligne 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
        <KpiCard label="Volume total" value={`${fmt(kpis.total_volume)} XOF`} icon="💰" color="#f59e0b" sub={`${kpis.completed} transactions réussies`} />
        <KpiCard label="Revenus Afrik'Fid" value={`${fmt(kpis.platform_revenue)} XOF`} icon="📈" color="#10b981" sub="Commissions Z%" />
        <KpiCard label="Remises clients" value={`${fmt(kpis.client_rebates)} XOF`} icon="🎁" color="#3b82f6" sub="Cashback distribué (Y%)" />
        <KpiCard label="Taux de succès" value={`${kpis.success_rate || 0}%`} icon="✅" color="#10b981" sub={`${kpis.total_transactions} transactions initiées`} />
      </div>

      {/* KPIs ligne 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Marchands actifs" value={merchantCount} icon="🏪" color="#f59e0b" />
        <KpiCard label="Clients inscrits" value={clientCount} icon="👥" color="#3b82f6" />
        <KpiCard label="Trans. non complétées" value={kpis.total_transactions - kpis.completed} icon="⏳" color="#f59e0b" />
      </div>

      {/* Graphiques */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card title="Volume quotidien (XOF)" action={
          <span style={{ fontSize: 11, color: '#64748b' }}>{period}j</span>
        }>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyVolume}>
              <defs>
                <linearGradient id="vGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                formatter={v => [`${fmt(v)} XOF`]} />
              <Area type="monotone" dataKey="volume" stroke="#f59e0b" strokeWidth={2} fill="url(#vGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Clients par statut">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={loyaltyPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                {loyaltyPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }} />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {loyaltyPieData.map(d => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Top Marchands */}
      <Card title="Top Marchands" style={{ marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              {['#', 'Marchand', 'Transactions', 'Volume (XOF)'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topMerchants.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '10px 12px', fontSize: 13, color: '#64748b' }}>{i + 1}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, color: '#f1f5f9' }}>{m.name}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, color: '#94a3b8' }}>{m.tx_count}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>{fmt(m.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Liens rapides Admin */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          { label: 'Webhooks', icon: '🔔', desc: 'Gestion des événements', href: '/admin/webhooks', color: '#3b82f6' },
          { label: 'Fraude', icon: '🛡️', desc: 'Règles & blacklist', href: '/admin/fraud', color: '#ef4444' },
          { label: 'Taux de change', icon: '💱', desc: 'XOF / XAF / KES / EUR', href: '/admin/exchange-rates', color: '#10b981' },
        ].map(item => (
          <a key={item.href} href={item.href}
            style={{ background: '#1e293b', borderRadius: 12, padding: '16px 20px', border: '1px solid #334155', textDecoration: 'none', display: 'block', transition: 'border-color 0.15s' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>{item.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: item.color }}>{item.label}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.desc}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
