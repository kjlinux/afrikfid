import React, { useEffect, useState, useCallback } from 'react'
import { ArrowPathIcon, ArrowUpCircleIcon, BellAlertIcon } from '@heroicons/react/24/outline'
import api from '../../api.js'
import { useAuth, Breadcrumb } from '../../App.jsx'
import { Badge, Spinner, Modal, Input, Select, Button, Pagination, InfoTooltip } from '../../components/ui.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'

const SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS']
const TRIGGER_TYPES = ['BIENVENUE', '1ER_ACHAT', 'ABSENCE', 'ALERTE_R', 'A_RISQUE', 'WIN_BACK', 'ANNIVERSAIRE', 'PALIER']
const TRIGGER_TIPS = {
  BIENVENUE: 'Nouveau client inscrit au programme',
  '1ER_ACHAT': 'Premier achat effectué',
  ABSENCE: 'Client sans achat depuis trop longtemps',
  ALERTE_R: 'Score Récence RFM en chute',
  A_RISQUE: 'Client à fort risque de churn',
  WIN_BACK: 'Client inactif depuis très longtemps — tentative de récupération',
  ANNIVERSAIRE: 'Jour ou mois d\'anniversaire du client',
  PALIER: 'Client proche du palier fidélité suivant',
}
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
const LOYALTY_STATUSES = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE']
const STATUS_COLORS = { draft: 'gray', scheduled: 'blue', running: 'yellow', completed: 'green', cancelled: 'red' }

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--af-border)' }
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-surface)' }
const tdBold = { ...td, color: 'var(--af-text)', fontWeight: 600 }

function UpgradeWall({ requiredPackage }) {
  const labels = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium' }
  return (
    <div style={{ background: 'var(--af-surface-2)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
      <BellAlertIcon style={{ width: 40, height: 40, color: 'var(--af-text-muted)', margin: '0 auto 16px' }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--af-text)', marginBottom: 8 }}>Fonctionnalité réservée au package Growth</div>
      <p style={{ fontSize: 13, color: 'var(--af-text-muted)', marginBottom: 20 }}>
        La gestion des campagnes et des triggers est disponible à partir du package{' '}
        <strong style={{ color: 'var(--af-text)' }}>{labels[requiredPackage] || requiredPackage}</strong>.
        Passez à un package supérieur pour envoyer des campagnes ciblées à vos clients fidélité.
      </p>
      <a href="/merchant/subscription" style={{ padding: '10px 24px', background: 'var(--af-accent)', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <ArrowUpCircleIcon style={{ width: 18, height: 18 }} />
        Upgrader mon package
      </a>
    </div>
  )
}

export default function MerchantCampaigns() {
  const { user } = useAuth()
  const [tab, setTab] = useState('campaigns')
  const [campaigns, setCampaigns] = useState([])
  const [triggers, setTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [upgradeNeeded, setUpgradeNeeded] = useState(null)
  const [waTemplates, setWaTemplates] = useState([])

  // Modale campagne RFM
  const [showCampModal, setShowCampModal] = useState(false)
  const [campForm, setCampForm] = useState({ name: '', target_segment: '', channel: 'whatsapp', message_template: '', template_name: '' })
  const [campError, setCampError] = useState('')
  const [campSubmitting, setCampSubmitting] = useState(false)

  // Modale campagne démographique
  const [showDemoModal, setShowDemoModal] = useState(false)
  const [demoForm, setDemoForm] = useState({
    name: '', channel: 'whatsapp', template_name: '', message_template: '',
    birth_months: [], cities: '', genders: [], age_min: '', age_max: '',
    loyalty_statuses: [], has_purchased: false, inactivity_days: '',
    min_purchases: '', min_amount: '', sectors: '',
  })
  const [demoPreview, setDemoPreview] = useState(null)
  const [demoPreviewLoading, setDemoPreviewLoading] = useState(false)
  const [demoError, setDemoError] = useState('')
  const [demoSubmitting, setDemoSubmitting] = useState(false)

  // Modale trigger
  const [showTrigModal, setShowTrigModal] = useState(false)
  const [trigForm, setTrigForm] = useState({ trigger_type: '', target_segment: '', channel: 'whatsapp', message_template: '', cooldown_hours: 24, template_name: '' })
  const [trigError, setTrigError] = useState('')
  const [trigSubmitting, setTrigSubmitting] = useState(false)

  const limit = 20

  useEffect(() => {
    api.get('/campaigns/wa-templates').then(r => {
      if (r.data?.ok) setWaTemplates(r.data.templates || [])
    }).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setUpgradeNeeded(null)
    const endpoint = tab === 'campaigns' ? '/campaigns' : '/campaigns/triggers'
    api.get(endpoint, { params: { page, limit } })
      .then(r => {
        if (tab === 'campaigns') {
          setCampaigns(r.data.campaigns || [])
        } else {
          setTriggers(r.data.triggers || [])
        }
        setTotal(r.data.total || 0)
      })
      .catch(e => {
        if (e.response?.status === 403 && e.response.data?.upgrade_needed) {
          setUpgradeNeeded(e.response.data.required || 'GROWTH')
        }
      })
      .finally(() => setLoading(false))
  }, [tab, page])

  useEffect(() => { load() }, [load])

  const executeCampaign = async (id) => {
    try {
      await api.post(`/campaigns/${id}/execute`)
      load()
    } catch (e) {
      alert(e.response?.data?.error || 'Erreur lors du lancement')
    }
  }

  // ── Campagne RFM ──
  const submitCampaign = async () => {
    if (!campForm.name) return setCampError('Nom requis')
    if (!campForm.target_segment) return setCampError('Segment cible requis')
    if (!campForm.message_template) return setCampError('Message template requis')
    setCampError(''); setCampSubmitting(true)
    try {
      await api.post('/campaigns', campForm)
      setShowCampModal(false)
      setCampForm({ name: '', target_segment: '', channel: 'whatsapp', message_template: '', template_name: '' })
      load()
    } catch (e) {
      setCampError(e.response?.data?.error || 'Erreur lors de la création')
    } finally { setCampSubmitting(false) }
  }

  // ── Campagne démographique ──
  const demoFilterPayload = () => {
    const f = {}
    if (demoForm.birth_months.length) f.birth_months = demoForm.birth_months
    if (demoForm.cities.trim()) f.cities = demoForm.cities.split(',').map(s => s.trim()).filter(Boolean)
    if (demoForm.genders.length) f.genders = demoForm.genders
    if (demoForm.age_min) f.age_min = parseInt(demoForm.age_min, 10)
    if (demoForm.age_max) f.age_max = parseInt(demoForm.age_max, 10)
    if (demoForm.loyalty_statuses.length) f.loyalty_statuses = demoForm.loyalty_statuses
    if (demoForm.has_purchased) f.has_purchased = true
    if (demoForm.inactivity_days) f.inactivity_days = parseInt(demoForm.inactivity_days, 10)
    if (demoForm.min_purchases) f.min_purchases = parseInt(demoForm.min_purchases, 10)
    if (demoForm.min_amount) f.min_amount = parseFloat(demoForm.min_amount)
    if (demoForm.sectors) {
      const arr = demoForm.sectors.split(',').map(s => s.trim()).filter(Boolean)
      if (arr.length) f.sectors = arr
    }
    return f
  }

  const previewDemo = async () => {
    setDemoPreviewLoading(true); setDemoError('')
    try {
      const { data } = await api.post('/campaigns/demographic/preview', { filter: demoFilterPayload() })
      setDemoPreview(data)
    } catch (e) {
      setDemoError(e.response?.data?.error || 'Erreur preview')
    } finally { setDemoPreviewLoading(false) }
  }

  const submitDemo = async () => {
    if (!demoForm.name) return setDemoError('Nom requis')
    if (!demoForm.message_template) return setDemoError('Message template requis')
    const filter = demoFilterPayload()
    if (Object.keys(filter).length === 0) return setDemoError('Au moins un critère de ciblage requis')
    setDemoSubmitting(true); setDemoError('')
    try {
      await api.post('/campaigns/demographic', {
        name: demoForm.name, channel: demoForm.channel,
        message_template: demoForm.message_template,
        template_name: demoForm.template_name || undefined,
        filter,
      })
      setShowDemoModal(false)
      setDemoForm({ name: '', channel: 'whatsapp', template_name: '', message_template: '',
        birth_months: [], cities: '', genders: [], age_min: '', age_max: '',
        loyalty_statuses: [], has_purchased: false, inactivity_days: '',
        min_purchases: '', min_amount: '', sectors: '' })
      setDemoPreview(null)
      load()
    } catch (e) {
      setDemoError(e.response?.data?.error || 'Erreur création')
    } finally { setDemoSubmitting(false) }
  }

  const toggleDemoArr = (key, val) => {
    setDemoForm(f => ({ ...f, [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val] }))
    setDemoPreview(null)
  }

  // ── Trigger ──
  const submitTrigger = async () => {
    if (!trigForm.trigger_type) return setTrigError('Type de trigger requis')
    if (!trigForm.message_template) return setTrigError('Message template requis')
    setTrigError(''); setTrigSubmitting(true)
    try {
      await api.post('/campaigns/triggers', trigForm)
      setShowTrigModal(false)
      setTrigForm({ trigger_type: '', target_segment: '', channel: 'whatsapp', message_template: '', cooldown_hours: 24, template_name: '' })
      load()
    } catch (e) {
      setTrigError(e.response?.data?.error || 'Erreur lors de la création')
    } finally { setTrigSubmitting(false) }
  }

  const toggleTrigger = async (id, active) => {
    try {
      await api.patch(`/campaigns/triggers/${id}`, { is_active: !active })
      load()
    } catch { /* ignore */ }
  }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <Breadcrumb title="Campagnes" segments={[{ label: 'Campagnes & Triggers' }]} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['campaigns', 'triggers'].map(t => (
            <button key={t} onClick={() => { setTab(t); setPage(1) }}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: `1px solid ${tab === t ? 'var(--af-accent)' : 'var(--af-border)'}`, cursor: 'pointer', background: tab === t ? 'var(--af-accent)' : 'var(--af-surface)', color: tab === t ? '#fff' : 'var(--af-text-muted)' }}>
              {t === 'campaigns' ? 'Campagnes' : 'Triggers automatiques'}
            </button>
          ))}
          <button onClick={() => setShowTrigModal(true)}
            style={{ padding: '8px 16px', background: 'var(--af-surface)', color: 'var(--af-accent)', border: '1px solid var(--af-accent)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            + Trigger<InfoTooltip text={TOOLTIPS.trigger} />
          </button>
          {tab === 'campaigns' && (
            <>
              <button onClick={() => setShowCampModal(true)}
                style={{ padding: '8px 16px', background: 'var(--af-accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                + Campagne RFM<InfoTooltip text={TOOLTIPS.campagne_rfm} />
              </button>
              <button onClick={() => setShowDemoModal(true)}
                style={{ padding: '8px 16px', background: 'var(--af-surface)', color: 'var(--af-text)', border: '1px solid var(--af-border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                + Campagne ciblée<InfoTooltip text={TOOLTIPS.campagne_ciblee} />
              </button>
            </>
          )}
          <button onClick={load} style={{ padding: '8px 12px', background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, cursor: 'pointer', color: 'var(--af-text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <ArrowPathIcon style={{ width: 14, height: 14 }} />
          </button>
        </div>
      </div>

      {upgradeNeeded && <UpgradeWall requiredPackage={upgradeNeeded} />}

      {!upgradeNeeded && tab === 'campaigns' && (
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    { h: 'Nom', tip: null },
                    { h: 'Segment / Type', tip: TOOLTIPS.segment_cible },
                    { h: 'Canal', tip: TOOLTIPS.canal_whatsapp },
                    { h: 'Cibles', tip: "Nombre de clients correspondant au segment au moment de la création de la campagne." },
                    { h: 'Envoyés', tip: "Nombre de messages effectivement envoyés. Peut différer des cibles si certains clients n'ont pas de numéro/email valide." },
                    { h: 'Statut', tip: TOOLTIPS.statut_campagne_draft },
                    { h: 'Actions', tip: null },
                  ].map(({ h, tip }) => (
                    <th key={h} style={th}>{h}{tip && <InfoTooltip text={tip} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td style={tdBold}>{c.name}</td>
                    <td style={td}><Badge color="blue">{c.target_segment}</Badge></td>
                    <td style={td}>{c.channel}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{c.total_targeted ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{c.total_sent ?? '—'}</td>
                    <td style={td}>
                      <Badge color={STATUS_COLORS[c.status] || 'gray'}>{c.status}</Badge>
                      {TOOLTIPS['statut_campagne_' + c.status] && <InfoTooltip text={TOOLTIPS['statut_campagne_' + c.status]} />}
                    </td>
                    <td style={td}>
                      {(c.status === 'draft' || c.status === 'scheduled') && (
                        <button onClick={() => executeCampaign(c.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--af-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                          Lancer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 40 }}>Aucune campagne — créez votre première campagne RFM ou ciblée.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
        </div>
      )}

      {!upgradeNeeded && tab === 'triggers' && (
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    { h: 'Type', tip: TOOLTIPS.trigger },
                    { h: 'Segment cible', tip: TOOLTIPS.segment_cible },
                    { h: 'Canal', tip: TOOLTIPS.canal_whatsapp },
                    { h: 'Cooldown', tip: TOOLTIPS.cooldown },
                    { h: 'Actif', tip: "Un trigger actif s'exécute automatiquement dès que la condition est remplie. Désactivez-le pour le mettre en pause sans le supprimer." },
                    { h: 'Actions', tip: null },
                  ].map(({ h, tip }) => (
                    <th key={h} style={th}>{h}{tip && <InfoTooltip text={tip} />}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {triggers.map(t => (
                  <tr key={t.id}>
                    <td style={tdBold}>
                      {t.trigger_type}
                      {TRIGGER_TIPS[t.trigger_type] && <InfoTooltip text={TRIGGER_TIPS[t.trigger_type]} />}
                    </td>
                    <td style={td}>{t.target_segment || '—'}</td>
                    <td style={td}>{t.channel}</td>
                    <td style={td}>{t.cooldown_hours}h</td>
                    <td style={td}><Badge color={t.is_active ? 'green' : 'red'}>{t.is_active ? 'Actif' : 'Inactif'}</Badge></td>
                    <td style={td}>
                      <button onClick={() => toggleTrigger(t.id, t.is_active)}
                        style={{ background: 'none', border: 'none', color: 'var(--af-accent)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {t.is_active ? 'Désactiver' : 'Activer'}
                      </button>
                    </td>
                  </tr>
                ))}
                {triggers.length === 0 && (
                  <tr><td colSpan={6} style={{ ...td, textAlign: 'center', padding: 40 }}>Aucun trigger configuré.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
        </div>
      )}

      {/* ── Modale campagne RFM ── */}
      {showCampModal && (
        <Modal open onClose={() => { setShowCampModal(false); setCampError('') }} title="Nouvelle campagne RFM">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input placeholder="Nom de la campagne" value={campForm.name}
              onChange={e => setCampForm({ ...campForm, name: e.target.value })} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Segment cible<InfoTooltip text={TOOLTIPS.segment_cible} />
              </div>
              <Select value={campForm.target_segment} onChange={e => setCampForm({ ...campForm, target_segment: e.target.value })}>
                <option value="">— Choisir un segment —</option>
                {[
                  { v: 'CHAMPIONS', tip: TOOLTIPS.seg_champions },
                  { v: 'FIDELES', tip: TOOLTIPS.seg_fideles },
                  { v: 'PROMETTEURS', tip: TOOLTIPS.seg_prometteurs },
                  { v: 'A_RISQUE', tip: TOOLTIPS.seg_a_risque },
                  { v: 'HIBERNANTS', tip: TOOLTIPS.seg_hibernants },
                  { v: 'PERDUS', tip: TOOLTIPS.seg_perdus },
                ].map(({ v }) => <option key={v} value={v}>{v}</option>)}
              </Select>
              {campForm.target_segment && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--af-text-muted)', padding: '6px 10px', background: 'var(--af-surface-3)', borderRadius: 6, lineHeight: 1.5 }}>
                  {TOOLTIPS['seg_' + campForm.target_segment.toLowerCase().replace('a_risque', 'a_risque')] || ''}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Canal d'envoi<InfoTooltip text={campForm.channel === 'whatsapp' ? TOOLTIPS.canal_whatsapp : TOOLTIPS.canal_email} />
              </div>
              <Select value={campForm.channel} onChange={e => setCampForm({ ...campForm, channel: e.target.value })}>
                <option value="whatsapp">WhatsApp (Lafricamobile)</option>
                <option value="email">Email</option>
              </Select>
            </div>
            {campForm.channel === 'whatsapp' && waTemplates.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                  Template WhatsApp<InfoTooltip text={TOOLTIPS.template_whatsapp} />
                </div>
                <Select value={campForm.template_name} onChange={e => setCampForm({ ...campForm, template_name: e.target.value })}>
                  <option value="">— Choisir un template —</option>
                  {waTemplates.map(t => <option key={t.name || t.id} value={t.name || t.id}>{t.name || t.id}</option>)}
                </Select>
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Message<InfoTooltip text={TOOLTIPS.message_template} />
              </div>
              <textarea rows={3}
                placeholder="Ex : Bonjour {client_name}, voici une offre exclusive chez {merchant_name} !"
                value={campForm.message_template}
                onChange={e => setCampForm({ ...campForm, message_template: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            {campError && <div style={{ color: 'var(--af-danger)', fontSize: 12, padding: '6px 10px', background: 'var(--af-danger-soft)', borderRadius: 6 }}>{campError}</div>}
            <Button onClick={submitCampaign} disabled={campSubmitting}>
              {campSubmitting ? 'Création...' : 'Créer la campagne'}
            </Button>
          </div>
        </Modal>
      )}

      {/* ── Modale campagne démographique ── */}
      {showDemoModal && (
        <Modal open onClose={() => { setShowDemoModal(false); setDemoPreview(null); setDemoError('') }} title="Campagne ciblée (démographique)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ padding: '8px 12px', background: 'var(--af-surface-2)', border: '1px solid var(--af-border)', borderRadius: 8, fontSize: 12, color: 'var(--af-text-muted)', lineHeight: 1.6 }}>
              {TOOLTIPS.campagne_ciblee}
            </div>
            <Input placeholder="Nom de la campagne" value={demoForm.name}
              onChange={e => { setDemoForm({ ...demoForm, name: e.target.value }); setDemoPreview(null) }} />

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Mois d'anniversaire<InfoTooltip text="Cibler les clients dont l'anniversaire tombe ce mois. Ex : sélectionnez Décembre pour envoyer un message à tous vos clients nés en décembre." /></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {MONTHS.map((m, i) => {
                  const num = i + 1; const on = demoForm.birth_months.includes(num)
                  return (
                    <button key={num} type="button" onClick={() => toggleDemoArr('birth_months', num)}
                      style={{ padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: on ? 'var(--af-accent)' : 'var(--af-surface-2)', color: on ? '#fff' : 'var(--af-text-muted)', border: '1px solid ' + (on ? 'var(--af-accent)' : 'var(--af-border)') }}>
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Villes (séparées par virgule)<InfoTooltip text="Filtrer les clients selon leur ville enregistrée. Exemple : Abidjan, Bouaké. Laissez vide pour toutes les villes." /></div>
              <Input placeholder="Abidjan, Bouaké, Daloa" value={demoForm.cities}
                onChange={e => { setDemoForm({ ...demoForm, cities: e.target.value }); setDemoPreview(null) }} />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Genre<InfoTooltip text="Filtrer par genre déclaré. Laissez tout désélectionné pour cibler tous les genres." /></div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ k: 'M', l: 'Hommes' }, { k: 'F', l: 'Femmes' }, { k: 'X', l: 'Autre' }].map(({ k, l }) => {
                  const on = demoForm.genders.includes(k)
                  return (
                    <button key={k} type="button" onClick={() => toggleDemoArr('genders', k)}
                      style={{ padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer', background: on ? 'var(--af-accent)' : 'var(--af-surface-2)', color: on ? '#fff' : 'var(--af-text-muted)', border: '1px solid ' + (on ? 'var(--af-accent)' : 'var(--af-border)') }}>{l}</button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Âge min</div>
                <Input type="number" placeholder="18" value={demoForm.age_min}
                  onChange={e => { setDemoForm({ ...demoForm, age_min: e.target.value }); setDemoPreview(null) }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Âge max</div>
                <Input type="number" placeholder="65" value={demoForm.age_max}
                  onChange={e => { setDemoForm({ ...demoForm, age_max: e.target.value }); setDemoPreview(null) }} />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Statut fidélité<InfoTooltip text="Filtrer par niveau fidélité atteint. OPEN = débutant, LIVE = actif, GOLD = premium, ROYAL / ROYAL_ELITE = élite. Laissez vide pour tous les niveaux." /></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {LOYALTY_STATUSES.map(s => {
                  const on = demoForm.loyalty_statuses.includes(s)
                  return (
                    <button key={s} type="button" onClick={() => toggleDemoArr('loyalty_statuses', s)}
                      style={{ padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer', background: on ? 'var(--af-accent)' : 'var(--af-surface-2)', color: on ? '#fff' : 'var(--af-text-muted)', border: '1px solid ' + (on ? 'var(--af-accent)' : 'var(--af-border)') }}>{s}</button>
                  )
                })}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--af-text)' }}>
              <input type="checkbox" checked={demoForm.has_purchased}
                onChange={e => { setDemoForm({ ...demoForm, has_purchased: e.target.checked }); setDemoPreview(null) }} />
              A déjà acheté chez moi
            </label>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Inactif depuis (jours)<InfoTooltip text={TOOLTIPS.inactivite_jours} /></div>
              <Input type="number" placeholder="60" value={demoForm.inactivity_days}
                onChange={e => { setDemoForm({ ...demoForm, inactivity_days: e.target.value }); setDemoPreview(null) }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Achats min<InfoTooltip text="Nombre minimum d'achats effectués chez vous. Ex : 3 = clients ayant acheté au moins 3 fois." /></div>
                <Input type="number" placeholder="3" value={demoForm.min_purchases}
                  onChange={e => { setDemoForm({ ...demoForm, min_purchases: e.target.value }); setDemoPreview(null) }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Montant min (FCFA)<InfoTooltip text="Montant total cumulé minimum dépensé chez vous sur toute la durée. Ex : 50 000 FCFA = clients ayant dépensé au moins 50 000 FCFA au total." /></div>
                <Input type="number" placeholder="50000" value={demoForm.min_amount}
                  onChange={e => { setDemoForm({ ...demoForm, min_amount: e.target.value }); setDemoPreview(null) }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Secteurs (csv)<InfoTooltip text="Filtrer les clients qui ont aussi acheté dans d'autres commerces de ces secteurs. Ex : restaurant, mode. Séparez par virgule." /></div>
                <Input placeholder="restaurant,mode" value={demoForm.sectors}
                  onChange={e => { setDemoForm({ ...demoForm, sectors: e.target.value }); setDemoPreview(null) }} />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Canal d'envoi<InfoTooltip text={demoForm.channel === 'whatsapp' ? TOOLTIPS.canal_whatsapp : TOOLTIPS.canal_email} />
              </div>
              <Select value={demoForm.channel} onChange={e => setDemoForm({ ...demoForm, channel: e.target.value })}>
                <option value="whatsapp">WhatsApp (Lafricamobile)</option>
                <option value="email">Email</option>
              </Select>
            </div>
            {demoForm.channel === 'whatsapp' && waTemplates.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                  Template WhatsApp<InfoTooltip text={TOOLTIPS.template_whatsapp} />
                </div>
                <Select value={demoForm.template_name} onChange={e => setDemoForm({ ...demoForm, template_name: e.target.value })}>
                  <option value="">— Choisir un template —</option>
                  {waTemplates.map(t => <option key={t.name || t.id} value={t.name || t.id}>{t.name || t.id}</option>)}
                </Select>
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Message<InfoTooltip text={TOOLTIPS.message_template} />
              </div>
              <textarea rows={3}
                placeholder="Ex : Joyeux anniversaire {client_name} ! -20% chez {merchant_name} ce mois."
                value={demoForm.message_template}
                onChange={e => setDemoForm({ ...demoForm, message_template: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            {demoPreview && (
              <div style={{ background: 'var(--af-surface-2)', border: '1px solid var(--af-border)', borderLeft: '3px solid var(--af-accent)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--af-text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  Audience estimée : {demoPreview.total} client{demoPreview.total > 1 ? 's' : ''}<InfoTooltip text={TOOLTIPS.audience_estimee} />
                </div>
                {demoPreview.sample?.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>
                    Aperçu : {demoPreview.sample.map(s => s.name).join(' · ')}
                  </div>
                )}
              </div>
            )}

            {demoError && <div style={{ color: 'var(--af-danger)', fontSize: 12, padding: '6px 10px', background: 'var(--af-danger-soft)', borderRadius: 6 }}>{demoError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={previewDemo} disabled={demoPreviewLoading}
                style={{ flex: 1, background: 'var(--af-surface-3)', color: 'var(--af-text)' }}>
                {demoPreviewLoading ? 'Calcul...' : "Prévisualiser l'audience"}
              </Button>
              <Button onClick={submitDemo} disabled={demoSubmitting || !demoPreview} style={{ flex: 1 }}>
                {demoSubmitting ? 'Création...' : 'Créer la campagne'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modale trigger ── */}
      {showTrigModal && (
        <Modal open onClose={() => { setShowTrigModal(false); setTrigError('') }} title="Nouveau trigger automatique">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '8px 12px', background: 'var(--af-surface-2)', border: '1px solid var(--af-border)', borderRadius: 8, fontSize: 12, color: 'var(--af-text-muted)', lineHeight: 1.6 }}>
              {TOOLTIPS.trigger}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Type de trigger<InfoTooltip text="Choisissez l'événement qui déclenche l'envoi automatique du message." />
              </div>
              <Select value={trigForm.trigger_type} onChange={e => setTrigForm({ ...trigForm, trigger_type: e.target.value })}>
                <option value="">— Choisir un type —</option>
                {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              {trigForm.trigger_type && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--af-text-muted)', padding: '6px 10px', background: 'var(--af-surface-3)', borderRadius: 6, lineHeight: 1.5 }}>
                  {{
                    BIENVENUE: TOOLTIPS.trigger_bienvenue,
                    '1ER_ACHAT': TOOLTIPS.trigger_1er_achat,
                    ABSENCE: TOOLTIPS.trigger_absence,
                    ALERTE_R: TOOLTIPS.trigger_alerte_r,
                    A_RISQUE: TOOLTIPS.trigger_a_risque,
                    WIN_BACK: TOOLTIPS.trigger_win_back,
                    ANNIVERSAIRE: TOOLTIPS.trigger_anniversaire,
                    PALIER: TOOLTIPS.trigger_palier,
                  }[trigForm.trigger_type] || ''}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Segment cible (optionnel)<InfoTooltip text={TOOLTIPS.segment_cible + " Laissez vide pour déclencher sur tous les clients sans restriction de segment."} />
              </div>
              <Select value={trigForm.target_segment} onChange={e => setTrigForm({ ...trigForm, target_segment: e.target.value })}>
                <option value="">— Tous les clients —</option>
                {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Canal d'envoi<InfoTooltip text={trigForm.channel === 'whatsapp' ? TOOLTIPS.canal_whatsapp : TOOLTIPS.canal_email} />
              </div>
              <Select value={trigForm.channel} onChange={e => setTrigForm({ ...trigForm, channel: e.target.value })}>
                <option value="whatsapp">WhatsApp (Lafricamobile)</option>
                <option value="email">Email</option>
              </Select>
            </div>
            {trigForm.channel === 'whatsapp' && waTemplates.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                  Template WhatsApp<InfoTooltip text={TOOLTIPS.template_whatsapp} />
                </div>
                <Select value={trigForm.template_name} onChange={e => setTrigForm({ ...trigForm, template_name: e.target.value })}>
                  <option value="">— Choisir un template —</option>
                  {waTemplates.map(t => <option key={t.name || t.id} value={t.name || t.id}>{t.name || t.id}</option>)}
                </Select>
              </div>
            )}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Cooldown (heures)<InfoTooltip text={TOOLTIPS.cooldown} />
              </div>
              <Input type="number" value={trigForm.cooldown_hours}
                onChange={e => setTrigForm({ ...trigForm, cooldown_hours: parseInt(e.target.value, 10) || 24 })} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Message<InfoTooltip text={TOOLTIPS.message_template} />
              </div>
              <textarea rows={3}
                placeholder="Ex : Bienvenue {client_name} chez {merchant_name} ! Voici votre récompense de fidélité."
                value={trigForm.message_template}
                onChange={e => setTrigForm({ ...trigForm, message_template: e.target.value })}
                style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            {trigError && <div style={{ color: 'var(--af-danger)', fontSize: 12, padding: '6px 10px', background: 'var(--af-danger-soft)', borderRadius: 6 }}>{trigError}</div>}
            <Button onClick={submitTrigger} disabled={trigSubmitting}>
              {trigSubmitting ? 'Création...' : 'Créer le trigger'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
