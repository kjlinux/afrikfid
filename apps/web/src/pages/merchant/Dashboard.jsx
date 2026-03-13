import React, { useEffect, useState, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'
import { fmt, KpiCard, Card, CopyButton, Spinner, PeriodSelector, exportCsv } from '../../components/ui.jsx'
import { useSSE } from '../../hooks/useSSE.js'
import { useToast } from '../../components/ToastNotification.jsx'

const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function MerchantDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [profile, setProfile] = useState(null)
  const [daily, setDaily] = useState([])
  const [period, setPeriod] = useState('30')
  const [showKey, setShowKey] = useState(false)
  const { toast } = useToast()

  const token = localStorage.getItem('accessToken')

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
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Bonjour, {profile.name} 👋</h1>
          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
              Remise X = {profile.rebatePercent}%
            </span>
            <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
              {profile.rebateMode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'}
            </span>
            <span style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
              {profile.countryId} · {profile.currency}
            </span>
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
        <KpiCard label="Volume total" value={`${fmt(s.total_volume)} XOF`} icon="💰" color="#f59e0b" />
        <KpiCard label="Reçu net" value={`${fmt(s.total_received)} XOF`} icon="✅" color="#10b981" sub={`Après remise X=${profile.rebatePercent}%`} />
        <KpiCard label="Remises accordées" value={`${fmt(s.total_rebate_given)} XOF`} icon="🎁" color="#3b82f6" sub="Cashback clients (Y%)" />
        <KpiCard label="Transactions" value={s.completed_count} icon="📊" color="#8b5cf6" sub={`sur ${period} jours`} />
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
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="day" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                  formatter={v => [`${fmt(v)} XOF`]} />
                <Area type="monotone" dataKey="volume" stroke="#f59e0b" strokeWidth={2} fill="url(#mGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        ) : (
          <Card title="Volume par statut fidélité client">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byLoyaltyStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="client_loyalty_status" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                  formatter={v => [`${fmt(v)} XOF`]} />
                <Bar dataKey="volume" fill="#f59e0b" radius={[4, 4, 0, 0]} />
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
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{row.client_loyalty_status}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{row.count} tx</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{fmt(row.volume)} XOF</div>
              </div>
            </div>
          ))}

          {/* Clés API */}
          <div style={{ marginTop: 16, background: '#0f172a', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              CLÉ API SANDBOX
              <CopyButton text={profile.sandboxKeyPublic} />
            </div>
            <code style={{ fontSize: 11, color: '#f59e0b', wordBreak: 'break-all', display: showKey ? 'block' : 'none' }}>{profile.sandboxKeyPublic}</code>
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
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byLoyaltyStatus}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="client_loyalty_status" tick={{ fill: '#64748b', fontSize: 12 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => `${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9' }}
                formatter={v => [`${fmt(v)} XOF`]} />
              <Bar dataKey="volume" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Liens rapides */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
        <a href="/merchant/links" style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px', textDecoration: 'none', display: 'block' }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🔗</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f59e0b' }}>Liens de paiement</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Créer et gérer vos liens</div>
        </a>
        <a href="/merchant/transactions" style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px', textDecoration: 'none', display: 'block' }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>Transactions</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Historique complet</div>
        </a>
      </div>
    </div>
  )
}
