import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Modal, Input, Button, Alert, EmptyState, Spinner } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import { ScaleIcon, NoSymbolIcon } from '@heroicons/react/24/outline'

const RULE_TYPE_LABELS = {
  max_amount_per_tx:   'Montant max par transaction',
  max_tx_per_hour:     'Nb max de transactions / heure',
  max_tx_per_day:      'Nb max de transactions / jour',
  max_amount_per_day:  'Volume max par jour',
  max_failed_attempts: 'Tentatives échouées max',
}

export default function AdminFraud() {
  const [rules, setRules] = useState([])
  const [phones, setPhones] = useState([])
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState(null)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [ruleForm, setRuleForm] = useState({ name: '', rule_type: 'max_amount_per_tx', value: '' })
  const [phoneForm, setPhoneForm] = useState({ phone: '', reason: '' })

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/fraud/rules'), api.get('/fraud/blocked-phones')]).then(([r, p]) => {
      setRules(r.data.rules)
      setPhones(p.data.phones)
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const createRule = async () => {
    if (!ruleForm.name || !ruleForm.value) return
    try {
      await api.post('/fraud/rules', { ...ruleForm, value: parseFloat(ruleForm.value) })
      setAlert({ type: 'success', text: 'Règle créée.' })
      setShowRuleModal(false)
      setRuleForm({ name: '', rule_type: 'max_amount_per_tx', value: '' })
      load()
    } catch (e) {
      setAlert({ type: 'error', text: e.response?.data?.error || 'Erreur création règle.' })
    }
  }

  const toggleRule = async (id, current) => {
    try {
      await api.patch(`/fraud/rules/${id}/toggle`, { is_active: !current })
      load()
    } catch {
      setAlert({ type: 'error', text: 'Erreur mise à jour règle.' })
    }
  }

  const deleteRule = async (id) => {
    if (!confirm('Supprimer cette règle ?')) return
    try {
      await api.delete(`/fraud/rules/${id}`)
      load()
    } catch {
      setAlert({ type: 'error', text: 'Erreur suppression.' })
    }
  }

  const blockPhone = async () => {
    if (!phoneForm.phone) return
    try {
      await api.post('/fraud/blocked-phones', phoneForm)
      setAlert({ type: 'success', text: `${phoneForm.phone} bloqué.` })
      setShowPhoneModal(false)
      setPhoneForm({ phone: '', reason: '' })
      load()
    } catch (e) {
      setAlert({ type: 'error', text: e.response?.data?.error || 'Erreur.' })
    }
  }

  const unblockPhone = async (phone) => {
    if (!confirm(`Débloquer ${phone} ?`)) return
    try {
      await api.delete(`/fraud/blocked-phones/${encodeURIComponent(phone)}`)
      load()
    } catch {
      setAlert({ type: 'error', text: 'Erreur déblocage.' })
    }
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <Breadcrumb title="Fraude" segments={[{ label: 'Règles · Blacklist · Score de risque' }]} />

      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.text}</Alert>}

      {loading ? <Spinner /> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Règles */}
          <Card title="Règles actives" action={
            <Button size="sm" onClick={() => setShowRuleModal(true)}>+ Ajouter</Button>
          }>
            {rules.length === 0 ? (
              <EmptyState icon={<ScaleIcon style={{ width: 40, height: 40, color: 'var(--af-border)' }} />} title="Règles par défaut actives" desc="Ajoutez des règles pour surcharger les valeurs par défaut." />
            ) : (
              <div>
                {rules.map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--af-border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: r.is_active ? 'var(--af-text)' : 'var(--af-text-muted)' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>{RULE_TYPE_LABELS[r.rule_type] || r.rule_type} · Valeur: {r.value}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button onClick={() => toggleRule(r.id, r.is_active)}
                        style={{ padding: '3px 10px', background: r.is_active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)', border: `1px solid ${r.is_active ? 'rgba(16,185,129,0.3)' : 'var(--af-border)'}`, borderRadius: 6, color: r.is_active ? '#10b981' : 'var(--af-text-muted)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        {r.is_active ? 'Actif' : 'Inactif'}
                      </button>
                      <button onClick={() => deleteRule(r.id)}
                        style={{ padding: '3px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Règles par défaut */}
            <div style={{ marginTop: 16, background: 'var(--af-surface-3)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>Règles par défaut (si non surchargées)</div>
              {[
                ['Montant max / tx', '5 000 000 XOF'],
                ['Max tx / heure', '10'],
                ['Max tx / jour', '30'],
                ['Volume max / jour', '10 000 000 XOF'],
                ['Tentatives échouées', '5'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 4 }}>
                  <span>{k}</span><span style={{ color: 'var(--af-text-muted)' }}>{v}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Blacklist */}
          <Card title="Numéros bloqués" action={
            <Button size="sm" variant="danger" onClick={() => setShowPhoneModal(true)}>+ Bloquer</Button>
          }>
            {phones.length === 0 ? (
              <EmptyState icon={<NoSymbolIcon style={{ width: 40, height: 40, color: 'var(--af-border)' }} />} title="Aucun numéro bloqué" desc="Les numéros bloqués seront refusés à l'initiation de paiement." />
            ) : (
              <div>
                {phones.map(p => (
                  <div key={p.phone} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--af-border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444', fontFamily: 'monospace' }}>{p.phone}</div>
                      {p.reason && <div style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>{p.reason}</div>}
                      <div style={{ fontSize: 10, color: 'var(--af-text-muted)' }}>{p.blocked_at?.split('T')[0]}</div>
                    </div>
                    <button onClick={() => unblockPhone(p.phone)}
                      style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, color: '#10b981', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                      Débloquer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Modal règle */}
      <Modal open={showRuleModal} onClose={() => setShowRuleModal(false)} title="Nouvelle règle anti-fraude" maxWidth={440}>
        <Input label="Nom de la règle" value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Limite Orange CI" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6 }}>Type</label>
          <select value={ruleForm.rule_type} onChange={e => setRuleForm(f => ({ ...f, rule_type: e.target.value }))}
            style={{ width: '100%', padding: '10px 12px', background: 'var(--af-surface-3)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
            {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Input label="Valeur" type="number" value={ruleForm.value} onChange={e => setRuleForm(f => ({ ...f, value: e.target.value }))} placeholder="Ex: 1000000" />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setShowRuleModal(false)}>Annuler</Button>
          <Button onClick={createRule}>Créer</Button>
        </div>
      </Modal>

      {/* Modal blacklist */}
      <Modal open={showPhoneModal} onClose={() => setShowPhoneModal(false)} title="Bloquer un numéro" maxWidth={400}>
        <Input label="Numéro de téléphone" value={phoneForm.phone} onChange={e => setPhoneForm(f => ({ ...f, phone: e.target.value }))} placeholder="+2250700000000" />
        <Input label="Raison (optionnel)" value={phoneForm.reason} onChange={e => setPhoneForm(f => ({ ...f, reason: e.target.value }))} placeholder="Ex: Fraude détectée" />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={() => setShowPhoneModal(false)}>Annuler</Button>
          <Button variant="danger" onClick={blockPhone}>Bloquer</Button>
        </div>
      </Modal>
    </div>
  )
}
