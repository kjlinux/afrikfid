'use client'
import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Breadcrumb } from '../../App.jsx'
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

const STATUS_COLOR = { active: '#4caf50', pending: 'var(--af-accent)', suspended: '#ef4444' }
const KYC_COLOR = { approved: '#4caf50', pending: 'var(--af-accent)', rejected: '#ef4444' }

const S = {
  modal: { background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 560, border: '1px solid var(--afrikfid-border)', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(15, 17, 21,0.12)' },
  inp: { width: '100%', padding: '10px 12px', background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  theadTh: { padding: '11px 12px', textAlign: 'left', fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' },
  td: { padding: '13px 12px' },
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 17, 21,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={S.modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--afrikfid-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  )
}

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
  const [kycForm, setKycForm] = useState({ decision: 'approve', rejection_reason: '' })
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
      setKycForm({ decision: 'approve', rejection_reason: '' })
      setKycError('')
      load()
    } catch (err) {
      const m = err.response?.data?.error || err.response?.data?.message || err.message || 'Erreur lors de la revue KYC'
      setKycError(m)
    } finally { setKycSaving(false) }
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 12 }}>
        <Breadcrumb title="Marchands" segments={[{ label: 'Liste des marchands' }]} />
        <button onClick={() => setShowCreate(true)} className="af-btn af-btn--primary">
          + Nouveau marchand
        </button>
      </div>

      {msg && (
        <div style={{ background: 'var(--af-success-soft)', border: '1px solid var(--af-success)33', borderRadius: 'var(--af-radius)', padding: '10px 14px', color: 'var(--af-success)', marginBottom: 16, fontSize: 13 }}>{msg}</div>
      )}

      <div className="af-card">
        <div className="af-card__header">
          <h3 className="af-card__title">Liste des marchands <span style={{ color: 'var(--af-text-muted)', fontWeight: 400, marginLeft: 8 }}>({total})</span></h3>
          <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="recherche..."
            className="af-field af-field--search" style={{ width: 240, marginBottom: 0 }} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="af-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Pays</th>
                <th style={{ textAlign: 'center' }}>Remise X%</th>
                <th>Mode</th>
                <th>Statut</th>
                <th>KYC</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {merchants.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--af-text-muted)' }}>Aucun marchand</td></tr>
              ) : merchants.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--af-brand-soft)', color: 'var(--af-brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0, textTransform: 'uppercase' }}>
                        {(m.name || '?').slice(0, 2)}
                      </span>
                      {m.name}
                    </div>
                  </td>
                  <td style={{ color: 'var(--af-text-muted)' }}>{m.email}</td>
                  <td style={{ color: 'var(--af-text-muted)' }}>{m.countryId}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className="af-pill af-pill--orange">{m.rebatePercent}%</span>
                  </td>
                  <td style={{ color: 'var(--af-text-muted)', fontSize: 12 }}>{m.rebateMode === 'cashback' ? 'Cashback' : 'Immédiate'}</td>
                  <td>
                    <span className={`af-badge-status af-badge-status--${m.status === 'active' ? 'success' : m.status === 'pending' ? 'warning' : 'danger'}`}>
                      {m.status}
                    </span>
                  </td>
                  <td>
                    <span className={`af-badge-status af-badge-status--${m.kycStatus === 'approved' ? 'success' : m.kycStatus === 'pending' || m.kycStatus === 'submitted' ? 'warning' : 'danger'}`}>
                      {m.kycStatus}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      {m.status !== 'active' && (
                        <button onClick={() => updateStatus(m.id, 'active')} className="af-btn af-btn--success af-btn--sm">Activer</button>
                      )}
                      {m.status === 'active' && (
                        <button onClick={() => updateStatus(m.id, 'suspended')} className="af-btn af-btn--danger af-btn--sm">Suspendre</button>
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
                        className="af-btn af-btn--ghost af-btn--sm">
                        <PencilSquareIcon style={{ width: 12, height: 12 }} />
                        Détails
                      </button>
                      {m.kycStatus === 'submitted' && (
                        <button onClick={() => { setKycMerchant(m); setKycForm({ decision: 'approve', rejection_reason: '' }); setKycError('') }}
                          className="af-btn af-btn--primary af-btn--sm">
                          Revue KYC
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--af-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--af-surface-2)' }}>
          <span style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>{total} marchands</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="af-btn af-btn--ghost af-btn--sm">←</button>
            <span style={{ fontSize: 13, color: 'var(--af-text)', padding: '0 8px', alignSelf: 'center' }}>{page}</span>
            <button disabled={page * 15 >= total} onClick={() => setPage(p => p + 1)} className="af-btn af-btn--ghost af-btn--sm">→</button>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal title="Nouveau Marchand" onClose={() => setShowCreate(false)}>
          <form onSubmit={create}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Nom *">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required style={S.inp} placeholder="SuperMarché Abidjan" />
              </Field>
              <Field label="Email *">
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required style={S.inp} placeholder="contact@marchand.com" />
              </Field>
              <Field label="Téléphone">
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={S.inp} placeholder="+22507000001" />
              </Field>
              <Field label="Pays">
                <select value={form.country_id} onChange={e => setForm(f => ({ ...f, country_id: e.target.value }))} style={S.inp}>
                  {['CI', 'SN', 'BF', 'ML', 'NE', 'TG', 'BJ', 'CM', 'KE'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Remise X%">
                <input type="number" min="0" max="50" step="0.5" value={form.rebate_percent} onChange={e => setForm(f => ({ ...f, rebate_percent: parseFloat(e.target.value) }))} required style={S.inp} />
              </Field>
              <Field label="Mode de remise client">
                <select value={form.rebate_mode} onChange={e => setForm(f => ({ ...f, rebate_mode: e.target.value }))} style={S.inp}>
                  <option value="cashback">Cashback différé</option>
                  <option value="immediate">Remise immédiate</option>
                </select>
              </Field>
              <Field label="Catégorie">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={S.inp}>
                  {['retail', 'pharmacy', 'restaurant', 'electronics', 'fashion', 'services', 'general'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Mot de passe initial">
                <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={S.inp} />
              </Field>
            </div>
            <button type="submit" disabled={saving}
              style={{ width: '100%', padding: 12, background: saving ? 'var(--afrikfid-border)' : 'var(--afrikfid-primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', marginTop: 8, fontSize: 15 }}>
              {saving ? 'Création...' : 'Créer le marchand'}
            </button>
          </form>
        </Modal>
      )}

      {/* KYC Review Modal */}
      {kycMerchant && (
        <Modal title={`Revue KYC — ${kycMerchant.name}`} onClose={() => setKycMerchant(null)}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 10, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Documents soumis</div>
            {kycMerchant.kycDocuments ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {kycMerchant.kycDocuments.gerant_name && (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 3 }}>NOM DU GÉRANT</div>
                    <div style={{ fontSize: 14, color: 'var(--afrikfid-text)', fontWeight: 600 }}>{kycMerchant.kycDocuments.gerant_name}</div>
                  </div>
                )}
                {kycMerchant.kycDocuments.rccm_number && (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 3 }}>N° RCCM</div>
                    <div style={{ fontSize: 14, color: 'var(--afrikfid-text)', fontFamily: 'monospace' }}>{kycMerchant.kycDocuments.rccm_number}</div>
                  </div>
                )}
                {kycMerchant.kycDocuments.files?.length > 0 && (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>FICHIERS ({kycMerchant.kycDocuments.files.length})</div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {kycMerchant.kycDocuments.files.map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                          <div>
                            <div style={{ fontSize: 13, color: 'var(--afrikfid-text)' }}>{f.originalName}</div>
                            <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)' }}>{f.mimeType} · {(f.sizeBytes / 1024).toFixed(0)} Ko</div>
                          </div>
                          <button onClick={() => openKycFile(kycMerchant.id, f.storedName)}
                            style={{ padding: '5px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 6, color: 'var(--afrikfid-info)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Voir
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {kycMerchant.kycDocuments.submittedAt && (
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', textAlign: 'right' }}>
                    Soumis le {new Date(kycMerchant.kycDocuments.submittedAt).toLocaleString('fr-FR')}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: 14, fontSize: 13, color: 'var(--afrikfid-muted)', fontStyle: 'italic', textAlign: 'center' }}>
                Aucun document joint
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[['Nom', kycMerchant.name], ['Email', kycMerchant.email], ['Catégorie', kycMerchant.category], ['Pays', kycMerchant.countryId]].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 2, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 13, color: 'var(--afrikfid-text)' }}>{v || '—'}</div>
              </div>
            ))}
          </div>
          <form onSubmit={submitKycReview}>
            <Field label="Décision">
              <select value={kycForm.decision} onChange={e => setKycForm(f => ({ ...f, decision: e.target.value }))} style={S.inp}>
                <option value="approve">Approuver</option>
                <option value="reject">Rejeter</option>
              </select>
            </Field>
            {kycForm.decision === 'reject' && (
              <Field label="Motif de rejet *">
                <textarea required value={kycForm.rejection_reason}
                  onChange={e => setKycForm(f => ({ ...f, rejection_reason: e.target.value }))}
                  rows={3} placeholder="Expliquez la raison du rejet..."
                  style={{ ...S.inp, resize: 'vertical' }} />
              </Field>
            )}
            {kycError && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginTop: 12 }}>
                {kycError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={() => setKycMerchant(null)}
                style={{ flex: 1, padding: 11, background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 14 }}>
                Annuler
              </button>
              <button type="submit" disabled={kycSaving}
                style={{ flex: 1, padding: 11, background: kycSaving ? 'var(--afrikfid-border)' : (kycForm.decision === 'approve' ? 'var(--afrikfid-success)' : '#ef4444'), border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                {kycSaving ? 'Enregistrement...' : (kycForm.decision === 'approve' ? 'Approuver le KYC' : 'Rejeter le KYC')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Detail / Edit Modal */}
      {selected && editForm && (
        <Modal title={`Paramètres — ${selected.name}`} onClose={() => { setSelected(null); setEditForm(null); setEditMsg(null) }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
            {[['Email', selected.email], ['Pays', selected.countryId], ['Catégorie', selected.category], ['KYC', selected.kycStatus]].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 6, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', marginBottom: 2, textTransform: 'uppercase' }}>{k}</div>
                <div style={{ fontSize: 13, color: 'var(--afrikfid-text)' }}>{v || '—'}</div>
              </div>
            ))}
          </div>

          {editMsg && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
              background: editMsg.type === 'success' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${editMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: editMsg.type === 'success' ? 'var(--afrikfid-success)' : '#ef4444',
              borderRadius: 8, padding: '10px 14px', fontSize: 13,
            }}>
              {editMsg.type === 'success'
                ? <CheckCircleIcon style={{ width: 15, height: 15, flexShrink: 0 }} />
                : <ExclamationCircleIcon style={{ width: 15, height: 15, flexShrink: 0 }} />}
              {editMsg.text}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Paramètres modifiables</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <Field label="Taux de remise X% *">
              <input type="number" min="0" max="50" step="0.5" value={editForm.rebate_percent}
                onChange={e => setEditForm(f => ({ ...f, rebate_percent: parseFloat(e.target.value) }))} style={S.inp} />
            </Field>
            <Field label="Mode de remise client">
              <select value={editForm.rebate_mode} onChange={e => setEditForm(f => ({ ...f, rebate_mode: e.target.value }))} style={S.inp}>
                <option value="cashback">Cashback différé</option>
                <option value="immediate">Remise immédiate</option>
              </select>
            </Field>
            <Field label="Fréquence de settlement">
              <select value={editForm.settlement_frequency} onChange={e => setEditForm(f => ({ ...f, settlement_frequency: e.target.value }))} style={S.inp}>
                <option value="instant">Instantané</option>
                <option value="daily">Quotidien</option>
                <option value="weekly">Hebdomadaire</option>
              </select>
            </Field>
            <Field label="Montant max / transaction (XOF)">
              <input type="number" min="0" value={editForm.max_transaction_amount}
                onChange={e => setEditForm(f => ({ ...f, max_transaction_amount: e.target.value }))}
                placeholder="Illimité" style={S.inp} />
            </Field>
            <Field label="Volume quotidien maximum (XOF)">
              <input type="number" min="0" value={editForm.daily_volume_limit}
                onChange={e => setEditForm(f => ({ ...f, daily_volume_limit: e.target.value }))}
                placeholder="Illimité" style={S.inp} />
            </Field>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'var(--afrikfid-surface-2)', borderRadius: 8, marginBottom: 20, border: '1px solid var(--afrikfid-border)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--afrikfid-text)' }}>Mode invité (clients sans compte)</div>
              <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 2 }}>
                {editForm.allow_guest_mode ? "Autorisé — paiement sans remise si client non identifié" : "Désactivé — transaction refusée si client sans compte Afrik'Fid"}
              </div>
            </div>
            <button type="button" onClick={() => setEditForm(f => ({ ...f, allow_guest_mode: !f.allow_guest_mode }))}
              style={{ width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, marginLeft: 16, background: editForm.allow_guest_mode ? 'var(--afrikfid-success)' : 'var(--afrikfid-border)', position: 'relative', transition: 'background 0.2s' }}>
              <span style={{ position: 'absolute', top: 3, left: editForm.allow_guest_mode ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', display: 'block' }} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => { setSelected(null); setEditForm(null); setEditMsg(null) }}
              style={{ flex: 1, padding: 10, background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', cursor: 'pointer' }}>
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
              style={{ flex: 2, padding: 10, background: editSaving ? 'var(--afrikfid-border)' : 'var(--afrikfid-primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: editSaving ? 'default' : 'pointer' }}>
              {editSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
