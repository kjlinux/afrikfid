import React, { useEffect, useState } from 'react'
import api from '../../api.js'

const STATUS_COLOR = { active: '#10b981', pending: '#f59e0b', suspended: '#ef4444' }
const KYC_COLOR = { approved: '#10b981', pending: '#f59e0b', rejected: '#ef4444' }

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, width: '100%', maxWidth: 560, border: '1px solid #334155', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  )
}

const inp = { width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }
const sel = { ...inp }

export default function AdminMerchants() {
  const [merchants, setMerchants] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState(null)
  const [kycMerchant, setKycMerchant] = useState(null)
  const [kycForm, setKycForm] = useState({ decision: 'approved', rejection_reason: '' })
  const [kycSaving, setKycSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', country_id: 'CI', rebate_percent: 10, rebate_mode: 'cashback', category: 'retail', password: 'Merchant@2026!' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    api.get(`/merchants?page=${page}&limit=15&q=${q}`).then(r => {
      setMerchants(r.data.merchants)
      setTotal(r.data.total)
    })
  }

  useEffect(() => { load() }, [page, q])

  const create = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/merchants', form)
      setMsg('Marchand créé avec succès')
      setShowCreate(false)
      load()
    } catch (err) {
      setMsg(err.response?.data?.error || 'Erreur')
    } finally { setSaving(false) }
  }

  const updateStatus = async (id, status) => {
    await api.patch(`/merchants/${id}`, { status })
    load()
  }

  const submitKycReview = async e => {
    e.preventDefault()
    setKycSaving(true)
    try {
      await api.patch(`/merchants/${kycMerchant.id}/kyc/review`, {
        decision: kycForm.decision,
        rejection_reason: kycForm.decision === 'rejected' ? kycForm.rejection_reason : undefined,
      })
      setMsg(`KYC ${kycForm.decision === 'approved' ? 'approuvé' : 'rejeté'} pour ${kycMerchant.name}`)
      setKycMerchant(null)
      setKycForm({ decision: 'approved', rejection_reason: '' })
      load()
    } catch (err) {
      setMsg(err.response?.data?.message || 'Erreur lors de la revue KYC')
    } finally { setKycSaving(false) }
  }

  return (
    <div style={{ padding: '24px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Marchands ({total})</h1>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '10px 20px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          + Nouveau marchand
        </button>
      </div>

      {msg && <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', color: '#10b981', marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="Rechercher..."
          style={{ flex: 1, ...inp }} />
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              {['Nom', 'Email', 'Pays', 'Remise X%', 'Mode', 'Statut', 'KYC', 'Actions'].map(h => (
                <th key={h} style={{ padding: '11px 12px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {merchants.map(m => (
              <tr key={m.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={{ padding: '14px 16px', fontSize: 14, color: '#f1f5f9', fontWeight: 500 }}>{m.name}</td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>{m.email}</td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>{m.countryId}</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '3px 8px', borderRadius: 6, fontSize: 13, fontWeight: 700 }}>{m.rebatePercent}%</span>
                </td>
                <td style={{ padding: '14px 16px', fontSize: 13, color: '#94a3b8' }}>{m.rebateMode === 'cashback' ? 'Cashback' : 'Immédiate'}</td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ background: `${STATUS_COLOR[m.status]}22`, color: STATUS_COLOR[m.status], padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                    {m.status}
                  </span>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <span style={{ background: `${KYC_COLOR[m.kycStatus]}22`, color: KYC_COLOR[m.kycStatus], padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                    {m.kycStatus}
                  </span>
                </td>
                <td style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {m.status !== 'active' && (
                      <button onClick={() => updateStatus(m.id, 'active')}
                        style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, color: '#10b981', cursor: 'pointer', fontSize: 12 }}>
                        Activer
                      </button>
                    )}
                    {m.status === 'active' && (
                      <button onClick={() => updateStatus(m.id, 'suspended')}
                        style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                        Suspendre
                      </button>
                    )}
                    <button onClick={() => setSelected(m)}
                      style={{ padding: '4px 10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', cursor: 'pointer', fontSize: 12 }}>
                      Détails
                    </button>
                    {m.kycStatus === 'submitted' && (
                      <button onClick={() => { setKycMerchant(m); setKycForm({ decision: 'approved', rejection_reason: '' }) }}
                        style={{ padding: '4px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, color: '#f59e0b', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        Revue KYC
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{total} marchands</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              style={{ padding: '6px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page === 1 ? '#334155' : '#94a3b8', cursor: page === 1 ? 'default' : 'pointer', fontSize: 13 }}>
              ←
            </button>
            <button disabled={page * 15 >= total} onClick={() => setPage(p => p + 1)}
              style={{ padding: '6px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page * 15 >= total ? '#334155' : '#94a3b8', cursor: page * 15 >= total ? 'default' : 'pointer', fontSize: 13 }}>
              →
            </button>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal title="Nouveau Marchand" onClose={() => setShowCreate(false)}>
          <form onSubmit={create}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Nom *">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required style={inp} placeholder="SuperMarché Abidjan" />
              </Field>
              <Field label="Email *">
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required style={inp} placeholder="contact@marchand.com" />
              </Field>
              <Field label="Téléphone">
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} placeholder="+22507000001" />
              </Field>
              <Field label="Pays">
                <select value={form.country_id} onChange={e => setForm(f => ({ ...f, country_id: e.target.value }))} style={sel}>
                  {['CI', 'SN', 'BF', 'ML', 'NE', 'TG', 'BJ', 'CM', 'KE'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Remise X% (accordée à la plateforme)">
                <input type="number" min="0" max="50" step="0.5" value={form.rebate_percent} onChange={e => setForm(f => ({ ...f, rebate_percent: parseFloat(e.target.value) }))} required style={inp} />
              </Field>
              <Field label="Mode de remise client">
                <select value={form.rebate_mode} onChange={e => setForm(f => ({ ...f, rebate_mode: e.target.value }))} style={sel}>
                  <option value="cashback">Cashback différé</option>
                  <option value="immediate">Remise immédiate</option>
                </select>
              </Field>
              <Field label="Catégorie">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={sel}>
                  {['retail', 'pharmacy', 'restaurant', 'electronics', 'fashion', 'services', 'general'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Mot de passe initial">
                <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={inp} />
              </Field>
            </div>
            <button type="submit" disabled={saving}
              style={{ width: '100%', padding: '12px', background: saving ? '#374151' : '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', marginTop: 8, fontSize: 15 }}>
              {saving ? 'Création...' : 'Créer le marchand'}
            </button>
          </form>
        </Modal>
      )}

      {/* KYC Review Modal */}
      {kycMerchant && (
        <Modal title={`Revue KYC — ${kycMerchant.name}`} onClose={() => setKycMerchant(null)}>
          <div style={{ marginBottom: 20, padding: 14, background: '#0f172a', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', fontWeight: 600 }}>Documents soumis</div>
            {kycMerchant.kycDocuments ? (
              <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
                {JSON.stringify(kycMerchant.kycDocuments, null, 2)}
              </pre>
            ) : (
              <span style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>Aucun document joint</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[['Nom', kycMerchant.name], ['Email', kycMerchant.email], ['Catégorie', kycMerchant.category], ['Pays', kycMerchant.countryId]].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 13, color: '#f1f5f9' }}>{v || '—'}</div>
              </div>
            ))}
          </div>
          <form onSubmit={submitKycReview}>
            <Field label="Décision">
              <select value={kycForm.decision} onChange={e => setKycForm(f => ({ ...f, decision: e.target.value }))} style={sel}>
                <option value="approved">Approuver</option>
                <option value="rejected">Rejeter</option>
              </select>
            </Field>
            {kycForm.decision === 'rejected' && (
              <Field label="Motif de rejet *">
                <textarea
                  required
                  value={kycForm.rejection_reason}
                  onChange={e => setKycForm(f => ({ ...f, rejection_reason: e.target.value }))}
                  rows={3}
                  placeholder="Expliquez la raison du rejet..."
                  style={{ ...inp, resize: 'vertical' }}
                />
              </Field>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={() => setKycMerchant(null)}
                style={{ flex: 1, padding: '11px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>
                Annuler
              </button>
              <button type="submit" disabled={kycSaving}
                style={{ flex: 1, padding: '11px', background: kycSaving ? '#374151' : (kycForm.decision === 'approved' ? '#10b981' : '#ef4444'), border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                {kycSaving ? 'Enregistrement...' : (kycForm.decision === 'approved' ? 'Approuver le KYC' : 'Rejeter le KYC')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Detail Modal */}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              ['Email', selected.email], ['Téléphone', selected.phone],
              ['Pays', selected.countryId], ['Catégorie', selected.category],
              ['Remise X%', `${selected.rebatePercent}%`], ['Mode', selected.rebateMode],
              ['Statut', selected.status], ['KYC', selected.kycStatus],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 14, color: '#f1f5f9', fontWeight: 500 }}>{v || '—'}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, padding: '14px', background: '#0f172a', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Clé API Sandbox</div>
            <code style={{ fontSize: 12, color: '#f59e0b', wordBreak: 'break-all' }}>{selected.sandboxKeyPublic}</code>
          </div>
        </Modal>
      )}
    </div>
  )
}
