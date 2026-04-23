import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'

const SEGMENT_COLORS = { A_RISQUE: 'red', HIBERNANTS: 'orange', PERDUS: 'gray', CHAMPIONS: 'green', FIDELES: 'blue', PROMETTEURS: 'yellow' }

export default function AdminChurnAlerts() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = () => {
    setLoading(true)
    api.get('/campaigns/churn-alerts', { params: { page, limit } })
      .then(r => {
        setData(r.data.data || r.data.clients || r.data.alerts || [])
        setTotal(r.data.pagination?.total || r.data.total || 0)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--af-border)', textAlign: 'left' }
  const td = { padding: '10px 14px', fontSize: 13, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-surface)' }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)' }}>Alertes Churn</h1>
        <button onClick={load} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Actualiser</button>
      </div>

      <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--af-border)', fontSize: 13, fontWeight: 600, color: 'var(--af-text-muted)' }}>
          Clients à risque de churn (segments A_RISQUE & HIBERNANTS)
        </div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--af-text-muted)', padding: 40 }}>Aucune alerte de churn en ce moment</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Client', 'Marchand', 'Segment RFM', 'Score R', 'Score F', 'Score M', 'Dernier achat'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.id || i}>
                    <td style={{ ...td, color: 'var(--af-text)', fontWeight: 600 }}>{row.client_name || row.full_name || row.client_id}</td>
                    <td style={td}>{row.merchant_name || row.merchant_id}</td>
                    <td style={td}><Badge color={SEGMENT_COLORS[row.segment] || 'gray'}>{row.segment}</Badge></td>
                    <td style={{ ...td, textAlign: 'center', fontFamily: 'monospace' }}>{row.r_score ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center', fontFamily: 'monospace' }}>{row.f_score ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'center', fontFamily: 'monospace' }}>{row.m_score ?? '—'}</td>
                    <td style={{ ...td, fontSize: 11 }}>{row.last_purchase_at ? new Date(row.last_purchase_at).toLocaleDateString('fr-FR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
      </div>
    </div>
  )
}
