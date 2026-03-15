import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../App.jsx'
import api from '../api.js'
import {
  LockClosedIcon,
  BuildingStorefrontIcon,
  UserIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  IdentificationIcon,
  ChevronRightIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'

const TABS = [
  { id: 'admin',    label: 'Administrateur', Icon: LockClosedIcon },
  { id: 'merchant', label: 'Marchand',        Icon: BuildingStorefrontIcon },
  { id: 'client',   label: 'Client',           Icon: UserIcon },
]

const STATUS_COLORS = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

const CLIENT_LOGIN_MODES = [
  { id: 'phone',       label: 'Téléphone',   Icon: DevicePhoneMobileIcon },
  { id: 'email',       label: 'Email',        Icon: EnvelopeIcon },
  { id: 'afrikfid_id', label: 'Identifiant', Icon: IdentificationIcon },
]

const COUNTRIES = [
  { id: 'CI', flag: '🇨🇮', prefix: '+225', digits: 10 },
  { id: 'SN', flag: '🇸🇳', prefix: '+221', digits: 9  },
  { id: 'BF', flag: '🇧🇫', prefix: '+226', digits: 8  },
  { id: 'ML', flag: '🇲🇱', prefix: '+223', digits: 8  },
  { id: 'NE', flag: '🇳🇪', prefix: '+227', digits: 8  },
  { id: 'TG', flag: '🇹🇬', prefix: '+228', digits: 8  },
  { id: 'BJ', flag: '🇧🇯', prefix: '+229', digits: 8  },
  { id: 'CM', flag: '🇨🇲', prefix: '+237', digits: 9  },
  { id: 'TD', flag: '🇹🇩', prefix: '+235', digits: 8  },
  { id: 'CG', flag: '🇨🇬', prefix: '+242', digits: 9  },
  { id: 'GA', flag: '🇬🇦', prefix: '+241', digits: 8  },
  { id: 'KE', flag: '🇰🇪', prefix: '+254', digits: 9  },
]

export default function Login() {
  const [role, setRole]             = useState('admin')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  // Client-specific state
  const [clientMode, setClientMode] = useState('phone')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [countryId, setCountryId]   = useState('CI')
  const [clientEmail, setClientEmail] = useState('')
  const [afrikfidId, setAfrikfidId] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const selectedCountry = COUNTRIES.find(c => c.id === countryId) || COUNTRIES[0]

  const handleTabChange = (r) => { setRole(r); setError('') }
  const handleModeChange = (m) => { setClientMode(m); setError('') }

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (role === 'client') {
        let body = { password }
        if (clientMode === 'phone') {
          // Normalise : retire le 0 initial si présent, ajoute l'indicatif
          const raw = phoneLocal.trim().replace(/\s/g, '')
          const normalized = raw.startsWith('+')
            ? raw
            : selectedCountry.prefix + raw.replace(/^0+/, '')
          body.phone = normalized
          body.country_prefix = selectedCountry.prefix
        } else if (clientMode === 'email') {
          body.email = clientEmail.trim()
        } else {
          body.afrikfid_id = afrikfidId.trim().toUpperCase()
        }
        const { data } = await api.post('/auth/client/login', body)
        login({ ...data.client, role: 'client' }, data.accessToken, data.refreshToken)
        navigate('/client')
      } else {
        const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/merchant/login'
        const { data } = await api.post(endpoint, { email, password })
        const userData = role === 'admin'
          ? { ...data.admin, role: 'admin' }
          : { ...data.merchant, role: 'merchant' }
        login(userData, data.accessToken, data.refreshToken)
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
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => handleTabChange(id)}
                style={{
                  flex: 1, padding: '7px 4px', border: 'none', borderRadius: 6, cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, transition: 'all 0.2s', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  background: role === id ? '#f59e0b' : 'transparent',
                  color: role === id ? '#0f172a' : '#64748b',
                }}>
                <Icon style={{ width: 13, height: 13 }} />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {role === 'client' ? (
              <>
                {/* Mode selector */}
                <div style={{ display: 'flex', background: '#0f172a', borderRadius: 6, padding: 3, marginBottom: 16, gap: 2 }}>
                  {CLIENT_LOGIN_MODES.map(({ id, label, Icon }) => (
                    <button key={id} type="button" onClick={() => handleModeChange(id)}
                      style={{
                        flex: 1, padding: '6px 4px', border: 'none', borderRadius: 4, cursor: 'pointer',
                        fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                        background: clientMode === id ? '#1e40af' : 'transparent',
                        color: clientMode === id ? '#bfdbfe' : '#64748b',
                      }}>
                      <Icon style={{ width: 12, height: 12 }} />
                      {label}
                    </button>
                  ))}
                </div>

                {clientMode === 'phone' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Téléphone</label>
                    {/* Country selector */}
                    <select value={countryId} onChange={e => setCountryId(e.target.value)}
                      style={{ ...inp, marginBottom: 6, padding: '8px 12px' }}>
                      {COUNTRIES.map(c => (
                        <option key={c.id} value={c.id}>{c.flag} {c.prefix}</option>
                      ))}
                    </select>
                    {/* Phone input with prefix badge */}
                    <div style={{ display: 'flex' }}>
                      <div style={{
                        padding: '10px 12px', background: '#162032', border: '1px solid #334155',
                        borderRight: 'none', borderRadius: '8px 0 0 8px', color: '#94a3b8',
                        fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', userSelect: 'none',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <span>{selectedCountry.flag}</span>
                        <span>{selectedCountry.prefix}</span>
                      </div>
                      <input type="tel" value={phoneLocal}
                        onChange={e => setPhoneLocal(e.target.value.replace(/[^\d\s]/g, ''))}
                        placeholder={'0'.repeat(selectedCountry.digits)}
                        maxLength={selectedCountry.digits + 2}
                        autoFocus required
                        style={{ ...inp, borderRadius: '0 8px 8px 0', flex: 1 }} />
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      Saisissez votre numéro local (ex: 0759376464 ou 759376464)
                    </div>
                  </div>
                )}

                {clientMode === 'email' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Email</label>
                    <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                      placeholder="votre@email.com" required autoFocus style={inp} />
                  </div>
                )}

                {clientMode === 'afrikfid_id' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Identifiant Afrik'Fid</label>
                    <input type="text" value={afrikfidId}
                      onChange={e => setAfrikfidId(e.target.value.toUpperCase())}
                      placeholder="AFD-XXXXXXXX-XXXX" required autoFocus
                      style={{ ...inp, fontFamily: 'monospace', letterSpacing: 1 }} />
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                      L'identifiant reçu lors de votre inscription
                    </div>
                  </div>
                )}
              </>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
                <ExclamationCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '12px', background: loading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {loading ? 'Connexion…' : (<><span>Se connecter</span><ChevronRightIcon style={{ width: 16, height: 16 }} /></>)}
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
