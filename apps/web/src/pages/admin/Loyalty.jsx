import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import {
  GlobeAltIcon,
  WalletIcon,
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon,
  PlusIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'

const COUNTRIES = [
  { id: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮' },
  { id: 'SN', name: 'Sénégal',       flag: '🇸🇳' },
  { id: 'BF', name: 'Burkina Faso',  flag: '🇧🇫' },
  { id: 'ML', name: 'Mali',          flag: '🇲🇱' },
  { id: 'NE', name: 'Niger',         flag: '🇳🇪' },
  { id: 'TG', name: 'Togo',          flag: '🇹🇬' },
  { id: 'BJ', name: 'Bénin',         flag: '🇧🇯' },
  { id: 'CM', name: 'Cameroun',      flag: '🇨🇲' },
  { id: 'TD', name: 'Tchad',         flag: '🇹🇩' },
  { id: 'CG', name: 'Congo',         flag: '🇨🇬' },
  { id: 'GA', name: 'Gabon',         flag: '🇬🇦' },
  { id: 'KE', name: 'Kenya',         flag: '🇰🇪' },
]

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

function SectionMsg({ msg }) {
  if (!msg) return null
  const ok = msg.type === 'success'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
      background: ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
      color: ok ? '#10b981' : '#ef4444',
      borderRadius: 8, padding: '9px 12px', fontSize: 12,
    }}>
      {ok ? <CheckCircleIcon style={{ width: 14, height: 14, flexShrink: 0 }} /> : <ExclamationCircleIcon style={{ width: 14, height: 14, flexShrink: 0 }} />}
      {msg.text}
    </div>
  )
}

export default function AdminLoyalty() {
  const [configs, setConfigs] = useState([])
  const [stats, setStats] = useState(null)
  const [editing, setEditing] = useState(null)
  const [formData, setFormData] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Taux par pays
  const [countryOverrides, setCountryOverrides] = useState([])
  const [countryMsg, setCountryMsg] = useState(null)
  const [newOverride, setNewOverride] = useState({ country_id: 'CI', status: 'LIVE', rate: '' })
  const [savingOverride, setSavingOverride] = useState(false)

  // Plafond wallet
  const [walletCap, setWalletCap] = useState('')
  const [walletCapSaving, setWalletCapSaving] = useState(false)
  const [walletMsg, setWalletMsg] = useState(null)

  const load = () => {
    api.get('/loyalty/config').then(r => setConfigs(r.data.config))
    api.get('/loyalty/stats').then(r => setStats(r.data))
    api.get('/loyalty/config-country').then(r => setCountryOverrides(r.data.overrides))
    api.get('/loyalty/wallet-config').then(r => {
      setWalletCap(r.data.walletConfig?.default_max_balance ?? '')
    })
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

  const saveOverride = async () => {
    if (!newOverride.rate && newOverride.rate !== 0) return
    setSavingOverride(true); setCountryMsg(null)
    try {
      await api.put(`/loyalty/config-country/${newOverride.country_id}/${newOverride.status}`, {
        client_rebate_percent: parseFloat(newOverride.rate),
      })
      setCountryMsg({ type: 'success', text: 'Surcharge enregistrée.' })
      setNewOverride(f => ({ ...f, rate: '' }))
      load()
    } catch (e) {
      setCountryMsg({ type: 'error', text: e.response?.data?.error || 'Erreur' })
    } finally { setSavingOverride(false) }
  }

  const deleteOverride = async (countryId, status) => {
    setCountryMsg(null)
    try {
      await api.delete(`/loyalty/config-country/${countryId}/${status}`)
      setCountryMsg({ type: 'success', text: 'Surcharge supprimée, taux global restauré.' })
      load()
    } catch (e) {
      setCountryMsg({ type: 'error', text: e.response?.data?.error || 'Erreur' })
    }
  }

  const saveWalletCap = async () => {
    setWalletCapSaving(true); setWalletMsg(null)
    try {
      const cap = walletCap === '' ? null : parseFloat(walletCap)
      await api.put('/loyalty/wallet-config', { default_max_balance: cap })
      setWalletMsg({ type: 'success', text: cap ? `Plafond fixé à ${cap.toLocaleString('fr-FR')} XOF` : 'Plafond supprimé (illimité).' })
    } catch (e) {
      setWalletMsg({ type: 'error', text: e.response?.data?.error || 'Erreur' })
    } finally { setWalletCapSaving(false) }
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

      {/* ─── Taux Y% par pays ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <GlobeAltIcon style={{ width: 18, height: 18, color: '#3b82f6' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Surcharges Y% par pays </h3>
        </div>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Ces taux remplacent le taux global pour les clients d'un pays spécifique. Priorité : catégorie marchand &gt; pays &gt; global.
        </p>

        <SectionMsg msg={countryMsg} />

        {/* Tableau des surcharges existantes */}
        {countryOverrides.length > 0 ? (
          <div style={{ background: '#0f172a', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#162032' }}>
                  {['Pays', 'Statut', 'Taux Y%', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {countryOverrides.map(o => {
                  const c = COUNTRIES.find(c => c.id === o.country_id)
                  return (
                    <tr key={`${o.country_id}-${o.status}`} style={{ borderTop: '1px solid #1e293b' }}>
                      <td style={{ padding: '8px 12px', color: '#f1f5f9' }}>{c?.flag} {o.country_name || o.country_id}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ background: `${STATUS_META[o.status]?.color}22`, color: STATUS_META[o.status]?.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{o.status}</span>
                      </td>
                      <td style={{ padding: '8px 12px', fontWeight: 700, color: '#10b981' }}>{o.client_rebate_percent}%</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button onClick={() => deleteOverride(o.country_id, o.status)}
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <TrashIcon style={{ width: 12, height: 12 }} /> Supprimer
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '14px', fontSize: 13, color: '#475569', textAlign: 'center', marginBottom: 16 }}>
            Aucune surcharge — tous les pays utilisent les taux globaux.
          </div>
        )}

        {/* Formulaire ajout */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Pays</label>
            <select value={newOverride.country_id} onChange={e => setNewOverride(f => ({ ...f, country_id: e.target.value }))}
              style={{ ...inp, fontSize: 13 }}>
              {COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Statut</label>
            <select value={newOverride.status} onChange={e => setNewOverride(f => ({ ...f, status: e.target.value }))}
              style={{ ...inp, fontSize: 13 }}>
              {['OPEN', 'LIVE', 'GOLD', 'ROYAL'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 80 }}>
            <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Taux Y%</label>
            <input type="number" step="0.5" min="0" max="20"
              value={newOverride.rate}
              onChange={e => setNewOverride(f => ({ ...f, rate: e.target.value }))}
              placeholder="ex: 6"
              style={{ ...inp, fontSize: 13 }} />
          </div>
          <button onClick={saveOverride} disabled={savingOverride || !newOverride.rate}
            style={{ padding: '9px 16px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, color: '#3b82f6', cursor: savingOverride ? 'default' : 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <PlusIcon style={{ width: 14, height: 14 }} />
            {savingOverride ? 'Enregistrement...' : 'Ajouter / Mettre à jour'}
          </button>
        </div>
      </div>

      {/* ─── Plafond wallet cashback ───────────────────────────────────────── */}
      <div style={{ marginTop: 24, background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <WalletIcon style={{ width: 18, height: 18, color: '#f59e0b' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Plafond du portefeuille cashback </h3>
        </div>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Montant maximum qu'un client peut accumuler dans son portefeuille cashback. Laisser vide = illimité.
        </p>

        <SectionMsg msg={walletMsg} />

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 600 }}>Plafond global (XOF)</label>
            <input type="number" min="0"
              value={walletCap}
              onChange={e => setWalletCap(e.target.value)}
              placeholder="Illimité (laisser vide)"
              style={inp} />
          </div>
          <button onClick={saveWalletCap} disabled={walletCapSaving}
            style={{ padding: '9px 20px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#f59e0b', cursor: walletCapSaving ? 'default' : 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
            {walletCapSaving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
