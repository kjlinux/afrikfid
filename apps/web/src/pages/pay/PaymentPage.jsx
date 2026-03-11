import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { publicApi as api } from '../../api.js'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const OPERATORS = [
  { code: 'ORANGE', name: 'Orange Money', color: '#FF6B00', icon: '🟠' },
  { code: 'MTN', name: 'MTN MoMo', color: '#FFD700', icon: '🟡' },
  { code: 'WAVE', name: 'Wave', color: '#1DA1F2', icon: '🌊' },
  { code: 'AIRTEL', name: 'Airtel Money', color: '#E30613', icon: '🔴' },
  { code: 'MOOV', name: 'Moov Money', color: '#00A651', icon: '🟢' },
  { code: 'MPESA', name: 'M-Pesa', color: '#00A551', icon: '🦁' },
]
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export default function PaymentPage() {
  const { code } = useParams()
  const [linkInfo, setLinkInfo] = useState(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState('info') // info | client | payment | confirm | done
  const [form, setForm] = useState({ phone: '', afrikfid_id: '', operator: '', custom_amount: '' })
  const [clientInfo, setClientInfo] = useState(null)
  const [result, setResult] = useState(null)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    api.get(`/payment-links/${code}/info`).then(r => {
      setLinkInfo(r.data)
    }).catch(err => {
      setError(err.response?.data?.error || 'Lien de paiement invalide ou expiré')
    })
  }, [code])

  const lookupClient = async () => {
    if (!form.phone && !form.afrikfid_id) { setStep('payment'); return }
    try {
      const { data } = await api.post(`/payment-links/${code}/identify-client`, {
        phone: form.phone || undefined,
        afrikfid_id: form.afrikfid_id || undefined,
      })
      setClientInfo(data.found ? data.client : null)
    } catch {
      setClientInfo(null)
    }
    setStep('payment')
  }

  const amount = linkInfo?.amount || parseFloat(form.custom_amount) || 0
  const Y = clientInfo ? clientInfo.clientRebatePercent : 0
  const rebateAmount = (amount * Y) / 100
  const toPay = linkInfo?.rebateMode === 'immediate' ? amount - rebateAmount : amount

  const pay = async () => {
    setProcessing(true)
    try {
      const { data } = await api.post(`/payment-links/${code}/pay`, {
        phone: form.phone,
        payment_operator: form.operator,
        afrikfid_id: form.afrikfid_id || undefined,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      setResult(data)
      setStep('done')
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du paiement')
    } finally { setProcessing(false) }
  }

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 32, maxWidth: 400, width: '100%', textAlign: 'center', border: '1px solid #334155' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>❌</div>
        <h2 style={{ color: '#ef4444', marginBottom: 8 }}>Lien invalide</h2>
        <p style={{ color: '#64748b', fontSize: 14 }}>{error}</p>
      </div>
    </div>
  )

  if (!linkInfo) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#64748b' }}>Chargement...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, marginBottom: 12 }}>A</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9' }}>{linkInfo.merchantName}</h2>
          {linkInfo.description && <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>{linkInfo.description}</p>}
        </div>

        <div style={{ background: '#1e293b', borderRadius: 16, border: '1px solid #334155', overflow: 'hidden' }}>
          {/* Amount */}
          <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid #334155', textAlign: 'center' }}>
            {linkInfo.amount ? (
              <div style={{ fontSize: 36, fontWeight: 800, color: '#f59e0b' }}>{fmt(linkInfo.amount)} <span style={{ fontSize: 18, color: '#64748b' }}>{linkInfo.currency}</span></div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>Saisissez le montant</div>
                <input type="number" min="0" step="100" value={form.custom_amount} onChange={e => setForm(f => ({ ...f, custom_amount: e.target.value }))}
                  placeholder="0" style={{ width: '100%', padding: '12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f59e0b', fontSize: 28, fontWeight: 800, textAlign: 'center', outline: 'none' }} />
              </div>
            )}
          </div>

          <div style={{ padding: '20px 24px' }}>
            {/* Step: info (identification client) */}
            {step === 'info' && (
              <div>
                <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16 }}>
                  Identifiez-vous pour bénéficier de votre remise fidélité Afrik'Fid (optionnel)
                </p>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 6, fontWeight: 600 }}>Numéro de téléphone</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+2250700000000"
                    style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={lookupClient}
                    style={{ flex: 1, padding: '12px', background: '#f59e0b', border: 'none', borderRadius: 8, color: '#0f172a', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                    Continuer
                  </button>
                  <button onClick={() => setStep('payment')}
                    style={{ padding: '12px 16px', background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                    Invité
                  </button>
                </div>
              </div>
            )}

            {/* Step: payment */}
            {step === 'payment' && (
              <div>
                {/* Client badge */}
                {clientInfo && (
                  <div style={{ background: `${LOYALTY_COLOR[clientInfo.loyaltyStatus]}22`, border: `1px solid ${LOYALTY_COLOR[clientInfo.loyaltyStatus]}44`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{clientInfo.fullName}</div>
                      <div style={{ fontSize: 12, color: LOYALTY_COLOR[clientInfo.loyaltyStatus], fontWeight: 700 }}>{clientInfo.loyaltyStatus} — {clientInfo.clientRebatePercent}% de remise</div>
                    </div>
                    <div style={{ fontSize: 22 }}>{clientInfo.loyaltyStatus === 'ROYAL' ? '👑' : clientInfo.loyaltyStatus === 'GOLD' ? '🥇' : clientInfo.loyaltyStatus === 'LIVE' ? '⭐' : '🔵'}</div>
                  </div>
                )}

                {/* Recap remise */}
                {amount > 0 && (
                  <div style={{ background: '#0f172a', borderRadius: 10, padding: 14, marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, color: '#64748b' }}>Montant brut</span>
                      <span style={{ fontSize: 13, color: '#f1f5f9' }}>{fmt(amount)} XOF</span>
                    </div>
                    {rebateAmount > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: '#64748b' }}>Remise ({Y}%)</span>
                        <span style={{ fontSize: 13, color: '#10b981' }}>- {fmt(rebateAmount)} XOF</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #334155', paddingTop: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>Vous payez</span>
                      <span style={{ fontSize: 16, fontWeight: 800, color: '#f59e0b' }}>{fmt(toPay)} XOF</span>
                    </div>
                    {linkInfo.rebateMode === 'cashback' && rebateAmount > 0 && (
                      <div style={{ fontSize: 11, color: '#10b981', marginTop: 6, textAlign: 'center' }}>
                        + {fmt(rebateAmount)} XOF seront crédités sur votre portefeuille Afrik'Fid
                      </div>
                    )}
                  </div>
                )}

                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>Choisir l'opérateur Mobile Money</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                  {OPERATORS.map(op => (
                    <button key={op.code} onClick={() => setForm(f => ({ ...f, operator: op.code }))}
                      style={{ padding: '10px 6px', border: `2px solid ${form.operator === op.code ? op.color : '#334155'}`, borderRadius: 10, background: form.operator === op.code ? `${op.color}22` : '#0f172a', cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: 20 }}>{op.icon}</div>
                      <div style={{ fontSize: 10, color: form.operator === op.code ? op.color : '#64748b', marginTop: 4, fontWeight: 600 }}>{op.name.split(' ')[0]}</div>
                    </button>
                  ))}
                </div>

                {form.operator && (
                  <button onClick={pay} disabled={processing || !amount}
                    style={{ width: '100%', padding: '14px', background: processing ? '#334155' : 'linear-gradient(135deg, #f59e0b, #ef4444)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: processing ? 'default' : 'pointer', fontSize: 16 }}>
                    {processing ? '⏳ Traitement...' : `Payer ${fmt(toPay)} XOF`}
                  </button>
                )}

                {error && <div style={{ marginTop: 12, color: '#ef4444', fontSize: 13, textAlign: 'center' }}>{error}</div>}
              </div>
            )}

            {/* Step: done */}
            {step === 'done' && result && (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>Paiement initié !</h3>
                <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>Confirmez le paiement sur votre téléphone via OTP.</p>
                <div style={{ background: '#0f172a', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Référence</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#f59e0b' }}>{result.reference}</div>
                </div>
                {result.distribution?.clientRebate > 0 && (
                  <div style={{ marginTop: 12, fontSize: 13, color: '#10b981' }}>
                    💰 {fmt(result.distribution.clientRebate)} XOF de cashback seront crédités sur votre portefeuille
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#334155', marginTop: 16 }}>
          Paiement sécurisé • Afrik'Fid © 2026
        </p>
      </div>
    </div>
  )
}
