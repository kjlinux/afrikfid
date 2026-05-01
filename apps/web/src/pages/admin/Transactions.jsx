import React, { useEffect, useState } from 'react'
import api from '../../api.js'
import { exportCsv, exportPdf } from '../../components/ui.jsx'
import { Breadcrumb } from '../../App.jsx'
import { CreditCardIcon, GiftIcon, WalletIcon, ArrowTrendingUpIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline'

const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))
const STATUS_STYLE = {
  completed: { color: '#4caf50', bg: 'rgba(16,185,129,0.1)' },
  failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  pending: { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  refunded:  { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
}
const LOYALTY_COLOR = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6', ROYAL_ELITE: '#ec4899' }
const RFM_COLORS = { CHAMPIONS: '#4caf50', FIDELES: '#3b82f6', PROMETTEURS: '#8b5cf6', A_RISQUE: '#ef4444', HIBERNANTS: '#F59E0B', PERDUS: '#6B7280' }
const RFM_SHORT = { CHAMPIONS: 'Champion', FIDELES: 'Fidèle', PROMETTEURS: 'Prometteur', A_RISQUE: 'À Risque', HIBERNANTS: 'Hibernant', PERDUS: 'Perdu' }

const S = {
  sel: { padding: '10px 14px', background: 'var(--afrikfid-surface)', border: '1px solid var(--afrikfid-border)', borderRadius: 8, color: 'var(--afrikfid-muted)', fontSize: 14, outline: 'none' },
  th: { padding: '11px 10px', textAlign: 'left', fontSize: 11, color: 'var(--afrikfid-muted)', fontWeight: 600, whiteSpace: 'nowrap' },
  td: { padding: '12px 10px' },
  infoCell: { background: 'var(--afrikfid-surface-2)', borderRadius: 8, padding: '10px 12px' },
}

export default function AdminTransactions() {
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ status: '', loyalty_status: '' })
  const [selected, setSelected] = useState(null)

  const load = () => {
    const params = new URLSearchParams({ page, limit: 20 })
    if (filters.status) params.set('status', filters.status)
    if (filters.loyalty_status) params.set('loyalty_status', filters.loyalty_status)
    api.get(`/reports/transactions?${params}`).then(r => {
      setTransactions(r.data.transactions)
      setTotal(r.data.total)
    })
  }

  useEffect(() => { load() }, [page, filters])

  const TX_COLS = [
    { label: 'Référence', key: 'reference' },
    { label: 'Marchand', key: 'merchant_name' },
    { label: 'Client', key: 'client_name' },
    { label: 'Montant brut', value: r => fmt(r.gross_amount) },
    { label: 'X%', key: 'merchant_rebate_percent' },
    { label: 'Y%', key: 'client_rebate_percent' },
    { label: 'Z%', key: 'platform_commission_percent' },
    { label: 'Statut client', key: 'client_loyalty_status' },
    { label: 'Statut tx', key: 'status' },
    { label: 'Opérateur', key: 'payment_operator' },
    { label: 'Date', value: r => r.initiated_at ? new Date(r.initiated_at).toLocaleDateString('fr-FR') : '' },
  ]

  // Compteurs par type de transaction (match capture 8 : 4 cards à gauche)
  const txCounts = {
    loyaltyCard: transactions.filter(t => t.status === 'completed').length,
    giftCard: transactions.filter(t => t.status === 'refunded').length,
    walletDebit: transactions.filter(t => t.payment_operator === 'wallet').length,
    walletCredit: total,
  }

  const typeCards = [
    { label: 'Carte fidélité', sub: 'Transactions totales', icon: CreditCardIcon, color: 'var(--af-kpi-green)', count: txCounts.loyaltyCard },
    { label: 'Débit Carte cadeau', sub: 'Transactions totales', icon: GiftIcon, color: 'var(--af-kpi-blue)', count: txCounts.giftCard },
    { label: 'Débit Wallet', sub: 'Transactions totales', icon: WalletIcon, color: 'var(--af-kpi-red)', count: txCounts.walletDebit },
    { label: 'Crédit wallet', sub: 'Transactions totales', icon: ArrowTrendingUpIcon, color: 'var(--af-kpi-yellow)', count: txCounts.walletCredit },
  ]

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Breadcrumb title="Transactions" segments={[{ label: 'Journal des transactions' }]} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportCsv(transactions, TX_COLS, 'transactions.csv')} className="af-btn af-btn--ghost af-btn--sm">
            <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> CSV
          </button>
          <button onClick={() => exportPdf(transactions, TX_COLS, 'Rapport Transactions', `${total} transactions`)} className="af-btn af-btn--ghost af-btn--sm">
            <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> PDF
          </button>
          <button onClick={() => { const params = new URLSearchParams(filters); window.location.href = `/api/v1/reports/transactions/excel?${params}` }} className="af-btn af-btn--ghost af-btn--sm">
            <ArrowDownTrayIcon style={{ width: 14, height: 14 }} /> Excel
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, marginBottom: 20 }}>
        {/* 4 cards types à gauche */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {typeCards.map(c => (
            <div key={c.label} className="af-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--af-text)' }}>{c.label}</div>
                <div style={{ fontSize: 11, color: 'var(--af-kpi-green)', marginTop: 2 }}>▲ {c.sub}</div>
              </div>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--af-radius)', background: `${c.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <c.icon style={{ width: 20, height: 20, color: c.color }} />
              </div>
            </div>
          ))}
        </div>

        {/* Zone filtres + table à droite */}
        <div>
          <div className="af-card" style={{ marginBottom: 12, padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)' }}>Opération</div>
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className="af-field" style={{ width: 'auto', marginBottom: 0 }}>
              <option value="">Peu importe</option>
              <option value="completed">Complétées</option>
              <option value="pending">En attente</option>
              <option value="failed">Échouées</option>
              <option value="refunded">Remboursées</option>
            </select>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--af-text-muted)' }}>Statut client</div>
            <select value={filters.loyalty_status} onChange={e => setFilters(f => ({ ...f, loyalty_status: e.target.value }))} className="af-field" style={{ width: 'auto', marginBottom: 0 }}>
              <option value="">Peu importe</option>
              <option value="OPEN">Open</option>
              <option value="LIVE">Live</option>
              <option value="GOLD">Gold</option>
              <option value="ROYAL">Royal</option>
            </select>
            <button onClick={load} className="af-btn af-btn--primary af-btn--sm" style={{ marginLeft: 'auto' }}>
              ↻ Filtrer
            </button>
            <button onClick={() => setFilters({ status: '', loyalty_status: '' })} className="af-btn af-btn--ghost af-btn--sm af-btn--icon" title="Effacer">
              🗑
            </button>
          </div>

          <div className="af-card" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--afrikfid-surface-2)', borderBottom: '2px solid var(--afrikfid-border)' }}>
              {['Référence', 'Marchand', 'Client', 'Montant', 'X%', 'Y%', 'Z%', 'Statut', 'Opérateur', 'Date'].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, i) => {
              const s = STATUS_STYLE[tx.status] || STATUS_STYLE.pending
              const lc = LOYALTY_COLOR[tx.client_loyalty_status] || '#6B7280'
              return (
                <tr key={tx.id} style={{ borderTop: '1px solid var(--afrikfid-border)', cursor: 'pointer', background: i % 2 === 1 ? 'var(--afrikfid-surface-2)' : 'transparent' }}
                  onClick={() => setSelected(tx)}>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--afrikfid-muted)', fontFamily: 'monospace' }}>{tx.reference}</td>
                  <td style={{ ...S.td, fontSize: 13, color: 'var(--afrikfid-text)', fontWeight: 500 }}>{tx.merchant_name}</td>
                  <td style={S.td}>
                    <div style={{ fontSize: 13, color: 'var(--afrikfid-muted)' }}>{tx.client_name || '—'}</div>
                    {tx.client_rfm_segment && (
                      <div style={{ fontSize: 10, color: RFM_COLORS[tx.client_rfm_segment] || '#6B7280', marginTop: 2, fontWeight: 600 }}>{RFM_SHORT[tx.client_rfm_segment] || tx.client_rfm_segment}</div>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 13, fontWeight: 700, color: 'var(--afrikfid-accent)' }}>{fmt(tx.gross_amount)}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#ef4444' }}>{tx.merchant_rebate_percent}%</td>
                  <td style={{ ...S.td, fontSize: 12, color: lc }}>{tx.client_rebate_percent}%</td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--afrikfid-success)' }}>{tx.platform_commission_percent}%</td>
                  <td style={S.td}>
                    <span style={{ background: s.bg, color: s.color, padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{tx.status}</span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--afrikfid-muted)' }}>{tx.payment_operator || '—'}</td>
                  <td style={{ ...S.td, fontSize: 11, color: 'var(--afrikfid-muted)' }}>{tx.initiated_at?.split('T')[0]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--af-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--af-surface-2)' }}>
          <span style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>{total} transactions</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="af-btn af-btn--ghost af-btn--sm">←</button>
            <span style={{ fontSize: 13, color: 'var(--af-text)', padding: '0 8px', alignSelf: 'center' }}>{page}</span>
            <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="af-btn af-btn--ghost af-btn--sm">→</button>
          </div>
        </div>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 17, 21,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--afrikfid-surface)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 540, border: '1px solid var(--afrikfid-border)', boxShadow: '0 8px 32px rgba(15, 17, 21,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--af-text)', fontFamily: 'Montserrat, sans-serif' }}>Détail Transaction</h2>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--afrikfid-muted)', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>

            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--afrikfid-accent)', marginBottom: 16, background: 'var(--afrikfid-surface-2)', padding: 10, borderRadius: 8, border: '1px solid var(--afrikfid-border)' }}>
              {selected.reference}
            </div>

            <div style={{ background: 'var(--afrikfid-surface-2)', borderRadius: 12, padding: 20, marginBottom: 20, border: '1px solid var(--afrikfid-border)' }}>
              <div style={{ fontSize: 12, color: 'var(--afrikfid-muted)', marginBottom: 16, fontWeight: 600 }}>RÉPARTITION X/Y/Z</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div style={{ textAlign: 'center', background: 'var(--afrikfid-surface)', borderRadius: 8, padding: 12, border: '1px solid rgba(239,68,68,0.25)' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#ef4444' }}>X = {selected.merchant_rebate_percent}%</div>
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>Remise marchand</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#ef4444', marginTop: 6 }}>{fmt(selected.merchant_rebate_amount)} XOF</div>
                </div>
                <div style={{ textAlign: 'center', background: 'var(--afrikfid-surface)', borderRadius: 8, padding: 12, border: `1px solid ${LOYALTY_COLOR[selected.client_loyalty_status] || '#6B7280'}40` }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: LOYALTY_COLOR[selected.client_loyalty_status] || 'var(--af-text-muted)' }}>Y = {selected.client_rebate_percent}%</div>
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>Remise client ({selected.client_loyalty_status})</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: LOYALTY_COLOR[selected.client_loyalty_status], marginTop: 6 }}>{fmt(selected.client_rebate_amount)} XOF</div>
                </div>
                <div style={{ textAlign: 'center', background: 'var(--afrikfid-surface)', borderRadius: 8, padding: 12, border: '1px solid rgba(16,185,129,0.25)' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--afrikfid-success)' }}>Z = {selected.platform_commission_percent}%</div>
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginTop: 4 }}>Commission Afrik'Fid</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--afrikfid-success)', marginTop: 6 }}>{fmt(selected.platform_commission_amount)} XOF</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--afrikfid-border)' }}>
                <span style={{ color: 'var(--afrikfid-muted)', fontSize: 13 }}>Montant brut</span>
                <span style={{ color: 'var(--afrikfid-accent)', fontWeight: 700, fontSize: 16 }}>{fmt(selected.gross_amount)} XOF</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ color: 'var(--afrikfid-muted)', fontSize: 13 }}>Marchand reçoit</span>
                <span style={{ color: 'var(--afrikfid-text)', fontWeight: 600, fontSize: 15 }}>{fmt(selected.merchant_receives)} XOF</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Marchand', selected.merchant_name],
                ['Client', selected.client_name || 'Invité'],
                ['Opérateur', selected.payment_operator || '—'],
                ['Mode remise', selected.rebate_mode],
                ['Date', selected.initiated_at?.split('T')[0]],
              ].map(([k, v]) => (
                <div key={k} style={S.infoCell}>
                  <div style={{ fontSize: 11, color: 'var(--afrikfid-muted)', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, color: 'var(--afrikfid-text)', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
