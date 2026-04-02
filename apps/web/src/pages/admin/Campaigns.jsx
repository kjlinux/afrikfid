import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination, Select, Button, Modal, Input } from '../../components/ui.jsx'

const SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS']
const TRIGGER_TYPES = ['BIENVENUE', '1ER_ACHAT', 'ABSENCE', 'ALERTE_R', 'A_RISQUE', 'WIN_BACK', 'ANNIVERSAIRE', 'PALIER']
const STATUS_COLORS = { draft: 'gray', scheduled: 'blue', running: 'yellow', completed: 'green', cancelled: 'red' }

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

  const toggleTrigger = async (id, active) => {
    try {
      await api.patch(`/campaigns/triggers/${id}`, { is_active: !active })
      load()
    } catch { /* ignore */ }
  }

  const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #334155' }
  const td = { padding: '10px 14px', fontSize: 13, color: '#94a3b8', borderBottom: '1px solid #1e293b' }
  const tdBold = { ...td, color: '#f1f5f9', fontWeight: 600 }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Campagnes & Triggers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {['campaigns', 'triggers'].map(t => (
            <button key={t} onClick={() => { setTab(t); setPage(1) }}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', background: tab === t ? '#6366f1' : '#1e293b', color: tab === t ? '#fff' : '#94a3b8' }}>
              {t === 'campaigns' ? 'Campagnes' : 'Triggers'}
            </button>
          ))}
          <button onClick={() => setShowModal(true)}
            style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + {tab === 'campaigns' ? 'Campagne' : 'Trigger'}
          </button>
        </div>
      </div>

      {tab === 'campaigns' && (
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
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
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
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
              style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
            />
            {formError && <div style={{ color: '#f87171', fontSize: 12, padding: '6px 10px', background: '#450a0a', borderRadius: 6 }}>{formError}</div>}
            <Button onClick={tab === 'campaigns' ? createCampaign : createTrigger} disabled={submitting}>
              {submitting ? 'Création...' : 'Créer'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
