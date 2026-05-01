import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Input, Button, Alert, Spinner } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'

export default function AdminExchangeRates() {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState(null)
  const [editing, setEditing] = useState(null) // { from_currency, to_currency, rate }
  const [form, setForm] = useState({ from_currency: '', to_currency: '', rate: '' })

  const load = () => {
    setLoading(true)
    api.get('/reports/exchange-rates').then(r => {
      setRates(r.data.rates || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const startEdit = (r) => {
    setEditing(r)
    setForm({ from_currency: r.from_currency, to_currency: r.to_currency, rate: String(r.rate) })
  }

  const save = async () => {
    const rate = parseFloat(form.rate)
    if (!rate || rate <= 0) { setAlert({ type: 'error', text: 'Taux invalide.' }); return }
    try {
      await api.put('/reports/exchange-rates', { from_currency: form.from_currency, to_currency: form.to_currency, rate })
      setAlert({ type: 'success', text: `Taux ${form.from_currency}/${form.to_currency} mis à jour.` })
      setEditing(null)
      load()
    } catch (e) {
      setAlert({ type: 'error', text: e.response?.data?.error || 'Erreur mise à jour.' })
    }
  }

  const ZONES = { XOF: 'UEMOA', XAF: 'CEMAC', KES: 'Afrique de l\'Est', EUR: 'International' }

  return (
    <div style={{ padding: '28px 32px' }}>
      <Breadcrumb title="Taux de change" segments={[{ label: 'XOF · XAF · KES · EUR' }]} />

      {alert && <Alert type={alert.type} onClose={() => setAlert(null)}>{alert.text}</Alert>}

      {loading ? <Spinner /> : (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
          <Card title="Taux configurés">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--af-surface-3)' }}>
                  {['De', 'Vers', 'Taux', 'Zone', 'Modifié', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rates.map(r => (
                  <tr key={`${r.from_currency}-${r.to_currency}`} style={{ borderTop: '1px solid var(--af-border)' }}>
                    <td style={{ padding: '11px 14px', fontSize: 14, fontWeight: 600, color: 'var(--af-accent)' }}>{r.from_currency}</td>
                    <td style={{ padding: '11px 14px', fontSize: 14, fontWeight: 600, color: '#3b82f6' }}>{r.to_currency}</td>
                    <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--af-text)', fontFamily: 'monospace' }}>{r.rate}</td>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--af-text-muted)' }}>{ZONES[r.from_currency] || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: 11, color: 'var(--af-text-muted)' }}>{r.updated_at?.split('T')[0]}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <button onClick={() => startEdit(r)}
                        style={{ padding: '3px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6, color: 'var(--af-accent)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                        Modifier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Modifier un taux */}
          <Card title={editing ? `Modifier ${editing.from_currency} → ${editing.to_currency}` : 'Sélectionnez un taux'}>
            {editing ? (
              <div>
                <div style={{ background: 'var(--af-surface-3)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 4 }}>Taux actuel</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--af-accent)', fontFamily: 'monospace' }}>
                    1 {editing.from_currency} = {editing.rate} {editing.to_currency}
                  </div>
                </div>
                <Input label="Nouveau taux" type="number" step="0.000001" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button onClick={save} style={{ flex: 1 }}>Enregistrer</Button>
                  <Button variant="secondary" onClick={() => setEditing(null)}>Annuler</Button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--af-text-muted)', fontSize: 13 }}>
                Cliquez sur "Modifier" pour mettre à jour un taux.
              </div>
            )}

            {/* Info */}
            <div style={{ marginTop: 20, background: 'var(--af-surface-3)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 8 }}>ℹ️ UTILISATION</div>
              <p style={{ fontSize: 12, color: 'var(--af-text-muted)', lineHeight: 1.6, margin: 0 }}>
                Ces taux sont utilisés pour normaliser les rapports multi-devises en EUR.
                Les transactions réelles ne sont pas affectées par ces valeurs.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
