/**
 * Composants UI réutilisables — Afrik'Fid Design System
 */
import React from 'react'

export const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

export const STATUS_COLORS = {
  completed: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  failed:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  pending:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  refunded:  { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  active:    { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  suspended: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  delivered: { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
}
export const LOYALTY_COLORS = { OPEN: '#6B7280', LIVE: '#3B82F6', GOLD: '#F59E0B', ROYAL: '#8B5CF6' }

export function Badge({ status, label }) {
  const s = STATUS_COLORS[status] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'inline-block' }}>
      {label || status}
    </span>
  )
}

export function LoyaltyBadge({ status }) {
  const color = LOYALTY_COLORS[status] || '#6B7280'
  const icon = status === 'ROYAL' ? '👑' : status === 'GOLD' ? '🥇' : status === 'LIVE' ? '⭐' : '○'
  return (
    <span style={{ color, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {icon} {status}
    </span>
  )
}

export function KpiCard({ label, value, sub, color = '#f59e0b', icon, trend }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 22 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>}
      {trend !== undefined && (
        <div style={{ fontSize: 11, color: trend >= 0 ? '#10b981' : '#ef4444', marginTop: 4 }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs période préc.
        </div>
      )}
    </div>
  )
}

export function Card({ children, title, action, style = {} }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155', ...style }}>
      {title && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: '#f1f5f9', margin: 0 }}>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function Modal({ open, onClose, title, children, maxWidth = 540 }) {
  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#1e293b', borderRadius: 16, padding: 28, width: '100%', maxWidth, border: '1px solid #334155', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{label}</label>}
      <input {...props} style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box', ...props.style }} />
    </div>
  )
}

export function Select({ label, children, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{label}</label>}
      <select {...props} style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box', ...props.style }}>
        {children}
      </select>
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', ...props }) {
  const sizes = { sm: { padding: '6px 12px', fontSize: 12 }, md: { padding: '10px 18px', fontSize: 14 }, lg: { padding: '13px 24px', fontSize: 15 } }
  const variants = {
    primary: { background: '#f59e0b', color: '#0f172a', border: 'none' },
    secondary: { background: 'transparent', color: '#94a3b8', border: '1px solid #334155' },
    danger: { background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' },
    success: { background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' },
  }
  const v = variants[variant] || variants.primary
  const s = sizes[size] || sizes.md
  return (
    <button {...props} style={{ ...s, ...v, borderRadius: 8, cursor: props.disabled ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: props.disabled ? 0.5 : 1, ...props.style }}>
      {children}
    </button>
  )
}

export function Pagination({ page, total, limit, onPage }) {
  const pages = Math.ceil(total / limit)
  if (pages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 13, color: '#64748b' }}>{total} total</span>
      <button disabled={page === 1} onClick={() => onPage(page - 1)}
        style={{ padding: '5px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page === 1 ? '#334155' : '#94a3b8', cursor: page === 1 ? 'default' : 'pointer' }}>←</button>
      <span style={{ fontSize: 13, color: '#94a3b8' }}>{page}/{pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}
        style={{ padding: '5px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: page >= pages ? '#334155' : '#94a3b8', cursor: page >= pages ? 'default' : 'pointer' }}>→</button>
    </div>
  )
}

export function Spinner() {
  return (
    <div style={{ padding: 40, color: '#64748b', textAlign: 'center', fontSize: 14 }}>
      <div style={{ width: 28, height: 28, border: '3px solid #334155', borderTopColor: '#f59e0b', borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
      Chargement...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export function Alert({ type = 'error', children, onClose }) {
  const styles = {
    error:   { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', color: '#ef4444' },
    success: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', color: '#10b981' },
    info:    { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', color: '#3b82f6' },
  }
  const s = styles[type] || styles.error
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '10px 14px', color: s.color, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>✕</button>}
    </div>
  )
}

export function EmptyState({ icon = '📭', title, desc }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>{title}</div>
      {desc && <div style={{ fontSize: 13 }}>{desc}</div>}
    </div>
  )
}

export function CopyButton({ text }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button onClick={copy} title="Copier" style={{ background: 'none', border: '1px solid #334155', borderRadius: 6, color: copied ? '#10b981' : '#64748b', cursor: 'pointer', padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>
      {copied ? '✓ Copié' : 'Copier'}
    </button>
  )
}

export function PeriodSelector({ value, onChange, options = ['7', '30', '90'] }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(p => (
        <button key={p} onClick={() => onChange(p)}
          style={{ padding: '6px 14px', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer', fontSize: 13, background: value === p ? '#f59e0b' : '#1e293b', color: value === p ? '#0f172a' : '#94a3b8', fontWeight: 600 }}>
          {p}j
        </button>
      ))}
    </div>
  )
}

// Helper to export table data as CSV
export function exportCsv(rows, columns, filename = 'export.csv') {
  const header = columns.map(c => c.label).join(',')
  const lines = rows.map(row => columns.map(c => {
    const val = typeof c.value === 'function' ? c.value(row) : row[c.key]
    return `"${String(val ?? '').replace(/"/g, '""')}"`
  }).join(','))
  const csv = [header, ...lines].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
