import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { Card, Badge, Spinner, Pagination, Select } from '../../components/ui.jsx'

const SEGMENTS = ['CHAMPIONS', 'FIDELES', 'PROMETTEURS', 'A_RISQUE', 'HIBERNANTS', 'PERDUS']
const SEG_COLORS = { CHAMPIONS: 'green', FIDELES: 'blue', PROMETTEURS: 'yellow', A_RISQUE: 'orange', HIBERNANTS: 'gray', PERDUS: 'red' }

export default function AdminRFM() {
  const [stats, setStats] = useState(null)
  const [merchants, setMerchants] = useState([])
  const [selectedMerchant, setSelectedMerchant] = useState('')
  const [scores, setScores] = useState([])
  const [segment, setSegment] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const limit = 20

  useEffect(() => {
    api.get('/rfm/stats').then(r => setStats(r.data))
    api.get('/merchants', { params: { limit: 200 } }).then(r => setMerchants(r.data.merchants || []))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!selectedMerchant) { setScores([]); setTotal(0); return }
    setLoading(true)
    const params = { page, limit }
    if (segment) params.segment = segment
    api.get(`/rfm/merchant/${selectedMerchant}`, { params }).then(r => {
      setScores(r.data.scores || [])
      setTotal(r.data.total || 0)
    }).finally(() => setLoading(false))
  }, [selectedMerchant, segment, page])

  const recalculate = () => {
    if (!selectedMerchant) return
    setLoading(true)
    api.post(`/rfm/merchant/${selectedMerchant}/calculate`).then(() => {
      setPage(1)
      api.get(`/rfm/merchant/${selectedMerchant}`, { params: { page: 1, limit } }).then(r => {
        setScores(r.data.scores || [])
        setTotal(r.data.total || 0)
      })
      api.get('/rfm/stats').then(r => setStats(r.data))
    }).finally(() => setLoading(false))
  }

  const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: 'var(--af-text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--af-border)' }
  const td = { padding: '10px 14px', fontSize: 13, color: 'var(--af-text-muted)', borderBottom: '1px solid var(--af-surface)' }
  const card = { background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--af-text)' }}>Segmentation RFM</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select value={selectedMerchant} onChange={e => { setSelectedMerchant(e.target.value); setPage(1) }}>
            <option value="">Choisir un marchand</option>
            {merchants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
          <Select value={segment} onChange={e => { setSegment(e.target.value); setPage(1) }}>
            <option value="">Tous segments</option>
            {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          {selectedMerchant && (
            <button onClick={recalculate} style={{ padding: '8px 14px', background: 'var(--af-kpi-violet)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Recalculer
            </button>
          )}
        </div>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
          {[{ label: 'Clients scorés', value: stats.total_clients }, { label: 'Marchands', value: stats.total_merchants }].map(k => (
            <div key={k.label} style={card}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--af-text)' }}>{k.value}</div>
            </div>
          ))}
          {(stats.segments || []).slice(0, 2).map(s => (
            <div key={s.segment} style={card}>
              <div style={{ fontSize: 11, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6 }}>{s.segment}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--af-text)' }}>{s.count}</div>
            </div>
          ))}
        </div>
      )}

      {stats?.segments && (
        <div style={{ ...card, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--af-text)', marginBottom: 12 }}>Répartition globale</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {stats.segments.map(s => (
              <div key={s.segment} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge color={SEG_COLORS[s.segment]}>{s.segment}</Badge>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--af-text)' }}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <Spinner />}

      {selectedMerchant && !loading && (
        <div style={{ background: 'var(--af-surface)', border: '1px solid var(--af-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Client', 'R', 'F', 'M', 'Total', 'Segment', 'Achats', 'Montant'].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i > 0 ? 'center' : 'left' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {scores.map(s => (
                  <tr key={s.id}>
                    <td style={{ ...td, color: 'var(--af-text)', fontWeight: 600 }}>
                      {s.full_name}<br/>
                      <span style={{ fontSize: 11, color: 'var(--af-text-muted)' }}>{s.afrikfid_id}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{s.r_score}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{s.f_score}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{s.m_score}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 800, color: 'var(--af-kpi-violet)' }}>{s.rfm_total}</td>
                    <td style={td}><Badge color={SEG_COLORS[s.segment]}>{s.segment}</Badge></td>
                    <td style={{ ...td, textAlign: 'right' }}>{s.purchase_count}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{Number(s.total_amount).toLocaleString()} FCFA</td>
                  </tr>
                ))}
                {scores.length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32 }}>Aucun score RFM</td></tr>}
              </tbody>
            </table>
          </div>
          {total > limit && <Pagination page={page} total={total} limit={limit} onPage={setPage} />}
        </div>
      )}
    </div>
  )
}
