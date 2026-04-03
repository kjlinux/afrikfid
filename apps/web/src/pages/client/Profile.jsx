import React, { useState } from 'react'
import { useAuth } from '../../App.jsx'
import api from '../../api.js'
import { InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'
import {
  ShieldCheckIcon, LockClosedIcon, DevicePhoneMobileIcon,
  CheckCircleIcon, ExclamationCircleIcon, QrCodeIcon, KeyIcon,
  ArrowDownTrayIcon, TrashIcon,
} from '@heroicons/react/24/outline'

const inp = {
  width: '100%', padding: '9px 12px', background: '#0f172a',
  border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

function Msg({ msg }) {
  if (!msg) return null
  const ok = msg.type === 'success'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
      color: ok ? '#10b981' : '#ef4444',
      borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16,
    }}>
      {ok ? <CheckCircleIcon style={{ width: 15, height: 15, flexShrink: 0 }} /> : <ExclamationCircleIcon style={{ width: 15, height: 15, flexShrink: 0 }} />}
      {msg.text}
    </div>
  )
}

export default function ClientProfile() {
  const { user, updateUser } = useAuth()


  const [step, setStep] = useState('idle')
  const [qrCode, setQrCode] = useState(null)
  const [secret, setSecret] = useState(null)
  const [totpCode, setTotpCode] = useState('')
  const [backupCodes, setBackupCodes] = useState([])
  const [setupMsg, setSetupMsg] = useState(null)
  const [setupLoading, setSetupLoading] = useState(false)

  const [disablePassword, setDisablePassword] = useState('')
  const [disableMsg, setDisableMsg] = useState(null)
  const [disableLoading, setDisableLoading] = useState(false)
  const [showDisable, setShowDisable] = useState(false)

  const totpEnabled = user?.totpEnabled

  // RGPD
  const [gdprLoading, setGdprLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState(null)

  const exportMyData = async () => {
    setGdprLoading(true)
    try {
      const { data } = await api.get(`/clients/${user.id}/export`)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mes-donnees-afrikfid-${user.afrikfidId || user.id}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export : ' + (e.response?.data?.error || e.message))
    } finally { setGdprLoading(false) }
  }

  const deleteMyAccount = async () => {
    setDeleteLoading(true); setDeleteMsg(null)
    try {
      await api.delete(`/clients/${user.id}`)
      setDeleteMsg({ type: 'success', text: 'Votre compte a été anonymisé. Vous allez être déconnecté.' })
      setTimeout(() => { localStorage.clear(); window.location.href = '/login' }, 2500)
    } catch (e) {
      setDeleteMsg({ type: 'error', text: e.response?.data?.error || 'Erreur lors de la suppression' })
      setDeleteLoading(false)
    }
  }

  const startSetup = async () => {
    setSetupLoading(true); setSetupMsg(null)
    try {
      const { data } = await api.post('/auth/client/2fa/setup')
      setQrCode(data.qrCode); setSecret(data.secret); setStep('verify')
    } catch (e) {
      setSetupMsg({ type: 'error', text: e.response?.data?.error || 'Erreur initialisation 2FA' })
    } finally { setSetupLoading(false) }
  }

  const verifySetup = async () => {
    if (!totpCode) return
    setSetupLoading(true); setSetupMsg(null)
    try {
      const { data } = await api.post('/auth/client/2fa/verify', { totp_code: totpCode })
      setBackupCodes(data.backupCodes || [])
      setStep('done')
      setSetupMsg({ type: 'success', text: '2FA activé avec succès !' })
      updateUser({ totpEnabled: true })
    } catch (e) {
      setSetupMsg({ type: 'error', text: e.response?.data?.error || 'Code TOTP invalide' })
    } finally { setSetupLoading(false) }
  }

  const disable2FA = async () => {
    if (!disablePassword) return
    setDisableLoading(true); setDisableMsg(null)
    try {
      await api.delete('/auth/client/2fa/disable', { data: { password: disablePassword } })
      setDisableMsg({ type: 'success', text: '2FA désactivé.' })
      setShowDisable(false); setDisablePassword('')
      updateUser({ totpEnabled: false })
    } catch (e) {
      setDisableMsg({ type: 'error', text: e.response?.data?.error || 'Mot de passe incorrect' })
    } finally { setDisableLoading(false) }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', padding: '28px 24px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>Sécurité du compte</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>Gérez la sécurité de votre compte Afrik'Fid</p>

        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <KeyIcon style={{ width: 16, height: 16, color: '#f59e0b' }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Informations du compte</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              ['Identifiant', user?.afrikfidId, null],
              ['Statut fidélité', user?.loyaltyStatus, user?.loyaltyStatus ? TOOLTIPS[user.loyaltyStatus] : null],
              ['2FA', totpEnabled ? 'Activé' : 'Désactivé', TOOLTIPS.deux_fa],
            ].map(([k, v, tip]) => (
              <div key={k} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                  {tip ? <>{k}<InfoTooltip text={tip} /></> : k}
                </div>
                <div style={{ fontSize: 13, color: k === '2FA' ? (totpEnabled ? '#10b981' : '#ef4444') : '#f1f5f9', fontWeight: 500 }}>{v || '—'}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <ShieldCheckIcon style={{ width: 16, height: 16, color: '#10b981' }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Authentification à deux facteurs (2FA)<InfoTooltip text={TOOLTIPS.deux_fa} /></h2>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>
            Protégez votre compte avec Google Authenticator, Authy, etc.
          </p>

          {totpEnabled ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                <CheckCircleIcon style={{ width: 18, height: 18, color: '#10b981', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981' }}>2FA activé</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>Votre compte est protégé.</div>
                </div>
              </div>
              <Msg msg={disableMsg} />
              {showDisable ? (
                <div style={{ background: '#0f172a', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Saisissez votre mot de passe pour désactiver le 2FA :</div>
                  <input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && disable2FA()}
                    placeholder="Mot de passe" autoFocus style={{ ...inp, marginBottom: 10 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setShowDisable(false); setDisablePassword(''); setDisableMsg(null) }}
                      style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                      Annuler
                    </button>
                    <button onClick={disable2FA} disabled={disableLoading || !disablePassword}
                      style={{ flex: 1, padding: '9px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                      {disableLoading ? 'Vérification...' : 'Désactiver'}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowDisable(true)}
                  style={{ padding: '9px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <LockClosedIcon style={{ width: 14, height: 14 }} />Désactiver le 2FA
                </button>
              )}
            </>
          ) : (
            <>
              <Msg msg={setupMsg} />
              {step === 'idle' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                    <ExclamationCircleIcon style={{ width: 18, height: 18, color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Le 2FA n'est pas activé. Activez-le pour mieux protéger votre compte.</div>
                  </div>
                  <button onClick={startSetup} disabled={setupLoading}
                    style={{ padding: '10px 20px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldCheckIcon style={{ width: 16, height: 16 }} />
                    {setupLoading ? 'Initialisation...' : 'Activer le 2FA'}
                  </button>
                </div>
              )}
              {step === 'verify' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <QrCodeIcon style={{ width: 14, height: 14, color: '#64748b' }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>1. Scanner le QR code</span>
                      </div>
                      {qrCode && <img src={qrCode} alt="QR Code 2FA" style={{ width: '100%', maxWidth: 180, borderRadius: 8, border: '1px solid #334155' }} />}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <KeyIcon style={{ width: 14, height: 14, color: '#64748b' }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Ou saisie manuelle</span>
                      </div>
                      <code style={{ display: 'block', fontSize: 11, color: '#f59e0b', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '10px 12px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{secret}</code>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>
                    <DevicePhoneMobileIcon style={{ width: 13, height: 13, display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                    2. Entrez le code généré<InfoTooltip text={TOOLTIPS.totp} />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="text" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onKeyDown={e => e.key === 'Enter' && verifySetup()}
                      placeholder="000000" maxLength={6} autoFocus
                      style={{ ...inp, fontFamily: 'monospace', letterSpacing: 4, fontSize: 18, textAlign: 'center', maxWidth: 140 }} />
                    <button onClick={verifySetup} disabled={setupLoading || totpCode.length !== 6}
                      style={{ padding: '9px 20px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, color: '#10b981', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                      {setupLoading ? 'Vérification...' : 'Confirmer'}
                    </button>
                    <button onClick={() => { setStep('idle'); setQrCode(null); setSecret(null); setTotpCode(''); setSetupMsg(null) }}
                      style={{ padding: '9px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
              {step === 'done' && backupCodes.length > 0 && (
                <div>
                  <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 4 }}>2FA activé !</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Conservez ces codes de secours. Chaque code ne peut être utilisé qu'une seule fois.</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, background: '#0f172a', borderRadius: 8, padding: 16 }}>
                    {backupCodes.map(code => (
                      <code key={code} style={{ fontSize: 12, color: '#f59e0b', fontFamily: 'monospace', letterSpacing: 2, padding: '4px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: 4, textAlign: 'center' }}>{code}</code>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {/* RGPD */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155', marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <ArrowDownTrayIcon style={{ width: 16, height: 16, color: '#64748b' }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Mes données personnelles (RGPD)<InfoTooltip text={TOOLTIPS.RGPD} /></h2>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>
            Conformément au RGPD, vous pouvez exporter ou supprimer vos données personnelles.
          </p>

          <button onClick={exportMyData} disabled={gdprLoading}
            style={{ width: '100%', padding: '10px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, color: '#3b82f6', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            <ArrowDownTrayIcon style={{ width: 15, height: 15 }} />
            {gdprLoading ? 'Téléchargement...' : 'Télécharger mes données (JSON)'}
          </button>

          <button onClick={() => setShowDeleteConfirm(true)}
            style={{ width: '100%', padding: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <TrashIcon style={{ width: 15, height: 15 }} />
            Supprimer mon compte (<Tooltip text={TOOLTIPS.droit_oubli}>droit à l'oubli</Tooltip>)
          </button>
        </div>

        {/* Modale suppression compte */}
        {showDeleteConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
            <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #ef4444', padding: 28, width: 420, maxWidth: '90vw' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#ef4444', marginBottom: 10 }}>Supprimer mon compte ?</div>
              <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
                Vos données personnelles (nom, téléphone, email) seront <strong style={{ color: '#f1f5f9' }}>anonymisées de façon irréversible</strong>.
                Vos transactions sont conservées à des fins comptables.
              </p>
              <Msg msg={deleteMsg} />
              <div style={{ marginBottom: 12 }}>
                <input type="password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                  placeholder="Confirmez avec votre mot de passe" style={{ ...inp, marginBottom: 0 }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteMsg(null) }} disabled={deleteLoading}
                  style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>
                  Annuler
                </button>
                <button onClick={deleteMyAccount} disabled={deleteLoading || !deletePassword}
                  style={{ flex: 1, padding: '10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  {deleteLoading ? 'Traitement...' : 'Confirmer la suppression'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
