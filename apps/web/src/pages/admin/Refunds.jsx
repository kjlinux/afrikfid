import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { Card, Badge, Modal, Button, Input, Select, Pagination, Spinner, Alert, EmptyState } from '../../components/ui.jsx'

const STATUS_COLORS = {
  completed: 'green',
  pending: 'yellow',
  failed: 'red',
}

const STATUS_LABELS = {
  completed: 'Remboursé',
  pending: 'En attente',
  failed: 'Échoué',
}

function RefundRow({ refund, onView }) {
  return (
    <tr style={{ borderBottom: '1px solid #1e293b' }}>
      <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>
        {new Date(refund.created_at).toLocaleString('fr-FR')}
      </td>
      <td style={{ padding: '12px 16px', color: '#f1f5f9', fontFamily: 'monospace', fontSize: 13 }}>
        {refund.transaction_reference || refund.transaction_id?.slice(0, 12) + '…'}
      </td>
      <td style={{ padding: '12px 16px', color: '#f1f5f9', fontWeight: 600 }}>
        {Number(refund.amount).toLocaleString('fr-FR')} {refund.currency || ''}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Badge color={refund.refund_type === 'full' ? 'blue' : 'purple'}>
          {refund.refund_type === 'full' ? 'Total' : 'Partiel'}
        </Badge>
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Badge color={STATUS_COLORS[refund.status] || 'gray'}>
          {STATUS_LABELS[refund.status] || refund.status}
        </Badge>
      </td>
      <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: 13 }}>
        {refund.merchant_name || '—'}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Button size="sm" onClick={() => onView(refund)}>Détail</Button>
      </td>
    </tr>
  )
}

function RefundModal({ refund, onClose }) {
  if (!refund) return null
  return (
    <Modal title={`Remboursement — ${refund.transaction_reference || refund.transaction_id?.slice(0, 12)}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Montant remboursé</div>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 18 }}>
            {Number(refund.amount).toLocaleString('fr-FR')} {refund.currency}
          </div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Statut</div>
          <Badge color={STATUS_COLORS[refund.status] || 'gray'}>{STATUS_LABELS[refund.status] || refund.status}</Badge>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Type</div>
          <div style={{ color: '#f1f5f9' }}>{refund.refund_type === 'full' ? 'Total' : 'Partiel'}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Ratio</div>
          <div style={{ color: '#f1f5f9' }}>{refund.refund_ratio ? (refund.refund_ratio * 100).toFixed(1) + '%' : '—'}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Remise marchand reversée</div>
          <div style={{ color: '#f1f5f9' }}>{Number(refund.merchant_rebate_refunded || 0).toLocaleString('fr-FR')}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Cashback client annulé</div>
          <div style={{ color: '#f1f5f9' }}>{Number(refund.client_rebate_refunded || 0).toLocaleString('fr-FR')}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Commission Afrik'Fid reversée</div>
          <div style={{ color: '#f1f5f9' }}>{Number(refund.platform_commission_refunded || 0).toLocaleString('fr-FR')}</div>
        </div>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Date</div>
          <div style={{ color: '#f1f5f9' }}>{new Date(refund.created_at).toLocaleString('fr-FR')}</div>
        </div>
        {refund.reason && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Motif</div>
            <div style={{ color: '#f1f5f9' }}>{refund.reason}</div>
          </div>
        )}
        {refund.merchant_name && (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Marchand</div>
            <div style={{ color: '#f1f5f9' }}>{refund.merchant_name}</div>
          </div>
        )}
        {refund.initiated_by && (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Initié par</div>
            <div style={{ color: '#f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{refund.initiated_by}</div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function AdminRefunds() {
  const [refunds, setRefunds] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [selectedRefund, setSelectedRefund] = useState(null)
  const [filters, setFilters] = useState({ status: '', refund_type: '', q: '' })
  const limit = 20

  const fetchRefunds = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page, limit })
      if (filters.status) params.append('status', filters.status)
      if (filters.refund_type) params.append('refund_type', filters.refund_type)
      if (filters.q) params.append('q', filters.q)
      const res = await api.get(`/reports/refunds?${params}`)
      setRefunds(res.data.refunds || [])
      setTotal(res.data.total || 0)
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du chargement des remboursements')
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => { fetchRefunds() }, [fetchRefunds])

  const handleFilter = (key, value) => {
    setFilters(f => ({ ...f, [key]: value }))
    setPage(1)
  }

  const kpiCards = [
    { label: 'Total remboursements', value: total },
    { label: 'Montant total remboursé', value: refunds.reduce((s, r) => s + Number(r.amount), 0).toLocaleString('fr-FR') + ' XOF' },
    { label: 'Remboursements partiels', value: refunds.filter(r => r.refund_type === 'partial').length },
    { label: 'En attente', value: refunds.filter(r => r.status === 'pending').length },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#f1f5f9' }}>Remboursements</h1>
        <span style={{ color: '#94a3b8', fontSize: 14 }}>{total} remboursement{total !== 1 ? 's' : ''}</span>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {kpiCards.map(kpi => (
          <Card key={kpi.label}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{kpi.label}</div>
            <div style={{ color: '#f1f5f9', fontSize: 20, fontWeight: 700 }}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input
            placeholder="Rechercher (référence, marchand…)"
            value={filters.q}
            onChange={e => handleFilter('q', e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select value={filters.status} onChange={e => handleFilter('status', e.target.value)} style={{ width: 160 }}>
            <option value="">Tous les statuts</option>
            <option value="completed">Remboursé</option>
            <option value="pending">En attente</option>
            <option value="failed">Échoué</option>
          </Select>
          <Select value={filters.refund_type} onChange={e => handleFilter('refund_type', e.target.value)} style={{ width: 160 }}>
            <option value="">Tous les types</option>
            <option value="full">Total</option>
            <option value="partial">Partiel</option>
          </Select>
        </div>
      </Card>

      {error && <Alert type="error" style={{ marginBottom: 16 }}>{error}</Alert>}

      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
        ) : refunds.length === 0 ? (
          <EmptyState message="Aucun remboursement trouvé" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  {['Date', 'Référence', 'Montant', 'Type', 'Statut', 'Marchand', ''].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: '#64748b', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refunds.map(r => <RefundRow key={r.id} refund={r} onView={setSelectedRefund} />)}
              </tbody>
            </table>
          </div>
        )}
        {total > limit && (
          <div style={{ padding: '16px 16px 0' }}>
            <Pagination page={page} totalPages={Math.ceil(total / limit)} onPageChange={setPage} />
          </div>
        )}
      </Card>

      <RefundModal refund={selectedRefund} onClose={() => setSelectedRefund(null)} />
    </div>
  )
}
