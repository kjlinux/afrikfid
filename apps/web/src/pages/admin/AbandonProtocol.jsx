import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'

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

  const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--af-border)', textAlign: 'left' }
  const td = { padding: '10px 14px', fontSize: 13, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-surface)' }

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Breadcrumb title="Protocole d'abandon" segments={[{ label: 'Séquence de réactivation clients inactifs' }]} />
        <button onClick={load} disabled={loading} className="af-btn af-btn--ghost af-btn--sm">
          {loading ? 'Chargement...' : 'Actualiser'}
        </button>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--af-text)' }}>{stats[`step_${i + 1}`] || 0}</div>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--af-border)', fontSize: 13, fontWeight: 600, color: 'var(--af-text-muted)' }}>
          Clients en protocole d'abandon
        </div>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
        ) : data.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--af-text-muted)', padding: 40 }}>Aucun client en protocole d'abandon</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Client', 'Marchand', 'Étape', 'Statut', 'Prochaine action', 'Démarré le'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {data.map(row => (
                  <tr key={row.id}>
                    <td style={{ ...td, color: 'var(--af-text)', fontWeight: 600 }}>{row.full_name || row.client_name || row.client_id}</td>
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
