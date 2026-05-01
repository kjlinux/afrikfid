import React, { useEffect, useMemo, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Button, Spinner, Modal, Alert, Select } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'

const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium Performance' }
const PKG_RANK = { STARTER_BOOST: 0, STARTER_PLUS: 1, GROWTH: 2, PREMIUM: 3 }
const PKG_COLORS = { STARTER_BOOST: 'yellow', STARTER_PLUS: 'blue', GROWTH: 'green', PREMIUM: 'purple' }
const PKG_HEX = { STARTER_BOOST: 'var(--af-text-muted)', STARTER_PLUS: '#3b82f6', GROWTH: '#10b981', PREMIUM: 'var(--af-accent)' }

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

function CheckoutModal({ open, target, cycle, sub, onClose, onSuccess }) {
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
      if (provider === 'mobile_money') { body.phone = phone; body.operator = operator }
      const { data } = await api.post('/subscriptions/me/checkout', body)
      if (data.checkout_url) {
        window.location.href = data.checkout_url
        return
      }
      onSuccess(data)
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Erreur de paiement')
    } finally { setSubmitting(false) }
  }

  if (!open) return null
  return (
    <Modal open title={`Souscrire — ${PKG_LABELS[target]} (${cycle === 'annual' ? 'annuel' : 'mensuel'})`} onClose={onClose}>
      {loading && <Spinner />}
      {error && <Alert type="error">{error}</Alert>}
      {quote && (
        <>
          <div style={{ background: 'var(--af-surface-3)', padding: 14, borderRadius: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 4 }}>{quote.description}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--af-text)' }}>{fmtFCFA(quote.amount)}</div>
            {quote.kind === 'upgrade_prorata' && (
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
                Prorata jusqu'à votre échéance actuelle. Votre date d'expiration n'est pas modifiée.
              </div>
            )}
            {quote.kind === 'advance' && (
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
                Cette période démarrera à la fin de votre abonnement en cours.
              </div>
            )}
            {quote.kind === 'renewal' && cycle === 'annual' && (
              <div style={{ fontSize: 11, color: '#10b981', marginTop: 6, fontWeight: 600 }}>
                ✓ 1 mois offert (11 mois facturés)
              </div>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 8 }}>Mode de paiement</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { code: 'stripe', label: 'Carte bancaire (Stripe)' },
                { code: 'mobile_money', label: 'Mobile Money' },
              ].map(p => (
                <button key={p.code} onClick={() => setProvider(p.code)}
                  style={{
                    padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                    border: `2px solid ${provider === p.code ? 'var(--af-accent)' : 'var(--af-border)'}`,
                    background: provider === p.code ? 'rgba(245,158,11,0.08)' : 'var(--af-surface-3)',
                    color: provider === p.code ? 'var(--af-accent)' : 'var(--af-text-muted)',
                    fontWeight: 600, fontSize: 13,
                  }}>{p.label}</button>
              ))}
            </div>
          </div>

          {provider === 'mobile_money' && (
            <div style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>Opérateur</div>
                <Select value={operator} onChange={e => setOperator(e.target.value)}>
                  {MM_OPERATORS.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                </Select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>Téléphone</div>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+225 07 00 00 00 00"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--af-border)', background: 'var(--af-surface-3)', color: 'var(--af-text)', fontSize: 13 }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button onClick={submit} disabled={submitting || quote.amount <= 0 || (provider === 'mobile_money' && !phone)}>
              {submitting ? 'Paiement...' : `Payer ${fmtFCFA(quote.amount)}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function MerchantSubscription() {
  const [data, setData] = useState(null)
  const [packages, setPackages] = useState([])
  const [cycle, setCycle] = useState('monthly')
  const [target, setTarget] = useState(null)
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get('/subscriptions/me'),
      api.get('/subscriptions/packages'),
    ]).then(([me, pkgs]) => {
      setData(me.data)
      setPackages(pkgs.data.packages || [])
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const sub = data?.subscription
  const periods = data?.periods || []
  const payments = data?.payments || []

  const priceFor = useMemo(() => {
    const map = {}
    for (const p of packages) map[p.code] = p
    return map
  }, [packages])

  if (loading || !sub) return <Spinner />

  const daysLeft = data.daysLeft
  const showWarning = typeof daysLeft === 'number' && daysLeft <= 10 && daysLeft >= 0

  return (
    <div style={{ padding: '28px 32px' }}>
      {target && (
        <CheckoutModal open target={target} cycle={cycle} sub={sub}
          onClose={() => setTarget(null)}
          onSuccess={(d) => { setTarget(null); setSuccess(d.sandbox ? 'Paiement sandbox confirmé.' : 'Paiement enregistré.'); load() }} />
      )}

      <Breadcrumb title="Abonnement" segments={[{ label: 'Mon plan' }]} />

      {success && <Alert type="success" onClose={() => setSuccess('')}>{success}</Alert>}

      {showWarning && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '14px 18px', marginBottom: 18, color: 'var(--af-accent)', fontSize: 13 }}>
          ⚠️ Votre abonnement expire dans <b>{daysLeft} jour{daysLeft > 1 ? 's' : ''}</b> ({fmtDate(sub.current_period_end)}). Renouvelez-le pour éviter la bascule automatique sur Starter Boost.
        </div>
      )}

      {/* Bloc plan actuel */}
      <Card title="Mon plan actuel" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Plan</div>
            <Badge color={PKG_COLORS[sub.package]}>{PKG_LABELS[sub.package]}</Badge>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Cycle</div>
            <div style={{ fontWeight: 700 }}>{sub.billing_cycle === 'annual' ? 'Annuel' : 'Mensuel'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Période en cours</div>
            <div style={{ fontWeight: 700 }}>{fmtDate(sub.current_period_start)} → {fmtDate(sub.current_period_end)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Mensualité de base</div>
            <div style={{ fontWeight: 700 }}>{fmtFCFA(sub.base_monthly_fee)}</div>
          </div>
        </div>
        {data.recruitmentBonus && data.recruitmentBonus.discountPercent > 0 && (
          <div style={{ marginTop: 14, padding: 10, background: 'rgba(16,185,129,0.08)', borderRadius: 8, fontSize: 12, color: '#10b981' }}>
            🎁 Bonus recrutement Starter Boost : <b>-{data.recruitmentBonus.discountPercent}%</b> ({data.recruitmentBonus.clientsRecruitedThisMonth} clients recrutés ce mois)
          </div>
        )}
      </Card>

      {/* File de périodes */}
      {periods.length > 0 && (
        <Card title="File de périodes" style={{ marginBottom: 20 }}>
          {periods.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--af-surface)' }}>
              <div>
                <Badge color={p.status === 'active' ? 'green' : 'blue'}>{p.status}</Badge>{' '}
                <span style={{ fontWeight: 600 }}>{PKG_LABELS[p.package]}</span>{' '}
                <span style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>({p.billing_cycle})</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>
                {fmtDate(p.period_start)} → {fmtDate(p.period_end)} — {fmtFCFA(p.amount_paid)}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Sélection / changement de plan */}
      <Card title="Changer ou renouveler mon plan" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {['monthly', 'annual'].map(c => (
            <button key={c} onClick={() => setCycle(c)}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${cycle === c ? 'var(--af-accent)' : 'var(--af-border)'}`,
                background: cycle === c ? 'rgba(245,158,11,0.1)' : 'transparent',
                color: cycle === c ? 'var(--af-accent)' : 'var(--af-text-muted)',
              }}>
              {c === 'monthly' ? 'Mensuel' : 'Annuel (-1 mois offert)'}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {packages.map(p => {
            const isCurrent = p.code === sub.package
            const isUpgrade = PKG_RANK[p.code] > PKG_RANK[sub.package]
            const price = cycle === 'annual' ? p.annual : p.monthly
            const hex = PKG_HEX[p.code]
            return (
              <div key={p.code} style={{ padding: 16, borderRadius: 12, border: `2px solid ${isCurrent ? hex : 'var(--af-border)'}`, background: 'var(--af-surface)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: hex, marginBottom: 4 }}>{p.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--af-text)', marginBottom: 2 }}>{fmtFCFA(price)}</div>
                <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginBottom: 12 }}>{cycle === 'annual' ? '/an' : '/mois'}</div>
                {isCurrent ? (
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)', textAlign: 'center', padding: '6px 0' }}>Plan actuel</div>
                ) : (
                  <Button onClick={() => setTarget(p.code)} size="sm" style={{ width: '100%' }}>
                    {isUpgrade ? 'Upgrader' : (PKG_RANK[p.code] < PKG_RANK[sub.package] ? 'Choisir (avance)' : 'Renouveler')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Historique paiements */}
      <Card title="Historique des paiements">
        {payments.length === 0 && <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Aucun paiement enregistré.</div>}
        {payments.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--af-border)' }}>
                  {['Date', 'Plan', 'Type', 'Montant', 'Provider', 'Statut'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--af-surface)' }}>
                    <td style={{ padding: '8px 10px', color: 'var(--af-text-muted)' }}>{fmtDate(p.created_at)}</td>
                    <td style={{ padding: '8px 10px' }}>{PKG_LABELS[p.package] || p.package || '—'}</td>
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
        )}
      </Card>
    </div>
  )
}
