import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { CheckCircleIcon } from '@heroicons/react/24/outline'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

export default function MerchantLinks() {
  const [links, setLinks] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ amount: '', description: '', expires_in_hours: 24, max_uses: 1 })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [newLink, setNewLink] = useState(null)

  const load = () => api.get('/payment-links').then(r => setLinks(r.data.links))
  useEffect(() => { load() }, [])

  const create = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      const { data } = await api.post('/payment-links', form)
      setNewLink(data)
      setMsg('')
      setShowCreate(false)
      load()
    } catch (err) {
      setMsg(err.response?.data?.error || 'Erreur')
    } finally { setSaving(false) }
  }

  const cancel = async id => {
    await api.delete(`/payment-links/${id}`)
    load()
  }

  const copyToClipboard = text => {
    navigator.clipboard.writeText(text)
    setMsg('Lien copié !')
    setTimeout(() => setMsg(''), 2000)
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Liens de Paiement</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Partagez des liens de paiement sans intégration technique</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '10px 20px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer' }}>
          + Créer un lien
        </button>
      </div>

      {msg && <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', color: '#10b981', marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* Nouveau lien généré */}
      {newLink && (
        <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircleIcon className="w-4 h-4" />Lien créé avec succès !</div>
          <div style={{ background: '#0f172a', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <code style={{ fontSize: 13, color: '#f59e0b', wordBreak: 'break-all' }}>{newLink.payUrl}</code>
            <button onClick={() => copyToClipboard(newLink.payUrl)}
              style={{ padding: '6px 12px', background: '#f59e0b', border: 'none', borderRadius: 6, color: '#0f172a', cursor: 'pointer', fontSize: 12, fontWeight: 700, marginLeft: 12, flexShrink: 0 }}>
              Copier
            </button>
          </div>
          <button onClick={() => setNewLink(null)} style={{ marginTop: 10, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}>Fermer</button>
        </div>
      )}

      {/* Liste */}
      <div style={{ display: 'grid', gap: 12 }}>
        {links.length === 0 && (
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 40, textAlign: 'center', color: '#64748b', border: '1px solid #334155' }}>
            Aucun lien de paiement créé. Créez votre premier lien ci-dessus.
          </div>
        )}
        {links.map(link => {
          const isExpired = new Date(link.expires_at) < new Date()
          const isUsed = link.uses_count >= link.max_uses
          const isActive = link.status === 'active' && !isExpired && !isUsed
          const payUrl = `${window.location.origin}/pay/${link.code}`

          return (
            <div key={link.id} style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: `1px solid ${isActive ? '#334155' : '#1e293b'}`, opacity: isActive ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#f59e0b', fontWeight: 700 }}>{link.code}</span>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: isActive ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)', color: isActive ? '#10b981' : '#6B7280' }}>
                      {isExpired ? 'Expiré' : isUsed ? 'Utilisé' : link.status}
                    </span>
                  </div>

                  {link.description && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>{link.description}</div>}

                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 700 }}>
                      {link.amount ? `${fmt(link.amount)} ${link.currency}` : 'Montant libre'}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      Utilisations: {link.uses_count} / {link.max_uses}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      Expire: {new Date(link.expires_at).toLocaleDateString('fr-FR')}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12, background: '#0f172a', borderRadius: 8, padding: '8px 12px', alignItems: 'center' }}>
                    <code style={{ fontSize: 12, color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{payUrl}</code>
                    <button onClick={() => copyToClipboard(payUrl)}
                      style={{ padding: '4px 10px', background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
                      Copier
                    </button>
                  </div>
                </div>

                {isActive && (
                  <button onClick={() => cancel(link.id)}
                    style={{ marginLeft: 16, padding: '6px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
                    Annuler
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, width: '100%', maxWidth: 460, border: '1px solid #334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>Nouveau Lien de Paiement</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <form onSubmit={create}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Montant (laisser vide = libre)</label>
                <input type="number" min="0" step="100" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Ex: 50000"
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex: Commande #123"
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Durée (heures)</label>
                  <select value={form.expires_in_hours} onChange={e => setForm(f => ({ ...f, expires_in_hours: parseInt(e.target.value) }))}
                    style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14 }}>
                    <option value={1}>1 heure</option>
                    <option value={6}>6 heures</option>
                    <option value={24}>24 heures</option>
                    <option value={72}>3 jours</option>
                    <option value={168}>7 jours</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>Nb utilisations</label>
                  <input type="number" min="1" max="100" value={form.max_uses} onChange={e => setForm(f => ({ ...f, max_uses: parseInt(e.target.value) }))}
                    style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
                </div>
              </div>
              {msg && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{msg}</div>}
              <button type="submit" disabled={saving}
                style={{ width: '100%', padding: '12px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
                {saving ? 'Création...' : 'Créer le lien'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
