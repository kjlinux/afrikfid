import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { publicApi as api } from '../api.js'

const COUNTRIES = [
  { id: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮' },
  { id: 'SN', name: 'Sénégal',       flag: '🇸🇳' },
  { id: 'BJ', name: 'Bénin',         flag: '🇧🇯' },
  { id: 'ML', name: 'Mali',          flag: '🇲🇱' },
  { id: 'BF', name: 'Burkina Faso',  flag: '🇧🇫' },
  { id: 'TG', name: 'Togo',          flag: '🇹🇬' },
  { id: 'GN', name: 'Guinée',        flag: '🇬🇳' },
  { id: 'CM', name: 'Cameroun',      flag: '🇨🇲' },
  { id: 'KE', name: 'Kenya',         flag: '🇰🇪' },
]

const inp = {
  width: '100%', padding: '10px 12px', background: '#0f172a',
  border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const lbl = { display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 5 }

export default function RegisterClient() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', country_id: 'CI', password: '', password_confirm: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.full_name.trim()) return setError('Nom complet requis.')
    if (!form.phone.startsWith('+')) return setError('Numéro avec indicatif (ex: +2250700000000)')
    if (form.password.length < 6) return setError('Mot de passe : minimum 6 caractères.')
    if (form.password !== form.password_confirm) return setError('Les mots de passe ne correspondent pas.')

    setLoading(true)
    try {
      const { data } = await api.post('/clients', {
        full_name: form.full_name,
        phone: form.phone,
        email: form.email || undefined,
        country_id: form.country_id,
        password: form.password,
      })
      setSuccess(data.client)
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur lors de la création du compte.')
    } finally { setLoading(false) }
  }

  if (success) return (
    <Screen>
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 36, maxWidth: 420, width: '100%', textAlign: 'center', border: '1px solid #334155' }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#10b981', marginBottom: 10 }}>Compte créé !</h2>
        <div style={{ background: '#0f172a', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Votre identifiant Afrik'Fid</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b', fontFamily: 'monospace', letterSpacing: 2 }}>
            {success.afrikfidId}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
            Conservez cet identifiant pour payer chez nos marchands partenaires et profiter de vos remises fidélité.
          </div>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 20 }}>
          Bienvenue <strong style={{ color: '#f1f5f9' }}>{success.fullName}</strong> !<br />
          Statut initial : <span style={{ color: '#6B7280', fontWeight: 600 }}>OPEN</span>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => navigate('/login')}
            style={{ padding: '10px 20px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
            Se connecter
          </button>
        </div>
      </div>
    </Screen>
  )

  return (
    <Screen>
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>A</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>Créer un compte client</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 3 }}>Profitez des remises fidélité chez tous nos marchands partenaires</p>
        </div>

        <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, border: '1px solid #334155' }}>
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Nom complet *</label>
              <input style={inp} value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder="Ex: Kouamé Jean-Baptiste" autoFocus />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Téléphone *</label>
                <input style={inp} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                  placeholder="+2250700000000" />
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>Avec indicatif international</div>
              </div>
              <div>
                <label style={lbl}>Pays *</label>
                <select style={inp} value={form.country_id} onChange={e => set('country_id', e.target.value)}>
                  {COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Email (optionnel)</label>
              <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="votre@email.com" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div>
                <label style={lbl}>Mot de passe *</label>
                <input style={inp} type="password" value={form.password} onChange={e => set('password', e.target.value)}
                  placeholder="Min. 6 caractères" />
              </div>
              <div>
                <label style={lbl}>Confirmer *</label>
                <input style={inp} type="password" value={form.password_confirm} onChange={e => set('password_confirm', e.target.value)}
                  placeholder="Répétez" />
              </div>
            </div>

            {/* Avantages fidélité */}
            <div style={{ background: '#0f172a', borderRadius: 10, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>PROGRAMME DE FIDÉLITÉ AFRIK'FID</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { status: 'OPEN',  color: '#6B7280', icon: '○', pct: '0%',  label: 'Démarrage' },
                  { status: 'LIVE',  color: '#3B82F6', icon: '★', pct: '5%',  label: 'Actif' },
                  { status: 'GOLD',  color: '#F59E0B', icon: '◎', pct: '8%',  label: 'Premium' },
                  { status: 'ROYAL', color: '#8B5CF6', icon: '♛', pct: '12%', label: 'Elite' },
                ].map(s => (
                  <div key={s.status} style={{ background: s.color + '15', border: '1px solid ' + s.color + '40', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: s.color, fontSize: 14 }}>{s.icon}</span>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{s.status}</div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{s.pct} de remise</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 12, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '13px', background: loading ? '#334155' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 9, color: loading ? '#64748b' : '#fff', fontWeight: 700, cursor: loading ? 'default' : 'pointer', fontSize: 15 }}>
              {loading ? 'Création...' : 'Créer mon compte Afrik\'Fid'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 16 }}>
          Déjà un compte ?{' '}
          <Link to="/login" style={{ color: '#f59e0b', fontWeight: 600, textDecoration: 'none' }}>Se connecter</Link>
          {' · '}
          <Link to="/register" style={{ color: '#94a3b8', textDecoration: 'none' }}>Inscription marchand</Link>
        </p>
      </div>
    </Screen>
  )
}

function Screen({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      {children}
    </div>
  )
}
