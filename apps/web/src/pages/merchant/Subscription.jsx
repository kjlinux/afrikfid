import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Badge, Button, Spinner, Modal, Alert, Select } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import {
  ExclamationTriangleIcon, CheckIcon,
  GiftIcon, ChartBarIcon, BellAlertIcon, MegaphoneIcon, DocumentTextIcon, CogIcon,
} from '@heroicons/react/24/outline'

const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium Performance' }
const PKG_RANK = { STARTER_BOOST: 0, STARTER_PLUS: 1, GROWTH: 2, PREMIUM: 3 }
const PKG_COLORS = { STARTER_BOOST: 'yellow', STARTER_PLUS: 'blue', GROWTH: 'green', PREMIUM: 'purple' }

// Couleurs et gradients par plan
const PKG_THEME = {
  STARTER_BOOST: { border: '#e2b93b', accent: '#c9962a', bg: 'rgba(226,185,59,0.07)', badge: '#c9962a', tag: null },
  STARTER_PLUS:  { border: '#3b82f6', accent: '#2563eb', bg: 'rgba(59,130,246,0.07)', badge: '#2563eb', tag: null },
  GROWTH:        { border: '#22c55e', accent: '#16a34a', bg: 'rgba(34,197,94,0.07)',  badge: '#16a34a', tag: 'POPULAIRE' },
  PREMIUM:       { border: 'var(--af-accent)', accent: 'var(--af-accent)', bg: 'rgba(var(--af-accent-rgb,139,92,246),0.07)', badge: 'var(--af-accent)', tag: 'MEILLEUR RAPPORT' },
}

// Description courte sous le nom
const PKG_TAGLINE = {
  STARTER_BOOST: 'Pour démarrer et fidéliser vos premiers clients',
  STARTER_PLUS:  'Suivez vos clients en temps réel et anticipez les départs',
  GROWTH:        'Analysez, segmentez et relancez automatiquement',
  PREMIUM:       'Pilotez votre croissance avec des données avancées',
}

// Features par plan — langage marchand, pas technique
// true = inclus, false = non inclus, string = précision
const SECTION_ICONS = { GiftIcon, ChartBarIcon, BellAlertIcon, MegaphoneIcon, DocumentTextIcon, CogIcon }

const PKG_FEATURES = [
  {
    group: 'Programme de fidélité', icon: 'GiftIcon',
    rows: [
      { label: 'Carte de fidélité digitale pour vos clients',        STARTER_BOOST: true, STARTER_PLUS: true, GROWTH: true, PREMIUM: true },
      { label: 'Statuts clients (Bronze → Gold → Royal)',            STARTER_BOOST: true, STARTER_PLUS: true, GROWTH: true, PREMIUM: true },
      { label: 'Remises automatiques par palier',                    STARTER_BOOST: true, STARTER_PLUS: true, GROWTH: true, PREMIUM: true },
      { label: 'Notifications clients (SMS, email, push)',           STARTER_BOOST: true, STARTER_PLUS: true, GROWTH: true, PREMIUM: true },
    ],
  },
  {
    group: 'Suivi & analyses', icon: 'ChartBarIcon',
    rows: [
      { label: 'Score fidélité mensuel',                            STARTER_BOOST: true,         STARTER_PLUS: true,          GROWTH: true,         PREMIUM: true },
      { label: 'Tableau de bord en temps réel',                     STARTER_BOOST: false,        STARTER_PLUS: true,          GROWTH: true,         PREMIUM: true },
      { label: 'Taux de retour de vos clients',                     STARTER_BOOST: false,        STARTER_PLUS: true,          GROWTH: true,         PREMIUM: true },
      { label: 'Vos meilleurs clients (classement)',                STARTER_BOOST: false,        STARTER_PLUS: true,          GROWTH: true,         PREMIUM: true },
      { label: 'Segmentation RFM automatique (6 profils)',          STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
      { label: 'Valeur à vie de chaque client (LTV)',               STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: false,        PREMIUM: true },
      { label: 'Analyse des prix les plus efficaces',               STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: false,        PREMIUM: true },
      { label: 'Cartographie de vos zones de chalandise',           STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: false,        PREMIUM: true },
    ],
  },
  {
    group: 'Alertes & prévention', icon: 'BellAlertIcon',
    rows: [
      { label: 'Alertes clients sur le départ',                     STARTER_BOOST: false,        STARTER_PLUS: '⚠ Basiques',  GROWTH: '✓ Prédictives', PREMIUM: '✓ Prédictives' },
      { label: 'Prédiction IA : qui va partir prochainement',       STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
    ],
  },
  {
    group: 'Campagnes & relances', icon: 'MegaphoneIcon',
    rows: [
      { label: 'Campagnes de relance automatiques',                 STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
      { label: 'Messages de bienvenue automatiques',                STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
      { label: 'Rappels d\'anniversaire clients',                   STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
      { label: 'Récupération automatique des clients perdus',       STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
      { label: 'Recommandations IA hebdomadaires',                  STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
    ],
  },
  {
    group: 'Rapports', icon: 'DocumentTextIcon',
    rows: [
      { label: 'Rapport de performance périodique',                 STARTER_BOOST: false,        STARTER_PLUS: '1 / an',      GROWTH: '2 / an',     PREMIUM: '4 / an' },
      { label: 'Liste prioritaire de clients à contacter',          STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: true,         PREMIUM: true },
    ],
  },
  {
    group: 'Intégrations & support', icon: 'CogIcon',
    rows: [
      { label: 'Paiement Mobile Money & carte bancaire',            STARTER_BOOST: true,         STARTER_PLUS: true,          GROWTH: true,         PREMIUM: true },
      { label: 'Accès API temps réel',                              STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: false,        PREMIUM: true },
      { label: 'Intégration ERP / CRM',                             STARTER_BOOST: false,        STARTER_PLUS: false,         GROWTH: false,        PREMIUM: true },
    ],
  },
]

const MM_OPERATORS = [
  { code: 'ORANGE', label: 'Orange Money' },
  { code: 'MTN', label: 'MTN MoMo' },
  { code: 'WAVE', label: 'Wave' },
  { code: 'MOOV', label: 'Moov Money' },
  { code: 'AIRTEL', label: 'Airtel Money' },
  { code: 'MPESA', label: 'M-Pesa' },
]

function fmtFCFA(n) { return Number(n || 0).toLocaleString('fr-FR') + ' FCFA' }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('fr-FR') : '—' }

function FeatureValue({ val }) {
  if (val === true)  return <CheckIcon style={{ width: 18, height: 18, color: '#22c55e', margin: '0 auto', display: 'block' }} />
  if (val === false) return <span style={{ color: 'var(--af-text-muted)', fontSize: 16, display: 'block', textAlign: 'center' }}>—</span>
  return <span style={{ fontSize: 11, color: 'var(--af-text-muted)', display: 'block', textAlign: 'center', fontWeight: 600 }}>{val}</span>
}

function CheckoutModal({ open, target, cycle, onClose, onSuccess }) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState('stripe')
  const [phone, setPhone] = useState('')
  const [operator, setOperator] = useState('ORANGE')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !target) return
    setLoading(true); setError(''); setQuote(null)
    api.post('/subscriptions/me/quote', { package: target, billing_cycle: cycle, mode: 'auto' })
      .then(r => setQuote(r.data))
      .catch(err => setError(err.response?.data?.error || 'Erreur lors du calcul du devis'))
      .finally(() => setLoading(false))
  }, [open, target, cycle])

  const submit = async () => {
    setSubmitting(true); setError('')
    try {
      const body = { package: target, billing_cycle: cycle, mode: 'auto', provider }
      if (quote?.kind !== 'free' && provider === 'mobile_money') { body.phone = phone; body.operator = operator }
      const { data } = await api.post('/subscriptions/me/checkout', body)
      if (data.checkout_url) { window.location.href = data.checkout_url; return }
      onSuccess(data)
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Erreur de paiement')
    } finally { setSubmitting(false) }
  }

  if (!open) return null
  const theme = PKG_THEME[target] || {}
  return (
    <Modal open title={`Souscrire — ${PKG_LABELS[target]}`} onClose={onClose}>
      {loading && <Spinner />}
      {error && <Alert type="error">{error}</Alert>}
      {quote && (
        <>
          <div style={{ background: theme.bg, border: `1px solid ${theme.border}`, padding: 16, borderRadius: 12, marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 4 }}>{quote.description}</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: quote.kind === 'free' ? '#22c55e' : 'var(--af-text)' }}>
              {quote.kind === 'free' ? 'Gratuit' : fmtFCFA(quote.amount)}
            </div>
            {quote.kind === 'upgrade_prorata' && <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>Prorata jusqu'à votre échéance actuelle. Votre date d'expiration n'est pas modifiée.</div>}
            {quote.kind === 'advance' && <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>Cette période démarrera à la fin de votre abonnement en cours.</div>}
            {quote.kind === 'renewal' && cycle === 'annual' && <div style={{ fontSize: 11, color: '#22c55e', marginTop: 6, fontWeight: 600 }}>1 mois offert (11 mois facturés)</div>}
            {quote.kind === 'free' && <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>Aucun paiement requis. Ce plan est gratuit à vie.</div>}
          </div>

          {quote.kind !== 'free' && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 8 }}>Mode de paiement</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[{ code: 'stripe', label: 'Carte bancaire' }, { code: 'mobile_money', label: 'Mobile Money' }].map(p => (
                    <button key={p.code} onClick={() => setProvider(p.code)} style={{
                      padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                      border: `2px solid ${provider === p.code ? theme.border : 'var(--af-border)'}`,
                      background: provider === p.code ? theme.bg : 'var(--af-surface-3)',
                      color: provider === p.code ? theme.accent : 'var(--af-text-muted)',
                      fontWeight: 600, fontSize: 13,
                    }}>{p.label}</button>
                  ))}
                </div>
              </div>
              {provider === 'mobile_money' && (
                <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>Opérateur</div>
                    <Select value={operator} onChange={e => setOperator(e.target.value)}
                      style={{ '--af-accent': theme.accent, '--af-focus-ring': `0 0 0 3px ${theme.accent}40` }}>
                      {MM_OPERATORS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </Select>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>Téléphone</div>
                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+225 07 00 00 00 00"
                      className="af-field"
                      style={{ '--af-accent': theme.accent, '--af-focus-ring': `0 0 0 3px ${theme.accent}40`, padding: '8px 12px', fontSize: 13 }} />
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button onClick={submit} disabled={submitting || (quote.kind !== 'free' && (quote.amount <= 0 || (provider === 'mobile_money' && !phone)))}
              style={{ background: theme.accent, borderColor: theme.accent }}>
              {submitting
                ? (quote.kind === 'free' ? 'Activation...' : 'Paiement...')
                : (quote.kind === 'free' ? 'Activer gratuitement' : `Payer ${fmtFCFA(quote.amount)}`)}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

const PKGS = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']

export default function MerchantSubscription() {
  const [data, setData]       = useState(null)
  const [packages, setPackages] = useState([])
  const [cycle, setCycle]     = useState('monthly')
  const [target, setTarget]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/subscriptions/me'), api.get('/subscriptions/packages')])
      .then(([me, pkgs]) => { setData(me.data); setPackages(pkgs.data.packages || []) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const sub      = data?.subscription
  const periods  = data?.periods || []
  const payments = data?.payments || []
  const pkgMap   = Object.fromEntries(packages.map(p => [p.code, p]))

  if (loading || !sub) return <Spinner />

  const daysLeft   = data.daysLeft
  const showWarning = sub.package !== 'STARTER_BOOST' && typeof daysLeft === 'number' && daysLeft <= 10 && daysLeft >= 0

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {target && (
        <CheckoutModal open target={target} cycle={cycle}
          onClose={() => setTarget(null)}
          onSuccess={(d) => { setTarget(null); setSuccess(d.sandbox ? 'Paiement sandbox confirmé.' : 'Plan activé avec succès !'); load() }} />
      )}

      <Breadcrumb title="Abonnement" segments={[{ label: 'Mon plan' }]} />
      {success && <Alert type="success" onClose={() => setSuccess('')}>{success}</Alert>}

      {showWarning && (
        <div style={{ background: 'var(--af-warning-soft)', borderLeft: '4px solid var(--af-warning)', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 13 }}>
          <ExclamationTriangleIcon style={{ width: 16, height: 16, display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
          Votre abonnement expire dans <b>{daysLeft} jour{daysLeft > 1 ? 's' : ''}</b> ({fmtDate(sub.current_period_end)}). Renouvelez-le pour conserver toutes vos fonctionnalités.
        </div>
      )}

      {/* ── Plan actuel ── */}
      <div style={{ background: 'var(--af-surface)', borderRadius: 14, padding: '18px 22px', marginBottom: 28, border: `2px solid ${PKG_THEME[sub.package]?.border || 'var(--af-border)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>VOTRE PLAN ACTUEL</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--af-text)' }}>{PKG_LABELS[sub.package]}</span>
              <Badge color={PKG_COLORS[sub.package]}>Actif</Badge>
            </div>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 4 }}>{PKG_TAGLINE[sub.package]}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {sub.package === 'STARTER_BOOST'
              ? <span style={{ fontSize: 22, fontWeight: 900, color: PKG_THEME[sub.package]?.accent }}>Gratuit</span>
              : <>
                  <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--af-text)' }}>{fmtFCFA(sub.effective_monthly_fee)}</span>
                  <span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>/mois</span>
                </>
            }
            {sub.current_period_end && sub.package !== 'STARTER_BOOST' && (
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>Expire le {fmtDate(sub.current_period_end)}</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Grille tarifaire + features ── */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--af-text)', marginBottom: 4 }}>Choisissez votre plan</div>
        <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 18 }}>
          Passez à un plan supérieur pour débloquer de nouvelles capacités et développer votre activité.
        </div>

        {/* Toggle mensuel / annuel */}
        <div style={{ display: 'inline-flex', background: 'var(--af-surface-2)', borderRadius: 8, padding: 3, marginBottom: 24, gap: 2 }}>
          {[{ v: 'monthly', l: 'Mensuel' }, { v: 'annual', l: 'Annuel  −1 mois offert' }].map(c => (
            <button key={c.v} onClick={() => setCycle(c.v)} style={{
              padding: '7px 18px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: 'none', transition: 'all .15s',
              background: cycle === c.v ? 'var(--af-surface)' : 'transparent',
              color: cycle === c.v ? 'var(--af-text)' : 'var(--af-text-muted)',
              boxShadow: cycle === c.v ? '0 1px 4px rgba(0,0,0,.15)' : 'none',
            }}>{c.l}</button>
          ))}
        </div>

        {/* Colonnes en-têtes plans */}
        <div style={{ display: 'grid', gridTemplateColumns: '220px repeat(4, 1fr)', gap: 0, alignItems: 'end', marginBottom: 0 }}>
          <div />
          {PKGS.map(code => {
            const p      = pkgMap[code] || {}
            const theme  = PKG_THEME[code]
            const isCurr = code === sub.package
            const price  = cycle === 'annual' ? p.annual : p.monthly
            return (
              <div key={code} style={{
                padding: '20px 16px 0',
                borderRadius: '14px 14px 0 0',
                border: `2px solid ${isCurr ? theme.border : 'var(--af-border)'}`,
                borderBottom: 'none',
                background: isCurr ? theme.bg : 'var(--af-surface)',
                position: 'relative',
                marginBottom: 0,
              }}>
                {theme.tag && !isCurr && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: theme.accent, color: '#fff', fontSize: 9, fontWeight: 800,
                    padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', letterSpacing: 1,
                  }}>{theme.tag}</div>
                )}
                {isCurr && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: theme.accent, color: '#fff', fontSize: 9, fontWeight: 800,
                    padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', letterSpacing: 1,
                  }}>VOTRE PLAN</div>
                )}
                <div style={{ fontSize: 11, fontWeight: 800, color: theme.accent, letterSpacing: .5, marginBottom: 4, textTransform: 'uppercase' }}>{PKG_LABELS[code]}</div>
                <div style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 12, lineHeight: 1.4 }}>{PKG_TAGLINE[code]}</div>
                <div style={{ marginBottom: 4 }}>
                  {p.is_free
                    ? <span style={{ fontSize: 26, fontWeight: 900, color: PKG_THEME[code].accent }}>Gratuit</span>
                    : <>
                        <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--af-text)' }}>{fmtFCFA(price)}</span>
                        <span style={{ fontSize: 11, color: 'var(--af-text-muted)', marginLeft: 4 }}>{cycle === 'annual' ? '/an' : '/mois'}</span>
                      </>
                  }
                </div>
                {!p.is_free && cycle === 'annual' && (
                  <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, marginBottom: 8 }}>1 mois offert</div>
                )}
                <div style={{ paddingBottom: 14 }}>
                  {isCurr
                    ? <div style={{ fontSize: 11, color: theme.accent, fontWeight: 700, padding: '7px 0', textAlign: 'center', border: `1px solid ${theme.border}`, borderRadius: 8 }}>Plan actuel</div>
                    : <Button onClick={() => setTarget(code)} size="sm" style={{ width: '100%', background: theme.accent, borderColor: theme.accent, color: '#fff' }}>
                        {PKG_RANK[code] > PKG_RANK[sub.package]
                          ? (p.is_free ? 'Choisir' : '↑ Passer à ce plan')
                          : (p.is_free ? 'Revenir au gratuit' : '↓ Choisir (avance)')}
                      </Button>
                  }
                </div>
              </div>
            )
          })}
        </div>

        {/* Tableau de features */}
        {PKG_FEATURES.map((section, si) => (
          <div key={si}>
            {/* Ligne groupe */}
            <div style={{ display: 'grid', gridTemplateColumns: '220px repeat(4, 1fr)', gap: 0 }}>
              {(() => { const Icon = SECTION_ICONS[section.icon]; return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 0 6px',
                fontSize: 11, fontWeight: 800, color: 'var(--af-text-muted)',
                letterSpacing: .5, textTransform: 'uppercase',
                borderTop: si === 0 ? 'none' : '1px solid var(--af-border)',
                paddingTop: si === 0 ? 0 : 14, marginTop: si === 0 ? 0 : 4,
              }}>
                {Icon && <Icon style={{ width: 14, height: 14, flexShrink: 0 }} />}
                {section.group}
              </div>
              )})()}
              {PKGS.map(code => {
                const isCurr = code === sub.package
                const theme  = PKG_THEME[code]
                return (
                  <div key={code} style={{
                    border: `2px solid ${isCurr ? theme.border : 'var(--af-border)'}`,
                    borderTop: si === 0 ? 'none' : `2px solid ${isCurr ? theme.border : 'var(--af-border)'}`,
                    borderBottom: 'none',
                    background: isCurr ? theme.bg : 'var(--af-surface)',
                    padding: '8px 0',
                  }} />
                )
              })}
            </div>

            {/* Lignes de features */}
            {section.rows.map((row, ri) => {
              const isLast = ri === section.rows.length - 1 && si === PKG_FEATURES.length - 1
              return (
                <div key={ri} style={{ display: 'grid', gridTemplateColumns: '220px repeat(4, 1fr)', gap: 0, alignItems: 'center' }}>
                  <div style={{
                    fontSize: 12, color: 'var(--af-text)', padding: '9px 0 9px 4px',
                    borderBottom: '1px solid var(--af-surface-2)',
                  }}>{row.label}</div>
                  {PKGS.map(code => {
                    const isCurr = code === sub.package
                    const theme  = PKG_THEME[code]
                    return (
                      <div key={code} style={{
                        padding: '9px 8px',
                        border: `2px solid ${isCurr ? theme.border : 'var(--af-border)'}`,
                        borderTop: 'none',
                        borderBottom: isLast ? `2px solid ${isCurr ? theme.border : 'var(--af-border)'}` : 'none',
                        borderRadius: isLast ? '0 0 14px 14px' : 0,
                        background: isCurr ? theme.bg : 'var(--af-surface)',
                      }}>
                        <FeatureValue val={row[code]} />
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}

        {/* Dernière rangée : boutons répétés en bas */}
        <div style={{ display: 'grid', gridTemplateColumns: '220px repeat(4, 1fr)', gap: 0, marginTop: 0 }}>
          <div />
          {PKGS.map(code => {
            const p      = pkgMap[code] || {}
            const isCurr = code === sub.package
            const theme  = PKG_THEME[code]
            return (
              <div key={code} style={{
                padding: '14px 16px',
                border: `2px solid ${isCurr ? theme.border : 'var(--af-border)'}`,
                borderTop: 'none',
                borderRadius: '0 0 14px 14px',
                background: isCurr ? theme.bg : 'var(--af-surface)',
              }}>
                {isCurr
                  ? <div style={{ fontSize: 11, color: theme.accent, fontWeight: 700, padding: '7px 0', textAlign: 'center', border: `1px solid ${theme.border}`, borderRadius: 8 }}>Plan actuel</div>
                  : <Button onClick={() => setTarget(code)} size="sm" style={{ width: '100%', background: theme.accent, borderColor: theme.accent, color: '#fff' }}>
                      {PKG_RANK[code] > PKG_RANK[sub.package]
                        ? (p.is_free ? 'Choisir' : '↑ Passer à ce plan')
                        : (p.is_free ? 'Revenir au gratuit' : '↓ Choisir (avance)')}
                    </Button>
                }
              </div>
            )
          })}
        </div>
      </div>

      {/* ── File de périodes ── */}
      {periods.length > 0 && (
        <div style={{ background: 'var(--af-surface)', borderRadius: 14, padding: '18px 22px', marginTop: 28, marginBottom: 20, border: '1px solid var(--af-border)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Périodes en file</div>
          {periods.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--af-surface-2)' }}>
              <div>
                <Badge color={p.status === 'active' ? 'green' : 'blue'}>{p.status}</Badge>{' '}
                <span style={{ fontWeight: 600, fontSize: 13 }}>{PKG_LABELS[p.package]}</span>{' '}
                <span style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>({p.billing_cycle})</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>
                {fmtDate(p.period_start)} → {fmtDate(p.period_end)} — {fmtFCFA(p.amount_paid)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Historique paiements ── */}
      <div style={{ background: 'var(--af-surface)', borderRadius: 14, padding: '18px 22px', border: '1px solid var(--af-border)', marginTop: periods.length ? 0 : 28 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Historique des paiements</div>
        {payments.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>Aucun paiement enregistré.</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--af-border)' }}>
                    {['Date', 'Plan', 'Type', 'Montant', 'Moyen', 'Statut'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--af-surface-2)' }}>
                      <td style={{ padding: '8px 10px', color: 'var(--af-text-muted)' }}>{fmtDate(p.created_at)}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{PKG_LABELS[p.package] || p.package || '—'}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--af-text-muted)' }}>{p.kind || '—'}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>{fmtFCFA(p.effective_amount)}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--af-text-muted)' }}>{p.provider || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <Badge color={p.status === 'completed' ? 'green' : (p.status === 'pending' ? 'yellow' : 'red')}>{p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </div>
  )
}
