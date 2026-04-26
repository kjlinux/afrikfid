import React, { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api from '../../api.js'
import { Breadcrumb } from '../../App.jsx'

const BADGE = { OPEN: { color: '#6B7280', bg: 'rgba(107,114,128,0.15)' }, LIVE: { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' }, GOLD: { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' }, ROYAL: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)' }, ROYAL_ELITE: { color: '#ec4899', bg: 'rgba(236,72,153,0.15)' } }
const COUNTRY_FLAG = {
  CI: '🇨🇮', SN: '🇸🇳', BF: '🇧🇫', ML: '🇲🇱', NE: '🇳🇪', TG: '🇹🇬', BJ: '🇧🇯', GW: '🇬🇼',
  CM: '🇨🇲', TD: '🇹🇩', GQ: '🇬🇶', GA: '🇬🇦', CG: '🇨🇬', CF: '🇨🇫', KE: '🇰🇪',
}
const STATUS_COLORS = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6', ROYAL_ELITE: '#ec4899' }
const RFM_COLORS = { CHAMPIONS: '#4caf50', FIDELES: '#3b82f6', PROMETTEURS: '#8b5cf6', A_RISQUE: '#ef4444', HIBERNANTS: '#F59E0B', PERDUS: '#6B7280' }
const RFM_LABELS = { CHAMPIONS: 'Champions', FIDELES: 'Fidèles', PROMETTEURS: 'Prometteurs', A_RISQUE: 'À Risque', HIBERNANTS: 'Hibernants', PERDUS: 'Perdus' }
const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

const S = {
  inp: { padding: '10px 14px', background: 'var(--afrikfid-surface)', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-text)', fontSize: 14, outline: 'none' },
  cell: { padding: '11px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  infoBox: { background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: 12, textAlign: 'center' },
}

export default function AdminClients() {
  const [clients, setClients] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [rfmFilter, setRfmFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [clientDetail, setClientDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pieData, setPieData] = useState([])
  const [confirmAnonymize, setConfirmAnonymize] = useState(null)
  const [anonymizeLoading, setAnonymizeLoading] = useState(false)
  const [confirmUnlink, setConfirmUnlink] = useState(null)
  const [unlinkLoading, setUnlinkLoading] = useState(false)

  // Création d'un nouveau client (délègue à business-api)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({
    full_name: '', sexe: 'M', phone: '', email: '', city: '', birth_date: '', indicatif: '',
  })
  const [createLoading, setCreateLoading] = useState(false)
  const [createMsg, setCreateMsg] = useState(null)

  const submitCreateClient = async () => {
    if (!createForm.full_name?.trim()) return setCreateMsg({ type: 'error', text: 'Nom et prénom requis' })
    if (!createForm.sexe) return setCreateMsg({ type: 'error', text: 'Genre requis' })
    setCreateLoading(true); setCreateMsg(null)
    try {
      const { data } = await api.post('/clients', createForm)
      setCreateMsg({
        type: 'success',
        text: `Client créé. Carte n° ${data.numero_carte}.`,
      })
      setCreateForm({ full_name: '', sexe: 'M', phone: '', email: '', city: '', birth_date: '', indicatif: '' })
      load()
      setTimeout(() => { setShowCreateModal(false); setCreateMsg(null) }, 2000)
    } catch (e) {
      const status = e.response?.status
      if (status === 409) {
        const numero = e.response.data?.numero_carte
        setCreateMsg({
          type: 'error',
          text: `Consommateur déjà existant${numero ? ` (carte ${numero}, rattaché)` : ''}.`,
        })
        load()
      } else {
        setCreateMsg({ type: 'error', text: e.response?.data?.message || e.response?.data?.error || 'Erreur' })
      }
    } finally { setCreateLoading(false) }
  }

  useEffect(() => {
    api.get('/loyalty/stats').then(r => {
      const dist = r.data.byStatus || []
      setPieData(dist.map(d => ({ name: d.loyalty_status, value: parseInt(d.count), color: STATUS_COLORS[d.loyalty_status] || '#6B7280' })).filter(d => d.value > 0))
    }).catch(() => {})
  }, [])

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 15 })
    if (q) params.set('q', q)
    if (statusFilter) params.set('status', statusFilter)
    if (rfmFilter) params.set('rfm_segment', rfmFilter)
    api.get(`/clients?${params}`).then(r => {
      setClients(r.data.clients)
      setTotal(r.data.total)
      setLoading(false)
    })
  }

  useEffect(() => { load() }, [page, q, statusFilter, rfmFilter])

  const openDetail = async client => {
    setSelected(client)
    const r = await api.get(`/clients/${client.id}/profile`)
    setClientDetail(r.data)
  }

  const updateStatus = async (id, status) => {
    await api.patch(`/clients/${id}/loyalty-status`, { status })
    load()
    if (selected?.id === id) openDetail({ id })
  }

  const exportGdpr = async (client) => {
    try {
      const r = await api.get(`/clients/${client.id}/export`)
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `rgpd-export-${client.afrikfidId || client.id}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erreur export RGPD : ' + (e.response?.data?.error || e.message))
    }
  }

  const unlinkCard = async () => {
    if (!confirmUnlink) return
    setUnlinkLoading(true)
    try {
      const { data } = await api.delete(`/clients/${confirmUnlink.id}/card-link`)
      setConfirmUnlink(null)
      // Rafraîchir le client sélectionné avec le nouvel afrikfidId
      if (selected?.id === confirmUnlink.id) {
        setSelected(prev => ({ ...prev, afrikfidId: data.newAfrikfidId }))
        openDetail({ id: confirmUnlink.id })
      }
      load()
    } catch (e) {
      alert('Erreur : ' + (e.response?.data?.error || e.message))
    } finally { setUnlinkLoading(false) }
  }

  const anonymizeClient = async () => {
    if (!confirmAnonymize) return
    setAnonymizeLoading(true)
    try {
      await api.delete(`/clients/${confirmAnonymize.id}`)
      setConfirmAnonymize(null)
      setSelected(null)
      setClientDetail(null)
      load()
    } catch (e) {
      alert('Erreur anonymisation : ' + (e.response?.data?.error || e.message))
    } finally { setAnonymizeLoading(false) }
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <Breadcrumb title="Consommateurs" segments={[{ label: 'Liste des consommateurs' }]} />

      <div className="af-card" style={{ marginBottom: 20 }}>
        <div className="af-card__header">
          <h3 className="af-card__title">Liste des consommateurs <span style={{ color: 'var(--af-text-muted)', fontWeight: 400, marginLeft: 8 }}>({total})</span></h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1) }} placeholder="recherche..."
              className="af-field af-field--search" style={{ width: 240, marginBottom: 0 }} />
            <button onClick={() => setShowCreateModal(true)}
              style={{ padding: '8px 14px', background: 'var(--afrikfid-accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Nouveau client
            </button>
          </div>
        </div>

        <div style={{ padding: '12px 20px', display: 'flex', gap: 12, borderBottom: '1px solid var(--af-border)', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className="af-field" style={{ width: 'auto', flex: '0 0 auto' }}>
            <option value="">Tous les statuts</option>
            <option value="OPEN">Open</option>
            <option value="LIVE">Live</option>
            <option value="GOLD">Gold</option>
            <option value="ROYAL">Royal</option>
            <option value="ROYAL_ELITE">Royal Élite</option>
          </select>
          <select value={rfmFilter} onChange={e => { setRfmFilter(e.target.value); setPage(1) }} className="af-field" style={{ width: 'auto', flex: '0 0 auto' }}>
            <option value="">Tous segments RFM</option>
            <option value="CHAMPIONS">Champions</option>
            <option value="FIDELES">Fidèles</option>
            <option value="PROMETTEURS">Prometteurs</option>
            <option value="A_RISQUE">À Risque</option>
            <option value="HIBERNANTS">Hibernants</option>
            <option value="PERDUS">Perdus</option>
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="af-table">
            <thead>
              <tr>
                <th>Nom & prénom</th>
                <th>Sexe</th>
                <th>Pays</th>
                <th style={{ textAlign: 'center' }}>Nb achats</th>
                <th style={{ textAlign: 'center' }}>Fidélité</th>
                <th style={{ textAlign: 'right' }}>Dépenses</th>
                <th style={{ textAlign: 'right' }}>Wallet</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--af-text-muted)' }}>Chargement...</td></tr>
              ) : clients.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--af-text-muted)' }}>Aucun consommateur</td></tr>
              ) : clients.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--af-kpi-blue-soft)', color: 'var(--af-kpi-blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                        {(c.fullName || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                      </span>
                      <div>
                        <div>{c.fullName}</div>
                        {c.afrikfidId && <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontFamily: 'monospace' }}>{c.afrikfidId}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--af-text-muted)' }}>{c.gender || 'M'}</td>
                  <td style={{ color: 'var(--af-text-muted)' }}>
                    <span style={{ marginRight: 6 }}>{COUNTRY_FLAG[c.countryId] || '🌍'}</span>
                    {c.countryName || c.countryId || '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={c.totalPurchases > 0 ? 'af-pill af-pill--blue' : 'af-pill af-pill--red'}>{c.totalPurchases || 0}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={c.loyaltyPoints > 0 ? 'af-pill af-pill--gray' : 'af-pill af-pill--gray'} style={{ opacity: c.loyaltyPoints > 0 ? 1 : 0.5 }}>{c.loyaltyPoints || 0} pts</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={c.totalAmount > 0 ? 'af-pill af-pill--green' : 'af-pill af-pill--red'}>{fmt(c.totalAmount)} FCFA</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={c.walletBalance > 0 ? 'af-pill af-pill--orange' : 'af-pill af-pill--red'}>{fmt(c.walletBalance)} FCFA</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => openDetail(c)} className="af-btn af-btn--ghost af-btn--sm">
                      Détails
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--af-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--af-surface-2)' }}>
          <span style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>{total} consommateurs</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="af-btn af-btn--ghost af-btn--sm">←</button>
            <span style={{ fontSize: 13, color: 'var(--af-text)', padding: '0 8px', alignSelf: 'center' }}>{page}</span>
            <button disabled={page * 15 >= total} onClick={() => setPage(p => p + 1)} className="af-btn af-btn--ghost af-btn--sm">→</button>
          </div>
        </div>
      </div>

      {pieData.length > 0 && (
        <div className="af-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--af-text)' }}>Clients par statut</div>
          <div style={{ flex: 1, height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="var(--af-surface)" strokeWidth={2} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [v, n]} contentStyle={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 8, color: 'var(--af-text)' }} />
                <Legend formatter={name => <span style={{ color: 'var(--af-text-muted)', fontSize: 12 }}>{name}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Create client modal */}
      {showCreateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 17, 21,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 12, border: '1px solid var(--afrikfid-border)', padding: 28, width: 460, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--afrikfid-text)', marginBottom: 6, fontFamily: 'Montserrat, sans-serif' }}>Nouveau client</div>
            <p style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 18 }}>
              Le compte est créé sur le système fidélité Afrik'Fid. Une carte fidélité (n° 2014…) et un wallet sont générés automatiquement.
            </p>

            {createMsg && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
                background: createMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                color: createMsg.type === 'success' ? '#10b981' : '#ef4444',
                border: '1px solid ' + (createMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'),
              }}>{createMsg.text}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Prénom + nom *</label>
                <input value={createForm.full_name}
                  onChange={e => setCreateForm({ ...createForm, full_name: e.target.value })}
                  placeholder="Aïcha Diop" style={S.inp} />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Genre *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[{ k: 'M', l: 'Homme' }, { k: 'F', l: 'Femme' }].map(({ k, l }) => (
                    <button key={k} type="button" onClick={() => setCreateForm({ ...createForm, sexe: k })}
                      style={{
                        flex: 1, padding: 8, borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        background: createForm.sexe === k ? 'var(--afrikfid-accent)' : 'var(--afrikfid-surface-2)',
                        color: createForm.sexe === k ? '#fff' : 'var(--afrikfid-muted)',
                        border: '1px solid ' + (createForm.sexe === k ? 'var(--afrikfid-accent)' : 'var(--afrikfid-border)'),
                      }}>{l}</button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 100 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Indicatif</label>
                  <input value={createForm.indicatif} onChange={e => setCreateForm({ ...createForm, indicatif: e.target.value.replace(/\D/g, '') })}
                    placeholder="221" style={S.inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Téléphone</label>
                  <input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
                    placeholder="771234567" style={S.inp} />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Email</label>
                <input type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                  placeholder="aicha@example.com" style={S.inp} />
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Ville</label>
                  <input value={createForm.city} onChange={e => setCreateForm({ ...createForm, city: e.target.value })}
                    placeholder="Dakar" style={S.inp} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 4 }}>Date de naissance</label>
                  <input type="date" value={createForm.birth_date} onChange={e => setCreateForm({ ...createForm, birth_date: e.target.value })}
                    style={S.inp} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => { setShowCreateModal(false); setCreateMsg(null) }} disabled={createLoading}
                style={{ flex: 1, padding: 10, background: 'transparent', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 13 }}>
                Annuler
              </button>
              <button onClick={submitCreateClient} disabled={createLoading || !createForm.full_name}
                style={{ flex: 1, padding: 10, background: 'var(--afrikfid-accent)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {createLoading ? 'Création...' : 'Créer le compte'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlink card confirm */}
      {confirmUnlink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 17, 21,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 12, border: '1px solid rgba(245,158,11,0.4)', padding: 28, width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(15, 17, 21,0.15)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b', marginBottom: 12, fontFamily: 'Montserrat, sans-serif' }}>Délier la carte fidélité ?</div>
            <p style={{ fontSize: 13, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>
              Le compte <strong style={{ color: 'var(--afrikfid-text)' }}>{confirmUnlink.fullName}</strong> sera déconnecté de la carte&nbsp;
              <span style={{ color: 'var(--afrikfid-text)', fontFamily: 'monospace' }}>{confirmUnlink.afrikfidId}</span>.
            </p>
            <p style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 20 }}>
              Le client ne pourra plus payer par wallet ni accumuler de points fidélité tant qu'une nouvelle carte n'est pas liée. La carte elle-même reste active côté business-api.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmUnlink(null)} disabled={unlinkLoading}
                style={{ flex: 1, padding: 10, background: 'transparent', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 13 }}>
                Annuler
              </button>
              <button onClick={unlinkCard} disabled={unlinkLoading}
                style={{ flex: 1, padding: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, color: '#f59e0b', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {unlinkLoading ? 'Déliaison...' : 'Confirmer la déliaison'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anonymize confirm */}
      {confirmAnonymize && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 17, 21,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 12, border: '1px solid #ef444450', padding: 28, width: 420, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(15, 17, 21,0.15)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444', marginBottom: 12, fontFamily: 'Montserrat, sans-serif' }}>Anonymiser ce client ?</div>
            <p style={{ fontSize: 13, color: 'var(--afrikfid-muted)', marginBottom: 8 }}>
              Cette action est <strong style={{ color: 'var(--afrikfid-text)' }}>irréversible</strong>. Les données personnelles de&nbsp;
              <strong style={{ color: 'var(--afrikfid-text)' }}>{confirmAnonymize.fullName}</strong> seront remplacées (RGPD — droit à l'oubli).
            </p>
            <p style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 20 }}>Les transactions historiques sont conservées à des fins comptables.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmAnonymize(null)} disabled={anonymizeLoading}
                style={{ flex: 1, padding: 10, background: 'transparent', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 13 }}>
                Annuler
              </button>
              <button onClick={anonymizeClient} disabled={anonymizeLoading}
                style={{ flex: 1, padding: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                {anonymizeLoading ? 'Anonymisation...' : "Confirmer l'anonymisation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 17, 21,0.45)', display: 'flex', justifyContent: 'flex-end', zIndex: 1000 }}>
          <div style={{ width: 480, background: 'var(--afrikfid-surface)', borderLeft: '1px solid var(--afrikfid-border)', padding: 28, overflowY: 'auto', boxShadow: '-4px 0 24px rgba(15, 17, 21,0.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>{selected.fullName}</h2>
              <button onClick={() => { setSelected(null); setClientDetail(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            {clientDetail && (
              <>
                <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--afrikfid-border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {[
                      ["ID Afrik'Fid", selected.afrikfidId],
                      ['Téléphone', selected.phone],
                      ['Email', clientDetail.client?.email || '—'],
                      ['Pays', selected.countryId],
                      ['Inscrit le', selected.createdAt?.split('T')[0]],
                      ['Statut depuis', selected.statusSince?.split('T')[0]],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 2 }}>{k}</div>
                        <div style={{ fontSize: 13, color: 'var(--afrikfid-text)' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--afrikfid-border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>STATUT FIDÉLITÉ</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['OPEN', 'LIVE', 'GOLD', 'ROYAL'].map(s => {
                      const b = BADGE[s]
                      const isCurrent = selected.loyaltyStatus === s
                      return (
                        <button key={s} onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, loyaltyStatus: s })) }}
                          style={{ padding: '6px 14px', border: `2px solid ${isCurrent ? b.color : 'var(--afrikfid-border)'}`, borderRadius: 20, background: isCurrent ? b.bg : 'transparent', color: isCurrent ? b.color : 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                          {s}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Achats', value: clientDetail.stats?.count || 0, color: 'var(--af-text)' },
                    { label: 'Volume XOF', value: fmt(clientDetail.stats?.total), color: 'var(--afrikfid-accent)' },
                    { label: 'Wallet cashback', value: `${fmt(clientDetail.wallet?.balance)} XOF`, color: 'var(--afrikfid-success)' },
                  ].map(s => (
                    <div key={s.label} style={S.infoBox}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Pts statut (12m)', value: clientDetail.client?.statusPoints12m ?? 0, color: 'var(--af-kpi-violet)' },
                    { label: 'Pts récompense', value: clientDetail.client?.rewardPoints ?? 0, color: 'var(--afrikfid-success)' },
                    { label: 'Pts statut total', value: clientDetail.client?.lifetimeStatusPoints ?? 0, color: '#8b5cf6' },
                  ].map(s => (
                    <div key={s.label} style={S.infoBox}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 2 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {['ROYAL', 'ROYAL_ELITE'].includes(selected.loyaltyStatus) && (
                  <div style={{ ...S.infoBox, marginBottom: 16, border: '1px solid var(--afrikfid-border)' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--af-kpi-yellow)' }}>
                      {clientDetail.client?.consecutiveRoyalYears ?? 0} an{(clientDetail.client?.consecutiveRoyalYears ?? 0) > 1 ? 's' : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 2 }}>Années ROYAL consécutives</div>
                    {(clientDetail.client?.consecutiveRoyalYears ?? 0) >= 2 && (
                      <div style={{ fontSize: 10, color: 'var(--afrikfid-accent)', marginTop: 4 }}>
                        {(clientDetail.client?.consecutiveRoyalYears ?? 0) >= 3 ? 'ROYAL ELITE éligible' : `${3 - (clientDetail.client?.consecutiveRoyalYears ?? 0)} an(s) restant(s) pour ROYAL ELITE`}
                      </div>
                    )}
                  </div>
                )}

                {clientDetail.rfmSegment && (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--afrikfid-border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Segment RFM</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ background: `${RFM_COLORS[clientDetail.rfmSegment.segment] || '#6B7280'}22`, color: RFM_COLORS[clientDetail.rfmSegment.segment] || '#6B7280', padding: '5px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700 }}>
                        {RFM_LABELS[clientDetail.rfmSegment.segment] || clientDetail.rfmSegment.segment}
                      </span>
                      <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)' }}>
                        R:{clientDetail.rfmSegment.r_score} F:{clientDetail.rfmSegment.f_score} M:{clientDetail.rfmSegment.m_score}
                      </div>
                    </div>
                    {clientDetail.abandonInfo && (
                      <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#ef4444' }}>
                        Protocole abandon — étape {clientDetail.abandonInfo.current_step}/5 chez {clientDetail.abandonInfo.merchant_name}
                      </div>
                    )}
                  </div>
                )}

                {clientDetail.triggerHistory?.length > 0 && (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid var(--afrikfid-border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>Derniers triggers automatiques</div>
                    {clientDetail.triggerHistory.map((t, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--afrikfid-border)', fontSize: 11 }}>
                        <div>
                          <span style={{ color: 'var(--afrikfid-text)', fontWeight: 600 }}>{t.trigger_type}</span>
                          {t.merchant_name && <span style={{ color: 'var(--afrikfid-muted)', marginLeft: 6 }}>({t.merchant_name})</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: t.status === 'sent' ? 'var(--afrikfid-success)' : '#ef4444', fontSize: 10 }}>{t.status}</span>
                          <span style={{ color: 'var(--afrikfid-muted)', fontSize: 10 }}>{t.sent_at ? new Date(t.sent_at).toLocaleDateString('fr-FR') : '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/^2014\d{8}$/.test(selected.afrikfidId) && !selected.anonymized_at && (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, border: '1px solid var(--afrikfid-border)', marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 10 }}>Carte fidélité</div>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 10 }}>
                      Carte liée : <span style={{ color: 'var(--afrikfid-text)', fontFamily: 'monospace' }}>{selected.afrikfidId}</span>
                    </div>
                    <button onClick={() => setConfirmUnlink(selected)}
                      style={{ width: '100%', padding: 9, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#f59e0b', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                      Délier la carte
                    </button>
                  </div>
                )}

                {!selected.anonymized_at ? (
                  <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 10, padding: 16, border: '1px solid var(--afrikfid-border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 12 }}>Droits RGPD</div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button onClick={() => exportGdpr(selected)}
                        style={{ flex: 1, padding: 9, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 8, color: 'var(--afrikfid-info)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        Exporter données
                      </button>
                      <button onClick={() => setConfirmAnonymize(selected)}
                        style={{ flex: 1, padding: 9, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        Anonymiser (oubli)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ef4444' }}>
                    Client anonymisé le {selected.anonymized_at?.split('T')[0]}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
