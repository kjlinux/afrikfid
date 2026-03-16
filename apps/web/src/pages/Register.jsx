import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { SparklesIcon, BoltIcon, BanknotesIcon } from '@heroicons/react/24/outline'

const COUNTRIES = [
  { id: 'CI', name: "Côte d'Ivoire", currency: 'XOF', flag: '🇨🇮' },
  { id: 'SN', name: 'Sénégal',       currency: 'XOF', flag: '🇸🇳' },
  { id: 'BJ', name: 'Bénin',         currency: 'XOF', flag: '🇧🇯' },
  { id: 'ML', name: 'Mali',          currency: 'XOF', flag: '🇲🇱' },
  { id: 'BF', name: 'Burkina Faso',  currency: 'XOF', flag: '🇧🇫' },
  { id: 'TG', name: 'Togo',          currency: 'XOF', flag: '🇹🇬' },
  { id: 'GN', name: 'Guinée',        currency: 'XOF', flag: '🇬🇳' },
  { id: 'CM', name: 'Cameroun',      currency: 'XAF', flag: '🇨🇲' },
  { id: 'CG', name: 'Congo',         currency: 'XAF', flag: '🇨🇬' },
  { id: 'GA', name: 'Gabon',         currency: 'XAF', flag: '🇬🇦' },
  { id: 'KE', name: 'Kenya',         currency: 'KES', flag: '🇰🇪' },
]

const CATEGORIES = [
  'retail', 'restaurant', 'pharmacie', 'telecom', 'education',
  'sante', 'transport', 'ecommerce', 'services', 'autre',
]

const STEPS = ['Entreprise', 'Fidélité', 'Sécurité', 'Confirmation']

const inp = {
  width: '100%', padding: '10px 12px', background: '#0f172a',
  border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const sel = { ...inp }
const lbl = { display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 5 }

export default function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [form, setForm] = useState({
    name: '', email: '', phone: '', country_id: 'CI',
    category: 'retail', website: '',
    rebate_percent: 5, rebate_mode: 'cashback',
    webhook_url: '',
    password: '', password_confirm: '',
    terms: false,
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const validateStep = () => {
    setError('')
    if (step === 0) {
      if (!form.name.trim()) return setError('Le nom de l\'entreprise est requis.')
      if (!form.email.includes('@')) return setError('Email invalide.')
      if (!form.phone.startsWith('+')) return setError('Numéro de téléphone avec indicatif (ex: +225...)')
      if (!form.country_id) return setError('Pays requis.')
      return true
    }
    if (step === 1) {
      if (form.rebate_percent < 1) return setError('Le taux X doit être d\'au moins 1%.')
      if (form.rebate_percent < 12) return setError('Attention : un taux X inférieur à 12% empêche les clients ROYAL de bénéficier de leur remise complète (Y=12%). Minimum recommandé : 12%.')
      return true
    }
    if (step === 2) {
      if (form.password.length < 8) return setError('Mot de passe: minimum 8 caractères.')
      if (form.password !== form.password_confirm) return setError('Les mots de passe ne correspondent pas.')
      if (!form.terms) return setError('Veuillez accepter les conditions d\'utilisation.')
      return true
    }
    return true
  }

  const next = () => { if (validateStep()) setStep(s => s + 1) }
  const prev = () => setStep(s => s - 1)

  const submit = async () => {
    if (!validateStep()) return
    setLoading(true); setError('')
    try {
      // L'inscription crée un compte en statut "pending" — admin doit activer
      const res = await fetch('/api/v1/merchants/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          country_id: form.country_id,
          category: form.category,
          website: form.website || undefined,
          rebate_percent: parseFloat(form.rebate_percent),
          rebate_mode: form.rebate_mode,
          webhook_url: form.webhook_url || undefined,
          password: form.password,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || 'Erreur inscription')
      setSuccess(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (success) return (
    <Screen>
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 40, maxWidth: 440, width: '100%', textAlign: 'center', border: '1px solid #334155' }}>
        <SparklesIcon className="w-16 h-16 mx-auto text-emerald-500" style={{ marginBottom: 16 }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#10b981', marginBottom: 10 }}>Demande envoyée !</h2>
        <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
          Votre demande d'inscription a bien été reçue.<br />
          Notre équipe va vérifier votre dossier sous <strong style={{ color: '#f59e0b' }}>24-48h</strong>.<br />
          Vous recevrez vos identifiants par email dès validation.
        </p>
        <Link to="/login" style={{ display: 'inline-block', padding: '10px 24px', background: '#f59e0b', borderRadius: 8, color: '#0f172a', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>
          Retour à la connexion
        </Link>
      </div>
    </Screen>
  )

  const country = COUNTRIES.find(c => c.id === form.country_id)

  return (
    <Screen>
      <div style={{ width: '100%', maxWidth: 520 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>A</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f1f5f9' }}>Rejoindre Afrik'Fid</h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 3 }}>Inscription marchand — Gratuit, sans engagement</p>
        </div>

        {/* Barre de progression */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 24 }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  background: i < step ? '#10b981' : i === step ? '#f59e0b' : '#1e293b',
                  color: i <= step ? '#0f172a' : '#64748b',
                  border: '2px solid ' + (i === step ? '#f59e0b' : i < step ? '#10b981' : '#334155'),
                }}>{i < step ? '✓' : i + 1}</div>
                <span style={{ fontSize: 10, color: i === step ? '#f1f5f9' : '#64748b' }}>{s}</span>
              </div>
              {i < 3 && <div style={{ width: 16, height: 1, background: '#334155' }} />}
            </React.Fragment>
          ))}
        </div>

        <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, border: '1px solid #334155' }}>

          {/* STEP 0: Entreprise */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 20 }}>Votre entreprise</h2>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Nom de l'entreprise *</label>
                <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Boutique Koffi SARL" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={lbl}>Email professionnel *</label>
                  <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="contact@entreprise.ci" />
                </div>
                <div>
                  <label style={lbl}>Téléphone *</label>
                  <input style={inp} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+2250700000000" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={lbl}>Pays *</label>
                  <select style={sel} value={form.country_id} onChange={e => set('country_id', e.target.value)}>
                    {COUNTRIES.map(c => <option key={c.id} value={c.id}>{c.flag} {c.name} ({c.currency})</option>)}
                  </select>
                  {country && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#64748b' }}>Devise :</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 4, padding: '2px 7px' }}>{country.currency}</span>
                    </div>
                  )}
                </div>
                <div>
                  <label style={lbl}>Catégorie *</label>
                  <select style={sel} value={form.category} onChange={e => set('category', e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Site web (optionnel)</label>
                <input style={inp} type="url" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://votreentreprise.ci" />
              </div>
            </div>
          )}

          {/* STEP 1: Fidélité */}
          {step === 1 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 6 }}>Programme de fidélité</h2>
              <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 1.6 }}>
                Définissez votre taux X% (remise marchand). Afrik'Fid répartit automatiquement ce taux entre votre client (Y%) et la plateforme (Z = X − Y). <strong style={{ color: '#f1f5f9' }}>Vous ne payez que X% par transaction réussie.</strong>
              </p>

              {/* Visuel X/Y/Z */}
              <div style={{ background: '#0f172a', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 10, fontWeight: 700, letterSpacing: '0.05em' }}>RÈGLE FONDAMENTALE : X = Y + Z</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>X = {form.rebate_percent}%</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>Remise marchand<br/><span style={{ color: '#64748b' }}>Négociée avec Afrik'Fid</span></div>
                  </div>
                  <div style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6' }}>Y ≤ X</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>Remise client<br/><span style={{ color: '#64748b' }}>Selon son statut fidélité (0–12%)</span></div>
                  </div>
                  <div style={{ textAlign: 'center', background: '#1e293b', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>Z = X−Y</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>Commission Afrik'Fid<br/><span style={{ color: '#64748b' }}>Toujours ≥ 0</span></div>
                  </div>
                </div>
                {/* Barème clients */}
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, fontWeight: 600 }}>BARÈME Y% SELON STATUT CLIENT</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
                  {[
                    { status: 'OPEN', y: 0, color: '#6B7280' },
                    { status: 'LIVE', y: 5, color: '#3B82F6' },
                    { status: 'GOLD', y: 8, color: '#F59E0B' },
                    { status: 'ROYAL', y: 12, color: '#8B5CF6' },
                  ].map(s => {
                    const z = parseFloat(form.rebate_percent) - s.y
                    return (
                      <div key={s.status} style={{ background: s.color + '15', border: '1px solid ' + s.color + '40', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: s.color }}>{s.status}</div>
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Y = {s.y}%</div>
                        <div style={{ fontSize: 9, color: z >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>Z = {z >= 0 ? '+' : ''}{z.toFixed(1)}%</div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                  Vous recevez toujours : <strong style={{ color: '#f1f5f9' }}>100% − {form.rebate_percent}% = {(100 - parseFloat(form.rebate_percent || 0)).toFixed(1)}%</strong> du montant brut de chaque transaction.
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Taux de remise X (%) — négocié avec Afrik'Fid *</label>
                <input style={inp} type="number" min="1" step="0.5"
                  value={form.rebate_percent} onChange={e => set('rebate_percent', e.target.value)} />
                <input type="range" min="1" max="50" step="0.5" value={Math.min(form.rebate_percent, 50)}
                  onChange={e => set('rebate_percent', parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: 8, accentColor: '#f59e0b' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  <span>1%</span>
                  <span style={{ color: form.rebate_percent < 12 ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>{form.rebate_percent}% (X choisi)</span>
                  <span>50%+</span>
                </div>
                {form.rebate_percent < 12 && (
                  <div style={{ fontSize: 10, color: '#f59e0b', marginTop: 4, background: 'rgba(245,158,11,0.08)', borderRadius: 6, padding: '5px 8px' }}>
                    ⚠ En dessous de 12%, les clients ROYAL (Y=12%) ne pourront pas être pleinement remboursés — Z deviendrait négatif. Minimum recommandé : 12%.
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
                  Ce taux est indicatif et sera validé contractuellement avec l'équipe Afrik'Fid lors de l'activation de votre compte.
                </div>
              </div>

              <div>
                <label style={lbl}>Mode de remise client *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                  {[
                    {
                      value: 'immediate',
                      label: 'Remise immédiate',
                      Icon: BoltIcon,
                      desc: 'Le montant Y% est déduit du prix au moment du paiement. Le client paie directement le montant réduit.',
                      example: '10 000 XOF → client paie 8 800 XOF (Y=12%)',
                      badge: 'Idéal en magasin',
                    },
                    {
                      value: 'cashback',
                      label: 'Cashback différé',
                      Icon: BanknotesIcon,
                      desc: 'Le client paie le montant intégral. Le Y% est crédité sur son portefeuille Afrik\'Fid pour un prochain achat.',
                      example: '10 000 XOF payés → 1 200 XOF crédités (Y=12%)',
                      badge: 'Renforce la fidélisation',
                    },
                  ].map(m => (
                    <button key={m.value} type="button" onClick={() => set('rebate_mode', m.value)}
                      style={{ padding: '14px 12px', border: '2px solid ' + (form.rebate_mode === m.value ? '#f59e0b' : '#334155'), borderRadius: 10, background: form.rebate_mode === m.value ? 'rgba(245,158,11,0.08)' : '#0f172a', cursor: 'pointer', textAlign: 'left' }}>
                      <m.Icon className="w-6 h-6" style={{ marginBottom: 6 }} />
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6, lineHeight: 1.5 }}>{m.desc}</div>
                      <div style={{ fontSize: 9, color: '#64748b', background: '#1e293b', borderRadius: 4, padding: '3px 6px', fontFamily: 'monospace' }}>{m.example}</div>
                      <div style={{ marginTop: 6, fontSize: 9, color: form.rebate_mode === m.value ? '#f59e0b' : '#64748b', fontWeight: 600 }}>{m.badge}</div>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', background: '#0f172a', borderRadius: 6, padding: '6px 10px' }}>
                  Ce mode est configurable par le marchand et s'applique à toutes les transactions de votre enseigne.
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={lbl}>URL Webhook (optionnel)</label>
                <input style={inp} type="url" value={form.webhook_url}
                  onChange={e => set('webhook_url', e.target.value)}
                  placeholder="https://votre-api.com/webhooks/afrikfid" />
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.6 }}>
                  <strong style={{ color: '#94a3b8' }}>À quoi ça sert ?</strong> Afrik'Fid envoie une notification signée (HMAC-SHA256) à cette URL après chaque événement : paiement confirmé, remboursement, changement de statut fidélité, etc. Cela permet à votre système (caisse, ERP, site e-commerce) d'être mis à jour automatiquement sans avoir à interroger l'API.<br/>
                  <span style={{ color: '#64748b' }}>Peut être configuré ou modifié plus tard dans vos paramètres.</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Sécurité */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 20 }}>Sécurité du compte</h2>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Mot de passe *</label>
                <input style={inp} type="password" value={form.password}
                  onChange={e => set('password', e.target.value)} placeholder="Minimum 8 caractères" />
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
                  Choisissez un mot de passe fort: majuscules, chiffres et caractères spéciaux recommandés.
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Confirmer le mot de passe *</label>
                <input style={inp} type="password" value={form.password_confirm}
                  onChange={e => set('password_confirm', e.target.value)} placeholder="Répétez le mot de passe" />
              </div>

              {/* Récap */}
              <div style={{ background: '#0f172a', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 10 }}>RÉCAPITULATIF</div>
                {[
                  ['Entreprise', form.name],
                  ['Email', form.email],
                  ['Pays', country ? `${country.flag} ${country.name}` : form.country_id],
                  ['Devise', country?.currency || '—'],
                  ['Remise X', `${form.rebate_percent}%`],
                  ['Mode', form.rebate_mode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                    <span style={{ color: '#64748b' }}>{k}</span>
                    <span style={{ color: '#f1f5f9', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.terms} onChange={e => set('terms', e.target.checked)}
                  style={{ marginTop: 2, accentColor: '#f59e0b', width: 14, height: 14 }} />
                <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                  J'accepte les <span style={{ color: '#f59e0b', cursor: 'pointer' }}>conditions d'utilisation</span> et la{' '}
                  <span style={{ color: '#f59e0b', cursor: 'pointer' }}>politique de confidentialité</span> d'Afrik'Fid.
                </span>
              </label>
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 12, marginTop: 16 }}>
              {error}
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {step > 0 && (
              <button onClick={prev}
                style={{ padding: '11px 18px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                ← Retour
              </button>
            )}
            {step < 2 ? (
              <button onClick={next}
                style={{ flex: 1, padding: '12px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                Suivant →
              </button>
            ) : (
              <button onClick={submit} disabled={loading}
                style={{ flex: 1, padding: '12px', background: loading ? '#334155' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 8, color: loading ? '#64748b' : '#fff', fontWeight: 700, cursor: loading ? 'default' : 'pointer', fontSize: 14 }}>
                {loading ? 'Envoi en cours...' : 'Envoyer ma demande'}
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#64748b', marginTop: 16 }}>
          Déjà inscrit ?{' '}
          <Link to="/login" style={{ color: '#f59e0b', fontWeight: 600, textDecoration: 'none' }}>Se connecter</Link>
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
