import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { publicApi as api } from '../api.js'
import { SparklesIcon } from '@heroicons/react/24/outline'

const COUNTRIES = [
  { id: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', prefix: '+225', currency: 'XOF', digits: 10 },
  { id: 'SN', name: 'Sénégal',       flag: '🇸🇳', prefix: '+221', currency: 'XOF', digits: 9  },
  { id: 'BF', name: 'Burkina Faso',  flag: '🇧🇫', prefix: '+226', currency: 'XOF', digits: 8  },
  { id: 'ML', name: 'Mali',          flag: '🇲🇱', prefix: '+223', currency: 'XOF', digits: 8  },
  { id: 'NE', name: 'Niger',         flag: '🇳🇪', prefix: '+227', currency: 'XOF', digits: 8  },
  { id: 'TG', name: 'Togo',          flag: '🇹🇬', prefix: '+228', currency: 'XOF', digits: 8  },
  { id: 'BJ', name: 'Bénin',         flag: '🇧🇯', prefix: '+229', currency: 'XOF', digits: 8  },
  { id: 'CM', name: 'Cameroun',      flag: '🇨🇲', prefix: '+237', currency: 'XAF', digits: 9  },
  { id: 'TD', name: 'Tchad',         flag: '🇹🇩', prefix: '+235', currency: 'XAF', digits: 8  },
  { id: 'CG', name: 'Congo',         flag: '🇨🇬', prefix: '+242', currency: 'XAF', digits: 9  },
  { id: 'GA', name: 'Gabon',         flag: '🇬🇦', prefix: '+241', currency: 'XAF', digits: 8  },
  { id: 'GW', name: 'Guinée-Bissau', flag: '🇬🇼', prefix: '+245', currency: 'XOF', digits: 7  },
  { id: 'GQ', name: 'Guinée Éq.',    flag: '🇬🇶', prefix: '+240', currency: 'XAF', digits: 9  },
  { id: 'CF', name: 'RCA',           flag: '🇨🇫', prefix: '+236', currency: 'XAF', digits: 8  },
  { id: 'KE', name: 'Kenya',         flag: '🇰🇪', prefix: '+254', currency: 'KES', digits: 9  },
]

// Villes et quartiers par pays (ISO 3166-1 alpha-2)
const GEO_DATA = {
  CI: {
    cities: ['Abidjan', 'Bouaké', 'Daloa', 'Korhogo', 'Man', 'San-Pédro', 'Yamoussoukro'],
    districts: {
      Abidjan: ['Abobo', 'Adjamé', 'Attécoubé', 'Cocody', 'Koumassi', 'Marcory', 'Plateau', 'Port-Bouët', 'Treichville', 'Yopougon'],
      Bouaké: ['Koko', 'N\'Dotré', 'Sokoura', 'Nimbo'],
      Daloa: ['Centre', 'Lobia', 'Orly'],
      default: [],
    },
  },
  SN: {
    cities: ['Dakar', 'Thiès', 'Saint-Louis', 'Kaolack', 'Ziguinchor', 'Touba', 'Mbour'],
    districts: {
      Dakar: ['Almadies', 'Dakar Plateau', 'Grand Dakar', 'Guédiawaye', 'Liberté', 'Médina', 'Ouakam', 'Parcelles Assainies', 'Pikine', 'Point E', 'Yoff'],
      Thiès: ['Centre', 'Nord', 'Ouest'],
      default: [],
    },
  },
  CM: {
    cities: ['Douala', 'Yaoundé', 'Bafoussam', 'Bamenda', 'Garoua', 'Maroua', 'Ngaoundéré'],
    districts: {
      Douala: ['Akwa', 'Bali', 'Bassa', 'Bonanjo', 'Bonabéri', 'Deïdo', 'Kotto', 'Logbessou', 'Makepe', 'New Bell'],
      Yaoundé: ['Bastos', 'Centre Administratif', 'Essos', 'Melen', 'Mvog-Mbi', 'Nlongkak', 'Tsinga'],
      default: [],
    },
  },
  KE: {
    cities: ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 'Nyeri'],
    districts: {
      Nairobi: ['CBD', 'Eastleigh', 'Gigiri', 'Hurlingham', 'Industrial Area', 'Karen', 'Kilimani', 'Lavington', 'Parklands', 'Westlands'],
      Mombasa: ['Island', 'Likoni', 'Mvita', 'Nyali'],
      default: [],
    },
  },
  BF: {
    cities: ['Ouagadougou', 'Bobo-Dioulasso', 'Koudougou', 'Banfora', 'Ouahigouya'],
    districts: {
      Ouagadougou: ['Baskuy', 'Bogodogo', 'Boulmiougou', 'Nongr-Massom', 'Sig-Noghin', 'Somgandé', 'Taabtenga', 'Wemtenga'],
      'Bobo-Dioulasso': ['Accart-ville', 'Dafra', 'Karandasso', 'Koko', 'Sarfalao'],
      default: [],
    },
  },
  ML: {
    cities: ['Bamako', 'Sikasso', 'Mopti', 'Kayes', 'Ségou', 'Gao'],
    districts: {
      Bamako: ['ACI 2000', 'Badalabougou', 'Banconi', 'Djélibougou', 'Hamdallaye', 'Korofina', 'Lafiabougou', 'Niarela', 'Sogoniko'],
      default: [],
    },
  },
  NE: {
    cities: ['Niamey', 'Zinder', 'Maradi', 'Agadez', 'Tahoua'],
    districts: { default: [] },
  },
  TG: {
    cities: ['Lomé', 'Sokodé', 'Kara', 'Palimé', 'Atakpamé'],
    districts: {
      Lomé: ['Agoè', 'Bè', 'Cacaveli', 'Nyékonakpoè', 'Tokoin'],
      default: [],
    },
  },
  BJ: {
    cities: ['Cotonou', 'Porto-Novo', 'Parakou', 'Abomey-Calavi', 'Bohicon'],
    districts: {
      Cotonou: ['Akpakpa', 'Cadjehoun', 'Dantokpa', 'Fidjrossè', 'Gbèdjromèdji', 'Menontin', 'Zogbo'],
      default: [],
    },
  },
  GA: {
    cities: ['Libreville', 'Port-Gentil', 'Franceville', 'Oyem', 'Moanda'],
    districts: {
      Libreville: ['Akanda', 'Angondjé', 'Centre-ville', 'Glass', 'Louis', 'Oloumi'],
      default: [],
    },
  },
  CG: {
    cities: ['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Nkayi', 'Impfondo'],
    districts: {
      Brazzaville: ['Bacongo', 'Djiri', 'Madibou', 'Makélékélé', 'Mfilou', 'Moungali', 'Ouenzé', 'Poto-Poto', 'Talangaï'],
      default: [],
    },
  },
  TD: {
    cities: ["N'Djamena", 'Moundou', 'Sarh', 'Abéché', 'Kélo'],
    districts: { default: [] },
  },
  GW: {
    cities: ['Bissau', 'Bafatá', 'Gabú', 'Bissorã'],
    districts: { default: [] },
  },
  GQ: {
    cities: ['Malabo', 'Bata', 'Ebebiyín', 'Aconibe'],
    districts: { default: [] },
  },
  CF: {
    cities: ['Bangui', 'Bimbo', 'Mbaïki', 'Berberati', 'Bambari'],
    districts: { default: [] },
  },
}

const inp = {
  width: '100%', padding: '10px 12px',
  background: 'var(--afrikfid-surface-2)',
  border: '1px solid var(--afrikfid-border)',
  borderRadius: 8, color: 'var(--afrikfid-text)',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const lbl = { display: 'block', fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, marginBottom: 5 }

export default function RegisterClient() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    full_name: '', phoneLocal: '', email: '', country_id: 'CI', password: '', password_confirm: '',
    city: '', district: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const selectedCountry = COUNTRIES.find(c => c.id === form.country_id) || COUNTRIES[0]

  const handleCountryChange = (country_id) => {
    setForm(f => ({ ...f, country_id, phoneLocal: '', city: '', district: '' }))
  }

  const geo = GEO_DATA[form.country_id] || { cities: [], districts: { default: [] } }
  const availableCities = geo.cities
  const availableDistricts = form.city
    ? (geo.districts[form.city] || geo.districts.default || [])
    : []

  const fullPhone = form.phoneLocal.trim()
    ? `${selectedCountry.prefix}${form.phoneLocal.replace(/^0+/, '').replace(/\s/g, '')}`
    : ''

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.full_name.trim()) return setError('Nom complet requis.')
    if (!form.phoneLocal.trim()) return setError('Numéro de téléphone requis.')
    if (form.password.length < 6) return setError('Mot de passe : minimum 6 caractères.')
    if (form.password !== form.password_confirm) return setError('Les mots de passe ne correspondent pas.')

    setLoading(true)
    try {
      const { data } = await api.post('/clients', {
        full_name: form.full_name,
        phone: fullPhone,
        email: form.email || undefined,
        country_id: form.country_id,
        password: form.password,
        city: form.city || undefined,
        district: form.district || undefined,
        country_code: form.country_id,
      })
      setSuccess(data.client)
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur lors de la création du compte.')
    } finally { setLoading(false) }
  }

  if (success) return (
    <Screen>
      <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 36, maxWidth: 420, width: '100%', textAlign: 'center', border: '1px solid var(--afrikfid-border)', boxShadow: '0 4px 24px rgba(15, 17, 21,0.1)' }}>
        <SparklesIcon style={{ width: 64, height: 64, margin: '0 auto 16px', color: 'var(--afrikfid-success)', display: 'block' }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--afrikfid-success)', marginBottom: 10, fontFamily: 'Montserrat, sans-serif' }}>Compte créé !</h2>
        <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, marginBottom: 20, border: '1px solid var(--afrikfid-border)' }}>
          <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 6 }}>Votre identifiant Afrik'Fid</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--afrikfid-accent)', fontFamily: 'monospace', letterSpacing: 2 }}>
            {success.afrikfidId}
          </div>
          <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 6 }}>
            Conservez cet identifiant pour payer chez nos marchands partenaires et profiter de vos remises fidélité.
          </div>
        </div>
        <p style={{ color: 'var(--afrikfid-muted)', fontSize: 13, marginBottom: 20 }}>
          Bienvenue <strong style={{ color: 'var(--afrikfid-text)' }}>{success.fullName}</strong> !<br />
          Statut initial : <span style={{ color: '#6B7280', fontWeight: 600 }}>OPEN</span>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => navigate('/login')}
            style={{ padding: '10px 20px', background: 'var(--afrikfid-primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
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
          <img src="/afrikfid-logo.png" alt="AfrikFid" style={{ height: 52, objectFit: 'contain', marginBottom: 10, filter: 'drop-shadow(0 2px 8px rgba(15, 17, 21,0.15))' }} onError={e => { e.target.style.display = 'none' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>Créer un compte client</h1>
          <p style={{ color: 'var(--afrikfid-muted)', fontSize: 13, marginTop: 3 }}>Profitez des remises fidélité chez tous nos marchands partenaires</p>
        </div>

        <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 28, border: '1px solid var(--afrikfid-border)', boxShadow: '0 4px 24px rgba(15, 17, 21,0.08)' }}>
          <form onSubmit={submit}>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Nom complet *</label>
              <input style={inp} value={form.full_name} onChange={e => set('full_name', e.target.value)}
                placeholder="Ex: Kouamé Jean-Baptiste" autoFocus />
            </div>

            {/* Pays */}
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Pays *</label>
              <select style={inp} value={form.country_id} onChange={e => handleCountryChange(e.target.value)}>
                {COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--afrikfid-muted)' }}>
                  Indicatif : <strong style={{ color: 'var(--afrikfid-text)' }}>{selectedCountry.prefix}</strong>
                </span>
                <span style={{ color: 'var(--afrikfid-border)' }}>·</span>
                <span style={{ fontSize: 11, color: 'var(--afrikfid-muted)' }}>
                  Devise : <strong style={{ color: 'var(--afrikfid-accent)' }}>{selectedCountry.currency}</strong>
                </span>
              </div>
            </div>

            {/* Téléphone avec préfixe auto */}
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Téléphone *</label>
              <div style={{ display: 'flex', gap: 0 }}>
                <div style={{
                  padding: '10px 12px', background: 'var(--afrikfid-surface-2)', border: '1px solid var(--afrikfid-border)',
                  borderRight: 'none', borderRadius: '8px 0 0 8px', color: 'var(--afrikfid-muted)',
                  fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', userSelect: 'none',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{selectedCountry.flag}</span>
                  <span>{selectedCountry.prefix}</span>
                </div>
                <input
                  style={{ ...inp, borderRadius: '0 8px 8px 0', flex: 1 }}
                  type="tel"
                  value={form.phoneLocal}
                  onChange={e => set('phoneLocal', e.target.value.replace(/[^\d\s]/g, ''))}
                  placeholder={'0'.repeat(selectedCountry.digits)}
                  maxLength={selectedCountry.digits + 2}
                />
              </div>
              {fullPhone && (
                <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>
                  Numéro complet : <span style={{ color: 'var(--afrikfid-text)', fontFamily: 'monospace' }}>{fullPhone}</span>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Email (optionnel)</label>
              <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="votre@email.com" />
            </div>

            {/* Localisation — ville + quartier selon pays */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={lbl}>Ville <span style={{ color: 'var(--af-border-strong)' }}>(optionnel)</span></label>
                {availableCities.length > 0 ? (
                  <select style={inp} value={form.city} onChange={e => { set('city', e.target.value); set('district', '') }}>
                    <option value="">— Choisir</option>
                    {availableCities.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input style={inp} value={form.city} onChange={e => set('city', e.target.value)}
                    placeholder="Votre ville" />
                )}
              </div>
              <div>
                <label style={lbl}>Quartier / Commune <span style={{ color: 'var(--af-border-strong)' }}>(optionnel)</span></label>
                {availableDistricts.length > 0 ? (
                  <select style={inp} value={form.district} onChange={e => set('district', e.target.value)}>
                    <option value="">— Choisir</option>
                    {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                ) : (
                  <input style={inp} value={form.district} onChange={e => set('district', e.target.value)}
                    placeholder={form.city ? 'Votre quartier' : 'Choisir une ville d\'abord'}
                    disabled={availableCities.length > 0 && !form.city} />
                )}
              </div>
            </div>
            {(form.city || form.district) && (
              <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 14, padding: '6px 10px', background: 'var(--afrikfid-surface-2)', borderRadius: 6, border: '1px solid var(--afrikfid-border)' }}>
                Zone de chalandise : <strong style={{ color: 'var(--afrikfid-text)' }}>{[form.city, form.district].filter(Boolean).join(' — ')}</strong>
                {' '}— utilisée pour la cartographie de votre marchand.
              </div>
            )}

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
            <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 14, marginBottom: 20, border: '1px solid var(--afrikfid-border)' }}>
              <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>PROGRAMME DE FIDÉLITÉ AFRIK'FID</div>
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
                      <div style={{ fontSize: 10, color: 'var(--af-text-muted)' }}>{s.pct} de remise</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 12, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{ width: '100%', padding: '13px', background: loading ? 'var(--afrikfid-border)' : 'var(--afrikfid-primary)', border: 'none', borderRadius: 9, color: loading ? 'var(--afrikfid-muted)' : '#fff', fontWeight: 700, cursor: loading ? 'default' : 'pointer', fontSize: 15 }}>
              {loading ? 'Création...' : "Créer mon compte Afrik'Fid"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--afrikfid-muted)', marginTop: 16 }}>
          Déjà un compte ?{' '}
          <Link to="/login" style={{ color: 'var(--afrikfid-accent)', fontWeight: 600, textDecoration: 'none' }}>Se connecter</Link>
          {' · '}
          <Link to="/register" style={{ color: 'var(--afrikfid-muted)', textDecoration: 'none' }}>Inscription marchand</Link>
        </p>
      </div>
    </Screen>
  )
}

function Screen({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--af-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      {children}
    </div>
  )
}
