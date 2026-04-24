import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination, Select, Button, Modal, Input } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'

const SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS']
const TRIGGER_TYPES = ['BIENVENUE', '1ER_ACHAT', 'ABSENCE', 'ALERTE_R', 'A_RISQUE', 'WIN_BACK', 'ANNIVERSAIRE', 'PALIER']
const STATUS_COLORS = { draft: 'gray', scheduled: 'blue', running: 'yellow', completed: 'green', cancelled: 'red' }
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
const LOYALTY_STATUSES = ['OPEN', 'LIVE', 'GOLD', 'ROYAL', 'ROYAL_ELITE']

export default function AdminCampaigns() {
  const [tab, setTab] = useState('campaigns')
  const [campaigns, setCampaigns] = useState([])
  const [triggers, setTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [merchants, setMerchants] = useState([])
  const [form, setForm] = useState({ merchant_id: '', name: '', target_segment: '', message_template: '', trigger_type: '', channel: 'sms' })
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const limit = 20

  // Campagne démographique
  const [showDemoModal, setShowDemoModal] = useState(false)
  const [demoForm, setDemoForm] = useState({
    merchant_id: '', name: '', channel: 'sms', message_template: '',
    birth_months: [], cities: '', genders: [], age_min: '', age_max: '',
    loyalty_statuses: [], has_purchased: false, inactivity_days: '',
  })
  const [demoPreview, setDemoPreview] = useState(null)
  const [demoPreviewLoading, setDemoPreviewLoading] = useState(false)

  useEffect(() => {
    api.get('/merchants', { params: { limit: 200 } }).then(r => setMerchants(r.data.merchants || []))
  }, [])

  const load = () => {
    setLoading(true)
    if (tab === 'campaigns') {
      api.get('/campaigns', { params: { page, limit } }).then(r => {
        setCampaigns(r.data.campaigns || [])
        setTotal(r.data.total || 0)
      }).finally(() => setLoading(false))
    } else {
      api.get('/campaigns/triggers', { params: { page, limit } }).then(r => {
        setTriggers(r.data.triggers || [])
        setTotal(r.data.total || 0)
      }).finally(() => setLoading(false))
    }
  }

  useEffect(() => { load() }, [tab, page])

  const resetModal = () => {
    setShowModal(false)
    setFormError('')
    setForm({ merchant_id: '', name: '', target_segment: '', message_template: '', trigger_type: '', channel: 'sms' })
  }

  const createCampaign = async () => {
    if (!form.merchant_id) return setFormError('Sélectionnez un marchand')
    if (!form.name) return setFormError('Saisissez un nom de campagne')
    if (!form.target_segment) return setFormError('Sélectionnez un segment cible')
    if (!form.message_template) return setFormError('Saisissez le message template')
    setFormError('')
    setSubmitting(true)
    try {
      await api.post('/campaigns', form)
      resetModal()
      load()
    } catch (e) {
      setFormError(e.response?.data?.error || 'Erreur lors de la création')
    } finally { setSubmitting(false) }
  }

  const createTrigger = async () => {
    if (!form.merchant_id) return setFormError('Sélectionnez un marchand')
    if (!form.trigger_type) return setFormError('Sélectionnez un type de trigger')
    if (!form.message_template) return setFormError('Saisissez le message template')
    setFormError('')
    setSubmitting(true)
    try {
      await api.post('/campaigns/triggers', form)
      resetModal()
      load()
    } catch (e) {
      setFormError(e.response?.data?.error || 'Erreur lors de la création')
    } finally { setSubmitting(false) }
  }

  const executeCampaign = async (id) => {
    try {
      await api.post(`/campaigns/${id}/execute`)
      load()
    } catch { /* ignore */ }
  }

  // Campagnes démographiques — helpers
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
    return f
  }

  const previewDemo = async () => {
    if (!demoForm.merchant_id) return setFormError('Sélectionnez un marchand')
    setDemoPreviewLoading(true); setFormError('')
    try {
      const { data } = await api.post('/campaigns/demographic/preview', {
        merchant_id: demoForm.merchant_id,
        filter: demoFilterPayload(),
      })
      setDemoPreview(data)
    } catch (e) {
      setFormError(e.response?.data?.error || 'Erreur preview')
    } finally { setDemoPreviewLoading(false) }
  }

  const createDemo = async () => {
    if (!demoForm.merchant_id) return setFormError('Sélectionnez un marchand')
    if (!demoForm.name) return setFormError('Nom requis')
    if (!demoForm.message_template) return setFormError('Message template requis')
    const filter = demoFilterPayload()
    if (Object.keys(filter).length === 0) return setFormError('Au moins un critère de ciblage requis')
    setSubmitting(true); setFormError('')
    try {
      await api.post('/campaigns/demographic', {
        merchant_id: demoForm.merchant_id,
        name: demoForm.name,
        channel: demoForm.channel,
        message_template: demoForm.message_template,
        filter,
      })
      setShowDemoModal(false)
      setDemoForm({ merchant_id: '', name: '', channel: 'sms', message_template: '',
        birth_months: [], cities: '', genders: [], age_min: '', age_max: '',
        loyalty_statuses: [], has_purchased: false, inactivity_days: '' })
      setDemoPreview(null)
      load()
    } catch (e) {
      setFormError(e.response?.data?.error || 'Erreur création')
    } finally { setSubmitting(false) }
  }

  const toggleArr = (key, val) => {
    setDemoForm(f => ({
      ...f,
      [key]: f[key].includes(val) ? f[key].filter(x => x !== val) : [...f[key], val],
    }))
    setDemoPreview(null)
  }

  const toggleTrigger = async (id, active) => {
    try {
      await api.patch(`/campaigns/triggers/${id}`, { is_active: !active })
      load()
    } catch { /* ignore */ }
  }

  const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--af-border)' }
  const td = { padding: '10px 14px', fontSize: 13, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-surface)' }
  const tdBold = { ...td, color: 'var(--af-text)', fontWeight: 600 }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Breadcrumb title="Campagnes" segments={[{ label: 'Campagnes automatisées & Triggers RFM' }]} />
        <div style={{ display: 'flex', gap: 8 }}>
          {['campaigns', 'triggers'].map(t => (
            <button key={t} onClick={() => { setTab(t); setPage(1) }}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: tab === t ? 'var(--af-kpi-violet)' : 'var(--af-surface)', color: tab === t ? '#fff' : 'var(--af-text-muted)' }}>
              {t === 'campaigns' ? 'Campagnes' : 'Triggers'}
            </button>
          ))}
          <button onClick={() => setShowModal(true)}
            style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + {tab === 'campaigns' ? 'Campagne RFM' : 'Trigger'}
          </button>
          {tab === 'campaigns' && (
            <button onClick={() => setShowDemoModal(true)}
              style={{ padding: '8px 16px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              + Campagne ciblée
            </button>
          )}
        </div>
      </div>

      {tab === 'campaigns' && (
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Nom', 'Marchand', 'Segment', 'Canal', 'Cibles', 'Envoyés', 'Statut', 'Actions'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td style={tdBold}>{c.name}</td>
                    <td style={td}>{c.merchant_name}</td>
                    <td style={td}><Badge color="blue">{c.target_segment}</Badge></td>
                    <td style={td}>{c.channel}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{c.total_targeted}</td>
                    <td style={{ ...td, textAlign: 'center' }}>{c.total_sent}</td>
                    <td style={td}><Badge color={STATUS_COLORS[c.status]}>{c.status}</Badge></td>
                    <td style={td}>
                      {(c.status === 'draft' || c.status === 'scheduled') && (
                        <button onClick={() => executeCampaign(c.id)} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Lancer</button>
                      )}
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32 }}>Aucune campagne</td></tr>}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
        </div>
      )}

      {tab === 'triggers' && (
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Type', 'Marchand', 'Segment cible', 'Canal', 'Cooldown', 'Actif', 'Actions'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {triggers.map(t => (
                  <tr key={t.id}>
                    <td style={tdBold}>{t.trigger_type}</td>
                    <td style={td}>{t.merchant_name}</td>
                    <td style={td}>{t.target_segment || '—'}</td>
                    <td style={td}>{t.channel}</td>
                    <td style={td}>{t.cooldown_hours}h</td>
                    <td style={td}><Badge color={t.is_active ? 'green' : 'red'}>{t.is_active ? 'Oui' : 'Non'}</Badge></td>
                    <td style={td}>
                      <button onClick={() => toggleTrigger(t.id, t.is_active)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {t.is_active ? 'Désactiver' : 'Activer'}
                      </button>
                    </td>
                  </tr>
                ))}
                {triggers.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 32 }}>Aucun trigger</td></tr>}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
        </div>
      )}

      {showDemoModal && (
        <Modal open onClose={() => { setShowDemoModal(false); setDemoPreview(null); setFormError('') }} title="Campagne ciblée (démographique)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '70vh', overflowY: 'auto' }}>
            <Select value={demoForm.merchant_id} onChange={e => { setDemoForm({ ...demoForm, merchant_id: e.target.value }); setDemoPreview(null) }}>
              <option value="">— Sélectionner un marchand —</option>
              {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            <Input placeholder="Nom de la campagne (ex: Anniversaires mars Abidjan)" value={demoForm.name}
              onChange={e => setDemoForm({ ...demoForm, name: e.target.value })} />

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Mois d'anniversaire</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {MONTHS.map((m, i) => {
                  const num = i + 1
                  const on = demoForm.birth_months.includes(num)
                  return (
                    <button key={num} type="button" onClick={() => toggleArr('birth_months', num)}
                      style={{ padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                        background: on ? '#8b5cf6' : 'var(--af-surface-3)',
                        color: on ? '#fff' : 'var(--af-text-muted)',
                        border: '1px solid ' + (on ? '#8b5cf6' : 'var(--af-border)') }}>
                      {m}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Villes (séparées par virgule)</div>
              <Input placeholder="Abidjan, Bouaké, Daloa" value={demoForm.cities}
                onChange={e => { setDemoForm({ ...demoForm, cities: e.target.value }); setDemoPreview(null) }} />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Genre</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[{ k: 'M', l: 'Hommes' }, { k: 'F', l: 'Femmes' }, { k: 'X', l: 'Autre' }].map(({ k, l }) => {
                  const on = demoForm.genders.includes(k)
                  return (
                    <button key={k} type="button" onClick={() => toggleArr('genders', k)}
                      style={{ padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                        background: on ? '#8b5cf6' : 'var(--af-surface-3)',
                        color: on ? '#fff' : 'var(--af-text-muted)',
                        border: '1px solid ' + (on ? '#8b5cf6' : 'var(--af-border)') }}>{l}</button>
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
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>Statut fidélité</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {LOYALTY_STATUSES.map(s => {
                  const on = demoForm.loyalty_statuses.includes(s)
                  return (
                    <button key={s} type="button" onClick={() => toggleArr('loyalty_statuses', s)}
                      style={{ padding: '5px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
                        background: on ? '#8b5cf6' : 'var(--af-surface-3)',
                        color: on ? '#fff' : 'var(--af-text-muted)',
                        border: '1px solid ' + (on ? '#8b5cf6' : 'var(--af-border)') }}>{s}</button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--af-text)' }}>
                <input type="checkbox" checked={demoForm.has_purchased}
                  onChange={e => { setDemoForm({ ...demoForm, has_purchased: e.target.checked }); setDemoPreview(null) }} />
                A déjà acheté chez ce marchand
              </label>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>
                Inactif depuis (jours, chez ce marchand)
              </div>
              <Input type="number" placeholder="60" value={demoForm.inactivity_days}
                onChange={e => { setDemoForm({ ...demoForm, inactivity_days: e.target.value }); setDemoPreview(null) }} />
            </div>

            <Select value={demoForm.channel} onChange={e => setDemoForm({ ...demoForm, channel: e.target.value })}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </Select>
            <textarea rows={3} placeholder="Message (ex: Joyeux anniversaire {client_name} ! -20% chez {merchant_name} ce mois.)"
              value={demoForm.message_template}
              onChange={e => setDemoForm({ ...demoForm, message_template: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />

            {demoPreview && (
              <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#8b5cf6', marginBottom: 6 }}>
                  Audience estimée : {demoPreview.total} client{demoPreview.total > 1 ? 's' : ''}
                </div>
                {demoPreview.sample?.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>
                    Aperçu : {demoPreview.sample.map(s => s.name).join(' · ')}
                  </div>
                )}
              </div>
            )}

            {formError && <div style={{ color: 'var(--af-danger)', fontSize: 12, padding: '6px 10px', background: 'var(--af-danger-soft)', borderRadius: 6 }}>{formError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={previewDemo} disabled={demoPreviewLoading} style={{ flex: 1, background: 'var(--af-surface-3)', color: 'var(--af-text)' }}>
                {demoPreviewLoading ? 'Calcul...' : "Prévisualiser l'audience"}
              </Button>
              <Button onClick={createDemo} disabled={submitting || !demoPreview} style={{ flex: 1, background: '#8b5cf6' }}>
                {submitting ? 'Création...' : 'Créer la campagne'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showModal && (
        <Modal open onClose={resetModal} title={tab === 'campaigns' ? 'Nouvelle campagne' : 'Nouveau trigger'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Select value={form.merchant_id} onChange={e => setForm({ ...form, merchant_id: e.target.value })}>
              <option value="">— Sélectionner un marchand —</option>
              {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            {tab === 'campaigns' ? (
              <>
                <Input placeholder="Nom de la campagne" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <Select value={form.target_segment} onChange={e => setForm({ ...form, target_segment: e.target.value })}>
                  <option value="">— Segment cible —</option>
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </>
            ) : (
              <>
                <Select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })}>
                  <option value="">— Type de trigger —</option>
                  {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Select value={form.target_segment} onChange={e => setForm({ ...form, target_segment: e.target.value })}>
                  <option value="">— Segment cible (optionnel) —</option>
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </>
            )}
            <Select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </Select>
            <textarea
              rows={3}
              placeholder="Message template (ex: Bonjour {{prenom}}, profitez de -{{remise}}% chez {{marchand}} !)"
              value={form.message_template}
              onChange={e => setForm({ ...form, message_template: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
            {formError && <div style={{ color: 'var(--af-danger)', fontSize: 12, padding: '6px 10px', background: 'var(--af-danger-soft)', borderRadius: 6 }}>{formError}</div>}
            <Button onClick={tab === 'campaigns' ? createCampaign : createTrigger} disabled={submitting}>
              {submitting ? 'Création...' : 'Créer'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
