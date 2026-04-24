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
  const [role, setRole]               = useState('admin')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [clientMode, setClientMode]   = useState('phone')
  const [phoneLocal, setPhoneLocal]   = useState('')
  const [countryId, setCountryId]     = useState('CI')
  const [clientEmail, setClientEmail] = useState('')
  const [afrikfidId, setAfrikfidId]   = useState('')
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
        if (data.requires2FA) { setRequires2FA(true); setLoading(false); return }
        login({ ...data.client, role: 'client' }, data.accessToken, data.refreshToken)
        navigate('/client')
      } else {
        const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/merchant/login'
        const { data } = await api.post(endpoint, body)
        if (data.requires2FA) { setRequires2FA(true); setLoading(false); return }
        const userData = role === 'admin' ? { ...data.admin, role: 'admin' } : { ...data.merchant, role: 'merchant' }
        login(userData, data.accessToken, data.refreshToken)
        navigate(role === 'admin' ? '/admin' : '/merchant')
      }
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'Identifiants invalides')
    } finally { setLoading(false) }
  }

  const inp = {
    width: '100%', padding: '10px 14px',
    background: 'var(--afrikfid-surface-2)',
    border: '1px solid var(--afrikfid-border)',
    borderRadius: 8, color: 'var(--afrikfid-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--af-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/afrikfid-logo.png" alt="Afrik'Fid" style={{ height: 80, objectFit: 'contain', display: 'block', margin: '0 auto 10px' }}
            onError={e => { e.target.style.display = 'none' }} />
          <p style={{ color: 'var(--af-text-muted)', fontSize: 13, letterSpacing: '0.3px' }}>Passerelle de Paiement B2B Multi-Pays</p>
        </div>

        {/* Card */}
        <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 32, border: '1px solid var(--afrikfid-border)', boxShadow: '0 4px 24px rgba(15, 17, 21,0.1)' }}>
          {/* Role tabs */}
          <div style={{ display: 'flex', background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: 4, marginBottom: 24, gap: 2, border: '1px solid var(--afrikfid-border)' }}>
            {TABS.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => handleTabChange(id)}
                style={{
                  flex: 1, padding: '7px 4px', border: 'none', borderRadius: 6, cursor: 'pointer',
                  fontSize: 11, fontWeight: 600, transition: 'all 0.2s', whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  background: role === id ? 'var(--afrikfid-primary)' : 'transparent',
                  color: role === id ? '#fff' : 'var(--afrikfid-muted)',
                }}>
                <Icon style={{ width: 13, height: 13 }} />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {requires2FA ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
                  <ShieldCheckIcon style={{ width: 20, height: 20, color: 'var(--afrikfid-success)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--afrikfid-success)' }}>Vérification 2FA</div>
                    <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginTop: 2 }}>Ouvrez Google Authenticator ou Authy et saisissez le code à 6 chiffres.</div>
                  </div>
                </div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>Code TOTP</label>
                <input type="text" inputMode="numeric" autoFocus autoComplete="one-time-code"
                  value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" maxLength={6}
                  style={{ ...inp, fontFamily: 'monospace', fontSize: 24, letterSpacing: 8, textAlign: 'center' }} />
                <button type="button" onClick={() => { setRequires2FA(false); setTotpCode(''); setError('') }}
                  style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--afrikfid-muted)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>
                  ← Revenir à la connexion
                </button>
              </div>
            ) : role === 'client' ? (
              <>
                {/* Mode selector */}
                <div style={{ display: 'flex', background: 'var(--afrikfid-surface-2)', borderRadius: 6, padding: 3, marginBottom: 16, gap: 2, border: '1px solid var(--afrikfid-border)' }}>
                  {CLIENT_LOGIN_MODES.map(({ id, label, Icon }) => (
                    <button key={id} type="button" onClick={() => handleModeChange(id)}
                      style={{
                        flex: 1, padding: '6px 4px', border: 'none', borderRadius: 4, cursor: 'pointer',
                        fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                        background: clientMode === id ? 'var(--afrikfid-secondary)' : 'transparent',
                        color: clientMode === id ? '#fff' : 'var(--afrikfid-muted)',
                      }}>
                      <Icon style={{ width: 12, height: 12 }} />
                      {label}
                    </button>
                  ))}
                </div>

                {clientMode === 'phone' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--afrikfid-muted)', marginBottom: 6 }}>Téléphone</label>
                    <select value={countryId} onChange={e => setCountryId(e.target.value)}
                      style={{ ...inp, marginBottom: 6, padding: '8px 12px' }}>
                      {COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.flag} {c.prefix}</option>)}
                    </select>
                    <div style={{ display: 'flex' }}>
                      <div style={{
                        padding: '10px 12px', background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)',
                        borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--afrikfid-muted)',
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
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>
                      Saisissez votre numéro local (ex: 0759376464)
                    </div>
                  </div>
                )}

                {clientMode === 'email' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--afrikfid-muted)', marginBottom: 6 }}>Email</label>
                    <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)}
                      placeholder="votre@email.com" required autoFocus style={inp} />
                  </div>
                )}

                {clientMode === 'afrikfid_id' && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--afrikfid-muted)', marginBottom: 6 }}>Identifiant Afrik'Fid</label>
                    <input type="text" value={afrikfidId}
                      onChange={e => setAfrikfidId(e.target.value.toUpperCase())}
                      placeholder="AFD-XXXXXXXX-XXXX" required autoFocus
                      style={{ ...inp, fontFamily: 'monospace', letterSpacing: 1 }} />
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>
                      L'identifiant reçu lors de votre inscription
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--afrikfid-muted)', marginBottom: 6 }}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  placeholder={role === 'admin' ? 'admin@afrikfid.com' : 'merchant@demo.af'}
                  style={inp} />
              </div>
            )}

            {!requires2FA && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--afrikfid-muted)', marginBottom: 6 }}>Mot de passe</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" style={inp} />
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 13, marginBottom: 16 }}>
                <ExclamationCircleIcon style={{ width: 16, height: 16, flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || (requires2FA && totpCode.length !== 6)}
              style={{ width: '100%', padding: 12, background: loading ? 'var(--afrikfid-border)' : 'var(--afrikfid-primary)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: loading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.2s' }}>
              {loading ? 'Vérification…' : requires2FA
                ? (<><ShieldCheckIcon style={{ width: 16, height: 16 }} /><span>Vérifier le code</span></>)
                : (<><span>Se connecter</span><ChevronRightIcon style={{ width: 16, height: 16 }} /></>)
              }
            </button>
          </form>

          {role === 'client' ? (
            <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--afrikfid-surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--afrikfid-muted)', border: '1px solid var(--afrikfid-border)' }}>
              <div style={{ fontWeight: 600, color: 'var(--afrikfid-text)', marginBottom: 6 }}>Statuts fidélité :</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_COLORS).map(([s, c]) => (
                  <span key={s} style={{ background: c + '18', border: `1px solid ${c}40`, borderRadius: 4, padding: '2px 8px', color: c, fontWeight: 700, fontSize: 11 }}>{s}</span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--afrikfid-surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--afrikfid-muted)', border: '1px solid var(--afrikfid-border)' }}>
              <div style={{ fontWeight: 600, color: 'var(--afrikfid-text)', marginBottom: 4 }}>Comptes démo :</div>
              <div>Admin: admin@afrikfid.com / Admin@2026!</div>
              <div>Marchand: supermarche@demo.af / Merchant@2026!</div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          {role === 'merchant' && (
            <p style={{ fontSize: 13, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>
              Pas encore inscrit ?{' '}
              <Link to="/register" style={{ color: 'var(--afrikfid-accent)', fontWeight: 600, textDecoration: 'none' }}>
                Créer un compte marchand →
              </Link>
            </p>
          )}
          {role === 'client' && (
            <p style={{ fontSize: 13, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>
              Pas encore de compte ?{' '}
              <Link to="/register-client" style={{ color: 'var(--afrikfid-accent)', fontWeight: 600, textDecoration: 'none' }}>
                Créer un compte Afrik'Fid →
              </Link>
            </p>
          )}
          {role !== 'client' && (
            <p style={{ fontSize: 12, color: 'var(--afrikfid-muted)' }}>
              Vous êtes un client ?{' '}
              <button onClick={() => handleTabChange('client')} style={{ background: 'none', border: 'none', color: 'var(--afrikfid-secondary)', fontWeight: 600, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>
                Se connecter ici
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
