import React, { useEffect, useState, useCallback } from 'react'
import api from '../../api.js'
import { fmt, Card, Spinner, LoyaltyBadge, Pagination, exportCsv, InfoTooltip, Tooltip } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import { TOOLTIPS } from '../../lib/tooltips.js'
import { TrophyIcon, StarIcon, SparklesIcon } from '@heroicons/react/24/solid'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'

const RFM_DANGER = new Set(['A_RISQUE', 'PERDUS'])
const RFM_LABELS = { CHAMPIONS: 'Champions', FIDELES: 'Fidèles', PROMETTEURS: 'Prometteurs', A_RISQUE: 'À Risque', HIBERNANTS: 'Hibernants', PERDUS: 'Perdus' }
const PKG_ORDER = ['STARTER_BOOST', 'STARTER_PLUS', 'GROWTH', 'PREMIUM']

const RFM_TIPS = {
  CHAMPIONS: TOOLTIPS.seg_champions,
  FIDELES: TOOLTIPS.seg_fideles,
  PROMETTEURS: TOOLTIPS.seg_prometteurs,
  A_RISQUE: TOOLTIPS.seg_a_risque,
  HIBERNANTS: TOOLTIPS.seg_hibernants,
  PERDUS: TOOLTIPS.seg_perdus,
}

function RfmBadge({ segment }) {
  if (!segment) return null
  const color = RFM_DANGER.has(segment) ? 'var(--af-danger)' : 'var(--af-text-muted)'
  const badge = (
    <span style={{ background: 'var(--af-surface-2)', color, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, border: '1px solid var(--af-border)' }}>
      {RFM_LABELS[segment] || segment}
    </span>
  )
  const tip = RFM_TIPS[segment]
  if (!tip) return badge
  return <Tooltip text={tip}>{badge}</Tooltip>
}

function AbandonBadge({ step, status }) {
  if (!step || status !== 'active') return null
  const color = step >= 4 ? 'var(--af-danger)' : 'var(--af-warning)'
  return (
    <Tooltip text={TOOLTIPS.protocole_abandon}>
      <span style={{ background: 'var(--af-surface-2)', color, padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, border: '1px solid var(--af-border)' }}>
        Abandon S{step}
      </span>
    </Tooltip>
  )
}

export default function MerchantClients() {
  const [clients, setClients] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [merchantPkg, setMerchantPkg] = useState(null)

  const LIMIT = 20

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: LIMIT })
    if (filter !== 'all') params.set('loyalty_status', filter)
    api.get(`/merchants/me/clients?${params}`).then(r => {
      setClients(r.data.clients || [])
      setTotal(r.data.total || 0)
      setStats(r.data.stats || null)
    }).finally(() => setLoading(false))
  }, [page, filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.get('/merchants/me/profile').then(r => setMerchantPkg(r.data.merchant?.package || null)).catch(() => {})
  }, [])

  const isGrowthPlus = PKG_ORDER.indexOf(merchantPkg) >= PKG_ORDER.indexOf('GROWTH')

  const handleExport = () => {
    exportCsv(clients, [
      { label: 'ID Afrik\'Fid', key: 'afrikfidId' },
      { label: 'Nom', key: 'clientName' },
      { label: 'Statut fidélité', key: 'loyaltyStatus' },
      { label: 'Transactions', key: 'txCount' },
      { label: 'Volume total', key: 'totalVolume' },
      { label: 'Dernière transaction', key: 'lastTx' },
    ], 'mes-clients-fideles.csv')
  }

  return (
    <div style={{ padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <Breadcrumb title="Clients fidélisés" segments={[{ label: "Clients Afrik'Fid ayant effectué au moins une transaction" }]} />
        <button onClick={handleExport} className="af-btn af-btn--ghost af-btn--sm">
          <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> Export CSV
        </button>
      </div>

      {/* Stats par statut */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {['OPEN', 'LIVE', 'GOLD', 'ROYAL'].map(s => {
            const count = stats.byStatus?.find(b => b.loyalty_status === s)?.count || 0
            const Icon = s === 'ROYAL' ? TrophyIcon : s === 'GOLD' ? StarIcon : s === 'LIVE' ? SparklesIcon : null
            return (
              <button key={s} onClick={() => { setFilter(s === filter ? 'all' : s); setPage(1) }}
                style={{
                  background: filter === s ? 'var(--af-surface-2)' : 'var(--af-surface)',
                  border: `1px solid ${filter === s ? 'var(--af-accent)' : 'var(--af-border)'}`,
                  borderRadius: 12, padding: '16px 20px', cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{ marginBottom: 6, color: 'var(--af-text-muted)' }}>
                  {Icon ? <Icon style={{ width: 20, height: 20 }} /> : <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--af-border-strong)', display: 'inline-block' }} />}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: filter === s ? 'var(--af-accent)' : 'var(--af-text)' }}>{count}</div>
                <div style={{ fontSize: 12, color: 'var(--af-text-muted)', marginTop: 2 }}>{s}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filtre actif */}
      {filter !== 'all' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>Filtré par :</span>
          <span style={{ background: 'var(--af-surface-2)', color: 'var(--af-accent)', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{filter}</span>
          <button onClick={() => { setFilter('all'); setPage(1) }}
            style={{ background: 'none', border: 'none', color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 12 }}>✕ effacer</button>
        </div>
      )}

      <Card title={`${total} client${total > 1 ? 's' : ''} fidélisé${total > 1 ? 's' : ''}`}>
        {loading ? <Spinner /> : clients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--af-text-muted)', fontSize: 14 }}>
            Aucun client pour ce filtre.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--af-border)' }}>
                {[
                  { label: 'Client', tip: null },
                  { label: 'Statut fidélité', tip: null },
                  ...(isGrowthPlus ? [{ label: 'Segment RFM', tip: TOOLTIPS.RFM }] : []),
                  { label: 'Transactions', tip: null },
                  { label: 'Volume total', tip: TOOLTIPS.chiffre_affaires },
                  { label: 'Remises reçues', tip: TOOLTIPS.remise_y },
                  { label: 'Dernière visite', tip: null },
                  ...(isGrowthPlus ? [{ label: 'Abandon', tip: TOOLTIPS.protocole_abandon }] : []),
                ].map(h => (
                  <th key={h.label} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--af-text-muted)', fontWeight: 600, fontSize: 11 }}>
                    {h.tip ? <>{h.label}<InfoTooltip text={h.tip} /></> : h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.clientId} style={{ borderBottom: '1px solid var(--af-surface)' }}>
                  <td style={{ padding: '12px 12px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--af-text)' }}>{c.clientName || 'Client anonyme'}</div>
                    <div style={{ fontSize: 11, color: 'var(--af-text-muted)', marginTop: 2 }}>{c.afrikfidId}</div>
                  </td>
                  <td style={{ padding: '12px 12px' }}>
                    <LoyaltyBadge status={c.loyaltyStatus} />
                  </td>
                  {isGrowthPlus && (
                    <td style={{ padding: '12px 12px' }}>
                      <RfmBadge segment={c.rfmSegment} />
                    </td>
                  )}
                  <td style={{ padding: '12px 12px', color: 'var(--af-text)', fontWeight: 600 }}>{c.txCount}</td>
                  <td style={{ padding: '12px 12px', color: 'var(--af-text)', fontWeight: 600 }}>{fmt(c.totalVolume)} XOF</td>
                  <td style={{ padding: '12px 12px', color: 'var(--af-text-muted)' }}>{fmt(c.totalRebates)} XOF</td>
                  <td style={{ padding: '12px 12px', color: 'var(--af-text-muted)', fontSize: 12 }}>
                    {c.lastTx ? new Date(c.lastTx).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  {isGrowthPlus && (
                    <td style={{ padding: '12px 12px' }}>
                      <AbandonBadge step={c.abandonStep} status={c.abandonStatus} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {total > LIMIT && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
            <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  )
}
