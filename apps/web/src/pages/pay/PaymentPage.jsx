import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { publicApi as api } from '../../api.js'
import { useTransactionSSE } from '../../hooks/useSSE.js'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

const MM_OPERATORS = [
  { code: 'ORANGE', name: 'Orange Money', color: '#FF6B00' },
  { code: 'MTN',    name: 'MTN MoMo',     color: '#FFD700' },
  { code: 'WAVE',   name: 'Wave',         color: '#1DA1F2' },
  { code: 'AIRTEL', name: 'Airtel Money', color: '#E30613' },
  { code: 'MOOV',   name: 'Moov Money',  color: '#00A651' },
  { code: 'MPESA',  name: 'M-Pesa',      color: '#00A551' },
]
function OperatorDot({ color }) {
  return <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }
const LOYALTY_ICON  = { OPEN: 'o', LIVE: '★', GOLD: '◎', ROYAL: '♛' }

export default function PaymentPage() {
  const { code } = useParams()
  const [linkInfo, setLinkInfo] = useState(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState('identify')
  const [paymentType, setPaymentType] = useState(null)
  const [form, setForm] = useState({ phone: '', afrikfid_id: '', operator: '', custom_amount: '' })
  const [clientInfo, setClientInfo] = useState(null)
  const [result, setResult] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [transactionId, setTransactionId] = useState(null)

  // SSE : avancer automatiquement quand la TX est confirmée/échouée
  useTransactionSSE(transactionId, (payload) => {
    if (payload.status === 'completed') {
      setResult(prev => prev ? { ...prev, status: 'completed' } : { status: 'completed' })
      setStep('done')
    } else if (payload.status === 'failed' || payload.status === 'expired') {
      setPageError(`Paiement ${payload.status === 'expired' ? 'expiré' : 'refusé'} par l'opérateur.`)
      setProcessing(false)
    }
  })

  useEffect(() => {
    api.get('/payment-links/' + code + '/info').then(r => {
      setLinkInfo(r.data)
    }).catch(err => {
      setError(err.response?.data?.error || 'Lien de paiement invalide ou expiré')
    })
  }, [code])

  const lookupClient = async () => {
    if (!form.phone && !form.afrikfid_id) { setStep('method'); return }
    try {
      const { data } = await api.post('/payment-links/' + code + '/identify-client', {
        phone: form.phone || undefined,
        afrikfid_id: form.afrikfid_id || undefined,
      })
      setClientInfo(data.found ? data.client : null)
    } catch { setClientInfo(null) }
    setStep('method')
  }

  const amount = linkInfo?.amount || parseFloat(form.custom_amount) || 0
  const Y = clientInfo ? clientInfo.clientRebatePercent : 0
  const rebateAmount = Math.round((amount * Y) / 100)
  const toPay = linkInfo?.rebateMode === 'immediate' ? amount - rebateAmount : amount

  const payMobile = async () => {
    if (!form.operator) { setPageError('Sélectionnez un opérateur.'); return }
    setProcessing(true); setPageError('')
    try {
      const { data } = await api.post('/payment-links/' + code + '/pay', {
        phone: form.phone,
        payment_operator: form.operator,
        afrikfid_id: form.afrikfid_id || undefined,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      // Stocker l'ID pour écouter le SSE de cette TX
      if (data.transaction?.id) setTransactionId(data.transaction.id)
      setResult(data); setStep('done')
    } catch (err) {
      setPageError(err.response?.data?.message || err.response?.data?.error || 'Erreur lors du paiement')
    } finally { setProcessing(false) }
  }

  const payCard = async () => {
    if (!amount) { setPageError('Montant invalide.'); return }
    setProcessing(true); setPageError('')
    try {
      const { data } = await api.post('/payment-links/' + code + '/pay', {
        phone: form.phone || undefined,
        payment_method: 'card',
        afrikfid_id: form.afrikfid_id || undefined,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      if (data.payment?.paymentUrl) { window.location.href = data.payment.paymentUrl }
      else { setResult(data); setStep('done') }
    } catch (err) {
      setPageError(err.response?.data?.message || err.response?.data?.error || 'Erreur lors du paiement')
    } finally { setProcessing(false) }
  }

  if (error) return (
    <Screen>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>X</div>
        <h2 style={{ color: '#ef4444', fontSize: 18 }}>Lien invalide</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>{error}</p>
      </div>
    </Screen>
  )

  if (!linkInfo) return (
    <Screen>
      <div style={{ textAlign: 'center', color: '#64748b', padding: 32 }}>Chargement...</div>
    </Screen>
  )

  const stepIdx = { identify: 0, method: 1, mobile: 2, card: 2, done: 3 }[step] || 0
  const stepLabels = ['Identification', 'Méthode', 'Paiement']

  return (
    <Screen>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, marginBottom: 10, color: '#fff' }}>A</div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>{linkInfo.merchantName}</h2>
          {linkInfo.description && <p style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{linkInfo.description}</p>}
        </div>

        {step !== 'done' && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginBottom: 18 }}>
            {stepLabels.map((s, i) => (
              <React.Fragment key={s}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700,
                    background: i < stepIdx ? '#10b981' : i === stepIdx ? '#f59e0b' : '#1e293b',
                    color: i <= stepIdx ? '#0f172a' : '#64748b',
                    border: '2px solid ' + (i === stepIdx ? '#f59e0b' : i < stepIdx ? '#10b981' : '#334155'),
                  }}>{i < stepIdx ? 'v' : i + 1}</div>
                  <span style={{ fontSize: 10, color: i === stepIdx ? '#f1f5f9' : '#64748b' }}>{s}</span>
                </div>
                {i < 2 && <div style={{ width: 14, height: 1, background: '#334155', margin: '0 2px' }} />}
              </React.Fragment>
            ))}
          </div>
        )}

        <div style={{ background: '#1e293b', borderRadius: 16, border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid #334155', textAlign: 'center' }}>
            {linkInfo.amount ? (
              <div style={{ fontSize: 32, fontWeight: 800, color: '#f59e0b' }}>
                {fmt(linkInfo.amount)} <span style={{ fontSize: 15, color: '#64748b' }}>{linkInfo.currency}</span>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>Saisissez le montant</div>
                <input type="number" min="0" step="100" value={form.custom_amount}
                  onChange={e => setForm(f => ({ ...f, custom_amount: e.target.value }))} placeholder="0"
                  style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f59e0b', fontSize: 24, fontWeight: 800, textAlign: 'center', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            )}
          </div>

          <div style={{ padding: '16px 20px' }}>

            {step === 'identify' && (
              <div>
                <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
                  Identifiez-vous pour bénéficier de votre remise fidélité (optionnel)
                </p>
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 5 }}>Numéro de téléphone</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+2250700000000" onKeyDown={e => e.key === 'Enter' && lookupClient()}
                  style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={lookupClient} style={{ flex: 1, padding: '12px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                    Continuer
                  </button>
                  <button onClick={() => setStep('method')} style={{ padding: '12px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                    Invité
                  </button>
                </div>
              </div>
            )}

            {step === 'method' && (
              <div>
                {clientInfo && (
                  <div style={{ background: LOYALTY_COLOR[clientInfo.loyaltyStatus] + '18', border: '1px solid ' + LOYALTY_COLOR[clientInfo.loyaltyStatus] + '44', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{clientInfo.fullName}</div>
                    <div style={{ fontSize: 11, color: LOYALTY_COLOR[clientInfo.loyaltyStatus], fontWeight: 700 }}>
                      {LOYALTY_ICON[clientInfo.loyaltyStatus]} {clientInfo.loyaltyStatus} — {clientInfo.clientRebatePercent}% de remise
                    </div>
                  </div>
                )}
                {!clientInfo && form.phone && (
                  <div style={{ background: 'rgba(100,116,139,0.1)', borderRadius: 8, padding: '7px 12px', marginBottom: 12, fontSize: 12, color: '#64748b' }}>
                    Compte non trouvé — paiement en mode invité
                  </div>
                )}
                <p style={{ fontSize: 11, color: '#64748b', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase' }}>Méthode de paiement</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button onClick={() => { setPaymentType('mobile_money'); setStep('mobile') }}
                    style={{ padding: '14px 10px', border: '2px solid #334155', borderRadius: 12, background: '#0f172a', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 5 }}>📱</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>Mobile Money</div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Orange, MTN, Wave…</div>
                  </button>
                  <button onClick={() => { setPaymentType('card'); setStep('card') }}
                    style={{ padding: '14px 10px', border: '2px solid #334155', borderRadius: 12, background: '#0f172a', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 5 }}>💳</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>Carte bancaire</div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Visa, Mastercard, GIM</div>
                  </button>
                </div>
              </div>
            )}

            {step === 'mobile' && (
              <div>
                <AmountRecap amount={amount} rebateAmount={rebateAmount} Y={Y} toPay={toPay} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 7, textTransform: 'uppercase' }}>Opérateur</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 12 }}>
                  {MM_OPERATORS.map(op => (
                    <button key={op.code} onClick={() => setForm(f => ({ ...f, operator: op.code }))}
                      style={{ padding: '9px 4px', border: '2px solid ' + (form.operator === op.code ? op.color : '#334155'), borderRadius: 9, background: form.operator === op.code ? op.color + '22' : '#0f172a', cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 2 }}><OperatorDot color={op.color} /></div>
                      <div style={{ fontSize: 9, color: form.operator === op.code ? op.color : '#64748b', marginTop: 3, fontWeight: 600 }}>{op.name.split(' ')[0]}</div>
                    </button>
                  ))}
                </div>
                {!form.phone && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 5 }}>Numéro Mobile Money</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+2250700000000"
                      style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                )}
                {pageError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{pageError}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('method')} style={{ padding: '11px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer' }}>←</button>
                  <button onClick={payMobile} disabled={processing || !amount || !form.operator}
                    style={{ flex: 1, padding: '12px', background: processing ? '#334155' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 9, color: '#fff', fontWeight: 700, cursor: processing ? 'default' : 'pointer', fontSize: 14, opacity: !amount || !form.operator ? 0.5 : 1 }}>
                    {processing ? 'Traitement...' : 'Payer ' + fmt(toPay) + ' ' + linkInfo.currency}
                  </button>
                </div>
              </div>
            )}

            {step === 'card' && (
              <div>
                <AmountRecap amount={amount} rebateAmount={0} Y={0} toPay={amount} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, padding: '11px 13px', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600, marginBottom: 3 }}>Paiement sécurisé 3DS</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Vous serez redirigé vers CinetPay. Visa, Mastercard et GIM-UEMOA acceptés.</div>
                </div>
                {pageError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{pageError}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('method')} style={{ padding: '11px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer' }}>←</button>
                  <button onClick={payCard} disabled={processing || !amount}
                    style={{ flex: 1, padding: '12px', background: processing ? '#334155' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)', border: 'none', borderRadius: 9, color: '#fff', fontWeight: 700, cursor: processing ? 'default' : 'pointer', fontSize: 14, opacity: !amount ? 0.5 : 1 }}>
                    {processing ? 'Redirection...' : 'Payer ' + fmt(amount) + ' ' + linkInfo.currency + ' par carte'}
                  </button>
                </div>
              </div>
            )}

            {step === 'done' && result && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#10b981', marginBottom: 7 }}>
                  {paymentType === 'mobile_money' ? 'Paiement initié !' : 'Traitement en cours...'}
                </h3>
                <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>
                  {paymentType === 'mobile_money' ? 'Confirmez sur votre téléphone via OTP.' : 'Votre paiement est en cours de traitement.'}
                </p>
                <div style={{ background: '#0f172a', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Référence</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#f59e0b' }}>{result.reference || result.transaction?.reference}</div>
                </div>
              </div>
            )}

          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#334155', marginTop: 12 }}>
          Paiement sécurisé · Afrik'Fid © 2026
        </p>
      </div>
    </Screen>
  )
}

function Screen({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {children}
    </div>
  )
}

function AmountRecap({ amount, rebateAmount, Y, toPay, rebateMode, currency }) {
  if (!amount) return null
  return (
    <div style={{ background: '#0f172a', borderRadius: 9, padding: 11, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>Montant brut</span>
        <span style={{ fontSize: 12, color: '#f1f5f9' }}>{fmt(amount)} {currency}</span>
      </div>
      {rebateAmount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>Remise ({Y}%)</span>
          <span style={{ fontSize: 12, color: '#10b981' }}>- {fmt(rebateAmount)} {currency}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Vous payez</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b' }}>{fmt(toPay)} {currency}</span>
      </div>
      {rebateMode === 'cashback' && rebateAmount > 0 && (
        <div style={{ fontSize: 11, color: '#10b981', marginTop: 5, textAlign: 'center' }}>
          + {fmt(rebateAmount)} {currency} crédités sur votre portefeuille Afrik'Fid
        </div>
      )}
    </div>
  )
}
