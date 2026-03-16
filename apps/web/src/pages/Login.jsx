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
  ShieldCheckIcon,
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
  const [requires2FA, setRequires2FA] = useState(false)
  const [totpCode, setTotpCode]       = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()

  const selectedCountry = COUNTRIES.find(c => c.id === countryId) || COUNTRIES[0]

  const handleTabChange = (r) => { setRole(r); setError(''); setRequires2FA(false); setTotpCode('') }
  const handleModeChange = (m) => { setClientMode(m); setError('') }

  const buildBody = () => {
    if (role === 'client') {
      const body = { password }
      if (clientMode === 'phone') {
        const raw = phoneLocal.trim().replace(/\s/g, '')
        body.phone = raw.startsWith('+') ? raw : selectedCountry.prefix + raw.replace(/^0+/, '')
        body.country_prefix = selectedCountry.prefix
      } else if (clientMode === 'email') {
        body.email = clientEmail.trim()
      } else {
        body.afrikfid_id = afrikfidId.trim().toUpperCase()
      }
      return body
    }
    return { email, password }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const body = buildBody()
      if (requires2FA) body.totp_code = totpCode

      if (role === 'client') {
        const { data } = await api.post('/auth/client/login', body)
        if (data.requires2FA) {
          setRequires2FA(true)
          setLoading(false)
          return
        }
        login({ ...data.client, role: 'client' }, data.accessToken, data.refreshToken)
        navigate('/client')
      } else {
        const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/merchant/login'
        const { data } = await api.post(endpoint, body)
        if (data.requires2FA) {
          setRequires2FA(true)
          setLoading(false)
          return
        }
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
          <div style={{ display: 'inline-block', marginBottom: 16, filter: 'drop-shadow(0 8px 24px rgba(245,158,11,0.35))' }}>
            <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="72" y2="72" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#fbbf24"/>
                  <stop offset="100%" stopColor="#d97706"/>
                </linearGradient>
                <linearGradient id="shineGrad" x1="0" y1="0" x2="0" y2="72" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22"/>
                  <stop offset="55%" stopColor="#ffffff" stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* Background rounded square */}
              <rect width="72" height="72" rx="18" fill="url(#logoGrad)"/>
              {/* Shine overlay */}
              <rect width="72" height="40" rx="18" fill="url(#shineGrad)"/>
              {/* Letter A — stylized */}
              <text x="36" y="50" fontFamily="Arial Black, Arial, sans-serif" fontSize="38" fontWeight="900" textAnchor="middle" fill="#0f172a" letterSpacing="-2">A</text>
              {/* Gold accent dot top-right */}
              <circle cx="56" cy="16" r="6" fill="#0f172a" opacity="0.18"/>
              <circle cx="56" cy="16" r="3.5" fill="#0f172a" opacity="0.35"/>
              {/* Small decorative bar bottom */}
              <rect x="24" y="58" width="24" height="3" rx="1.5" fill="#0f172a" opacity="0.2"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.5px' }}>
            Afrik<span style={{ color: '#f59e0b' }}>'Fid</span>
          </h1>
          <p style={{ color: '#64748b', marginTop: 6, fontSize: 13, letterSpacing: '0.3px' }}>Passerelle de Paiement B2B Multi-Pays</p>
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
            {requires2FA ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
                  <ShieldCheckIcon style={{ width: 20, height: 20, color: '#10b981', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#10b981' }}>Vérification 2FA</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Ouvrez Google Authenticator ou Authy et saisissez le code à 6 chiffres.</div>
                  </div>
                </div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 8 }}>Code TOTP</label>
                <input
                  type="text" inputMode="numeric" autoFocus autoComplete="one-time-code"
                  value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" maxLength={6}
                  style={{ ...inp, fontFamily: 'monospace', fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
                />
                <button type="button" onClick={() => { setRequires2FA(false); setTotpCode(''); setError('') }}
                  style={{ marginTop: 10, background: 'none', border: 'none', color: '#64748b', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  ← Revenir à la connexion
                </button>
              </div>
            ) : role === 'client' ? (
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

            {!requires2FA && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#94a3b8', marginBottom: 6 }}>Mot de passe</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={inp} />
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
                <ExclamationCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || (requires2FA && totpCode.length !== 6)}
              style={{ width: '100%', padding: '12px', background: loading ? '#374151' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {loading ? 'Vérification…' : requires2FA
                ? (<><ShieldCheckIcon style={{ width: 16, height: 16 }} /><span>Vérifier le code</span></>)
                : (<><span>Se connecter</span><ChevronRightIcon style={{ width: 16, height: 16 }} /></>)
              }
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
