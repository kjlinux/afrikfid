import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { publicApi as api } from '../../api.js'
import { useTransactionSSE } from '../../hooks/useSSE.js'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

// ─── Logos opérateurs (SVG inline) ───────────────────────────────────────────
function OrangeLogo() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36">
      <circle cx="20" cy="20" r="20" fill="#FF6B00"/>
      <rect x="10" y="17" width="20" height="6" rx="3" fill="#fff"/>
    </svg>
  )
}
function MtnLogo() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36">
      <circle cx="20" cy="20" r="20" fill="#FFD700"/>
      <text x="20" y="25" textAnchor="middle" fontSize="10" fontWeight="800" fill="#000">MTN</text>
    </svg>
  )
}
function WaveLogo() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36">
      <circle cx="20" cy="20" r="20" fill="#1DA1F2"/>
      <path d="M10 22 Q15 14 20 22 Q25 30 30 22" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    </svg>
  )
}
function AirtelLogo() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36">
      <circle cx="20" cy="20" r="20" fill="#E30613"/>
      <text x="20" y="25" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">AIRTEL</text>
    </svg>
  )
}
function MoovLogo() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36">
      <circle cx="20" cy="20" r="20" fill="#00A651"/>
      <text x="20" y="25" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">MOOV</text>
    </svg>
  )
}
function MpesaLogo() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36">
      <circle cx="20" cy="20" r="20" fill="#00a550"/>
      <text x="20" y="26" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#fff">M-PESA</text>
    </svg>
  )
}

const MM_OPERATORS = [
  { code: 'ORANGE', name: 'Orange Money', Logo: OrangeLogo, color: '#FF6B00' },
  { code: 'MTN',    name: 'MTN MoMo',     Logo: MtnLogo,    color: '#FFD700' },
  { code: 'WAVE',   name: 'Wave',         Logo: WaveLogo,   color: '#1DA1F2' },
  { code: 'AIRTEL', name: 'Airtel Money', Logo: AirtelLogo, color: '#E30613' },
  { code: 'MOOV',   name: 'Moov Money',  Logo: MoovLogo,   color: '#00A651' },
  { code: 'MPESA',  name: 'M-Pesa',      Logo: MpesaLogo,  color: '#00a550' },
]

// ─── Instructions USSD par opérateur et par pays ──────────────────────────────
// Format : { [operator]: { [countryCode]: { ussd, steps } } }
// countryCode = 'CI' | 'SN' | 'BF' | 'ML' | 'GN' | 'TG' | 'BJ' | 'CM' | 'KE' | '*'
const USSD_INSTRUCTIONS = {
  ORANGE: {
    CI: { ussd: '#144#', steps: ['Composez *144#', 'Choisissez "Paiement marchand"', 'Entrez le code marchand', 'Saisissez le montant', 'Confirmez avec votre code secret'] },
    SN: { ussd: '#144#', steps: ['Composez *144#', 'Sélectionnez "Paiement"', 'Entrez le numéro marchand', 'Validez avec votre PIN'] },
    ML: { ussd: '#144#', steps: ['Composez *144#', 'Choisissez "Paiement"', 'Entrez les informations marchand', 'Confirmez'] },
    BF: { ussd: '#144#', steps: ['Composez *144#', 'Sélectionnez "Transfert/Paiement"', 'Suivez les instructions', 'Confirmez avec votre code secret'] },
    '*': { ussd: '*144#', steps: ['Composez *144#', 'Sélectionnez "Paiement marchand"', 'Entrez le numéro / code marchand', 'Confirmez avec votre code secret Orange Money'] },
  },
  MTN: {
    CI: { ussd: '*133#', steps: ['Composez *133#', 'Choisissez "Payer"', 'Entrez le numéro marchand', 'Saisissez le montant et confirmez'] },
    GH: { ussd: '*170#', steps: ['Composez *170#', 'Sélectionnez "Pay Bill"', 'Entrez le code marchand', 'Confirmez avec PIN'] },
    CM: { ussd: '*126#', steps: ['Composez *126#', 'Choisissez "Paiement"', 'Entrez les informations', 'Confirmez avec votre PIN MoMo'] },
    '*': { ussd: '*170#', steps: ['Composez *170# (ou le code MTN de votre pays)', 'Sélectionnez "Pay" ou "Payer"', 'Entrez le numéro / code marchand', 'Confirmez avec votre PIN MTN MoMo'] },
  },
  WAVE: {
    CI: { ussd: null, steps: ['Ouvrez l\'app Wave', 'Appuyez sur "Payer"', 'Scannez le QR ou entrez le numéro marchand', 'Confirmez le paiement'] },
    SN: { ussd: null, steps: ['Ouvrez l\'app Wave', 'Appuyez sur "Payer"', 'Entrez le numéro du marchand', 'Confirmez'] },
    '*': { ussd: null, steps: ['Ouvrez l\'application Wave sur votre téléphone', 'Appuyez sur "Payer"', 'Entrez le numéro ou scannez le QR du marchand', 'Confirmez le paiement'] },
  },
  AIRTEL: {
    KE: { ussd: '*334#', steps: ['Composez *334#', 'Sélectionnez "Pay Bill"', 'Entrez le numéro marchand', 'Confirmez avec PIN Airtel Money'] },
    GH: { ussd: '*185#', steps: ['Composez *185#', 'Choisissez "Pay"', 'Entrez les informations marchand', 'Confirmez'] },
    '*': { ussd: '*185#', steps: ['Composez *185# (ou le code Airtel de votre pays)', 'Sélectionnez "Paiement"', 'Entrez le numéro marchand', 'Confirmez avec votre PIN Airtel Money'] },
  },
  MOOV: {
    CI: { ussd: '*555#', steps: ['Composez *555#', 'Choisissez "Payer un marchand"', 'Entrez le numéro marchand', 'Confirmez'] },
    BF: { ussd: '*555#', steps: ['Composez *555#', 'Sélectionnez "Paiement"', 'Entrez les détails du marchand', 'Confirmez avec votre PIN'] },
    TG: { ussd: '*155#', steps: ['Composez *155#', 'Choisissez "Flooz Pay"', 'Entrez le numéro marchand', 'Confirmez'] },
    BJ: { ussd: '*155#', steps: ['Composez *155#', 'Sélectionnez "Paiement marchand"', 'Entrez les informations', 'Confirmez avec votre code'] },
    '*': { ussd: '*555#', steps: ['Composez *555# (ou *155# selon votre pays)', 'Sélectionnez "Paiement marchand"', 'Entrez le numéro du marchand', 'Confirmez avec votre PIN Moov Money'] },
  },
  MPESA: {
    KE: { ussd: '*334#', steps: ['Composez *334# ou ouvrez l\'app M-Pesa', 'Sélectionnez "Lipa na M-Pesa"', 'Choisissez "Pay Bill" ou "Buy Goods"', 'Entrez le numéro marchand', 'Confirmez avec votre PIN M-Pesa'] },
    TZ: { ussd: '*150*00#', steps: ['Composez *150*00#', 'Sélectionnez "Pay via M-Pesa"', 'Entrez le numéro de référence', 'Confirmez'] },
    '*': { ussd: '*334#', steps: ['Composez *334# ou ouvrez M-Pesa', 'Sélectionnez "Lipa na M-Pesa"', 'Entrez le numéro du marchand', 'Confirmez avec votre PIN M-Pesa'] },
  },
}

function getUssdInstructions(operator, countryCode) {
  const opInstructions = USSD_INSTRUCTIONS[operator]
  if (!opInstructions) return null
  return opInstructions[countryCode] || opInstructions['*'] || null
}

const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }
const LOYALTY_ICON  = { OPEN: '○', LIVE: '★', GOLD: '◎', ROYAL: '♛' }

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

  // Déterminer le pays depuis le téléphone ou l'info marchand
  const countryCode = linkInfo?.countryCode || detectCountryFromPhone(form.phone)

  const payMobile = async () => {
    if (!form.operator) { setPageError('Sélectionnez un opérateur.'); return }
    if (!form.phone) { setPageError('Saisissez votre numéro Mobile Money.'); return }
    setProcessing(true); setPageError('')
    try {
      const { data } = await api.post('/payment-links/' + code + '/pay', {
        phone: form.phone,
        payment_operator: form.operator,
        afrikfid_id: form.afrikfid_id || undefined,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      if (data.transactionId || data.transaction?.id) setTransactionId(data.transactionId || data.transaction?.id)
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
        <div style={{ fontSize: 48, marginBottom: 16 }}>✕</div>
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
  const selectedOp = MM_OPERATORS.find(o => o.code === form.operator)
  const ussdInfo = form.operator ? getUssdInstructions(form.operator, countryCode) : null

  return (
    <Screen>
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, marginBottom: 10, color: '#fff' }}>A</div>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9' }}>{linkInfo.merchantName}</h2>
          {linkInfo.description && <p style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{linkInfo.description}</p>}
        </div>

        {/* Stepper */}
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
                  }}>{i < stepIdx ? '✓' : i + 1}</div>
                  <span style={{ fontSize: 10, color: i === stepIdx ? '#f1f5f9' : '#64748b' }}>{s}</span>
                </div>
                {i < 2 && <div style={{ width: 14, height: 1, background: '#334155', margin: '0 2px' }} />}
              </React.Fragment>
            ))}
          </div>
        )}

        <div style={{ background: '#1e293b', borderRadius: 16, border: '1px solid #334155', overflow: 'hidden' }}>
          {/* Montant */}
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

            {/* ÉTAPE 1 : Identification */}
            {step === 'identify' && (
              <div>
                <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
                  Identifiez-vous pour bénéficier de votre remise fidélité (optionnel)
                </p>
                <label style={labelStyle}>Numéro de téléphone</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+2250700000000" onKeyDown={e => e.key === 'Enter' && lookupClient()}
                  style={inputStyle} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={lookupClient} style={btnPrimary}>Continuer</button>
                  <button onClick={() => setStep('method')} style={btnGhost}>Invité</button>
                </div>
              </div>
            )}

            {/* ÉTAPE 2 : Méthode */}
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

            {/* ÉTAPE 3a : Mobile Money */}
            {step === 'mobile' && (
              <div>
                <AmountRecap amount={amount} rebateAmount={rebateAmount} Y={Y} toPay={toPay} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />

                <label style={labelStyle}>Opérateur</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7, marginBottom: 12 }}>
                  {MM_OPERATORS.map(op => {
                    const selected = form.operator === op.code
                    return (
                      <button key={op.code} onClick={() => setForm(f => ({ ...f, operator: op.code }))}
                        style={{ padding: '8px 4px', border: '2px solid ' + (selected ? op.color : '#334155'), borderRadius: 9, background: selected ? op.color + '22' : '#0f172a', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3 }}>
                          <op.Logo />
                        </div>
                        <div style={{ fontSize: 9, color: selected ? op.color : '#64748b', fontWeight: 600, lineHeight: 1.2 }}>{op.name.split(' ')[0]}</div>
                      </button>
                    )
                  })}
                </div>

                {!form.phone && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Numéro Mobile Money</label>
                    <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+2250700000000"
                      style={inputStyle} />
                  </div>
                )}

                {/* Instructions USSD */}
                {ussdInfo && (
                  <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                      {ussdInfo.ussd ? `Composez ${ussdInfo.ussd} sur votre téléphone :` : 'Comment payer :'}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 16 }}>
                      {ussdInfo.steps.map((step, i) => (
                        <li key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>{step}</li>
                      ))}
                    </ol>
                    {ussdInfo.ussd && (
                      <div style={{ marginTop: 8, background: '#0f172a', borderRadius: 6, padding: '6px 10px', display: 'inline-block' }}>
                        <span style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: '#f59e0b', letterSpacing: 2 }}>{ussdInfo.ussd}</span>
                      </div>
                    )}
                  </div>
                )}

                {pageError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{pageError}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('method')} style={btnBack}>←</button>
                  <button onClick={payMobile} disabled={processing || !amount || !form.operator}
                    style={{ ...btnPrimary, flex: 1, background: processing ? '#334155' : 'linear-gradient(135deg, #f59e0b, #ef4444)', opacity: (!amount || !form.operator) ? 0.5 : 1 }}>
                    {processing ? 'Traitement...' : 'Payer ' + fmt(toPay) + ' ' + linkInfo.currency}
                  </button>
                </div>
              </div>
            )}

            {/* ÉTAPE 3b : Carte */}
            {step === 'card' && (
              <div>
                <AmountRecap amount={amount} rebateAmount={0} Y={0} toPay={amount} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10, padding: '11px 13px', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#3b82f6', fontWeight: 600, marginBottom: 3 }}>Paiement sécurisé 3DS</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Vous serez redirigé vers CinetPay. Visa, Mastercard et GIM-UEMOA acceptés.</div>
                </div>
                {/* Logos cartes */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
                  {[
                    { label: 'VISA', bg: '#1a1f71', color: '#fff', italic: true },
                    { label: 'MC', bg: '#eb001b', color: '#fff', italic: false },
                    { label: 'GIM', bg: '#00843d', color: '#fff', italic: false },
                  ].map(c => (
                    <div key={c.label} style={{ background: c.bg, borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 800, color: c.color, fontStyle: c.italic ? 'italic' : 'normal', letterSpacing: 1 }}>
                      {c.label}
                    </div>
                  ))}
                </div>
                {pageError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8, textAlign: 'center' }}>{pageError}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('method')} style={btnBack}>←</button>
                  <button onClick={payCard} disabled={processing || !amount}
                    style={{ ...btnPrimary, flex: 1, background: processing ? '#334155' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)', opacity: !amount ? 0.5 : 1 }}>
                    {processing ? 'Redirection...' : 'Payer ' + fmt(amount) + ' ' + linkInfo.currency + ' par carte'}
                  </button>
                </div>
              </div>
            )}

            {/* SUCCÈS */}
            {step === 'done' && result && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#10b981', marginBottom: 7 }}>
                  {paymentType === 'mobile_money' ? 'Paiement initié !' : 'Traitement en cours...'}
                </h3>
                <p style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>
                  {paymentType === 'mobile_money' ? 'Confirmez sur votre téléphone via le menu USSD ou OTP.' : 'Votre paiement est en cours de traitement.'}
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

// ─── Détecter le pays depuis le préfixe téléphonique ─────────────────────────
function detectCountryFromPhone(phone) {
  if (!phone) return '*'
  const p = phone.replace(/\s/g, '')
  if (p.startsWith('+225') || p.startsWith('00225')) return 'CI'
  if (p.startsWith('+221') || p.startsWith('00221')) return 'SN'
  if (p.startsWith('+226') || p.startsWith('00226')) return 'BF'
  if (p.startsWith('+223') || p.startsWith('00223')) return 'ML'
  if (p.startsWith('+224') || p.startsWith('00224')) return 'GN'
  if (p.startsWith('+228') || p.startsWith('00228')) return 'TG'
  if (p.startsWith('+229') || p.startsWith('00229')) return 'BJ'
  if (p.startsWith('+237') || p.startsWith('00237')) return 'CM'
  if (p.startsWith('+254') || p.startsWith('00254')) return 'KE'
  if (p.startsWith('+255') || p.startsWith('00255')) return 'TZ'
  if (p.startsWith('+233') || p.startsWith('00233')) return 'GH'
  return '*'
}

// ─── Composants utilitaires ───────────────────────────────────────────────────
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

// ─── Styles réutilisables ─────────────────────────────────────────────────────
const labelStyle = { display: 'block', fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 5, textTransform: 'uppercase' }
const inputStyle = { width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }
const btnPrimary = { flex: 1, padding: '12px', background: 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 9, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14 }
const btnGhost = { padding: '12px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontSize: 13 }
const btnBack = { padding: '11px 14px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer' }
