import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { Card, Badge, Modal, Button, Select, Pagination, Spinner, Alert, EmptyState } from '../../components/ui.jsx'

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
  fraud: 'Fraude suspectée',
  other: 'Autre',
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 10, padding: '16px 20px', border: '1px solid #334155', minWidth: 120 }}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color || '#f1f5f9', fontWeight: 700, fontSize: 22 }}>{value}</div>
    </div>
  )
}

function DisputeRow({ dispute, onView }) {
  return (
    <tr style={{ borderBottom: '1px solid #1e293b' }}>
      <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>
        {new Date(dispute.created_at).toLocaleString('fr-FR')}
      </td>
      <td style={{ padding: '12px 16px', color: '#f1f5f9', fontFamily: 'monospace', fontSize: 13 }}>
        {dispute.tx_reference || dispute.transaction_id?.slice(0, 12) + '…'}
      </td>
      <td style={{ padding: '12px 16px', color: '#f1f5f9', fontSize: 13 }}>
        {dispute.merchant_name || '—'}
      </td>
      <td style={{ padding: '12px 16px', color: '#f1f5f9' }}>
        {REASON_LABELS[dispute.reason] || dispute.reason}
      </td>
      <td style={{ padding: '12px 16px', color: '#f1f5f9', fontWeight: 600 }}>
        {Number(dispute.amount_disputed || dispute.gross_amount || 0).toLocaleString('fr-FR')} {dispute.currency || ''}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Badge color={STATUS_COLORS[dispute.status] || 'gray'}>
          {STATUS_LABELS[dispute.status] || dispute.status}
        </Badge>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Button size="sm" onClick={() => onView(dispute)}>Détail</Button>
      </td>
    </tr>
  )
}

function DisputeModal({ dispute, onClose, onUpdate }) {
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    if (!dispute) return
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
    <Modal title={`Litige — ${dispute.tx_reference || dispute.id.slice(0, 12)}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Statut</div>
          <Badge color={STATUS_COLORS[dispute.status] || 'gray'}>{STATUS_LABELS[dispute.status] || dispute.status}</Badge>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Motif</div>
          <div style={{ color: '#f1f5f9' }}>{REASON_LABELS[dispute.reason] || dispute.reason}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Montant disputé</div>
          <div style={{ color: '#f1f5f9', fontWeight: 700 }}>
            {Number(dispute.amount_disputed || dispute.gross_amount || 0).toLocaleString('fr-FR')} {dispute.currency || ''}
          </div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Marchand</div>
          <div style={{ color: '#f1f5f9' }}>{dispute.merchant_name || '—'}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Client</div>
          <div style={{ color: '#f1f5f9' }}>{dispute.client_name || '—'} {dispute.afrikfid_id ? `(${dispute.afrikfid_id})` : ''}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Initié par</div>
          <div style={{ color: '#f1f5f9' }}>{dispute.initiated_by || '—'}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Description</div>
          <div style={{ color: '#cbd5e1', fontSize: 13, background: '#0f172a', borderRadius: 6, padding: '8px 12px' }}>
            {dispute.description || 'Aucune description fournie'}
          </div>
        </div>
        {dispute.resolution_note && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Note de résolution</div>
            <div style={{ color: '#cbd5e1', fontSize: 13, background: '#0f172a', borderRadius: 6, padding: '8px 12px' }}>
              {dispute.resolution_note}
            </div>
          </div>
        )}
      </div>

      {/* Historique */}
      {detail?.history?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Historique des actions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.history.map(h => (
              <div key={h.id} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>{new Date(h.created_at).toLocaleString('fr-FR')}</span>
                {' — '}
                <span style={{ color: '#94a3b8' }}>{h.action.replace(/_/g, ' ')}</span>
                {h.note && <span style={{ color: '#cbd5e1' }}> : {h.note}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions admin */}
      {!isClosed && (
        <div style={{ borderTop: '1px solid #334155', paddingTop: 16 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Mettre à jour le litige</div>
          {error && <Alert type="error" message={error} style={{ marginBottom: 8 }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Select
              value={status}
              onChange={e => setStatus(e.target.value)}
              options={[
                { value: '', label: 'Choisir un statut…' },
                { value: 'investigating', label: 'En cours d\'investigation' },
                { value: 'resolved', label: 'Résolu (en faveur du plaignant)' },
                { value: 'rejected', label: 'Rejeté (non fondé)' },
              ]}
            />
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note de résolution (optionnel)…"
              rows={3}
              style={{
                background: '#0f172a', border: '1px solid #334155', borderRadius: 6,
                color: '#f1f5f9', padding: '8px 12px', fontSize: 13, resize: 'vertical',
              }}
            />
            <Button onClick={handleUpdate} disabled={!status || loading} style={{ alignSelf: 'flex-end' }}>
              {loading ? 'Enregistrement…' : 'Mettre à jour'}
            </Button>
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

  const fetch = useCallback(async () => {
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

  useEffect(() => { fetch() }, [fetch])

  const statMap = Object.fromEntries(stats.map(s => [s.status, parseInt(s.count)]))

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 }}>Litiges & Disputes</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
          Gestion des contestations de transactions (CDC §4.6.1)
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard label="Ouverts" value={statMap.open || 0} color="#f59e0b" />
        <StatCard label="En cours" value={statMap.investigating || 0} color="#3b82f6" />
        <StatCard label="Résolus" value={statMap.resolved || 0} color="#22c55e" />
        <StatCard label="Rejetés" value={statMap.rejected || 0} color="#ef4444" />
      </div>

      {/* Filtres */}
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
          <Button onClick={fetch} variant="secondary" size="sm">Actualiser</Button>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>
        ) : disputes.length === 0 ? (
          <EmptyState icon="⚖️" title="Aucun litige" description="Aucune contestation enregistrée pour les filtres sélectionnés." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Date', 'Référence TX', 'Marchand', 'Motif', 'Montant', 'Statut', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 12, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {disputes.map(d => (
                  <DisputeRow key={d.id} dispute={d} onView={setSelected} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > LIMIT && (
          <Pagination
            page={page}
            totalPages={Math.ceil(total / LIMIT)}
            onPageChange={setPage}
            style={{ marginTop: 16 }}
          />
        )}
      </Card>

      <DisputeModal dispute={selected} onClose={() => setSelected(null)} onUpdate={fetch} />
    </div>
  )
}
