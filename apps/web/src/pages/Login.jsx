import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App.jsx'
import api from '../api.js'

const TABS = [
  { id: 'admin',    label: '🔐 Administrateur' },
  { id: 'merchant', label: '🏪 Marchand' },
  { id: 'client',   label: '👤 Client' },
]

const STATUS_COLORS = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function Login() {
  const [role, setRole]         = useState('admin')
  const [email, setEmail]       = useState('')
  const [phone, setPhone]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleTabChange = (r) => { setRole(r); setError('') }

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (role === 'client') {
        const { data } = await api.post('/auth/client/login', { phone, password })
        login({ ...data.client, role: 'client' }, data.accessToken)
        navigate('/client')
      } else {
        const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/merchant/login'
        const { data } = await api.post(endpoint, { email, password })
        const userData = role === 'admin'
          ? { ...data.admin, role: 'admin' }
          : { ...data.merchant, role: 'merchant' }
        login(userData, data.accessToken)
        navigate(role === 'admin' ? '/admin' : '/merchant')
      }
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Identifiants invalides')
    } finally {
      setLoading(false)
    }
  }

  const inp = { width: '100%', padding: '10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, marginBottom: 16 }}>
            A
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9' }}>Afrik'Fid</h1>
          <p style={{ color: '#64748b', marginTop: 6, fontSize: 14 }}>Passerelle de Paiement B2B Multi-Pays</p>
        </div>

        {/* Card */}
        <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, border: '1px solid #334155' }}>
          {/* Role tabs */}
          <div style={{ display: 'flex', background: '#0f172a', borderRadius: 8, padding: 4, marginBottom: 24, gap: 2 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => handleTabChange(t.id)}
                style={{
                  flex: 1, padding: '7px 4px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, transition: 'all 0.2s', whiteSpace: 'nowrap',
                  background: role === t.id ? '#f59e0b' : 'transparent',
                  color: role === t.id ? '#0f172a' : '#64748b',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {role === 'client' ? (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Numéro de téléphone</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required autoFocus
                  placeholder="+2250700000000"
                  style={inp} />
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>Avec indicatif international (ex: +225…)</div>
              </div>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder={role === 'admin' ? 'admin@afrikfid.com' : 'merchant@demo.af'}
                  style={inp} />
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Mot de passe</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••"
                style={inp} />
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', background: loading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>

          {/* Hint */}
          {role === 'client' ? (
            <div style={{ marginTop: 20, padding: '12px 14px', background: '#0f172a', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
              <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Statuts fidélité :</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_COLORS).map(([s, c]) => (
                  <span key={s} style={{ background: c + '20', border: `1px solid ${c}50`, borderRadius: 4, padding: '2px 8px', color: c, fontWeight: 700, fontSize: 11 }}>{s}</span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 20, padding: '12px 14px', background: '#0f172a', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
              <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Comptes démo :</div>
              <div>Admin: admin@afrikfid.com / Admin@2026!</div>
              <div>Marchand: supermarche@demo.af / Merchant@2026!</div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          {role === 'merchant' && (
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
              Pas encore inscrit ?{' '}
              <Link to="/register" style={{ color: '#f59e0b', fontWeight: 600, textDecoration: 'none' }}>
                Créer un compte marchand →
              </Link>
            </p>
          )}
          {role === 'client' && (
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
              Pas encore de compte ?{' '}
              <Link to="/register-client" style={{ color: '#f59e0b', fontWeight: 600, textDecoration: 'none' }}>
                Créer un compte Afrik'Fid →
              </Link>
            </p>
          )}
          {role !== 'client' && (
            <p style={{ fontSize: 12, color: '#64748b' }}>
              Vous êtes un client ?{' '}
              <button onClick={() => handleTabChange('client')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontWeight: 600, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>
                Se connecter ici
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
