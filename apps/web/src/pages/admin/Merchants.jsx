import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import {
  PencilSquareIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'

async function openKycFile(merchantId, filename) {
  const res = await api.get(`/merchants/${merchantId}/kyc/files/${filename}`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  window.open(url, '_blank')
}

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
  const [editForm, setEditForm] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editMsg, setEditMsg] = useState(null)
  const [kycMerchant, setKycMerchant] = useState(null)
  const [kycForm, setKycForm] = useState({ decision: 'approved', rejection_reason: '' })
  const [kycSaving, setKycSaving] = useState(false)
  const [kycError, setKycError] = useState('')
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
    setKycError('')
    try {
      await api.patch(`/merchants/${kycMerchant.id}/kyc/review`, {
        action: kycForm.decision,
        reason: kycForm.decision === 'reject' ? kycForm.rejection_reason : undefined,
      })
      setMsg(`KYC ${kycForm.decision === 'approve' ? 'approuvé' : 'rejeté'} pour ${kycMerchant.name}`)
      setKycMerchant(null)
      setKycForm({ decision: 'approved', rejection_reason: '' })
      setKycError('')
      load()
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Erreur lors de la revue KYC'
      setKycError(msg)
      console.error('[KYC review]', err.response?.data || err.message)
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
                    <button onClick={() => {
                        setSelected(m)
                        setEditForm({
                          rebate_percent: m.rebatePercent,
                          rebate_mode: m.rebateMode || 'cashback',
                          settlement_frequency: m.settlementFrequency || 'daily',
                          max_transaction_amount: m.maxTransactionAmount || '',
                          daily_volume_limit: m.dailyVolumeLimit || '',
                          allow_guest_mode: m.allowGuestMode !== false,
                        })
                        setEditMsg(null)
                      }}
                      style={{ padding: '4px 10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <PencilSquareIcon style={{ width: 12, height: 12 }} />
                      Détails
                    </button>
                    {m.kycStatus === 'submitted' && (
                      <button onClick={() => { setKycMerchant(m); setKycForm({ decision: 'approved', rejection_reason: '' }); setKycError('') }}
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
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', fontWeight: 600 }}>Documents soumis</div>
            {kycMerchant.kycDocuments ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {/* Infos textuelles */}
                {kycMerchant.kycDocuments.gerant_name && (
                  <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>NOM DU GÉRANT</div>
                    <div style={{ fontSize: 14, color: '#f1f5f9', fontWeight: 600 }}>{kycMerchant.kycDocuments.gerant_name}</div>
                  </div>
                )}
                {kycMerchant.kycDocuments.rccm_number && (
                  <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>N° RCCM</div>
                    <div style={{ fontSize: 14, color: '#f1f5f9', fontFamily: 'monospace' }}>{kycMerchant.kycDocuments.rccm_number}</div>
                  </div>
                )}
                {/* Fichiers uploadés */}
                {kycMerchant.kycDocuments.files?.length > 0 && (
                  <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>FICHIERS ({kycMerchant.kycDocuments.files.length})</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {kycMerchant.kycDocuments.files.map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 13, color: '#f1f5f9' }}>{f.originalName}</div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              {f.mimeType} · {(f.sizeBytes / 1024).toFixed(0)} Ko
                            </div>
                          </div>
                          <button
                            onClick={() => openKycFile(kycMerchant.id, f.storedName)}
                            style={{ padding: '5px 12px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: '#3b82f6', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          >
                            Voir
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {kycMerchant.kycDocuments.submittedAt && (
                  <div style={{ fontSize: 11, color: '#475569', textAlign: 'right' }}>
                    Soumis le {new Date(kycMerchant.kycDocuments.submittedAt).toLocaleString('fr-FR')}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '14px', fontSize: 13, color: '#64748b', fontStyle: 'italic', textAlign: 'center' }}>
                Aucun document joint
              </div>
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
                <option value="approve">Approuver</option>
                <option value="reject">Rejeter</option>
              </select>
            </Field>
            {kycForm.decision === 'reject' && (
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
            {kycError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginTop: 12 }}>
                {kycError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={() => setKycMerchant(null)}
                style={{ flex: 1, padding: '11px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>
                Annuler
              </button>
              <button type="submit" disabled={kycSaving}
                style={{ flex: 1, padding: '11px', background: kycSaving ? '#374151' : (kycForm.decision === 'approve' ? '#10b981' : '#ef4444'), border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                {kycSaving ? 'Enregistrement...' : (kycForm.decision === 'approve' ? 'Approuver le KYC' : 'Rejeter le KYC')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Detail / Edit Modal */}
      {selected && editForm && (
        <Modal title={`Paramètres — ${selected.name}`} onClose={() => { setSelected(null); setEditForm(null); setEditMsg(null) }}>
          {/* Infos lecture seule */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            {[
              ['Email', selected.email], ['Pays', selected.countryId],
              ['Catégorie', selected.category], ['KYC', selected.kycStatus],
            ].map(([k, v]) => (
              <div key={k} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 13, color: '#f1f5f9' }}>{v || '—'}</div>
              </div>
            ))}
          </div>

          {editMsg && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
              background: editMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${editMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: editMsg.type === 'success' ? '#10b981' : '#ef4444',
              borderRadius: 8, padding: '10px 14px', fontSize: 13,
            }}>
              {editMsg.type === 'success'
                ? <CheckCircleIcon style={{ width: 15, height: 15, flexShrink: 0 }} />
                : <ExclamationCircleIcon style={{ width: 15, height: 15, flexShrink: 0 }} />}
              {editMsg.text}
            </div>
          )}

          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Paramètres modifiables</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <Field label="Taux de remise X% *">
              <input type="number" min="0" max="50" step="0.5"
                value={editForm.rebate_percent}
                onChange={e => setEditForm(f => ({ ...f, rebate_percent: parseFloat(e.target.value) }))}
                style={inp} />
            </Field>
            <Field label="Mode de remise client">
              <select value={editForm.rebate_mode} onChange={e => setEditForm(f => ({ ...f, rebate_mode: e.target.value }))} style={sel}>
                <option value="cashback">Cashback différé</option>
                <option value="immediate">Remise immédiate</option>
              </select>
            </Field>
            <Field label="Fréquence de settlement">
              <select value={editForm.settlement_frequency} onChange={e => setEditForm(f => ({ ...f, settlement_frequency: e.target.value }))} style={sel}>
                <option value="instant">Instantané</option>
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
              </select>
            </Field>
            <Field label="Montant max / transaction (XOF)">
              <input type="number" min="0"
                value={editForm.max_transaction_amount}
                onChange={e => setEditForm(f => ({ ...f, max_transaction_amount: e.target.value }))}
                placeholder="Illimité"
                style={inp} />
            </Field>
            <Field label="Volume quotidien maximum (XOF)">
              <input type="number" min="0"
                value={editForm.daily_volume_limit}
                onChange={e => setEditForm(f => ({ ...f, daily_volume_limit: e.target.value }))}
                placeholder="Illimité"
                style={inp} />
            </Field>
          </div>

          {/* Toggle mode invité */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#0f172a', borderRadius: 8, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>Mode invité (clients sans compte)</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {editForm.allow_guest_mode
                  ? "Autorisé — paiement sans remise si client non identifié"
                  : "Désactivé — transaction refusée si client sans compte Afrik'Fid"}
              </div>
            </div>
            <button type="button" onClick={() => setEditForm(f => ({ ...f, allow_guest_mode: !f.allow_guest_mode }))}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, marginLeft: 16,
                background: editForm.allow_guest_mode ? '#10b981' : '#334155', position: 'relative', transition: 'background 0.2s',
              }}>
              <span style={{
                position: 'absolute', top: 3, left: editForm.allow_guest_mode ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', display: 'block',
              }} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => { setSelected(null); setEditForm(null); setEditMsg(null) }}
              style={{ flex: 1, padding: '10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer' }}>
              Fermer
            </button>
            <button type="button" disabled={editSaving} onClick={async () => {
              setEditSaving(true); setEditMsg(null)
              try {
                await api.patch(`/merchants/${selected.id}`, {
                  rebate_percent: editForm.rebate_percent,
                  rebate_mode: editForm.rebate_mode,
                  settlement_frequency: editForm.settlement_frequency,
                  max_transaction_amount: editForm.max_transaction_amount !== '' ? Number(editForm.max_transaction_amount) : null,
                  daily_volume_limit: editForm.daily_volume_limit !== '' ? Number(editForm.daily_volume_limit) : null,
                  allow_guest_mode: editForm.allow_guest_mode,
                })
                setEditMsg({ type: 'success', text: 'Paramètres enregistrés.' })
                load()
              } catch (e) {
                setEditMsg({ type: 'error', text: e.response?.data?.error || 'Erreur' })
              } finally { setEditSaving(false) }
            }}
              style={{ flex: 2, padding: '10px', background: editSaving ? '#374151' : '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: editSaving ? 'default' : 'pointer' }}>
              {editSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
