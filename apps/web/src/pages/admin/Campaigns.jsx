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

  const createCampaign = async () => {
    try {
      await api.post('/campaigns', form)
      setShowModal(false)
      setForm({ merchant_id: '', name: '', target_segment: '', message_template: '', trigger_type: '', channel: 'sms' })
      load()
    } catch { /* ignore */ }
  }

  const createTrigger = async () => {
    try {
      await api.post('/campaigns/triggers', form)
      setShowModal(false)
      setForm({ merchant_id: '', name: '', target_segment: '', message_template: '', trigger_type: '', channel: 'sms' })
      load()
    } catch { /* ignore */ }
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

  if (loading) return <Spinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Campagnes & Triggers</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setTab('campaigns'); setPage(1) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'campaigns' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >Campagnes</button>
          <button
            onClick={() => { setTab('triggers'); setPage(1) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'triggers' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          >Triggers</button>
          <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            + {tab === 'campaigns' ? 'Campagne' : 'Trigger'}
          </button>
        </div>
      </div>

      {tab === 'campaigns' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marchand</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Segment</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Canal</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Cibles</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Envoyes</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 text-sm font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.merchant_name}</td>
                    <td className="px-4 py-3"><Badge color="blue">{c.target_segment}</Badge></td>
                    <td className="px-4 py-3 text-sm">{c.channel}</td>
                    <td className="px-4 py-3 text-sm text-center">{c.total_targeted}</td>
                    <td className="px-4 py-3 text-sm text-center">{c.total_sent}</td>
                    <td className="px-4 py-3"><Badge color={STATUS_COLORS[c.status]}>{c.status}</Badge></td>
                    <td className="px-4 py-3 text-sm">
                      {(c.status === 'draft' || c.status === 'scheduled') && (
                        <button onClick={() => executeCampaign(c.id)} className="text-green-600 hover:underline text-xs">Lancer</button>
                      )}
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Aucune campagne</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onChange={setPage} />}
        </Card>
      )}

      {tab === 'triggers' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marchand</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Segment cible</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Canal</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cooldown</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actif</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {triggers.map(t => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-sm font-medium">{t.trigger_type}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{t.merchant_name}</td>
                    <td className="px-4 py-3 text-sm">{t.target_segment || '-'}</td>
                    <td className="px-4 py-3 text-sm">{t.channel}</td>
                    <td className="px-4 py-3 text-sm">{t.cooldown_hours}h</td>
                    <td className="px-4 py-3"><Badge color={t.is_active ? 'green' : 'red'}>{t.is_active ? 'Oui' : 'Non'}</Badge></td>
                    <td className="px-4 py-3 text-sm">
                      <button onClick={() => toggleTrigger(t.id, t.is_active)} className="text-blue-600 hover:underline text-xs">
                        {t.is_active ? 'Desactiver' : 'Activer'}
                      </button>
                    </td>
                  </tr>
                ))}
                {triggers.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Aucun trigger</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onChange={setPage} />}
        </Card>
      )}

      {showModal && (
        <Modal onClose={() => setShowModal(false)} title={tab === 'campaigns' ? 'Nouvelle campagne' : 'Nouveau trigger'}>
          <div className="space-y-4">
            <Select value={form.merchant_id} onChange={e => setForm({ ...form, merchant_id: e.target.value })}>
              <option value="">Marchand</option>
              {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            {tab === 'campaigns' ? (
              <>
                <Input placeholder="Nom de la campagne" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                <Select value={form.target_segment} onChange={e => setForm({ ...form, target_segment: e.target.value })}>
                  <option value="">Segment cible</option>
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </>
            ) : (
              <>
                <Select value={form.trigger_type} onChange={e => setForm({ ...form, trigger_type: e.target.value })}>
                  <option value="">Type de trigger</option>
                  {TRIGGER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Select value={form.target_segment} onChange={e => setForm({ ...form, target_segment: e.target.value })}>
                  <option value="">Segment cible (optionnel)</option>
                  {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                </Select>
              </>
            )}
            <Select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </Select>
            <textarea
              className="w-full border rounded-lg p-3 text-sm"
              rows={3}
              placeholder="Message template ({client_name}, {merchant_name})"
              value={form.message_template}
              onChange={e => setForm({ ...form, message_template: e.target.value })}
            />
            <Button onClick={tab === 'campaigns' ? createCampaign : createTrigger}>
              Creer
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
