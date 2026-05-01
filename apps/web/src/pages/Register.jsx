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
  { id: 'TD', name: 'Tchad',         currency: 'XAF', flag: '🇹🇩' },
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
  width: '100%', padding: '10px 12px',
  background: 'var(--afrikfid-surface-2)',
  border: '1px solid var(--afrikfid-border)',
  borderRadius: 8, color: 'var(--afrikfid-text)',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const sel = { ...inp }
const lbl = { display: 'block', fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, marginBottom: 5 }

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
      <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 40, maxWidth: 440, width: '100%', textAlign: 'center', border: '1px solid var(--afrikfid-border)', boxShadow: '0 4px 24px rgba(15, 17, 21,0.1)' }}>
        <SparklesIcon style={{ width: 64, height: 64, margin: '0 auto 16px', color: 'var(--afrikfid-success)', display: 'block' }} />
        <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--afrikfid-success)', marginBottom: 10, fontFamily: 'Montserrat, sans-serif' }}>Demande envoyée !</h2>
        <p style={{ color: 'var(--afrikfid-muted)', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
          Votre demande d'inscription a bien été reçue.<br />
          Notre équipe va vérifier votre dossier sous <strong style={{ color: 'var(--afrikfid-accent)' }}>24-48h</strong>.<br />
          Vous recevrez vos identifiants par email dès validation.
        </p>
        <Link to="/login" style={{ display: 'inline-block', padding: '10px 24px', background: 'var(--afrikfid-primary)', borderRadius: 8, color: '#fff', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>
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
          <img src="/afrikfid-logo.png" alt="AfrikFid" style={{ height: 52, objectFit: 'contain', marginBottom: 10, filter: 'drop-shadow(0 2px 8px rgba(15, 17, 21,0.15))' }} onError={e => { e.target.style.display = 'none' }} />
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>Rejoindre Afrik'Fid</h1>
          <p style={{ color: 'var(--afrikfid-muted)', fontSize: 13, marginTop: 3 }}>Inscription marchand — Gratuit, sans engagement</p>
        </div>

        {/* Barre de progression */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 24 }}>
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  background: i < step ? 'var(--afrikfid-success)' : i === step ? 'var(--afrikfid-primary)' : 'var(--afrikfid-surface-2)',
                  color: i <= step ? '#fff' : 'var(--afrikfid-muted)',
                  border: '2px solid ' + (i === step ? 'var(--afrikfid-primary)' : i < step ? 'var(--afrikfid-success)' : 'var(--afrikfid-border)'),
                }}>{i < step ? '✓' : i + 1}</div>
                <span style={{ fontSize: 10, color: i === step ? 'var(--afrikfid-text)' : 'var(--afrikfid-muted)' }}>{s}</span>
              </div>
              {i < 3 && <div style={{ width: 16, height: 1, background: 'var(--afrikfid-border)' }} />}
            </React.Fragment>
          ))}
        </div>

        <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 28, border: '1px solid var(--afrikfid-border)', boxShadow: '0 4px 24px rgba(15, 17, 21,0.08)' }}>

          {/* STEP 0: Entreprise */}
          {step === 0 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)', marginBottom: 20, fontFamily: 'Montserrat, sans-serif' }}>Votre entreprise</h2>
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
                      <span style={{ fontSize: 10, color: 'var(--afrikfid-muted)' }}>Devise :</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--afrikfid-accent)', background: 'rgba(227,6,19,0.1)', border: '1px solid rgba(227,6,19,0.3)', borderRadius: 4, padding: '2px 7px' }}>{country.currency}</span>
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
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)', marginBottom: 6, fontFamily: 'Montserrat, sans-serif' }}>Programme de fidélité</h2>
              <p style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 16, lineHeight: 1.6 }}>
                Définissez votre taux X% (remise marchand). Afrik'Fid répartit automatiquement ce taux entre votre client (Y%) et la plateforme (Z = X − Y). <strong style={{ color: 'var(--af-text)' }}>Vous ne payez que X% par transaction réussie.</strong>
              </p>

              {/* Visuel X/Y/Z */}
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, marginBottom: 20, border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ fontSize: 11, color: 'var(--afrikfid-accent)', marginBottom: 10, fontWeight: 700 }}>RÈGLE FONDAMENTALE : X = Y + Z</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center', background: 'var(--afrikfid-surface)', borderRadius: 8, padding: 10, border: '1px solid rgba(239,68,68,0.2)' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>X = {form.rebate_percent}%</div>
                    <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', marginTop: 4, lineHeight: 1.4 }}>Remise marchand<br/><span style={{ color: 'var(--afrikfid-muted)' }}>Négociée avec Afrik'Fid</span></div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'var(--afrikfid-surface)', borderRadius: 8, padding: 10, border: '1px solid rgba(59,130,246,0.2)' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#3b82f6' }}>Y ≤ X</div>
                    <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', marginTop: 4, lineHeight: 1.4 }}>Remise client<br/><span style={{ color: 'var(--afrikfid-muted)' }}>Selon son statut fidélité (0–12%)</span></div>
                  </div>
                  <div style={{ textAlign: 'center', background: 'var(--afrikfid-surface)', borderRadius: 8, padding: 10, border: '1px solid rgba(16,185,129,0.2)' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--afrikfid-success)' }}>Z = X−Y</div>
                    <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', marginTop: 4, lineHeight: 1.4 }}>Commission Afrik'Fid<br/><span style={{ color: 'var(--afrikfid-muted)' }}>Toujours ≥ 0</span></div>
                  </div>
                </div>
                {/* Barème clients */}
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginBottom: 8, fontWeight: 600 }}>BARÈME Y% SELON STATUT CLIENT</div>
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
                        <div style={{ fontSize: 9, color: 'var(--af-text-muted)', marginTop: 2 }}>Y = {s.y}%</div>
                        <div style={{ fontSize: 9, color: z >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>Z = {z >= 0 ? '+' : ''}{z.toFixed(1)}%</div>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', borderTop: '1px solid var(--afrikfid-border)', paddingTop: 10 }}>
                  Vous recevez toujours : <strong style={{ color: 'var(--afrikfid-text)' }}>100% − {form.rebate_percent}% = {(100 - parseFloat(form.rebate_percent || 0)).toFixed(1)}%</strong> du montant brut de chaque transaction.
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Taux de remise X (%) — négocié avec Afrik'Fid *</label>
                <input style={inp} type="number" min="1" step="0.5"
                  value={form.rebate_percent} onChange={e => set('rebate_percent', e.target.value)} />
                <input type="range" min="1" max="50" step="0.5" value={Math.min(form.rebate_percent, 50)}
                  onChange={e => set('rebate_percent', parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: 8, accentColor: 'var(--af-accent)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>
                  <span>1%</span>
                  <span style={{ color: form.rebate_percent < 12 ? '#ef4444' : 'var(--af-accent)', fontWeight: 700 }}>{form.rebate_percent}% (X choisi)</span>
                  <span>50%+</span>
                </div>
                {form.rebate_percent < 12 && (
                  <div style={{ fontSize: 10, color: 'var(--af-accent)', marginTop: 4, background: 'rgba(245,158,11,0.08)', borderRadius: 6, padding: '5px 8px' }}>
                    ⚠ En dessous de 12%, les clients ROYAL (Y=12%) ne pourront pas être pleinement remboursés — Z deviendrait négatif. Minimum recommandé : 12%.
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 6 }}>
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
                      style={{ padding: '14px 12px', border: '2px solid ' + (form.rebate_mode === m.value ? 'var(--afrikfid-accent)' : 'var(--afrikfid-border)'), borderRadius: 10, background: form.rebate_mode === m.value ? 'rgba(227,6,19,0.07)' : 'var(--afrikfid-surface-2)', cursor: 'pointer', textAlign: 'left' }}>
                      <m.Icon style={{ width: 24, height: 24, marginBottom: 6, color: form.rebate_mode === m.value ? 'var(--afrikfid-accent)' : 'var(--afrikfid-muted)' }} />
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--afrikfid-text)', marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', marginBottom: 6, lineHeight: 1.5 }}>{m.desc}</div>
                      <div style={{ fontSize: 9, color: 'var(--afrikfid-muted)', background: 'var(--afrikfid-surface)', borderRadius: 4, padding: '3px 6px', fontFamily: 'monospace', border: '1px solid var(--afrikfid-border)' }}>{m.example}</div>
                      <div style={{ marginTop: 6, fontSize: 9, color: form.rebate_mode === m.value ? 'var(--afrikfid-accent)' : 'var(--afrikfid-muted)', fontWeight: 600 }}>{m.badge}</div>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--afrikfid-muted)', background: 'var(--afrikfid-surface-2)', borderRadius: 6, padding: '6px 10px', border: '1px solid var(--afrikfid-border)' }}>
                  Ce mode est configurable par le marchand et s'applique à toutes les transactions de votre enseigne.
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <label style={lbl}>URL Webhook (optionnel)</label>
                <input style={inp} type="url" value={form.webhook_url}
                  onChange={e => set('webhook_url', e.target.value)}
                  placeholder="https://votre-api.com/webhooks/afrikfid" />
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 6, lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--af-text-muted)' }}>À quoi ça sert ?</strong> Afrik'Fid envoie une notification signée (HMAC-SHA256) à cette URL après chaque événement : paiement confirmé, remboursement, changement de statut fidélité, etc. Cela permet à votre système (caisse, ERP, site e-commerce) d'être mis à jour automatiquement sans avoir à interroger l'API.<br/>
                  <span style={{ color: 'var(--af-text-muted)' }}>Peut être configuré ou modifié plus tard dans vos paramètres.</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Sécurité */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)', marginBottom: 20, fontFamily: 'Montserrat, sans-serif' }}>Sécurité du compte</h2>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Mot de passe *</label>
                <input style={inp} type="password" value={form.password}
                  onChange={e => set('password', e.target.value)} placeholder="Minimum 8 caractères" />
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 4 }}>
                  Choisissez un mot de passe fort: majuscules, chiffres et caractères spéciaux recommandés.
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Confirmer le mot de passe *</label>
                <input style={inp} type="password" value={form.password_confirm}
                  onChange={e => set('password_confirm', e.target.value)} placeholder="Répétez le mot de passe" />
              </div>

              {/* Récap */}
              <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 14, marginBottom: 16, border: '1px solid var(--afrikfid-border)' }}>
                <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, marginBottom: 10 }}>RÉCAPITULATIF</div>
                {[
                  ['Entreprise', form.name],
                  ['Email', form.email],
                  ['Pays', country ? `${country.flag} ${country.name}` : form.country_id],
                  ['Devise', country?.currency || '—'],
                  ['Remise X', `${form.rebate_percent}%`],
                  ['Mode', form.rebate_mode === 'cashback' ? 'Cashback différé' : 'Remise immédiate'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                    <span style={{ color: 'var(--afrikfid-muted)' }}>{k}</span>
                    <span style={{ color: 'var(--afrikfid-text)', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.terms} onChange={e => set('terms', e.target.checked)}
                  style={{ marginTop: 2, accentColor: 'var(--afrikfid-primary)', width: 14, height: 14 }} />
                <span style={{ fontSize: 12, color: 'var(--afrikfid-muted)', lineHeight: 1.6 }}>
                  J'accepte les <span style={{ color: 'var(--afrikfid-accent)', cursor: 'pointer' }}>conditions d'utilisation</span> et la{' '}
                  <span style={{ color: 'var(--afrikfid-accent)', cursor: 'pointer' }}>politique de confidentialité</span> d'Afrik'Fid.
                </span>
              </label>
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 14px', color: '#ef4444', fontSize: 12, marginTop: 16 }}>
              {error}
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {step > 0 && (
              <button onClick={prev}
                style={{ padding: '11px 18px', background: 'transparent', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                ← Retour
              </button>
            )}
            {step < 2 ? (
              <button onClick={next}
                style={{ flex: 1, padding: '12px', background: 'var(--afrikfid-primary)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                Suivant →
              </button>
            ) : (
              <button onClick={submit} disabled={loading}
                style={{ flex: 1, padding: '12px', background: loading ? 'var(--afrikfid-border)' : 'var(--afrikfid-primary)', border: 'none', borderRadius: 8, color: loading ? 'var(--afrikfid-muted)' : '#fff', fontWeight: 700, cursor: loading ? 'default' : 'pointer', fontSize: 14 }}>
                {loading ? 'Envoi en cours...' : 'Envoyer ma demande'}
              </button>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--afrikfid-muted)', marginTop: 16 }}>
          Déjà inscrit ?{' '}
          <Link to="/login" style={{ color: 'var(--afrikfid-accent)', fontWeight: 600, textDecoration: 'none' }}>Se connecter</Link>
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
