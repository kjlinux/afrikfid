import React from 'react'
import {
  TrophyIcon,
  StarIcon,
  SparklesIcon,
  InboxIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid'

export const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

// Tooltip : enveloppe un élément et affiche un texte explicatif au survol (ou au clic sur mobile)
export function Tooltip({ text, children, position = 'top' }) {
  const [visible, setVisible] = React.useState(false)
  const posStyles = {
    top:    { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    right:  { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
    left:   { right: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
  }
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', cursor: 'help' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
    >
      <span style={{ borderBottom: '1px dotted #64748b' }}>{children}</span>
      {visible && (
        <span style={{
          position: 'absolute',
          ...posStyles[position],
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: '#cbd5e1',
          lineHeight: 1.5,
          width: 240,
          zIndex: 9999,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          whiteSpace: 'normal',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

// InfoTooltip : petite icône ⓘ qui affiche un tooltip explicatif au survol
export function InfoTooltip({ text, position = 'top' }) {
  const [visible, setVisible] = React.useState(false)
  const posStyles = {
    top:    { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' },
    right:  { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
    left:   { right: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' },
  }
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 4, cursor: 'help' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={e => { e.stopPropagation(); setVisible(v => !v) }}
    >
      <InformationCircleIcon style={{ width: 14, height: 14, color: '#475569' }} />
      {visible && (
        <span style={{
          position: 'absolute',
          ...posStyles[position],
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 12,
          color: '#cbd5e1',
          lineHeight: 1.5,
          width: 240,
          zIndex: 9999,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          whiteSpace: 'normal',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

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

const COLOR_MAP = {
  yellow: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  blue:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
  green:  { color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  red:    { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  purple: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  gray:   { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
}

export function Badge({ status, label, color, children }) {
  const s = (color && COLOR_MAP[color]) || STATUS_COLORS[status] || COLOR_MAP.gray
  return (
    <span style={{ background: s.bg, color: s.color, padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'inline-block' }}>
      {children || label || status}
    </span>
  )
}

const LOYALTY_TOOLTIPS = {
  OPEN: "Statut de départ. Vous bénéficiez des avantages de base du programme de fidélité.",
  LIVE: "Statut actif. Vous avez effectué vos premiers achats et bénéficiez de remises sur vos transactions.",
  GOLD: "Statut Premium. Vos achats réguliers vous donnent droit à des remises améliorées.",
  ROYAL: "Statut Élite. Réservé aux clients les plus fidèles avec les meilleures remises disponibles.",
  ROYAL_ELITE: "Statut Suprême. Le niveau de fidélité le plus élevé — avantages exclusifs et remises maximales.",
}

export function LoyaltyBadge({ status }) {
  const color = LOYALTY_COLORS[status] || '#6B7280'
  const Icon = status === 'ROYAL' ? TrophyIcon : status === 'GOLD' ? StarIcon : status === 'LIVE' ? SparklesIcon : null
  const tip = LOYALTY_TOOLTIPS[status]
  const badge = (
    <span style={{ color, fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {Icon ? <Icon style={{ width: 14, height: 14 }} /> : <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />}
      {status}
    </span>
  )
  if (!tip) return badge
  return <Tooltip text={tip}>{badge}</Tooltip>
}

export function KpiCard({ label, value, sub, color = '#f59e0b', icon, trend }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 12, padding: '20px 24px', border: '1px solid #334155' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</span>
        {icon && <span style={{ color, display: 'flex', alignItems: 'center' }}>{React.isValidElement(icon) ? React.cloneElement(icon, { style: { width: 22, height: 22, ...icon.props?.style } }) : icon}</span>}
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

export function Select({ label, children, options, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>{label}</label>}
      <select {...props} style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box', ...props.style }}>
        {options ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : children}
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

export function EmptyState({ icon, title, desc }) {
  const DefaultIcon = <InboxIcon style={{ width: 40, height: 40, color: '#334155' }} />
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>{icon || DefaultIcon}</div>
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

// Helper to export table data as PDF (print dialog → Save as PDF)
// Ouvre une fenêtre dédiée avec le tableau formaté et déclenche l'impression (CDC §4.6.1)
export function exportPdf(rows, columns, title = 'Rapport', subtitle = '') {
  const date = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' })
  const thead = columns.map(c => `<th>${c.label}</th>`).join('')
  const tbody = rows.map(row => {
    const cells = columns.map(c => {
      const val = typeof c.value === 'function' ? c.value(row) : row[c.key]
      return `<td>${val ?? ''}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 24px; }
    h1 { font-size: 18px; color: #f59e0b; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .date { font-size: 11px; color: #94a3b8; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e293b; color: #f1f5f9; padding: 8px 10px; text-align: left; font-size: 11px; }
    td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 20px; font-size: 10px; color: #94a3b8; text-align: right; }
    @media print { body { padding: 12px; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
  <div class="date">Généré le ${date} — Afrik'Fid</div>
  <table>
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
  <div class="footer">Afrik'Fid — Document confidentiel</div>
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(html)
  w.document.close()
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
