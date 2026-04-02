import React, { useEffect, useState, useCallback } from 'react'
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline'
import api from '../../api.js'
import { Card, Badge, Modal, Button, Input, Select, Pagination, Spinner, Alert, EmptyState, KpiCard } from '../../components/ui.jsx'

const STATUS_COLORS = {
  completed: 'green',
  pending: 'yellow',
  failed: 'red',
  overdue: 'red',
}

const STATUS_LABELS = {
  completed: 'Remboursé',
  pending: 'En attente',
  failed: 'Échoué',
  overdue: 'En retard',
}

const REASON_LABELS = {
  client_request: 'Demande client',
  merchant_error: 'Erreur marchand',
  fraud: 'Fraude',
  product_return: 'Retour produit',
  double_charge: 'Double débit',
  service_failure: 'Service non rendu',
}

function RefundModal({ refund, onClose }) {
  if (!refund) return null
  return (
    <Modal open title={`Remboursement — ${refund.transaction_reference || refund.transaction_id?.slice(0, 12)}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Montant remboursé</div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 15 }}>
            {Number(refund.amount).toLocaleString('fr-FR')} {refund.currency || ''}
          </div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Statut</div>
          <Badge color={STATUS_COLORS[refund.status] || 'gray'}>{STATUS_LABELS[refund.status] || refund.status}</Badge>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Type</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{refund.refund_type === 'full' ? 'Total' : 'Partiel'}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Ratio</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{refund.refund_ratio ? (refund.refund_ratio * 100).toFixed(1) + '%' : '—'}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Remise marchand reversée</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{Number(refund.merchant_rebate_refunded || 0).toLocaleString('fr-FR')}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Cashback client annulé</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{Number(refund.client_rebate_refunded || 0).toLocaleString('fr-FR')}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Commission reversée</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{Number(refund.platform_commission_refunded || 0).toLocaleString('fr-FR')}</div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Date</div>
          <div style={{ color: '#f1f5f9', fontSize: 13 }}>{new Date(refund.created_at).toLocaleString('fr-FR')}</div>
        </div>
        {refund.reason && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Motif</div>
            <div style={{ color: '#94a3b8', fontSize: 12, background: '#0f172a', borderRadius: 6, padding: '7px 12px' }}>
              {REASON_LABELS[refund.reason] || refund.reason}
            </div>
          </div>
        )}
        {refund.merchant_name && (
          <div>
            <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Marchand</div>
            <div style={{ color: '#f1f5f9', fontSize: 13 }}>{refund.merchant_name}</div>
          </div>
        )}
        {refund.initiated_by && (
          <div>
            <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Initié par</div>
            <div style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{refund.initiated_by}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function AdminRefunds() {
  const [refunds, setRefunds] = useState([])
  const [summary, setSummary] = useState({ total: 0, totalAmount: 0, partial: 0, pending: 0 })
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [filters, setFilters] = useState({ status: '', refund_type: '', q: '' })
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page, limit: LIMIT })
      if (filters.status) params.append('status', filters.status)
      if (filters.refund_type) params.append('refund_type', filters.refund_type)
      if (filters.q) params.append('q', filters.q)
      const res = await api.get(`/reports/refunds?${params}`)
      const rows = res.data.refunds || []
      setRefunds(rows)
      setTotal(res.data.total || 0)
      setSummary({
        total: res.data.total || 0,
        totalAmount: rows.reduce((s, r) => s + Number(r.amount), 0),
        partial: rows.filter(r => r.refund_type === 'partial').length,
        pending: rows.filter(r => r.status === 'pending').length,
      })
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => { load() }, [load])

  const handleFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }))
    setPage(1)
  }

  return (
    <div style={{ padding: '24px 20px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Remboursements</h1>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Suivi des remboursements totaux et partiels</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Total" value={summary.total} />
        <KpiCard label="Montant remboursé" value={summary.totalAmount.toLocaleString('fr-FR') + ' XOF'} />
        <KpiCard label="Partiels" value={summary.partial} />
        <KpiCard label="En attente" value={summary.pending} color={summary.pending > 0 ? '#f59e0b' : undefined} />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            placeholder="Rechercher (référence, marchand…)"
            value={filters.q}
            onChange={e => handleFilter('q', e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select
            value={filters.status}
            onChange={e => handleFilter('status', e.target.value)}
            options={[
              { value: '', label: 'Tous les statuts' },
              { value: 'completed', label: 'Remboursé' },
              { value: 'pending', label: 'En attente' },
              { value: 'failed', label: 'Échoué' },
            ]}
            style={{ width: 160 }}
          />
          <Select
            value={filters.refund_type}
            onChange={e => handleFilter('refund_type', e.target.value)}
            options={[
              { value: '', label: 'Tous les types' },
              { value: 'full', label: 'Total' },
              { value: 'partial', label: 'Partiel' },
            ]}
            style={{ width: 140 }}
          />
          <Button onClick={load} variant="secondary" size="sm">Actualiser</Button>
        </div>
      </Card>

      {error && <Alert type="error" onClose={() => setError(null)} style={{ marginBottom: 16 }}>{error}</Alert>}

      <Card>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spinner /></div>
        ) : refunds.length === 0 ? (
          <EmptyState icon={<ArrowUturnLeftIcon style={{ width: 40, height: 40, color: '#334155' }} />} title="Aucun remboursement" description="Aucun remboursement trouvé pour les filtres sélectionnés." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e293b' }}>
                  {['Date', 'Référence', 'Montant', 'Type', 'Statut', 'Motif', 'Marchand', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refunds.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #0f172a' }}>
                    <td style={{ padding: '11px 16px', color: '#64748b', fontSize: 12 }}>
                      {new Date(r.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>
                      {r.transaction_reference || r.transaction_id?.slice(0, 12) + '…'}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>
                      {Number(r.amount).toLocaleString('fr-FR')} {r.currency || ''}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Badge color={r.refund_type === 'full' ? 'blue' : 'purple'}>
                        {r.refund_type === 'full' ? 'Total' : 'Partiel'}
                      </Badge>
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Badge color={STATUS_COLORS[r.status] || 'gray'}>{STATUS_LABELS[r.status] || r.status}</Badge>
                    </td>
                    <td style={{ padding: '11px 16px', color: '#64748b', fontSize: 12 }}>
                      {REASON_LABELS[r.reason] || r.reason || '—'}
                    </td>
                    <td style={{ padding: '11px 16px', color: '#94a3b8', fontSize: 12 }}>
                      {r.merchant_name || '—'}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>Détail</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > LIMIT && (
          <div style={{ marginTop: 16 }}>
            <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
          </div>
        )}
      </Card>

      <RefundModal refund={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
