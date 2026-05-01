import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Button, Spinner, Pagination, Select, Modal } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'

const PACKAGES = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']
const PKG_COLORS = { STARTER_BOOST: 'yellow', STARTER_PLUS: 'blue', GROWTH: 'green', PREMIUM: 'purple' }
const PKG_LABELS = { STARTER_BOOST: 'Starter Boost', STARTER_PLUS: 'Starter Plus', GROWTH: 'Growth Intelligent', PREMIUM: 'Premium Performance' }

function ChangePackageModal({ sub, prices, onClose, onSaved }) {
  const [newPkg, setNewPkg] = useState(sub.package)
  const [reason, setReason] = useState('')
  const [periods, setPeriods] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/subscriptions/${sub.id}`).then(r => setPeriods(r.data.periods || [])).catch(() => { })
  }, [sub.id])

  const save = async () => {
    if (newPkg === sub.package && !reason) { onClose(); return }
    setSaving(true); setError('')
    try {
      await api.patch(`/subscriptions/${sub.id}`, { package: newPkg, base_monthly_fee: prices[newPkg], reason })
      onSaved()
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du changement')
    } finally { setSaving(false) }
  }

  const PKG_HEX = { STARTER_BOOST: 'var(--af-text-muted)', STARTER_PLUS: '#3b82f6', GROWTH: '#10b981', PREMIUM: 'var(--af-accent)' }

  return (
    <Modal open title={`Changer l'abonnement — ${sub.merchant_name || sub.merchant_email}`} onClose={onClose}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 8 }}>Abonnement actuel</div>
        <Badge color={PKG_COLORS[sub.package]}>{PKG_LABELS[sub.package]}</Badge>
        {sub.current_period_end && (
          <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 6 }}>
            Période en cours jusqu'au {new Date(sub.current_period_end).toLocaleDateString('fr-FR')}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 10 }}>Nouvel abonnement</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {PACKAGES.map(pkg => {
            const selected = newPkg === pkg
            const hex = PKG_HEX[pkg]
            return (
              <button key={pkg} onClick={() => setNewPkg(pkg)}
                style={{
                  padding: '12px 14px', border: `2px solid ${selected ? hex : 'var(--af-border)'}`,
                  borderRadius: 10, background: selected ? hex + '18' : 'var(--af-surface-3)',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: selected ? hex : 'var(--af-text-muted)' }}>{PKG_LABELS[pkg]}</div>
                <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>{(prices[pkg] || 0).toLocaleString()} FCFA/mois</div>
                {pkg === sub.package && <div style={{ fontSize: 10, color: 'var(--af-border-strong)', marginTop: 2 }}>Actuel</div>}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginBottom: 6 }}>Raison du changement (audit)</div>
        <input type="text" value={reason} onChange={e => setReason(e.target.value)}
          placeholder="ex: geste commercial, correction, négociation"
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--af-border)', background: 'var(--af-surface-3)', color: 'var(--af-text)', fontSize: 13 }} />
      </div>

      {periods.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--af-surface-3)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', marginBottom: 6 }}>File de périodes</div>
          {periods.map(p => (
            <div key={p.id} style={{ fontSize: 11, color: 'var(--af-text-muted)', marginBottom: 3 }}>
              <Badge color={p.status === 'active' ? 'green' : 'blue'}>{p.status}</Badge>{' '}
              {p.package} ({p.billing_cycle}) — {new Date(p.period_start).toLocaleDateString('fr-FR')} → {new Date(p.period_end).toLocaleDateString('fr-FR')}
            </div>
          ))}
        </div>
      )}

      {newPkg !== sub.package && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--af-accent)' }}>
          Le package du marchand sera mis à jour immédiatement. <b>L'échéance actuelle reste inchangée</b> et aucun paiement n'est facturé au marchand.
        </div>
      )}

      {error && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button onClick={save} disabled={saving || (newPkg === sub.package && !reason)}>
          {saving ? 'Enregistrement...' : 'Confirmer le changement'}
        </Button>
      </div>
    </Modal>
  )
}

export default function AdminSubscriptions() {
  const [subs, setSubs] = useState([])
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filterPkg, setFilterPkg] = useState('')
  const [changingSub, setChangingSub] = useState(null)
  const limit = 20

  useEffect(() => {
    api.get('/subscriptions/packages').then(r => {
      const map = {}
      for (const p of (r.data.packages || [])) map[p.code] = p.monthly
      setPrices(map)
    }).catch(() => setPrices({ STARTER_BOOST: 9900, STARTER_PLUS: 19900, GROWTH: 39900, PREMIUM: 79900 }))
  }, [])

  const load = () => {
    setLoading(true)
    const params = { page, limit }
    if (filterPkg) params.package = filterPkg
    api.get('/subscriptions', { params }).then(r => {
      setSubs(r.data.subscriptions || [])
      setTotal(r.data.total || 0)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page, filterPkg])

  const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-border)', textAlign: 'left' }
  const td = { padding: '10px 14px', fontSize: 13, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-surface)' }
  const card = { background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '16px 20px' }
  const PKG_HEX = { STARTER_BOOST: 'var(--af-text-muted)', STARTER_PLUS: '#3b82f6', GROWTH: '#10b981', PREMIUM: 'var(--af-accent)' }

  if (loading) return <Spinner />

  return (
    <div style={{ padding: '28px 32px' }}>
      {changingSub && (
        <ChangePackageModal
          sub={changingSub}
          prices={prices}
          onClose={() => setChangingSub(null)}
          onSaved={load}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Breadcrumb title="Abonnements" segments={[{ label: 'Packages marchands' }]} />
        <Select value={filterPkg} onChange={e => { setFilterPkg(e.target.value); setPage(1) }}>
          <option value="">Tous les packages</option>
          {PACKAGES.map(p => <option key={p} value={p}>{PKG_LABELS[p]}</option>)}
        </Select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
        {PACKAGES.map(pkg => {
          const count = subs.filter(s => s.package === pkg).length
          const hex = PKG_HEX[pkg] || 'var(--af-text-muted)'
          return (
            <div key={pkg} style={{ ...card }}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6 }}>{PKG_LABELS[pkg]}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: hex }}>{count}</div>
            </div>
          )
        })}
      </div>

      <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Marchand', 'Package', 'Cycle', 'Mensualité', 'Réduction', 'Statut', 'Échéance', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {subs.map(s => (
                <tr key={s.id}>
                  <td style={{ ...td, color: 'var(--af-text)', fontWeight: 600 }}>{s.merchant_name || s.merchant_email}</td>
                  <td style={td}><Badge color={PKG_COLORS[s.package]}>{PKG_LABELS[s.package] || s.package}</Badge></td>
                  <td style={td}>{s.billing_cycle === 'annual' ? 'Annuel' : 'Mensuel'}</td>
                  <td style={td}>
                    {s.effective_monthly_fee !== s.base_monthly_fee ? (
                      <span>
                        <span style={{ textDecoration: 'line-through', color: 'var(--af-border-strong)' }}>{Number(s.base_monthly_fee).toLocaleString()} FCFA</span>{' '}
                        <span style={{ fontWeight: 700, color: '#10b981' }}>{Number(s.effective_monthly_fee).toLocaleString()} FCFA</span>
                      </span>
                    ) : <span>{Number(s.base_monthly_fee).toLocaleString()} FCFA</span>}
                  </td>
                  <td style={td}>
                    {s.recruitment_discount_percent > 0
                      ? <Badge color="green">-{s.recruitment_discount_percent}% ({s.recruited_clients_count} clients)</Badge>
                      : <span style={{ color: 'var(--af-border-strong)' }}>—</span>}
                  </td>
                  <td style={td}><Badge color={s.status === 'active' ? 'green' : 'red'}>{s.status}</Badge></td>
                  <td style={td}>{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString('fr-FR') : (s.next_billing_at ? new Date(s.next_billing_at).toLocaleDateString('fr-FR') : '—')}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button
                      onClick={() => setChangingSub(s)}
                      style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: '1px solid var(--af-border)', borderRadius: 6, background: 'transparent', color: 'var(--af-text-muted)', cursor: 'pointer' }}
                    >
                      Changer
                    </button>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32 }}>Aucun abonnement</td></tr>}
            </tbody>
          </table>
        </div>
        {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
      </div>
    </div>
  )
}
