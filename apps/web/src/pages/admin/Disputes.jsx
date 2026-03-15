import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { Card, Badge, Modal, Button, Select, Pagination, Spinner, Alert, EmptyState, KpiCard } from '../../components/ui.jsx'

const STATUS_COLORS = {
  open: 'yellow',
  investigating: 'blue',
  resolved: 'green',
  rejected: 'red',
}

const STATUS_LABELS = {
  open: 'Ouvert',
  investigating: 'En cours',
  resolved: 'Résolu',
  rejected: 'Rejeté',
}

const REASON_LABELS = {
  incorrect_amount: 'Montant incorrect',
  service_not_rendered: 'Service non rendu',
  duplicate_payment: 'Double paiement',
  non_delivery: 'Non livraison',
  wrong_amount: 'Mauvais montant',
  unauthorized_tx: 'Transaction non autorisée',
  duplicate_charge: 'Double débit',
  fraud_claim: 'Fraude suspectée',
  poor_quality: 'Qualité insuffisante',
  fraud: 'Fraude suspectée',
  other: 'Autre',
}

function DisputeModal({ dispute, onClose, onUpdate }) {
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    if (!dispute) return
    setDetail(null)
    api.get(`/disputes/${dispute.id}`).then(r => setDetail(r.data)).catch(() => {})
  }, [dispute?.id])

  if (!dispute) return null
  const isClosed = ['resolved', 'rejected'].includes(dispute.status)

  const handleUpdate = async () => {
    if (!status) return
    setLoading(true)
    setError(null)
    try {
      await api.patch(`/disputes/${dispute.id}`, { status, resolution_note: note })
      onUpdate()
      onClose()
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur lors de la mise à jour')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open title={`Litige — ${dispute.tx_reference || dispute.id.slice(0, 12)}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Statut</div>
          <Badge color={STATUS_COLORS[dispute.status] || 'gray'}>{STATUS_LABELS[dispute.status] || dispute.status}</Badge>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Motif</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{REASON_LABELS[dispute.reason] || dispute.reason}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Montant disputé</div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 15 }}>
            {Number(dispute.amount_disputed || 0).toLocaleString('fr-FR')} {dispute.currency || ''}
          </div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Marchand</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{dispute.merchant_name || '—'}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Client</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{dispute.client_name || '—'}{dispute.afrikfid_id ? ` (${dispute.afrikfid_id})` : ''}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Initié par</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{dispute.initiated_by || '—'}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Description</div>
          <div style={{ color: '#94a3b8', fontSize: 12, background: '#0f172a', borderRadius: 6, padding: '8px 12px', lineHeight: 1.6 }}>
            {dispute.description || 'Aucune description fournie'}
          </div>
        </div>
        {dispute.resolution_note && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Note de résolution</div>
            <div style={{ color: '#94a3b8', fontSize: 12, background: '#0f172a', borderRadius: 6, padding: '8px 12px', lineHeight: 1.6 }}>
              {dispute.resolution_note}
            </div>
          </div>
        )}
      </div>

      {detail?.history?.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Historique</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {detail.history.map(h => (
              <div key={h.id} style={{ background: '#0f172a', borderRadius: 6, padding: '7px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: '#475569', flexShrink: 0 }}>{new Date(h.created_at).toLocaleString('fr-FR')}</span>
                <span style={{ color: '#94a3b8' }}>{h.action.replace(/_/g, ' ')}</span>
                {h.note && <span style={{ color: '#cbd5e1' }}>— {h.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {!isClosed && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14 }}>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Mettre à jour</div>
          {error && <Alert type="error" onClose={() => setError(null)} style={{ marginBottom: 10 }}>{error}</Alert>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Select
              value={status}
              onChange={e => setStatus(e.target.value)}
              options={[
                { value: '', label: 'Choisir un statut…' },
                { value: 'investigating', label: "En cours d'investigation" },
                { value: 'resolved', label: 'Résolu (en faveur du plaignant)' },
                { value: 'rejected', label: 'Rejeté (non fondé)' },
              ]}
            />
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note de résolution (optionnel)…"
              rows={3}
              style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', padding: '8px 12px', fontSize: 13, resize: 'vertical', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={handleUpdate} disabled={!status || loading}>
                {loading ? 'Enregistrement…' : 'Mettre à jour'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState([])
  const [stats, setStats] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { page, limit: LIMIT }
      if (status) params.status = status
      const r = await api.get('/disputes', { params })
      setDisputes(r.data.disputes || [])
      setTotal(r.data.total || 0)
      setStats(r.data.stats || [])
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { load() }, [load])

  const statMap = Object.fromEntries(stats.map(s => [s.status, parseInt(s.count)]))

  return (
    <div style={{ padding: '24px 20px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Litiges & Disputes</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Gestion des contestations de transactions · CDC §4.6.1</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Ouverts"   value={statMap.open || 0}          color="#f59e0b" />
        <KpiCard label="En cours"  value={statMap.investigating || 0} color="#3b82f6" />
        <KpiCard label="Résolus"   value={statMap.resolved || 0}      color="#10b981" />
        <KpiCard label="Rejetés"   value={statMap.rejected || 0}      color="#ef4444" />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={status}
            onChange={e => { setStatus(e.target.value); setPage(1) }}
            options={[
              { value: '', label: 'Tous les statuts' },
              { value: 'open', label: 'Ouverts' },
              { value: 'investigating', label: 'En cours' },
              { value: 'resolved', label: 'Résolus' },
              { value: 'rejected', label: 'Rejetés' },
            ]}
            style={{ minWidth: 180 }}
          />
          <Button onClick={load} variant="secondary" size="sm">Actualiser</Button>
        </div>
      </Card>

      {error && <Alert type="error" onClose={() => setError(null)} style={{ marginBottom: 16 }}>{error}</Alert>}

      <Card>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spinner /></div>
        ) : disputes.length === 0 ? (
          <EmptyState icon="⚖️" title="Aucun litige" description="Aucune contestation enregistrée pour les filtres sélectionnés." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Date', 'Référence TX', 'Marchand', 'Motif', 'Montant', 'Statut', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disputes.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #0f172a' }}>
                    <td style={{ padding: '11px 16px', color: '#64748b', fontSize: 12 }}>
                      {new Date(d.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>
                      {d.tx_reference || d.transaction_id?.slice(0, 12) + '…'}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#f1f5f9', fontSize: 13 }}>
                      {d.merchant_name || '—'}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#94a3b8', fontSize: 12 }}>
                      {REASON_LABELS[d.reason] || d.reason}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>
                      {Number(d.amount_disputed || 0).toLocaleString('fr-FR')} {d.currency || ''}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Badge color={STATUS_COLORS[d.status] || 'gray'}>{STATUS_LABELS[d.status] || d.status}</Badge>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Button size="sm" variant="secondary" onClick={() => setSelected(d)}>Détail</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > LIMIT && (
          <div style={{ marginTop: 16 }}>
            <Pagination page={page} totalPages={Math.ceil(total / LIMIT)} onPageChange={setPage} />
          </div>
        )}
      </Card>

      <DisputeModal dispute={selected} onClose={() => setSelected(null)} onUpdate={load} />
    </div>
  )
}
