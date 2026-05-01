import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Spinner, CopyButton, InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'
import {
  GlobeAltIcon,
  CreditCardIcon,
  UserGroupIcon,
  KeyIcon,
  LockClosedIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'

const inp = {
  width: '100%', padding: '9px 12px', background: 'var(--af-surface-3)',
  border: '1px solid var(--af-border)', borderRadius: 6, color: 'var(--af-text)', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--af-surface)' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--af-text)' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>{description}</div>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: checked ? '#10b981' : 'var(--af-border)',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 16,
        }}>
        <span style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', display: 'block',
        }} />
      </button>
    </div>
  )
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
      {ok
        ? <CheckCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
        : <ExclamationCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />}
      {msg.text}
    </div>
  )
}

export default function MerchantSettings() {
  const [profile, setProfile]               = useState(null)
  const [loading, setLoading]               = useState(true)
  // Clé secrète
  const [showSecret, setShowSecret]         = useState(false)
  const [secretValue, setSecretValue]       = useState(null)
  const [passwordInput, setPasswordInput]   = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [revealError, setRevealError]       = useState('')
  const [revealing, setRevealing]           = useState(false)
  // Paramètres comportementaux
  const [webhookUrl, setWebhookUrl]         = useState('')
  const [rebateMode, setRebateMode]         = useState('cashback')
  const [allowGuestMode, setAllowGuestMode] = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [msg, setMsg]                       = useState(null)
  // Logo
  const [logoFile, setLogoFile]             = useState(null)
  const [logoPreview, setLogoPreview]       = useState(null)
  const [uploadingLogo, setUploadingLogo]   = useState(false)
  const [logoMsg, setLogoMsg]               = useState(null)

  useEffect(() => {
    api.get('/merchants/me/profile').then(r => {
      const m = r.data.merchant
      setProfile(m)
      setWebhookUrl(m.webhookUrl || '')
      setRebateMode(m.rebateMode || 'cashback')
      setAllowGuestMode(m.allowGuestMode !== false)
    }).finally(() => setLoading(false))
  }, [])

  const revealSecret = async () => {
    if (!passwordInput) return
    setRevealing(true); setRevealError('')
    try {
      const { data } = await api.post('/merchants/me/reveal-secret', { password: passwordInput })
      setSecretValue(data.apiKeySecret)
      setShowPasswordModal(false)
      setPasswordInput('')
    } catch (e) {
      setRevealError(e.response?.data?.error || 'Erreur')
    } finally { setRevealing(false) }
  }

  const onLogoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setLogoMsg(null)
  }

  const uploadLogo = async () => {
    if (!logoFile) return
    setUploadingLogo(true); setLogoMsg(null)
    try {
      const form = new FormData()
      form.append('logo', logoFile)
      const { data } = await api.post('/merchants/me/logo', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      setProfile(p => ({ ...p, logoUrl: data.logoUrl }))
      setLogoFile(null)
      setLogoPreview(null)
      setLogoMsg({ type: 'success', text: 'Logo mis à jour avec succès.' })
    } catch (e) {
      setLogoMsg({ type: 'error', text: e.response?.data?.error || 'Erreur lors de l\'upload' })
    } finally { setUploadingLogo(false) }
  }

  const saveSettings = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const { data } = await api.patch('/merchants/me/settings', {
        webhook_url: webhookUrl || null,
        rebate_mode: rebateMode,
        allow_guest_mode: allowGuestMode,
      })
      setProfile(data.merchant)
      setMsg({ type: 'success', text: 'Paramètres enregistrés avec succès.' })
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || 'Erreur lors de la sauvegarde' })
    } finally { setSaving(false) }
  }

  if (loading) return <Spinner />

  const PasswordModal = showPasswordModal && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--af-surface)', borderRadius: 12, border: '1px solid var(--af-border)', padding: 24, width: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <LockClosedIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Confirmer votre identité</h3>
        </div>
        <p style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 16 }}>Saisissez votre mot de passe pour afficher la clé secrète.</p>
        <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && revealSecret()}
          placeholder="Mot de passe" autoFocus
          style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 6, color: 'var(--af-text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
        {revealError && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{revealError}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowPasswordModal(false); setPasswordInput(''); setRevealError('') }}
            style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid var(--af-border)', borderRadius: 6, color: 'var(--af-text-muted)', cursor: 'pointer' }}>Annuler</button>
          <button onClick={revealSecret} disabled={revealing}
            style={{ flex: 1, padding: '9px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, color: 'var(--af-accent)', cursor: 'pointer', fontWeight: 600, opacity: revealing ? 0.7 : 1 }}>
            {revealing ? 'Vérification...' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px' }}>
      {PasswordModal}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)', marginBottom: 6 }}>Paramètres</h1>
      <p style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 24 }}>Configurez le comportement de votre intégration Afrik'Fid</p>

      <Msg msg={msg} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 20, alignItems: 'start' }}>

      {/* ─── Comportement paiements ────────────────────────────────────────── */}
      <Card style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <CreditCardIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Comportement des paiements</h2>
        </div>

        {/* Mode de remise */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 8 }}>
            Mode de remise client
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { value: 'immediate', label: 'Remise immédiate', desc: 'Déduite directement sur le montant payé par le client' },
              { value: 'cashback',  label: 'Cashback différé',  desc: 'Créditée sur le portefeuille Afrik\'Fid du client' },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => setRebateMode(opt.value)}
                style={{
                  padding: '12px 14px', border: `1px solid ${rebateMode === opt.value ? 'var(--af-accent)' : 'var(--af-border)'}`,
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: rebateMode === opt.value ? 'var(--af-accent-soft)' : 'var(--af-surface)',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: rebateMode === opt.value ? 'var(--af-accent)' : 'var(--af-text)', marginBottom: 4 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 8, padding: '8px 10px', background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 6 }}>
            Taux actuel : <strong style={{ color: 'var(--af-accent)' }}>{profile.rebatePercent}%</strong> — modifiable uniquement par l'administration Afrik'Fid
          </div>
        </div>

        {/* Mode invité */}
        <Toggle
          checked={allowGuestMode}
          onChange={setAllowGuestMode}
          label="Mode invité (clients sans compte)"
          description={allowGuestMode
            ? "Les clients sans compte Afrik'Fid peuvent payer — sans remise (Y% = 0)"
            : "Les transactions sont refusées si le client n'a pas de compte Afrik'Fid"}
        />
      </Card>

      {/* ─── Webhook ──────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <GlobeAltIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Webhook de notification<InfoTooltip text={TOOLTIPS.webhook} /></h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 16 }}>
          Afrik'Fid enverra des notifications signées (<Tooltip text={TOOLTIPS.hmac}>HMAC-SHA256</Tooltip>) à cette URL pour chaque événement de paiement.
        </p>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--af-text-muted)', display: 'block', marginBottom: 6, fontWeight: 600 }}>URL de callback</label>
          <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://votre-site.com/api/webhook/afrikfid"
            style={inp} />
        </div>
        {/* Événements */}
        <div style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 10 }}>Événements reçus</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {[
              ['payment.success', 'Paiement confirmé'],
              ['payment.failed', 'Paiement échoué'],
              ['payment.expired', 'Transaction expirée'],
              ['refund.completed', 'Remboursement effectué'],
              ['distribution.completed', 'Distribution des fonds'],
              ['loyalty.status_changed', 'Changement statut fidélité'],
            ].map(([event, desc]) => (
              <div key={event} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ color: '#10b981', fontSize: 10, marginTop: 2, flexShrink: 0 }}>●</span>
                <div>
                  <code style={{ fontSize: 10, color: 'var(--af-accent)' }}>{event}</code>
                  <div style={{ fontSize: 10, color: 'var(--af-text-muted)' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ─── Clés API ─────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <KeyIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Clés API<InfoTooltip text={TOOLTIPS.api_key} /></h2>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 8 }}>
            Clé publique (Sandbox)<InfoTooltip text={TOOLTIPS.sandbox} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: 'var(--af-accent)', wordBreak: 'break-all' }}>
              {profile.sandboxKeyPublic}
            </code>
            <CopyButton text={profile.sandboxKeyPublic} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
            Utilisez cette clé dans l'en-tête <code style={{ color: 'var(--af-text-muted)' }}>X-API-Key</code> pour vos appels sandbox.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 8 }}>
            Clé publique (Production)<InfoTooltip text={TOOLTIPS.production} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#10b981', wordBreak: 'break-all' }}>
              {profile.apiKeyPublic}
            </code>
            <CopyButton text={profile.apiKeyPublic} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 8 }}>Clé secrète (Production)</div>
          {profile.kycStatus !== 'approved' ? (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <LockClosedIcon style={{ width: 18, height: 18, color: 'var(--af-accent)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--af-accent)' }}>KYC requis<InfoTooltip text={TOOLTIPS.KYC} /></div>
                <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>
                  Votre KYC doit être approuvé pour accéder aux clés de production.{' '}
                  <a href="/merchant/kyc" style={{ color: 'var(--af-accent)', textDecoration: 'underline' }}>Compléter mon KYC →</a>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: secretValue && showSecret ? '#ef4444' : 'var(--af-text-muted)', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {secretValue && showSecret ? secretValue : '••••••••••••••••••••••••••••••••••••••••'}
                </code>
                {secretValue && <CopyButton text={secretValue} />}
                <button onClick={() => { if (!secretValue) { setShowPasswordModal(true) } else { setShowSecret(s => !s) } }}
                  style={{ padding: '8px 12px', background: 'rgba(156,163,175,0.1)', border: '1px solid var(--af-border)', borderRadius: 6, color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {!secretValue ? 'Déverrouiller' : showSecret ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
                La clé secrète sert à signer vos requêtes (HMAC-SHA256). Ne la partagez jamais.
              </p>
            </>
          )}
        </div>
      </Card>

      {/* ─── Infos compte (lecture seule) ─────────────────────────────────── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <UserGroupIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Informations du compte</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Nom marchand',    profile.name,                                         null],
            ['Email',           profile.email,                                        null],
            ['Taux X%',         `${profile.rebatePercent}% (défini par Afrik\'Fid)`, TOOLTIPS.remise_x],
            ['Settlement',      profile.settlementFrequency || 'daily',               TOOLTIPS.settlement],
            ['Statut KYC',      profile.kycStatus,                                    TOOLTIPS.KYC],
            ['Statut compte',   profile.status,                                       null],
          ].map(([k, v, tip]) => (
            <div key={k} style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>
                {tip ? <>{k}<InfoTooltip text={tip} /></> : k}
              </div>
              <div style={{ fontSize: 13, color: 'var(--af-text)', fontWeight: 500 }}>{v || '—'}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--af-border-strong)', marginTop: 12 }}>
          Pour modifier votre taux X%, la fréquence de settlement ou vos coordonnées bancaires, contactez le support Afrik'Fid.
        </p>
      </Card>

      </div>

      {/* ─── Logo / Photo de profil ───────────────────────────────────── */}
      <Card style={{ gridColumn: '1 / -1', marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <UserGroupIcon style={{ width: 18, height: 18, color: 'var(--af-accent)' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)' }}>Logo / Photo de profil</h2>
        </div>
        <Msg msg={logoMsg} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Aperçu */}
          <div style={{ width: 80, height: 80, borderRadius: 12, border: '1px solid var(--af-border)', overflow: 'hidden', flexShrink: 0, background: 'var(--af-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {(logoPreview || profile.logoUrl)
              ? <img src={logoPreview || profile.logoUrl} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: 28, color: 'var(--af-border-strong)' }}>🏪</span>}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 10 }}>
              Format JPEG, PNG ou WEBP. Taille max 10 Mo. Ce logo apparaît sur les liens de paiement et dans le système de fidélité.
            </p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ padding: '8px 14px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--af-text)' }}>
                Choisir un fichier
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onLogoChange} style={{ display: 'none' }} />
              </label>
              {logoFile && (
                <button onClick={uploadLogo} disabled={uploadingLogo}
                  style={{ padding: '8px 16px', background: 'var(--af-accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600, opacity: uploadingLogo ? 0.7 : 1 }}>
                  {uploadingLogo ? 'Envoi...' : 'Enregistrer le logo'}
                </button>
              )}
              {logoFile && <span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>{logoFile.name}</span>}
            </div>
          </div>
        </div>
      </Card>

      {/* ─── Bouton Save (en bas de page) ──────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
        <button onClick={saveSettings} disabled={saving}
          className="af-btn af-btn--primary af-btn--lg"
          style={saving ? { opacity: 0.6, cursor: 'default' } : {}}>
          {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
        </button>
      </div>
    </div>
  )
}
