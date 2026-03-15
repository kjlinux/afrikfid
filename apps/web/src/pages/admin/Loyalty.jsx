import React, { useEffect, useState } from 'react'
import api from '../../api.js'

const STATUS_META = {
  OPEN:  { color: '#6B7280' },
  LIVE:  { color: '#3B82F6' },
  GOLD:  { color: '#F59E0B' },
  ROYAL: { color: '#8B5CF6' },
}
function StatusDot({ status }) {
  const color = STATUS_META[status]?.color || '#6B7280'
  return <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 6, flexShrink: 0 }} />
}

const inp = { width: '100%', padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 14, outline: 'none' }

export default function AdminLoyalty() {
  const [configs, setConfigs] = useState([])
  const [stats, setStats] = useState(null)
  const [editing, setEditing] = useState(null)
  const [formData, setFormData] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    api.get('/loyalty/config').then(r => setConfigs(r.data.config))
    api.get('/loyalty/stats').then(r => setStats(r.data))
  }

  useEffect(() => { load() }, [])

  const startEdit = config => {
    setEditing(config.status)
    setFormData({
      client_rebate_percent: config.client_rebate_percent,
      label: config.label,
      color: config.color,
      min_purchases: config.min_purchases,
      min_cumulative_amount: config.min_cumulative_amount,
      evaluation_months: config.evaluation_months,
      inactivity_months: config.inactivity_months,
    })
  }

  const save = async (status) => {
    setSaving(true)
    try {
      await api.put(`/loyalty/config/${status}`, formData)
      setMsg('Configuration sauvegardée')
      setEditing(null)
      load()
    } catch (err) {
      setMsg(err.response?.data?.error || 'Erreur')
    } finally { setSaving(false) }
  }

  const runBatch = async () => {
    const r = await api.post('/loyalty/batch')
    setMsg(r.data.message)
    load()
  }

  return (
    <div style={{ padding: '24px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Programme de Fidélité</h1>
        <button onClick={runBatch}
          style={{ padding: '10px 20px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, color: '#8b5cf6', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
          🔄 Lancer le batch
        </button>
      </div>

      {msg && <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', color: '#10b981', marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
          {['OPEN', 'LIVE', 'GOLD', 'ROYAL'].map(s => {
            const m = STATUS_META[s]
            const count = stats.byStatus.find(b => b.loyalty_status === s)?.count || 0
            const total = stats.summary?.total || 1
            return (
              <div key={s} style={{ background: '#1e293b', borderRadius: 12, padding: '20px 20px', border: `1px solid ${m.color}33` }}>
                <div style={{ marginBottom: 8 }}><StatusDot status={s} /></div>
                <div style={{ fontSize: 26, fontWeight: 800, color: m.color }}>{count}</div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{s}</div>
                <div style={{ marginTop: 10, height: 4, background: '#334155', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(count / total) * 100}%`, background: m.color, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{Math.round((count / total) * 100)}%</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Config cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {configs.map(config => {
          const m = STATUS_META[config.status] || {}
          const isEditing = editing === config.status

          return (
            <div key={config.status} style={{ background: '#1e293b', borderRadius: 14, padding: 24, border: `1px solid ${m.color}33` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${m.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <StatusDot status={config.status} />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{config.status}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{config.label}</div>
                  </div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: m.color }}>{config.client_rebate_percent}%</div>
              </div>

              {isEditing ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Remise Y% client</label>
                      <input type="number" step="0.5" min="0" max="20" value={formData.client_rebate_percent}
                        onChange={e => setFormData(f => ({ ...f, client_rebate_percent: parseFloat(e.target.value) }))} style={inp} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Achats min. (passage)</label>
                      <input type="number" min="0" value={formData.min_purchases}
                        onChange={e => setFormData(f => ({ ...f, min_purchases: parseInt(e.target.value) }))} style={inp} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Montant min. cumulé</label>
                      <input type="number" min="0" value={formData.min_cumulative_amount}
                        onChange={e => setFormData(f => ({ ...f, min_cumulative_amount: parseFloat(e.target.value) }))} style={inp} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Mois évaluation</label>
                      <input type="number" min="1" max="24" value={formData.evaluation_months}
                        onChange={e => setFormData(f => ({ ...f, evaluation_months: parseInt(e.target.value) }))} style={inp} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Inactivité (rétrogradation)</label>
                      <input type="number" min="1" value={formData.inactivity_months}
                        onChange={e => setFormData(f => ({ ...f, inactivity_months: parseInt(e.target.value) }))} style={inp} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => save(config.status)} disabled={saving}
                      style={{ flex: 1, padding: '8px', background: m.color, border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                      {saving ? 'Sauvegarde...' : 'Sauvegarder'}
                    </button>
                    <button onClick={() => setEditing(null)}
                      style={{ padding: '8px 12px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                    {[
                      ['Achats min.', config.min_purchases],
                      ['Montant min.', `${new Intl.NumberFormat('fr-FR').format(config.min_cumulative_amount)} XOF`],
                      ['Période d\'éval.', `${config.evaluation_months} mois`],
                      ['Rétrogradation', `${config.inactivity_months} mois`],
                    ].map(([k, v]) => (
                      <div key={k} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{k}</div>
                        <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => startEdit(config)}
                    style={{ width: '100%', padding: '8px', background: `${m.color}22`, border: `1px solid ${m.color}44`, borderRadius: 8, color: m.color, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    Modifier
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Formula */}
      <div style={{ marginTop: 24, background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 12 }}>Règle Fondamentale</h3>
        <div style={{ fontFamily: 'monospace', fontSize: 16, color: '#f59e0b', padding: '12px 16px', background: '#0f172a', borderRadius: 8, letterSpacing: '0.05em' }}>
          X% (remise marchand) = Y% (remise client) + Z% (commission Afrik'Fid)
        </div>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 12 }}>
          Z% est toujours calculé automatiquement : <strong style={{ color: '#94a3b8' }}>Z = X − Y</strong>. Le système rejette toute transaction où Y &gt; X.
        </p>
      </div>
    </div>
  )
}
