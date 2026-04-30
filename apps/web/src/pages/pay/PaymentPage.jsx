import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { publicApi as api } from '../../api.js'
import { useTransactionSSE } from '../../hooks/useSSE.js'
import {
  DevicePhoneMobileIcon,
  CreditCardIcon,
  CheckIcon,
  ArrowLeftIcon,
  XCircleIcon,
  StarIcon,
  TrophyIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  WalletIcon,
  GiftIcon,
  LockClosedIcon,
  CheckBadgeIcon,
} from '@heroicons/react/24/outline'
import { CheckCircleIcon as CheckCircleSolid, ShieldCheckIcon as ShieldSolid } from '@heroicons/react/24/solid'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

// ─── Logos opérateurs ─────────────────────────────────────────────────────────
const OPERATOR_IMAGE_MAP = {
  ORANGE: '/operators/orange.png',
  MTN:    '/operators/mtn.png',
  WAVE:   '/operators/wave.png',
  AIRTEL: '/operators/airtel.png',
  MOOV:   '/operators/moov.png',
  MPESA:  '/operators/mpesa.png',
}

const OPERATOR_SVG_FALLBACK = {
  ORANGE: ({ size = 36 }) => (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#FF6B00"/>
      <rect x="10" y="17" width="20" height="6" rx="3" fill="#fff"/>
    </svg>
  ),
  MTN: ({ size = 36 }) => (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#FFD700"/>
      <text x="20" y="25" textAnchor="middle" fontSize="10" fontWeight="800" fill="#000">MTN</text>
    </svg>
  ),
  WAVE: ({ size = 36 }) => (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#1DA1F2"/>
      <path d="M10 22 Q15 14 20 22 Q25 30 30 22" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    </svg>
  ),
  AIRTEL: ({ size = 36 }) => (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#E30613"/>
      <text x="20" y="25" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">AIRTEL</text>
    </svg>
  ),
  MOOV: ({ size = 36 }) => (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#00A651"/>
      <text x="20" y="25" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">MOOV</text>
    </svg>
  ),
  MPESA: ({ size = 36 }) => (
    <svg viewBox="0 0 40 40" width={size} height={size}>
      <circle cx="20" cy="20" r="20" fill="#00a550"/>
      <text x="20" y="26" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#fff">M-PESA</text>
    </svg>
  ),
}

function OperatorLogo({ code, size = 36 }) {
  const [imgFailed, setImgFailed] = React.useState(false)
  const imgSrc = OPERATOR_IMAGE_MAP[code]
  const FallbackSvg = OPERATOR_SVG_FALLBACK[code]
  if (!imgFailed && imgSrc) {
    return (
      <img src={imgSrc} alt={code} width={size} height={size}
        onError={() => setImgFailed(true)}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6 }} />
    )
  }
  return FallbackSvg ? <FallbackSvg size={size} /> : null
}

const MM_OPERATORS = [
  { code: 'ORANGE', name: 'Orange Money', color: '#FF6B00' },
  { code: 'MTN',    name: 'MTN MoMo',     color: '#FFD700' },
  { code: 'WAVE',   name: 'Wave',         color: '#1DA1F2' },
  { code: 'AIRTEL', name: 'Airtel Money', color: '#E30613' },
  { code: 'MOOV',   name: 'Moov Money',   color: '#00A651' },
  { code: 'MPESA',  name: 'M-Pesa',       color: '#00a550' },
]

const USSD_INSTRUCTIONS = {
  ORANGE: {
    CI: { ussd: '#144#', steps: ['Composez #144#', 'Choisissez "Paiement marchand"', 'Entrez le code marchand', 'Saisissez le montant', 'Confirmez avec votre code secret'] },
    SN: { ussd: '#144#', steps: ['Composez #144#', 'Sélectionnez "Paiement"', 'Entrez le numéro marchand', 'Validez avec votre PIN'] },
    ML: { ussd: '#144#', steps: ['Composez #144#', 'Choisissez "Paiement"', 'Entrez les informations marchand', 'Confirmez'] },
    BF: { ussd: '#144#', steps: ['Composez #144#', 'Sélectionnez "Transfert/Paiement"', 'Suivez les instructions', 'Confirmez avec votre code secret'] },
    '*': { ussd: '#144#', steps: ['Composez #144#', 'Sélectionnez "Paiement marchand"', 'Entrez le numéro / code marchand', 'Confirmez avec votre code secret Orange Money'] },
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
const LOYALTY_ICON  = {
  OPEN:  <UserCircleIcon style={{ width: 14, height: 14, display: 'inline', verticalAlign: 'middle' }} />,
  LIVE:  <StarIcon style={{ width: 14, height: 14, display: 'inline', verticalAlign: 'middle' }} />,
  GOLD:  <ShieldCheckIcon style={{ width: 14, height: 14, display: 'inline', verticalAlign: 'middle' }} />,
  ROYAL: <TrophyIcon style={{ width: 14, height: 14, display: 'inline', verticalAlign: 'middle' }} />,
}

const COUNTRIES = [
  { code: 'CI', flag: '🇨🇮', name: 'Côte d\'Ivoire', dial: '+225', digits: 10 },
  { code: 'SN', flag: '🇸🇳', name: 'Sénégal',        dial: '+221', digits: 9  },
  { code: 'ML', flag: '🇲🇱', name: 'Mali',            dial: '+223', digits: 8  },
  { code: 'BF', flag: '🇧🇫', name: 'Burkina Faso',    dial: '+226', digits: 8  },
  { code: 'GN', flag: '🇬🇳', name: 'Guinée',          dial: '+224', digits: 9  },
  { code: 'TG', flag: '🇹🇬', name: 'Togo',            dial: '+228', digits: 8  },
  { code: 'BJ', flag: '🇧🇯', name: 'Bénin',           dial: '+229', digits: 8  },
  { code: 'CM', flag: '🇨🇲', name: 'Cameroun',        dial: '+237', digits: 9  },
  { code: 'KE', flag: '🇰🇪', name: 'Kenya',           dial: '+254', digits: 9  },
  { code: 'TZ', flag: '🇹🇿', name: 'Tanzanie',        dial: '+255', digits: 9  },
  { code: 'GH', flag: '🇬🇭', name: 'Ghana',           dial: '+233', digits: 9  },
]

function buildE164(localNumber, dial) {
  let n = localNumber.replace(/\D/g, '')
  if (n.startsWith('00')) n = n.slice(2)
  const dialDigits = dial.replace('+', '')
  if (n.startsWith(dialDigits)) n = n.slice(dialDigits.length)
  if (n.startsWith('0')) n = n.slice(1)
  return dial + n
}

function PhoneInput({ countryCode, localPhone, onChange }) {
  const country = COUNTRIES.find(c => c.code === countryCode) || COUNTRIES[0]
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      <select value={countryCode} onChange={e => onChange(e.target.value, localPhone)}
        style={{ padding: '11px 8px', background: 'var(--af-surface-3)', border: '1.5px solid var(--af-border)', borderRadius: 10, color: 'var(--af-text)', fontSize: 13, flexShrink: 0, outline: 'none' }}>
        {COUNTRIES.map(c => (
          <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>
        ))}
      </select>
      <input type="tel" value={localPhone} onChange={e => onChange(countryCode, e.target.value)}
        placeholder={`Ex: ${'0' + '7'.repeat(country.digits - 1)}`}
        style={{ flex: 1, padding: '11px 14px', background: 'var(--af-surface-3)', border: '1.5px solid var(--af-border)', borderRadius: 10, color: 'var(--af-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  )
}

// ─── Barre de confiance ────────────────────────────────────────────────────────
function TrustBar() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 20, flexWrap: 'wrap' }}>
      {[
        { icon: <LockClosedIcon style={{ width: 13, height: 13 }} />, label: 'Chiffrement SSL 256-bit' },
        { icon: <ShieldSolid style={{ width: 13, height: 13 }} />, label: 'Paiement sécurisé' },
        { icon: <CheckBadgeIcon style={{ width: 13, height: 13 }} />, label: 'Certifié Afrik\'Fid' },
      ].map(({ icon, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>
          {icon}
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

export default function PaymentPage() {
  const { code } = useParams()
  const [linkInfo, setLinkInfo] = useState(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState('identify')
  const [paymentType, setPaymentType] = useState(null)
  const [form, setForm] = useState({ phone: '', localPhone: '', countryCode: 'CI', afrikfid_id: '', cardOrId: '', mode: 'phone', operator: '', custom_amount: '' })
  const setPhone = (countryCode, localPhone) => {
    const e164 = localPhone.trim() ? buildE164(localPhone, COUNTRIES.find(c => c.code === countryCode)?.dial || '+225') : ''
    setForm(f => ({ ...f, countryCode, localPhone, phone: e164 }))
  }
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

  const detectIdentifierType = (raw) => {
    const trimmed = String(raw || '').trim()
    if (!trimmed) return 'empty'
    const digits = trimmed.replace(/\s+/g, '')
    if (/^2014\d{8}$/.test(digits)) return 'card'
    if (/^AFD-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(trimmed)) return 'afrikfid_legacy'
    return 'phone'
  }
  const identifierType = form.mode === 'card' ? detectIdentifierType(form.cardOrId) : 'phone'
  const [identifying, setIdentifying] = useState(false)

  const lookupClient = async () => {
    const payload = {}
    if (form.mode === 'card' && form.cardOrId?.trim()) {
      payload.identifier = form.cardOrId.trim().replace(/\s+/g, '')
    } else if (form.phone) {
      payload.phone = form.phone
    } else {
      setStep('method'); return
    }
    setIdentifying(true)
    try {
      const { data } = await api.post('/payment-links/' + code + '/identify-client', payload)
      setClientInfo(data.found ? data.client : null)
      if (data.found && data.client?.afrikfidId) {
        setForm(f => ({ ...f, afrikfid_id: data.client.afrikfidId }))
      }
    } catch { setClientInfo(null) }
    finally { setIdentifying(false) }
    setStep('method')
  }

  const amount = linkInfo?.amount || parseFloat(form.custom_amount) || 0
  const Y = clientInfo ? clientInfo.clientRebatePercent : 0
  const rebateAmount = Math.round((amount * Y) / 100)
  const toPay = linkInfo?.rebateMode === 'immediate' ? amount - rebateAmount : amount
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

  const payWithPoints = async () => {
    if (!clientInfo?.rewardPoints) return
    setProcessing(true); setPageError('')
    try {
      const { data } = await api.post('/payment-links/' + code + '/pay', {
        payment_method: 'reward_points',
        afrikfid_id: clientInfo.afrikfidId,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      setResult(data); setStep('done')
    } catch (err) {
      setPageError(err.response?.data?.message || err.response?.data?.error || 'Erreur lors du paiement par points')
    } finally { setProcessing(false) }
  }

  const payWithWallet = async () => {
    if (!clientInfo?.afrikfidWalletBalance) return
    setProcessing(true); setPageError('')
    try {
      const { data } = await api.post('/payment-links/' + code + '/pay', {
        payment_method: 'wallet',
        afrikfid_id: clientInfo.afrikfidId,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      setResult(data); setStep('done')
    } catch (err) {
      setPageError(err.response?.data?.message || err.response?.data?.error || 'Erreur lors du paiement par wallet')
    } finally { setProcessing(false) }
  }

  const payWithGiftCard = async () => {
    if (!clientInfo?.giftCard) return
    setProcessing(true); setPageError('')
    try {
      const { data } = await api.post('/payment-links/' + code + '/pay', {
        payment_method: 'gift_card',
        gift_card_numero: clientInfo.giftCard.numero,
        afrikfid_id: clientInfo.afrikfidId,
        custom_amount: linkInfo?.amount ? undefined : parseFloat(form.custom_amount),
      })
      setResult(data); setStep('done')
    } catch (err) {
      setPageError(err.response?.data?.message || err.response?.data?.error || 'Erreur lors du paiement par carte cadeau')
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
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <XCircleIcon style={{ width: 36, height: 36, color: '#ef4444' }} />
        </div>
        <h2 style={{ color: '#ef4444', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Lien invalide</h2>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>{error}</p>
      </div>
    </Screen>
  )

  if (!linkInfo) return (
    <Screen>
      <div style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Chargement du paiement…</p>
      </div>
    </Screen>
  )

  const stepIdx = { identify: 0, method: 1, mobile: 2, card: 2, points: 2, wallet: 2, gift_card: 2, done: 3 }[step] || 0
  const stepLabels = ['Identification', 'Méthode', 'Paiement']
  const ussdInfo = form.operator ? getUssdInstructions(form.operator, countryCode) : null

  return (
    <Screen>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .pay-card { animation: fadeIn 0.3s ease; }
        .pay-method-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.18); }
        .pay-method-btn { transition: all 0.18s ease; }
        .pay-op-btn:hover { transform: scale(1.04); }
        .pay-op-btn { transition: all 0.15s ease; }
      `}</style>

      <div style={{ width: '100%', maxWidth: 460 }}>

        {/* ── Header marchand ── */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {/* Badge SSL */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, padding: '4px 12px', marginBottom: 16 }}>
            <LockClosedIcon style={{ width: 11, height: 11, color: '#10b981' }} />
            <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600, letterSpacing: 0.3 }}>Connexion sécurisée SSL</span>
          </div>

          {/* Logo marchand */}
          {linkInfo.merchantLogo ? (
            <div style={{ marginBottom: 12 }}>
              <img src={linkInfo.merchantLogo} alt={linkInfo.merchantName}
                style={{ width: 68, height: 68, borderRadius: 18, objectFit: 'contain', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }} />
            </div>
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg, var(--af-accent), var(--af-brand))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, marginBottom: 12, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', border: '2px solid rgba(255,255,255,0.15)' }}>
              {linkInfo.merchantName?.[0]?.toUpperCase() || 'A'}
            </div>
          )}

          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4, letterSpacing: -0.3 }}>{linkInfo.merchantName}</h1>
          {linkInfo.description && <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 }}>{linkInfo.description}</p>}
        </div>

        {/* ── Carte principale ── */}
        <div className="pay-card" style={{ background: 'var(--af-surface)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.06) inset', overflow: 'hidden' }}>

          {/* Montant */}
          <div style={{ padding: '22px 26px 16px', borderBottom: '1px solid var(--af-border)', textAlign: 'center', background: 'linear-gradient(180deg, rgba(var(--af-accent-rgb,99,102,241),0.06) 0%, transparent 100%)' }}>
            <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Montant à payer</div>
            {linkInfo.amount ? (
              <div style={{ fontSize: 38, fontWeight: 800, color: 'var(--af-accent)', letterSpacing: -1, lineHeight: 1 }}>
                {fmt(linkInfo.amount)}<span style={{ fontSize: 16, color: 'var(--af-text-muted)', fontWeight: 600, marginLeft: 6 }}>{linkInfo.currency}</span>
              </div>
            ) : (
              <div>
                <input type="number" min="0" step="100" value={form.custom_amount}
                  onChange={e => setForm(f => ({ ...f, custom_amount: e.target.value }))} placeholder="0"
                  style={{ width: '100%', padding: '8px', background: 'var(--af-surface-3)', border: '1.5px solid var(--af-border)', borderRadius: 10, color: 'var(--af-accent)', fontSize: 28, fontWeight: 800, textAlign: 'center', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 4 }}>{linkInfo.currency}</div>
              </div>
            )}
          </div>

          {/* Stepper */}
          {step !== 'done' && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0, padding: '14px 24px 0' }}>
              {stepLabels.map((s, i) => (
                <React.Fragment key={s}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                      background: i < stepIdx ? '#10b981' : i === stepIdx ? 'var(--af-accent)' : 'var(--af-surface-3)',
                      color: i <= stepIdx ? '#fff' : 'var(--af-text-muted)',
                      border: '2px solid ' + (i === stepIdx ? 'var(--af-accent)' : i < stepIdx ? '#10b981' : 'var(--af-border)'),
                      transition: 'all 0.3s',
                    }}>
                      {i < stepIdx ? <CheckIcon style={{ width: 12, height: 12 }} /> : i + 1}
                    </div>
                    <span style={{ fontSize: 10, color: i === stepIdx ? 'var(--af-text)' : 'var(--af-text-muted)', fontWeight: i === stepIdx ? 600 : 400, whiteSpace: 'nowrap' }}>{s}</span>
                  </div>
                  {i < 2 && (
                    <div style={{ flex: 1, height: 2, background: i < stepIdx ? '#10b981' : 'var(--af-border)', margin: '0 4px', marginBottom: 18, transition: 'background 0.3s', minWidth: 20 }} />
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          <div style={{ padding: '18px 24px 22px' }}>

            {/* ÉTAPE 1 : Identification */}
            {step === 'identify' && (
              <div>
                <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ShieldSolid style={{ width: 18, height: 18, color: 'var(--af-accent)', flexShrink: 0 }} />
                  <p style={{ fontSize: 12, color: 'var(--af-text-muted)', margin: 0, lineHeight: 1.5 }}>
                    Identifiez-vous pour bénéficier de votre <span style={{ color: 'var(--af-text)', fontWeight: 600 }}>remise fidélité</span> (optionnel)
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 6, marginBottom: 14, padding: 3, background: 'var(--af-surface-3)', borderRadius: 12, border: '1px solid var(--af-border)' }}>
                  <button onClick={() => setForm(f => ({ ...f, mode: 'phone' }))}
                    style={{ flex: 1, padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      background: form.mode === 'phone' ? 'var(--af-accent)' : 'transparent',
                      color: form.mode === 'phone' ? '#fff' : 'var(--af-text-muted)', transition: 'all 0.2s' }}>
                    <DevicePhoneMobileIcon style={{ width: 14, height: 14 }} />Téléphone
                  </button>
                  <button onClick={() => setForm(f => ({ ...f, mode: 'card' }))}
                    style={{ flex: 1, padding: '9px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      background: form.mode === 'card' ? 'var(--af-accent)' : 'transparent',
                      color: form.mode === 'card' ? '#fff' : 'var(--af-text-muted)', transition: 'all 0.2s' }}>
                    <CreditCardIcon style={{ width: 14, height: 14 }} />Carte fidélité
                  </button>
                </div>

                {form.mode === 'phone' ? (
                  <>
                    <label style={labelStyle}>Numéro de téléphone</label>
                    <PhoneInput countryCode={form.countryCode} localPhone={form.localPhone} onChange={setPhone} />
                  </>
                ) : (
                  <>
                    <label style={labelStyle}>Numéro de carte ou identifiant</label>
                    <input type="text" inputMode="text" autoComplete="off" value={form.cardOrId}
                      onChange={e => setForm(f => ({ ...f, cardOrId: e.target.value }))}
                      placeholder="2014 1234 5678"
                      style={{ width: '100%', padding: '11px 14px', background: 'var(--af-surface-3)', border: '1.5px solid var(--af-border)', borderRadius: 10, color: 'var(--af-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 6, letterSpacing: 1 }} />
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 14, minHeight: 14 }}>
                      {form.cardOrId.trim() === '' && '12 chiffres au dos de votre carte (préfixe 2014)'}
                      {form.cardOrId.trim() !== '' && identifierType === 'card' && <span style={{ color: '#10b981' }}>✓ Carte fidélité détectée</span>}
                      {form.cardOrId.trim() !== '' && identifierType === 'afrikfid_legacy' && <span style={{ color: '#10b981' }}>✓ Identifiant AfrikFid détecté</span>}
                      {form.cardOrId.trim() !== '' && identifierType === 'phone' && <span style={{ color: '#f59e0b' }}>Format non reconnu — vérifiez votre numéro</span>}
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={lookupClient} disabled={identifying}
                    style={{ ...btnPrimary, opacity: identifying ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    {identifying && <Spinner />}
                    {identifying ? 'Recherche...' : 'Continuer'}
                  </button>
                  <button onClick={() => setStep('method')} disabled={identifying}
                    style={{ ...btnGhost, opacity: identifying ? 0.5 : 1 }}>Payer sans compte</button>
                </div>
              </div>
            )}

            {/* ÉTAPE 2 : Méthode */}
            {step === 'method' && (
              <div>
                {clientInfo && (
                  <div style={{ background: LOYALTY_COLOR[clientInfo.loyaltyStatus] + '15', border: '1px solid ' + LOYALTY_COLOR[clientInfo.loyaltyStatus] + '40', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: LOYALTY_COLOR[clientInfo.loyaltyStatus] + '25', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {LOYALTY_ICON[clientInfo.loyaltyStatus]}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)' }}>{clientInfo.fullName}</div>
                      <div style={{ fontSize: 11, color: LOYALTY_COLOR[clientInfo.loyaltyStatus], fontWeight: 600, marginTop: 1 }}>
                        {clientInfo.loyaltyStatus} · {clientInfo.clientRebatePercent}% de remise appliquée
                      </div>
                    </div>
                  </div>
                )}
                {!clientInfo && form.phone && (
                  <div style={{ background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)', borderRadius: 10, padding: '9px 14px', marginBottom: 14, fontSize: 12, color: 'var(--af-text-muted)' }}>
                    Aucun compte trouvé — paiement en mode invité
                  </div>
                )}

                <p style={{ fontSize: 10, color: 'var(--af-text-muted)', marginBottom: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Choisissez votre méthode</p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <button className="pay-method-btn" onClick={() => { setPaymentType('mobile_money'); setStep('mobile') }}
                    style={{ padding: '16px 10px', border: '1.5px solid var(--af-border)', borderRadius: 14, background: 'var(--af-surface-3)', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                      <DevicePhoneMobileIcon style={{ width: 24, height: 24, color: 'var(--af-accent)' }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--af-text)', marginBottom: 2 }}>Mobile Money</div>
                    <div style={{ fontSize: 10, color: 'var(--af-text-muted)' }}>Orange, MTN, Wave…</div>
                  </button>
                  <button className="pay-method-btn" onClick={() => { setPaymentType('card'); setStep('card') }}
                    style={{ padding: '16px 10px', border: '1.5px solid var(--af-border)', borderRadius: 14, background: 'var(--af-surface-3)', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,91,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                      <CreditCardIcon style={{ width: 24, height: 24, color: '#635bff' }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--af-text)', marginBottom: 2 }}>Carte bancaire</div>
                    <div style={{ fontSize: 10, color: 'var(--af-text-muted)' }}>Visa, Mastercard</div>
                  </button>
                </div>

                {clientInfo?.rewardPoints > 0 && (() => {
                  const POINT_VALUE = 1
                  const pointsNeeded = Math.ceil(amount / POINT_VALUE)
                  const canPay = clientInfo.rewardPoints >= pointsNeeded && amount > 0
                  return (
                    <button className="pay-method-btn" onClick={() => { if (canPay) { setPaymentType('reward_points'); setStep('points') } }} disabled={!canPay}
                      style={{ width: '100%', padding: '13px 16px', marginBottom: 8, border: '1.5px solid ' + (canPay ? '#10b981' : 'var(--af-border)'), borderRadius: 12, background: canPay ? 'rgba(16,185,129,0.07)' : 'var(--af-surface-3)', cursor: canPay ? 'pointer' : 'not-allowed', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, opacity: canPay ? 1 : 0.5 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: canPay ? 'rgba(16,185,129,0.12)' : 'var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <StarIcon style={{ width: 20, height: 20, color: canPay ? '#10b981' : 'var(--af-text-muted)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: canPay ? '#10b981' : 'var(--af-text-muted)' }}>Points récompense</div>
                        <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>
                          {fmt(clientInfo.rewardPoints)} pts · {amount > 0 ? `${pointsNeeded} requis` : 'Entrez un montant'}
                        </div>
                      </div>
                    </button>
                  )
                })()}

                {clientInfo?.afrikfidWalletBalance > 0 && (() => {
                  const balance = clientInfo.afrikfidWalletBalance
                  const canPay = balance >= amount && amount > 0
                  return (
                    <button className="pay-method-btn" onClick={() => { if (canPay) { setPaymentType('wallet'); setStep('wallet') } }} disabled={!canPay}
                      style={{ width: '100%', padding: '13px 16px', marginBottom: 8, border: '1.5px solid ' + (canPay ? '#8b5cf6' : 'var(--af-border)'), borderRadius: 12, background: canPay ? 'rgba(139,92,246,0.07)' : 'var(--af-surface-3)', cursor: canPay ? 'pointer' : 'not-allowed', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, opacity: canPay ? 1 : 0.5 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: canPay ? 'rgba(139,92,246,0.12)' : 'var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <WalletIcon style={{ width: 20, height: 20, color: canPay ? '#8b5cf6' : 'var(--af-text-muted)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: canPay ? '#8b5cf6' : 'var(--af-text-muted)' }}>Wallet Afrik'Fid</div>
                        <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>
                          Solde : {fmt(balance)} {linkInfo.currency}{!canPay && amount > 0 ? ' · insuffisant' : ''}
                        </div>
                      </div>
                    </button>
                  )
                })()}

                {clientInfo?.giftCard?.solde > 0 && (() => {
                  const gc = clientInfo.giftCard
                  const canPay = gc.solde >= amount && amount > 0
                  return (
                    <button className="pay-method-btn" onClick={() => { if (canPay) { setPaymentType('gift_card'); setStep('gift_card') } }} disabled={!canPay}
                      style={{ width: '100%', padding: '13px 16px', border: '1.5px solid ' + (canPay ? '#f59e0b' : 'var(--af-border)'), borderRadius: 12, background: canPay ? 'rgba(245,158,11,0.07)' : 'var(--af-surface-3)', cursor: canPay ? 'pointer' : 'not-allowed', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, opacity: canPay ? 1 : 0.5 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: canPay ? 'rgba(245,158,11,0.12)' : 'var(--af-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <GiftIcon style={{ width: 20, height: 20, color: canPay ? '#f59e0b' : 'var(--af-text-muted)' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: canPay ? '#f59e0b' : 'var(--af-text-muted)' }}>Carte Cadeau</div>
                        <div style={{ fontSize: 10, color: 'var(--af-text-muted)', marginTop: 2 }}>
                          Solde : {fmt(gc.solde)} {linkInfo.currency}{!canPay && amount > 0 ? ' · insuffisant' : ''}
                        </div>
                      </div>
                    </button>
                  )
                })()}
              </div>
            )}

            {/* ÉTAPE 3a : Mobile Money */}
            {step === 'mobile' && (
              <div>
                <AmountRecap amount={amount} rebateAmount={rebateAmount} Y={Y} toPay={toPay} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                <label style={labelStyle}>Opérateur Mobile Money</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                  {MM_OPERATORS.map(op => {
                    const selected = form.operator === op.code
                    return (
                      <button key={op.code} className="pay-op-btn" onClick={() => setForm(f => ({ ...f, operator: op.code }))}
                        style={{ padding: '10px 4px', border: '2px solid ' + (selected ? op.color : 'var(--af-border)'), borderRadius: 10, background: selected ? op.color + '1a' : 'var(--af-surface-3)', cursor: 'pointer', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                          <OperatorLogo code={op.code} size={34} />
                        </div>
                        <div style={{ fontSize: 9, color: selected ? op.color : 'var(--af-text-muted)', fontWeight: 700 }}>{op.name.split(' ')[0]}</div>
                      </button>
                    )
                  })}
                </div>

                {!form.phone && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Numéro Mobile Money</label>
                    <PhoneInput countryCode={form.countryCode} localPhone={form.localPhone} onChange={setPhone} />
                  </div>
                )}

                {ussdInfo && (
                  <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                      {ussdInfo.ussd ? `Composez ${ussdInfo.ussd} sur votre téléphone` : 'Comment payer'}
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 16 }}>
                      {ussdInfo.steps.map((s, i) => (
                        <li key={i} style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 3 }}>{s}</li>
                      ))}
                    </ol>
                    {ussdInfo.ussd && (
                      <div style={{ marginTop: 8, background: 'var(--af-surface-3)', borderRadius: 7, padding: '6px 12px', display: 'inline-block' }}>
                        <span style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace', color: 'var(--af-accent)', letterSpacing: 2 }}>{ussdInfo.ussd}</span>
                      </div>
                    )}
                  </div>
                )}

                {pageError && <ErrorBox>{pageError}</ErrorBox>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('method')} style={btnBack}><ArrowLeftIcon style={{ width: 16, height: 16 }} /></button>
                  <button onClick={payMobile} disabled={processing || !amount || !form.operator}
                    style={{ ...btnPrimary, flex: 1, opacity: (!amount || !form.operator) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    {processing && <Spinner />}
                    {processing ? 'Traitement...' : `Payer ${fmt(toPay)} ${linkInfo.currency}`}
                  </button>
                </div>
              </div>
            )}

            {/* ÉTAPE 3b : Carte bancaire */}
            {step === 'card' && (
              <div>
                <AmountRecap amount={amount} rebateAmount={0} Y={0} toPay={amount} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                <div style={{ background: 'rgba(99,91,255,0.07)', border: '1px solid rgba(99,91,255,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(99,91,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <LockClosedIcon style={{ width: 20, height: 20, color: '#635bff' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--af-text)', fontWeight: 700, marginBottom: 2 }}>Paiement sécurisé 3D Secure</div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>Visa et Mastercard · Redirection vers Stripe</div>
                  </div>
                </div>
                {pageError && <ErrorBox>{pageError}</ErrorBox>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStep('method')} style={btnBack}><ArrowLeftIcon style={{ width: 16, height: 16 }} /></button>
                  <button onClick={payCard} disabled={processing || !amount}
                    style={{ ...btnPrimary, flex: 1, background: processing ? 'var(--af-border)' : '#635bff', opacity: !amount ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                    {processing && <Spinner />}
                    {processing ? 'Redirection...' : `Payer ${fmt(amount)} ${linkInfo.currency} par carte`}
                  </button>
                </div>
              </div>
            )}

            {/* ÉTAPE 3c : Points récompense */}
            {step === 'points' && (() => {
              const POINT_VALUE = 1
              const pointsNeeded = Math.ceil(amount / POINT_VALUE)
              return (
                <div>
                  <AmountRecap amount={amount} rebateAmount={0} Y={0} toPay={amount} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                  <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#10b981', marginBottom: 4 }}>Paiement par points récompense</div>
                    <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--af-text)' }}>{fmt(pointsNeeded)} pts</span> seront déduits
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 3 }}>Solde après : {fmt(clientInfo.rewardPoints - pointsNeeded)} pts</div>
                  </div>
                  {pageError && <ErrorBox>{pageError}</ErrorBox>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setStep('method')} style={btnBack}><ArrowLeftIcon style={{ width: 16, height: 16 }} /></button>
                    <button onClick={payWithPoints} disabled={processing}
                      style={{ ...btnPrimary, flex: 1, background: processing ? 'var(--af-border)' : 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                      {processing && <Spinner />}
                      {processing ? 'Traitement...' : `Payer (${fmt(pointsNeeded)} pts)`}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* ÉTAPE 3d : Wallet */}
            {step === 'wallet' && (() => {
              const balance = clientInfo?.afrikfidWalletBalance || 0
              return (
                <div>
                  <AmountRecap amount={amount} rebateAmount={0} Y={0} toPay={amount} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                  <div style={{ background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#8b5cf6', marginBottom: 4 }}>Paiement par Wallet Afrik'Fid</div>
                    <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--af-text)' }}>{fmt(amount)} {linkInfo.currency}</span> débités du wallet
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 3 }}>Solde après : {fmt(balance - amount)} {linkInfo.currency}</div>
                  </div>
                  {pageError && <ErrorBox>{pageError}</ErrorBox>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setStep('method')} style={btnBack}><ArrowLeftIcon style={{ width: 16, height: 16 }} /></button>
                    <button onClick={payWithWallet} disabled={processing}
                      style={{ ...btnPrimary, flex: 1, background: processing ? 'var(--af-border)' : 'linear-gradient(135deg, #8b5cf6, #6d28d9)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                      {processing && <Spinner />}
                      {processing ? 'Traitement...' : `Payer ${fmt(amount)} ${linkInfo.currency} via Wallet`}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* ÉTAPE 3e : Carte Cadeau */}
            {step === 'gift_card' && (() => {
              const gc = clientInfo?.giftCard || {}
              return (
                <div>
                  <AmountRecap amount={amount} rebateAmount={0} Y={0} toPay={amount} rebateMode={linkInfo.rebateMode} currency={linkInfo.currency} />
                  <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <GiftIcon style={{ width: 14, height: 14 }} />Paiement par carte cadeau
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--af-text)' }}>{fmt(amount)} {linkInfo.currency}</span> débités de votre carte
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 3 }}>Solde après : {fmt((gc.solde || 0) - amount)} {linkInfo.currency}</div>
                  </div>
                  {pageError && <ErrorBox>{pageError}</ErrorBox>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setStep('method')} style={btnBack}><ArrowLeftIcon style={{ width: 16, height: 16 }} /></button>
                    <button onClick={payWithGiftCard} disabled={processing}
                      style={{ ...btnPrimary, flex: 1, background: processing ? 'var(--af-border)' : 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                      {processing && <Spinner />}
                      {processing ? 'Traitement...' : `Payer ${fmt(amount)} ${linkInfo.currency} via Carte Cadeau`}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* SUCCÈS */}
            {step === 'done' && result && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 0 0 8px rgba(16,185,129,0.06)' }}>
                  <CheckCircleSolid style={{ width: 44, height: 44, color: '#10b981' }} />
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: '#10b981', marginBottom: 8 }}>
                  {paymentType === 'mobile_money' ? 'Paiement initié !'
                    : (paymentType === 'reward_points' || paymentType === 'wallet' || paymentType === 'gift_card') ? 'Paiement effectué !'
                    : 'Traitement en cours…'}
                </h3>
                <p style={{ color: 'var(--af-text-muted)', fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
                  {paymentType === 'mobile_money' ? 'Confirmez sur votre téléphone via le menu USSD ou OTP.'
                    : paymentType === 'reward_points' ? `${result.pointsUsed ?? ''} pts déduits de votre compte fidélité.`
                    : paymentType === 'gift_card' ? 'Montant débité de votre carte cadeau Afrik\'Fid.'
                    : paymentType === 'wallet' ? 'Montant débité de votre wallet Afrik\'Fid.'
                    : 'Votre paiement est en cours de traitement.'}
                </p>
                <div style={{ background: 'var(--af-surface-3)', borderRadius: 12, padding: '12px 16px', border: '1px solid var(--af-border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Référence de transaction</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--af-accent)', fontWeight: 700 }}>{result.reference || result.transaction?.reference}</div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── Footer de confiance ── */}
        <TrustBar />
        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 12 }}>
          Afrik'Fid · Plateforme de fidélité sécurisée · © 2026
        </p>

      </div>
    </Screen>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function Spinner() {
  return <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
}

function ErrorBox({ children }) {
  return (
    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 9, padding: '9px 13px', marginBottom: 12, color: '#ef4444', fontSize: 12, textAlign: 'center' }}>
      {children}
    </div>
  )
}

function Screen({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0f1117 0%, #1a1f2e 50%, #0f1117 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      {children}
    </div>
  )
}

function AmountRecap({ amount, rebateAmount, Y, toPay, rebateMode, currency }) {
  if (!amount) return null
  return (
    <div style={{ background: 'var(--af-surface-3)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, border: '1px solid var(--af-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Montant brut</span>
        <span style={{ fontSize: 12, color: 'var(--af-text)', fontWeight: 600 }}>{fmt(amount)} {currency}</span>
      </div>
      {rebateAmount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--af-text-muted)' }}>Remise fidélité ({Y}%)</span>
          <span style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>− {fmt(rebateAmount)} {currency}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--af-border)', paddingTop: 8, marginTop: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)' }}>Vous payez</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--af-accent)' }}>{fmt(toPay)} {currency}</span>
      </div>
      {rebateMode === 'cashback' && rebateAmount > 0 && (
        <div style={{ fontSize: 11, color: '#10b981', marginTop: 6, textAlign: 'center', paddingTop: 6, borderTop: '1px dashed rgba(16,185,129,0.25)' }}>
          + {fmt(rebateAmount)} {currency} remboursés sur votre portefeuille Afrik'Fid
        </div>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const labelStyle = { display: 'block', fontSize: 10, color: 'var(--af-text-muted)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }
const btnPrimary = { flex: 1, padding: '13px', background: 'linear-gradient(135deg, var(--af-accent), var(--af-brand))', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 14, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }
const btnGhost = { padding: '13px 16px', background: 'transparent', border: '1.5px solid var(--af-border)', borderRadius: 10, color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 500 }
const btnBack = { padding: '12px 16px', background: 'transparent', border: '1.5px solid var(--af-border)', borderRadius: 10, color: 'var(--af-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }
