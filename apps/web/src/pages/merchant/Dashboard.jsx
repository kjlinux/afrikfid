import React, { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import api from '../../api.js'
import { useAuth } from '../../App.jsx'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function MerchantDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    api.get('/merchants/me/stats').then(r => setStats(r.data))
    api.get('/merchants/me/profile').then(r => setProfile(r.data.merchant))
  }, [])

  if (!stats || !profile) return <div style={{ padding: 40, color: '#64748b', textAlign: 'center' }}>Chargement...</div>

  const { stats: s, byLoyaltyStatus } = stats

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Bonjour, {profile.name} 👋</h1>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            Remise X = {profile.rebatePercent}%
          </span>
          <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
            Mode: {profile.rebateMode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'}
          </span>
          <span style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
            {profile.countryId} | {profile.currency}
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Volume total', value: `${fmt(s.total_volume)} XOF`, icon: '💰', color: '#f59e0b' },
          { label: 'Reçu net', value: `${fmt(s.total_received)} XOF`, icon: '✅', color: '#10b981' },
          { label: 'Remises accordées', value: `${fmt(s.total_rebate_given)} XOF`, icon: '🎁', color: '#3b82f6' },
          { label: 'Transactions', value: s.completed_count, icon: '📊', color: '#8b5cf6' },
        ].map(k => (
          <div key={k.label} style={{ background: '#1e293b', borderRadius: 12, padding: '18px 20px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>{k.label}</span>
              <span style={{ fontSize: 20 }}>{k.icon}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Par statut fidélité */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 20 }}>Volume par statut fidélité client</h3>
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
        </div>

        <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', marginBottom: 16 }}>Répartition clients</h3>
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

          {/* API Key section */}
          <div style={{ marginTop: 20, padding: '12px', background: '#0f172a', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', fontWeight: 600 }}>Clé API Sandbox</div>
            <code style={{ fontSize: 11, color: '#f59e0b', wordBreak: 'break-all' }}>{profile.sandboxKeyPublic}</code>
          </div>
        </div>
      </div>
    </div>
  )
}
