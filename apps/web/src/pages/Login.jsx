import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App.jsx'
import api from '../api.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/merchant/login'
      const { data } = await api.post(endpoint, { email, password })
      const userData = role === 'admin' ? { ...data.admin, role: 'admin' } : { ...data.merchant, role: 'merchant' }
      login(userData, data.accessToken)
      navigate(role === 'admin' ? '/admin' : '/merchant')
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, marginBottom: 16 }}>
            A
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f1f5f9' }}>Afrik'Fid</h1>
          <p style={{ color: '#64748b', marginTop: 6, fontSize: 14 }}>Passerelle de Paiement B2B Multi-Pays</p>
        </div>

        {/* Card */}
        <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, border: '1px solid #334155' }}>
          {/* Role tabs */}
          <div style={{ display: 'flex', background: '#0f172a', borderRadius: 8, padding: 4, marginBottom: 24 }}>
            {['admin', 'merchant'].map(r => (
              <button key={r} onClick={() => setRole(r)}
                style={{
                  flex: 1, padding: '8px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                  background: role === r ? '#f59e0b' : 'transparent',
                  color: role === r ? '#0f172a' : '#64748b',
                }}>
                {r === 'admin' ? '🔐 Administrateur' : '🏪 Marchand'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder={role === 'admin' ? 'admin@afrikfid.com' : 'merchant@demo.af'}
                style={{ width: '100%', padding: '10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Mot de passe</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••"
                style={{ width: '100%', padding: '10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
            </div>

            {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</div>}

            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', background: loading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          {/* Credentials hint */}
          <div style={{ marginTop: 20, padding: '12px 14px', background: '#0f172a', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
            <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>Comptes démo :</div>
            <div>Admin: admin@afrikfid.com / Admin@2026!</div>
            <div>Marchand: supermarche@demo.af / Merchant@2026!</div>
          </div>
        </div>

        {role === 'merchant' && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#64748b', marginTop: 16 }}>
            Pas encore inscrit ?{' '}
            <Link to="/register" style={{ color: '#f59e0b', fontWeight: 600, textDecoration: 'none' }}>
              Créer un compte marchand →
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
