import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Spinner, CopyButton } from '../../components/ui.jsx'

const inp = {
  width: '100%', padding: '9px 12px', background: '#0f172a',
  border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13, outline: 'none',
  boxSizing: 'border-box',
}

export default function MerchantSettings() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSecret, setShowSecret] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.get('/merchants/me/profile').then(r => {
      setProfile(r.data.merchant)
      setWebhookUrl(r.data.merchant.webhookUrl || '')
    }).finally(() => setLoading(false))
  }, [])

  const saveWebhook = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await api.patch(`/merchants/${profile.id}`, { webhook_url: webhookUrl })
      setMsg({ type: 'success', text: 'URL webhook mise à jour.' })
      setProfile(p => ({ ...p, webhookUrl }))
    } catch (e) {
      setMsg({ type: 'error', text: e.response?.data?.error || 'Erreur lors de la sauvegarde' })
    } finally { setSaving(false) }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: '28px 32px', maxWidth: 780 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 24 }}>Paramètres d'intégration</h1>

      {msg && (
        <div style={{
          background: msg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${msg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: msg.type === 'success' ? '#10b981' : '#ef4444',
          borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 20,
        }}>{msg.text}</div>
      )}

      {/* Clés API */}
      <Card title="Clés API">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Clé publique (Sandbox)
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
            Clé publique (Production)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#10b981', wordBreak: 'break-all' }}>
              {profile.apiKeyPublic}
            </code>
            <CopyButton text={profile.apiKeyPublic} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Clé secrète (masquée)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '9px 12px', fontSize: 12, color: '#94a3b8' }}>
              {showSecret ? <span style={{ color: '#ef4444' }}>Contactez l'administrateur pour obtenir votre clé secrète</span> : '••••••••••••••••••••••••••••••••'}
            </div>
            <button onClick={() => setShowSecret(s => !s)}
              style={{ padding: '8px 12px', background: 'rgba(148,163,184,0.1)', border: '1px solid #334155', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}>
              {showSecret ? 'Masquer' : 'Afficher'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
            La clé secrète sert à signer vos requêtes (HMAC-SHA256). Ne la partagez jamais.
          </p>
        </div>
      </Card>

      {/* Webhook */}
      <Card title="Webhook de notification" style={{ marginTop: 20 }}>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Afrik'Fid enverra des notifications signées (HMAC-SHA256) à cette URL pour chaque événement de paiement.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 6, fontWeight: 600 }}>URL de callback</label>
          <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://votre-site.com/api/webhook/afrikfid"
            style={inp} />
        </div>

        <button onClick={saveWebhook} disabled={saving}
          style={{ padding: '9px 20px', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#f59e0b', cursor: saving ? 'default' : 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Sauvegarde...' : 'Enregistrer le webhook'}
        </button>

        {/* Événements */}
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #334155' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', marginBottom: 12 }}>Événements reçus</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {[
              ['payment.success', 'Paiement confirmé'],
              ['payment.failed', 'Paiement échoué'],
              ['payment.expired', 'Transaction expirée'],
              ['refund.completed', 'Remboursement effectué'],
              ['distribution.completed', 'Distribution des fonds'],
              ['loyalty.status_changed', 'Changement statut fidélité client'],
            ].map(([event, desc]) => (
              <div key={event} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ color: '#10b981', fontSize: 12, marginTop: 1 }}>●</span>
                <div>
                  <code style={{ fontSize: 11, color: '#f59e0b' }}>{event}</code>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Infos compte */}
      <Card title="Informations du compte" style={{ marginTop: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            ['Nom marchand', profile.name],
            ['Email', profile.email],
            ['Mode remise', profile.rebateMode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'],
            ['Taux X%', `${profile.rebatePercent}%`],
            ['Settlement', profile.settlementFrequency || 'daily'],
            ['Statut KYC', profile.kycStatus],
          ].map(([k, v]) => (
            <div key={k} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{k}</div>
              <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 500 }}>{v || '—'}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
