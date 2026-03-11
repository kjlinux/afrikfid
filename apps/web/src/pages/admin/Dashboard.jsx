import React, { useEffect, useState } from 'react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../../api.js'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

function KpiCard({ label, value, sub, color = '#f59e0b', icon }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 22 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>}
    </div>
  )
}

const STATUS_COLORS = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('30')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/reports/overview?period=${period}d`).then(r => {
      setData(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [period])

  if (loading) return <div style={{ padding: 40, color: '#64748b', textAlign: 'center', fontSize: 16 }}>Chargement...</div>
  if (!data) return null

  const { kpis, topMerchants, loyaltyDistribution, dailyVolume, merchantCount, clientCount } = data

  const loyaltyPieData = loyaltyDistribution.map(d => ({
    name: d.loyalty_status, value: d.count, color: STATUS_COLORS[d.loyalty_status] || '#6B7280'
  }))

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Dashboard Afrik'Fid</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>Vue d'ensemble de la plateforme</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['7', '30', '90'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ padding: '6px 14px', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: period === p ? '#f59e0b' : '#1e293b', color: period === p ? '#0f172a' : '#94a3b8', fontWeight: 600 }}>
              {p}j
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <KpiCard label="Volume total" value={`${fmt(kpis.total_volume)} XOF`} icon="💰" color="#f59e0b" sub={`${kpis.completed} transactions réussies`} />
        <KpiCard label="Revenus Afrik'Fid" value={`${fmt(kpis.platform_revenue)} XOF`} icon="📈" color="#10b981" sub="Commissions Z%" />
        <KpiCard label="Remises clients" value={`${fmt(kpis.client_rebates)} XOF`} icon="🎁" color="#3b82f6" sub="Cashback distribué (Y%)" />
        <KpiCard label="Taux de succès" value={`${kpis.success_rate || 0}%`} icon="✅" color="#10b981" sub={`${kpis.total_transactions} transactions initiées`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <KpiCard label="Marchands actifs" value={merchantCount} icon="🏪" color="#f59e0b" />
        <KpiCard label="Clients inscrits" value={clientCount} icon="👥" color="#3b82f6" />
        <KpiCard label="Trans. en attente" value={kpis.total_transactions - kpis.completed} icon="⏳" color="#f59e0b" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* Volume chart */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 20 }}>Volume quotidien (XOF)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyVolume}>
              <defs>
                <linearGradient id="vGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} tickFormatter={v => `${Math.round(v/1000)}k`} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                formatter={v => [`${fmt(v)} XOF`]} />
              <Area type="monotone" dataKey="volume" stroke="#f59e0b" strokeWidth={2} fill="url(#vGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Loyalty pie */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 20 }}>Clients par statut</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={loyaltyPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                {loyaltyPieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
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
        </div>
      </div>

      {/* Top Marchands */}
      <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 16 }}>Top Marchands</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155' }}>
              {['Marchand', 'Transactions', 'Volume (XOF)'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, color: '#64748b', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topMerchants.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '10px 12px', fontSize: 14, color: '#f1f5f9' }}>
                  <span style={{ marginRight: 8, color: '#64748b' }}>{i + 1}.</span>{m.name}
                </td>
                <td style={{ padding: '10px 12px', fontSize: 14, color: '#94a3b8' }}>{m.tx_count}</td>
                <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>{fmt(m.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
