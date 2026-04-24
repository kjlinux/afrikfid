import React, { useEffect, useState, useRef } from 'react'
import api from '../../api.js'
import { Spinner, Alert, InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'
import { ShieldCheckIcon, DocumentArrowUpIcon, CheckCircleIcon, ClockIcon, XCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline'

const STATUS_CONFIG = {
  pending:   { label: 'Non soumis',    color: 'var(--af-text-muted)', bg: 'rgba(156,163,175,0.1)',  icon: ClockIcon },
  submitted: { label: 'En cours d\'examen', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', icon: ClockIcon },
  approved:  { label: 'Approuvé',      color: '#10b981', bg: 'rgba(16,185,129,0.1)',   icon: CheckCircleIcon },
  rejected:  { label: 'Rejeté',        color: '#ef4444', bg: 'rgba(239,68,68,0.1)',    icon: XCircleIcon },
}

const inp = {
  width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)',
  border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const lbl = { display: 'block', fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 5 }

function FileDropZone({ label, accept, file, onChange, required }) {
  const ref = useRef()
  const [drag, setDrag] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) onChange(f)
  }

  return (
    <div>
      <label style={lbl}>{label} {required && <span style={{ color: '#ef4444' }}>*</span>}</label>
      <div
        onClick={() => ref.current.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${drag ? 'var(--af-accent)' : file ? '#10b981' : 'var(--af-border)'}`,
          borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer',
          background: file ? 'rgba(16,185,129,0.05)' : drag ? 'rgba(245,158,11,0.05)' : 'var(--af-surface-3)',
          transition: 'all 0.2s',
        }}
      >
        <input ref={ref} type="file" accept={accept} style={{ display: 'none' }}
          onChange={e => e.target.files[0] && onChange(e.target.files[0])} />
        {file ? (
          <div>
            <CheckCircleIcon style={{ width: 24, color: '#10b981', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>{file.name}</div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>
              {(file.size / 1024 / 1024).toFixed(2)} Mo — Cliquer pour changer
            </div>
          </div>
        ) : (
          <div>
            <DocumentArrowUpIcon style={{ width: 24, color: 'var(--af-border-strong)', margin: '0 auto 6px' }} />
            <div style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>Glisser-déposer ou cliquer</div>
            <div style={{ fontSize: 11, color: 'var(--af-border-strong)', marginTop: 2 }}>PDF, JPEG, PNG — max 10 Mo</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MerchantKyc() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const [rccm, setRccm] = useState(null)
  const [cni, setCni] = useState(null)
  const [gerantName, setGerantName] = useState('')
  const [rccmNumber, setRccmNumber] = useState('')

  useEffect(() => {
    api.get('/merchants/me/profile')
      .then(r => setProfile(r.data.merchant))
      .finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!rccm) return setError('Le document RCCM est requis.')
    if (!cni) return setError('La CNI du gérant est requise.')
    if (!gerantName.trim()) return setError('Le nom du gérant est requis.')

    const formData = new FormData()
    formData.append('files', rccm)
    formData.append('files', cni)
    formData.append('documents', JSON.stringify({
      rccm_number: rccmNumber.trim() || undefined,
      gerant_name: gerantName.trim(),
      doc_rccm: rccm.name,
      doc_cni: cni.name,
    }))

    setSubmitting(true)
    try {
      await api.post('/merchants/me/kyc', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setSuccess(true)
      setProfile(p => ({ ...p, kycStatus: 'submitted' }))
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || 'Erreur lors de la soumission.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>

  const status = profile?.kycStatus || 'pending'
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending
  const StatusIcon = cfg.icon

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ maxWidth: 620 }}>
      <Breadcrumb title="Vérification KYC" segments={[{ label: 'Soumettez vos documents pour activer votre compte' }]} />

      {/* Statut actuel */}
      <div style={{
        background: cfg.bg, border: `1px solid ${cfg.color}40`,
        borderRadius: 12, padding: '16px 20px', marginBottom: 28,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <StatusIcon style={{ width: 28, color: cfg.color, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 700, color: cfg.color, fontSize: 15 }}>{cfg.label}</div>
          {status === 'pending' && (
            <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginTop: 2 }}>
              Soumettez votre dossier pour que notre équipe puisse l'examiner (24–48h).
            </div>
          )}
          {status === 'submitted' && (
            <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginTop: 2 }}>
              Votre dossier est en cours d'examen. Vous serez notifié par email/SMS.
            </div>
          )}
          {status === 'approved' && (
            <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginTop: 2 }}>
              Votre identité est vérifiée. Votre compte est pleinement actif.
            </div>
          )}
          {status === 'rejected' && profile?.kycRejectionReason && (
            <div style={{ fontSize: 13, color: '#fca5a5', marginTop: 2 }}>
              Motif : {profile.kycRejectionReason}
            </div>
          )}
        </div>
      </div>

      {/* Formulaire — visible si pending ou rejected */}
      {(status === 'pending' || status === 'rejected') && !success && (
        <div style={{ background: 'var(--af-surface)', borderRadius: 14, padding: 28, border: '1px solid var(--af-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <ShieldCheckIcon style={{ width: 22, color: 'var(--af-accent)' }} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--af-text)', margin: 0 }}>
              Documents requis
            </h2>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gap: 18 }}>

              {/* Infos textuelles */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={lbl}>Nom du gérant <span style={{ color: '#ef4444' }}>*</span></label>
                  <input style={inp} value={gerantName}
                    onChange={e => setGerantName(e.target.value)}
                    placeholder="Prénom Nom" />
                </div>
                <div>
                  <label style={lbl}>N° RCCM<InfoTooltip text={TOOLTIPS.RCCM} /> <span style={{ color: 'var(--af-text-muted)', fontWeight: 400 }}>(optionnel)</span></label>
                  <input style={inp} value={rccmNumber}
                    onChange={e => setRccmNumber(e.target.value)}
                    placeholder="Ex: CI-ABJ-2023-B-00123" />
                </div>
              </div>

              {/* Upload RCCM */}
              <FileDropZone
                label={<>Registre du Commerce et du Crédit Mobilier (RCCM)<InfoTooltip text={TOOLTIPS.RCCM} /></>}
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                file={rccm}
                onChange={setRccm}
                required
              />

              {/* Upload CNI */}
              <FileDropZone
                label="Carte Nationale d'Identité du gérant"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                file={cni}
                onChange={setCni}
                required
              />

              <div style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--af-border-strong)' }}>
                <LockClosedIcon style={{ width: 14, height: 14, display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />Vos documents sont chiffrés et stockés de manière sécurisée. Ils ne seront utilisés que pour la vérification de votre identité conformément à notre politique RGPD.
              </div>

              {error && (
                <div style={{
                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13,
                }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={submitting} style={{
                width: '100%', padding: '13px', background: submitting ? 'var(--af-border)' : 'linear-gradient(135deg, var(--af-accent), var(--af-brand))',
                border: 'none', borderRadius: 9, color: submitting ? 'var(--af-text-muted)' : '#fff',
                fontWeight: 700, cursor: submitting ? 'default' : 'pointer', fontSize: 15,
              }}>
                {submitting ? 'Envoi en cours…' : 'Soumettre mon dossier KYC'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Succès */}
      {success && (
        <div style={{
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: 14, padding: 32, textAlign: 'center',
        }}>
          <CheckCircleIcon style={{ width: 48, color: '#10b981', margin: '0 auto 14px' }} />
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>Dossier soumis !</h3>
          <p style={{ color: 'var(--af-text-muted)', fontSize: 14 }}>
            Notre équipe examinera votre dossier sous 24–48h.<br />
            Vous serez notifié par email et SMS dès validation.
          </p>
        </div>
      )}

      {/* Dossier en cours — pas de formulaire */}
      {status === 'submitted' && (
        <div style={{ background: 'var(--af-surface)', borderRadius: 14, padding: 28, border: '1px solid var(--af-border)' }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--af-text)', marginBottom: 16 }}>Votre dossier</h2>
          <div style={{ color: 'var(--af-text-muted)', fontSize: 13, lineHeight: 1.7 }}>
            <div><CheckCircleIcon style={{ width: 14, height: 14, display: 'inline', marginRight: 4, color: '#10b981', verticalAlign: 'middle' }} />RCCM déposé</div>
            <div><CheckCircleIcon style={{ width: 14, height: 14, display: 'inline', marginRight: 4, color: '#10b981', verticalAlign: 'middle' }} />CNI du gérant déposée</div>
            <div style={{ marginTop: 12, color: 'var(--af-text-muted)' }}>
              Si vous avez besoin de modifier votre dossier, contactez notre support.
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
