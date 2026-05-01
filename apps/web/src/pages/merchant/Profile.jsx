import React, { useState } from 'react'
import { useAuth } from '../../App.jsx'
import api from '../../api.js'
import {
  ShieldCheckIcon, LockClosedIcon, DevicePhoneMobileIcon,
  CheckCircleIcon, ExclamationCircleIcon, QrCodeIcon, KeyIcon,
} from '@heroicons/react/24/outline'

const inp = {
  width: '100%', padding: '9px 12px', background: 'var(--af-surface-3)',
  border: '1px solid var(--af-border)', borderRadius: 6, color: 'var(--af-text)',
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

export default function MerchantProfile() {
  const { user, updateUser } = useAuth()

  React.useEffect(() => {
    api.get('/auth/merchant/me').then(r => {
      const totpEnabled = r.data.merchant?.totpEnabled ?? r.data.totpEnabled
      if (typeof totpEnabled === 'boolean' && totpEnabled !== user?.totpEnabled) {
        updateUser({ totpEnabled })
      }
    }).catch(() => {})
  }, [])

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

  const startSetup = async () => {
    setSetupLoading(true); setSetupMsg(null)
    try {
      const { data } = await api.post('/auth/merchant/2fa/setup')
      setQrCode(data.qrCode); setSecret(data.secret); setStep('verify')
    } catch (e) {
      setSetupMsg({ type: 'error', text: e.response?.data?.error || 'Erreur initialisation 2FA' })
    } finally { setSetupLoading(false) }
  }

  const verifySetup = async () => {
    if (!totpCode) return
    setSetupLoading(true); setSetupMsg(null)
    try {
      const { data } = await api.post('/auth/merchant/2fa/verify', { totp_code: totpCode })
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
      await api.delete('/auth/merchant/2fa/disable', { data: { password: disablePassword } })
      setDisableMsg({ type: 'success', text: '2FA désactivé.' })
      setShowDisable(false); setDisablePassword('')
      updateUser({ totpEnabled: false })
    } catch (e) {
      setDisableMsg({ type: 'error', text: e.response?.data?.error || 'Mot de passe incorrect' })
    } finally { setDisableLoading(false) }
  }

  // Pendant le setup 2FA (QR code + saisie code), on élargit la carte sécurité sur 2 colonnes.
  const securitySpansAll = !totpEnabled && (step === 'verify' || step === 'done')

  return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)', marginBottom: 6 }}>Profil & Sécurité</h1>
      <p style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 24 }}>Gérez la sécurité de votre compte marchand</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20, alignItems: 'start' }}>

      <div style={{ background: 'var(--af-surface)', borderRadius: 12, padding: 24, border: '1px solid var(--af-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <KeyIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Informations du compte</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Email', user?.email],
            ['Nom', user?.name],
            ['2FA', totpEnabled ? 'Activé' : 'Désactivé'],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>{k}</div>
              <div style={{ fontSize: 13, color: k === '2FA' ? (totpEnabled ? '#10b981' : '#ef4444') : 'var(--af-text)', fontWeight: 500 }}>{v || '—'}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--af-surface)', borderRadius: 12, padding: 24, border: '1px solid var(--af-border)', gridColumn: securitySpansAll ? '1 / -1' : 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ShieldCheckIcon style={{ width: 18, height: 18, color: '#10b981' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Authentification à deux facteurs (2FA)</h2>
        </div>
        <p style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 20 }}>
          Protégez votre compte avec une application TOTP (Google Authenticator, Authy, etc.).
        </p>

        {totpEnabled ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <CheckCircleIcon style={{ width: 18, height: 18, color: '#10b981', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981' }}>2FA activé</div>
                <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 1 }}>Votre compte est protégé par une double authentification.</div>
              </div>
            </div>
            <Msg msg={disableMsg} />
            {showDisable ? (
              <div style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 10 }}>Saisissez votre mot de passe pour désactiver le 2FA :</div>
                <input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && disable2FA()}
                  placeholder="Mot de passe" autoFocus style={{ ...inp, marginBottom: 10 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setShowDisable(false); setDisablePassword(''); setDisableMsg(null) }}
                    style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 6, color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 13 }}>
                    Annuler
                  </button>
                  <button onClick={disable2FA} disabled={disableLoading || !disablePassword}
                    style={{ flex: 1, padding: '9px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    {disableLoading ? 'Vérification...' : 'Désactiver le 2FA'}
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
                  <ExclamationCircleIcon style={{ width: 18, height: 18, color: 'var(--af-accent)', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Le 2FA n'est pas activé. Activez-le pour sécuriser l'accès à votre compte marchand.</div>
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
                      <QrCodeIcon style={{ width: 14, height: 14, color: 'var(--af-text-muted)' }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)' }}>1. Scanner le QR code</span>
                    </div>
                    {qrCode && <img src={qrCode} alt="QR Code 2FA" style={{ width: '100%', maxWidth: 180, borderRadius: 8, border: '1px solid var(--af-border)' }} />}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <KeyIcon style={{ width: 14, height: 14, color: 'var(--af-text-muted)' }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)' }}>Ou saisie manuelle</span>
                    </div>
                    <code style={{ display: 'block', fontSize: 11, color: 'var(--af-accent)', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 6, padding: '10px 12px', wordBreak: 'break-all', fontFamily: 'monospace' }}>{secret}</code>
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 8 }}>
                  <DevicePhoneMobileIcon style={{ width: 13, height: 13, display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  2. Entrez le code généré par l'application
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
                    style={{ padding: '9px 14px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 13 }}>
                    Annuler
                  </button>
                </div>
              </div>
            )}
            {step === 'done' && backupCodes.length > 0 && (
              <div>
                <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 4 }}>2FA activé !</div>
                  <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Conservez ces codes de secours. Chaque code ne peut être utilisé qu'une seule fois.</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, background: 'var(--af-surface-3)', borderRadius: 8, padding: 16 }}>
                  {backupCodes.map(code => (
                    <code key={code} style={{ fontSize: 12, color: 'var(--af-accent)', fontFamily: 'monospace', letterSpacing: 2, padding: '4px 8px', background: 'rgba(245,158,11,0.08)', borderRadius: 4, textAlign: 'center' }}>{code}</code>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      </div>
    </div>
  )
}
