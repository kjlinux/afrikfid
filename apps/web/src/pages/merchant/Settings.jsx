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
  width: '100%', padding: '9px 12px', background: '#0f172a',
  border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #1e293b' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{description}</div>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: checked ? '#10b981' : '#334155',
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
      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 24, width: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <LockClosedIcon style={{ width: 18, height: 18, color: '#f59e0b' }} />
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Confirmer votre identité</h3>
        </div>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Saisissez votre mot de passe pour afficher la clé secrète.</p>
        <input type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && revealSecret()}
          placeholder="Mot de passe" autoFocus
          style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
        {revealError && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{revealError}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowPasswordModal(false); setPasswordInput(''); setRevealError('') }}
            style={{ flex: 1, padding: '9px', background: 'transparent', border: '1px solid #334155', borderRadius: 6, color: '#64748b', cursor: 'pointer' }}>Annuler</button>
          <button onClick={revealSecret} disabled={revealing}
            style={{ flex: 1, padding: '9px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, color: '#f59e0b', cursor: 'pointer', fontWeight: 600, opacity: revealing ? 0.7 : 1 }}>
            {revealing ? 'Vérification...' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ padding: '28px 32px', maxWidth: 780 }}>
      {PasswordModal}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>Paramètres</h1>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 28 }}>Configurez le comportement de votre intégration Afrik'Fid</p>

      <Msg msg={msg} />

      {/* ─── Comportement paiements ────────────────────────────────────────── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <CreditCardIcon style={{ width: 18, height: 18, color: '#f59e0b' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Comportement des paiements</h2>
        </div>

        {/* Mode de remise */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Mode de remise client
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { value: 'immediate', label: 'Remise immédiate', desc: 'Déduite directement sur le montant payé par le client' },
              { value: 'cashback',  label: 'Cashback différé',  desc: 'Créditée sur le portefeuille Afrik\'Fid du client' },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => setRebateMode(opt.value)}
                style={{
                  padding: '12px 14px', border: `1px solid ${rebateMode === opt.value ? '#f59e0b' : '#334155'}`,
                  borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: rebateMode === opt.value ? 'rgba(245,158,11,0.1)' : '#0f172a',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: rebateMode === opt.value ? '#f59e0b' : '#f1f5f9', marginBottom: 4 }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 8, padding: '8px 10px', background: '#0f172a', borderRadius: 6 }}>
            Taux X actuel : <strong style={{ color: '#f59e0b' }}>{profile.rebatePercent}%</strong> — modifiable uniquement par l'administration Afrik'Fid
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
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <GlobeAltIcon style={{ width: 18, height: 18, color: '#f59e0b' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Webhook de notification<InfoTooltip text={TOOLTIPS.webhook} /></h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Afrik'Fid enverra des notifications signées (<Tooltip text={TOOLTIPS.hmac}>HMAC-SHA256</Tooltip>) à cette URL pour chaque événement de paiement.
        </p>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>URL de callback</label>
          <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://votre-site.com/api/webhook/afrikfid"
            style={inp} />
        </div>
        {/* Événements */}
        <div style={{ background: '#0f172a', borderRadius: 8, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Événements reçus</div>
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
                  <code style={{ fontSize: 10, color: '#f59e0b' }}>{event}</code>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ─── Bouton Save ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 28 }}>
        <button onClick={saveSettings} disabled={saving}
          style={{
            padding: '10px 28px', background: saving ? '#334155' : 'linear-gradient(135deg, #f59e0b, #ef4444)',
            border: 'none', borderRadius: 8, color: saving ? '#64748b' : '#fff',
            fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
          {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
        </button>
      </div>

      {/* ─── Clés API ─────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <KeyIcon style={{ width: 18, height: 18, color: '#f59e0b' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Clés API<InfoTooltip text={TOOLTIPS.api_key} /></h2>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Clé publique (Sandbox)<InfoTooltip text={TOOLTIPS.sandbox} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#f59e0b', wordBreak: 'break-all' }}>
              {profile.sandboxKeyPublic}
            </code>
            <CopyButton text={profile.sandboxKeyPublic} />
          </div>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
            Utilisez cette clé dans l'en-tête <code style={{ color: '#94a3b8' }}>X-API-Key</code> pour vos appels sandbox.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Clé publique (Production)<InfoTooltip text={TOOLTIPS.production} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#10b981', wordBreak: 'break-all' }}>
              {profile.apiKeyPublic}
            </code>
            <CopyButton text={profile.apiKeyPublic} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clé secrète (Production)</div>
          {profile.kycStatus !== 'approved' ? (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <LockClosedIcon style={{ width: 18, height: 18, color: '#f59e0b', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b' }}>KYC requis<InfoTooltip text={TOOLTIPS.KYC} /></div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  Votre KYC doit être approuvé pour accéder aux clés de production.{' '}
                  <a href="/merchant/kyc" style={{ color: '#f59e0b', textDecoration: 'underline' }}>Compléter mon KYC →</a>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: secretValue && showSecret ? '#ef4444' : '#94a3b8', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {secretValue && showSecret ? secretValue : '••••••••••••••••••••••••••••••••••••••••'}
                </code>
                {secretValue && <CopyButton text={secretValue} />}
                <button onClick={() => { if (!secretValue) { setShowPasswordModal(true) } else { setShowSecret(s => !s) } }}
                  style={{ padding: '8px 12px', background: 'rgba(148,163,184,0.1)', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {!secretValue ? 'Déverrouiller' : showSecret ? 'Masquer' : 'Afficher'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                La clé secrète sert à signer vos requêtes (HMAC-SHA256). Ne la partagez jamais.
              </p>
            </>
          )}
        </div>
      </Card>

      {/* ─── Infos compte (lecture seule) ─────────────────────────────────── */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <UserGroupIcon style={{ width: 18, height: 18, color: '#f59e0b' }} />
          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Informations du compte</h2>
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
            <div key={k} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                {tip ? <>{k}<InfoTooltip text={tip} /></> : k}
              </div>
              <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 500 }}>{v || '—'}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: '#475569', marginTop: 12 }}>
          Pour modifier votre taux X%, la fréquence de settlement ou vos coordonnées bancaires, contactez le support Afrik'Fid.
        </p>
      </Card>
    </div>
  )
}
