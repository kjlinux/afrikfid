import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'

const STATUS_COLORS = { calculated: 'blue', invoiced: 'yellow', paid: 'green', waived: 'gray' }

export default function AdminSuccessFees() {
  const [fees, setFees] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = () => {
    setLoading(true)
    api.get('/success-fees', { params: { page, limit } }).then(r => {
      setFees(r.data.fees || [])
      setTotal(r.data.total || 0)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const updateStatus = async (id, status) => {
    try {
      await api.patch(`/success-fees/${id}/status`, { status })
      load()
    } catch { /* ignore */ }
  }

  const th = (align = 'left') => ({ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #334155', textAlign: align })
  const td = (align = 'left') => ({ padding: '10px 14px', fontSize: 13, color: '#94a3b8', borderBottom: '1px solid #1e293b', textAlign: align })
  const kpiCard = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '16px 20px' }

  if (loading) return <Spinner />

  const totalFees = fees.reduce((s, f) => s + parseFloat(f.fee_amount || 0), 0)
  const totalGrowth = fees.reduce((s, f) => s + parseFloat(f.growth_amount || 0), 0)

  return (
    <div style={{ padding: '28px 32px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', marginBottom: 24 }}>Success Fees</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
        <div style={kpiCard}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Total Fees (page)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>{totalFees.toLocaleString()} FCFA</div>
        </div>
        <div style={kpiCard}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Croissance cumulée (page)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9' }}>{totalGrowth.toLocaleString()} FCFA</div>
        </div>
        <div style={kpiCard}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Nombre de fees</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9' }}>{total}</div>
        </div>
      </div>

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th()}>Marchand</th>
              <th style={th()}>Période</th>
              <th style={th('right')}>Panier réf.</th>
              <th style={th('right')}>Panier actuel</th>
              <th style={th('right')}>Croissance</th>
              <th style={th('right')}>Fee %</th>
              <th style={th('right')}>Montant fee</th>
              <th style={th()}>Statut</th>
              <th style={th()}>Actions</th>
            </tr></thead>
            <tbody>
              {fees.map(f => (
                <tr key={f.id}>
                  <td style={{ ...td(), color: '#f1f5f9', fontWeight: 600 }}>{f.merchant_name}</td>
                  <td style={td()}>{new Date(f.period_start).toLocaleDateString('fr-FR')} – {new Date(f.period_end).toLocaleDateString('fr-FR')}</td>
                  <td style={td('right')}>{Number(f.reference_avg_basket).toLocaleString()}</td>
                  <td style={td('right')}>{Number(f.current_avg_basket).toLocaleString()}</td>
                  <td style={{ ...td('right'), color: '#10b981', fontWeight: 600 }}>+{Number(f.growth_amount).toLocaleString()}</td>
                  <td style={td('right')}>{f.fee_percent}%</td>
                  <td style={{ ...td('right'), fontWeight: 700, color: '#f1f5f9' }}>{Number(f.fee_amount).toLocaleString()} FCFA</td>
                  <td style={td()}><Badge color={STATUS_COLORS[f.status]}>{f.status}</Badge></td>
                  <td style={td()}>
                    {f.status === 'calculated' && (
                      <button onClick={() => updateStatus(f.id, 'invoiced')} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Facturer</button>
                    )}
                    {f.status === 'invoiced' && (
                      <button onClick={() => updateStatus(f.id, 'paid')} style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Marquer payé</button>
                    )}
                  </td>
                </tr>
              ))}
              {fees.length === 0 && <tr><td colSpan={9} style={{ ...td('center'), padding: 32 }}>Aucun success fee calculé</td></tr>}
            </tbody>
          </table>
        </div>
        {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
      </div>
    </div>
  )
}
