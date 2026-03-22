import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'

const STEP_LABELS = [
  'Étape 1 — Win-back -15%',
  'Étape 2 — Vous nous manquez (-20%)',
  'Étape 3 — Dernière chance (-30%)',
  'Étape 4 — Enquête départ',
  'Étape 5 — PERDU définitif',
]

const STATUS_COLORS = { active: 'yellow', reactivated: 'green', lost: 'red', cancelled: 'gray' }

export default function AdminAbandonProtocol() {
  const [data, setData] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 20

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get('/campaigns/abandon', { params: { page, limit } }),
      api.get('/campaigns/abandon/stats').catch(() => ({ data: null })),
    ]).then(([res, statsRes]) => {
      setData(res.data.data || res.data.trackings || [])
      setTotal(res.data.pagination?.total || res.data.total || 0)
      setStats(statsRes.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #334155', textAlign: 'left' }
  const td = { padding: '10px 14px', fontSize: 13, color: '#94a3b8', borderBottom: '1px solid #1e293b' }

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>Protocole d'abandon</h1>
        <button onClick={load} disabled={loading}
          style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: loading ? 0.5 : 1 }}>
          {loading ? 'Chargement...' : 'Actualiser'}
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9' }}>{stats[`step_${i + 1}`] || 0}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #334155', fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>
          Clients en protocole d'abandon
        </div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Aucun client en protocole d'abandon</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Client', 'Marchand', 'Étape', 'Statut', 'Prochaine action', 'Démarré le'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.map(row => (
                  <tr key={row.id}>
                    <td style={{ ...td, color: '#f1f5f9', fontWeight: 600 }}>{row.client_name || row.client_id}</td>
                    <td style={td}>{row.merchant_name || row.merchant_id}</td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: 'rgba(249,115,22,0.15)', color: '#f97316' }}>
                        Étape {row.current_step}/5
                      </span>
                    </td>
                    <td style={td}><Badge color={STATUS_COLORS[row.status] || 'gray'}>{row.status}</Badge></td>
                    <td style={{ ...td, fontSize: 11 }}>{row.next_step_at ? new Date(row.next_step_at).toLocaleDateString('fr-FR') : '—'}</td>
                    <td style={{ ...td, fontSize: 11 }}>{new Date(row.created_at).toLocaleDateString('fr-FR')}</td>
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
