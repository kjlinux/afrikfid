import React from 'react'
import {
  TrophyIcon,
  StarIcon,
  SparklesIcon,
  InboxIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/solid'

export const fmt = n => new Intl.NumberFormat('fr-FR').format(Math.round(n || 0))

const TOOLTIP_W = 240
const TOOLTIP_GAP = 8

function useSmartTooltip(anchorRef) {
  const [pos, setPos] = React.useState(null)

  const compute = React.useCallback(() => {
    if (!anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const spaceTop    = r.top
    const spaceBottom = vh - r.bottom

    let top, left
    if (spaceBottom >= 80 || spaceBottom >= spaceTop) {
      top = r.bottom + TOOLTIP_GAP
    } else {
      top = r.top - TOOLTIP_GAP
    }

    left = r.left + r.width / 2 - TOOLTIP_W / 2
    left = Math.max(8, Math.min(left, vw - TOOLTIP_W - 8))

    const below = spaceBottom >= 80 || spaceBottom >= spaceTop
    setPos({ top, left, below })
  }, [anchorRef])

  return { compute, pos }
}

function TooltipBox({ text, anchorRef }) {
  const { compute, pos } = useSmartTooltip(anchorRef)

  React.useEffect(() => { compute() }, [compute])

  if (!pos) return null

  const style = {
    position: 'fixed',
    top: pos.below ? pos.top : undefined,
    bottom: pos.below ? undefined : window.innerHeight - pos.top + 'px',
    left: pos.left,
    background: 'var(--af-topbar-bg)',
    border: '1px solid var(--af-border)',
    borderRadius: 'var(--af-radius)',
    padding: '8px 12px',
    fontSize: 12,
    color: 'var(--af-text)',
    lineHeight: 1.5,
    width: TOOLTIP_W,
    zIndex: 99999,
    pointerEvents: 'none',
    boxShadow: 'var(--af-shadow-elevated)',
    whiteSpace: 'normal',
  }

  if (!pos.below) {
    const r = anchorRef.current?.getBoundingClientRect()
    if (r) style.top = r.top - TOOLTIP_GAP + 'px'
    style.transform = 'translateY(-100%)'
    delete style.bottom
  }

  return <span style={style}>{text}</span>
}

export function Tooltip({ text, children }) {
  const [visible, setVisible] = React.useState(false)
  const ref = React.useRef(null)
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-block', cursor: 'help' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(v => !v)}
    >
      <span style={{ borderBottom: '1px dotted var(--af-text-muted)' }}>{children}</span>
      {visible && <TooltipBox text={text} anchorRef={ref} />}
    </span>
  )
}

export function InfoTooltip({ text }) {
  const [visible, setVisible] = React.useState(false)
  const ref = React.useRef(null)
  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 4, cursor: 'help' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={e => { e.stopPropagation(); setVisible(v => !v) }}
    >
      <InformationCircleIcon style={{ width: 14, height: 14, color: 'var(--af-text-muted)' }} />
      {visible && <TooltipBox text={text} anchorRef={ref} />}
    </span>
  )
}

// ─── Color maps (consommés par les pages — on garde la même clé/structure) ───
export const STATUS_COLORS = {
  completed: { color: 'var(--af-success)', bg: 'var(--af-success-soft)' },
  failed:    { color: 'var(--af-danger)',  bg: 'var(--af-danger-soft)' },
  pending:   { color: 'var(--af-warning)', bg: 'var(--af-warning-soft)' },
  refunded:  { color: 'var(--af-kpi-violet)', bg: 'var(--af-kpi-violet-soft)' },
  active:    { color: 'var(--af-success)', bg: 'var(--af-success-soft)' },
  suspended: { color: 'var(--af-danger)',  bg: 'var(--af-danger-soft)' },
  delivered: { color: 'var(--af-success)', bg: 'var(--af-success-soft)' },
}
export const LOYALTY_COLORS = {
  OPEN: '#9CA3AF',
  LIVE: '#3B82F6',
  GOLD: '#F59E0B',
  ROYAL: '#8B5CF6',
  ROYAL_ELITE: '#EC4899',
}

const COLOR_MAP = {
  yellow: { color: 'var(--af-kpi-yellow)', bg: 'var(--af-kpi-yellow-soft)' },
  blue:   { color: 'var(--af-kpi-blue)',   bg: 'var(--af-kpi-blue-soft)' },
  green:  { color: 'var(--af-success)',    bg: 'var(--af-success-soft)' },
  red:    { color: 'var(--af-danger)',     bg: 'var(--af-danger-soft)' },
  purple: { color: 'var(--af-kpi-violet)', bg: 'var(--af-kpi-violet-soft)' },
  gray:   { color: 'var(--af-text-muted)', bg: 'var(--af-surface-2)' },
  orange: { color: 'var(--af-accent)',     bg: 'var(--af-accent-soft)' },
}

export function Badge({ status, label, color, children }) {
  const s = (color && COLOR_MAP[color]) || STATUS_COLORS[status] || COLOR_MAP.gray
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '4px 10px', borderRadius: 'var(--af-radius-pill)',
      fontSize: 11, fontWeight: 600, display: 'inline-block',
      border: '1px solid transparent',
      letterSpacing: 0.2,
    }}>
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
  const color = LOYALTY_COLORS[status] || LOYALTY_COLORS.OPEN
  const Icon = status === 'ROYAL' || status === 'ROYAL_ELITE' ? TrophyIcon : status === 'GOLD' ? StarIcon : status === 'LIVE' ? SparklesIcon : null
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

// ─── KPI card ────────────────────────────────────────────────────────────────
// Conserve la signature (label, value, sub, color, icon, trend) + ajoute un
// rendu "card avec sparkline" côté Dashboard en passant `color` = une couleur
// KPI (red/violet/yellow/green...). Les pages existantes continuent de passer
// une var CSS, ce qui reste supporté.
export function KpiCard({ label, value, sub, color = 'var(--af-accent)', icon, trend }) {
  return (
    <div className="af-kpi">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4, position: 'relative', zIndex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="af-kpi__label">{label}</div>
          <div className="af-kpi__value" style={{ color }}>{value}</div>
          {sub && <div className="af-kpi__sub">{sub}</div>}
          {trend !== undefined && (
            <div style={{ fontSize: 11, color: trend >= 0 ? 'var(--af-success)' : 'var(--af-danger)', marginTop: 4, fontWeight: 600 }}>
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs période préc.
            </div>
          )}
        </div>
        {icon && (
          <span style={{ color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            {React.isValidElement(icon)
              ? React.cloneElement(icon, { style: { width: 24, height: 24, ...icon.props?.style } })
              : icon}
          </span>
        )}
      </div>
    </div>
  )
}

export function Card({ children, title, action, style = {} }) {
  return (
    <div className="af-card" style={style}>
      {title && (
        <div className="af-card__header">
          <h3 className="af-card__title">{title}</h3>
          {action}
        </div>
      )}
      <div className="af-card__body">{children}</div>
    </div>
  )
}

export function Modal({ open, onClose, title, children, maxWidth = 540 }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(15, 17, 21, 0.65)',
      backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div style={{
        background: 'var(--af-surface)',
        borderRadius: 'var(--af-radius-xl)',
        padding: 28, width: '100%', maxWidth,
        border: '1px solid var(--af-border)',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: 'var(--af-shadow-elevated)',
        color: 'var(--af-text)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--af-text)', margin: 0 }}>{title}</h2>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--af-text-muted)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 4 }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Input({ label, ...props }) {
  const { style: propStyle, ...rest } = props
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 12, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</label>}
      <input className="af-field" {...rest} style={propStyle} />
    </div>
  )
}

export function Select({ label, children, options, ...props }) {
  const { style: propStyle, ...rest } = props
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: 'block', fontSize: 12, color: 'var(--af-text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</label>}
      <select className="af-field" {...rest} style={propStyle}>
        {options ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>) : children}
      </select>
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', ...props }) {
  const classMap = {
    primary: 'af-btn af-btn--primary',
    accent: 'af-btn af-btn--primary',
    secondary: 'af-btn af-btn--ghost',
    ghost: 'af-btn af-btn--ghost',
    danger: 'af-btn af-btn--danger',
    success: 'af-btn af-btn--success',
    brand: 'af-btn af-btn--brand',
  }
  const sizeMap = { sm: ' af-btn--sm', md: '', lg: ' af-btn--lg' }
  const cls = (classMap[variant] || classMap.primary) + (sizeMap[size] || '')
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  )
}

export function Pagination({ page, total, limit, onPage }) {
  const pages = Math.ceil(total / limit)
  if (pages <= 1) return null
  const navStyle = (disabled) => ({
    padding: '6px 12px',
    background: 'var(--af-surface)',
    border: '1px solid var(--af-border)',
    borderRadius: 'var(--af-radius-sm)',
    color: disabled ? 'var(--af-text-faint)' : 'var(--af-text)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 13,
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 13, color: 'var(--af-text-muted)' }}>{total} total</span>
      <button disabled={page === 1} onClick={() => onPage(page - 1)} style={navStyle(page === 1)}>←</button>
      <span style={{ fontSize: 13, color: 'var(--af-text)' }}>{page}/{pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} style={navStyle(page >= pages)}>→</button>
    </div>
  )
}

export function Spinner() {
  return (
    <div style={{ padding: 40, color: 'var(--af-text-muted)', textAlign: 'center', fontSize: 14 }}>
      <div className="af-spinner" style={{ margin: '0 auto 12px' }} />
      Chargement...
    </div>
  )
}

export function Alert({ type = 'error', children, onClose }) {
  const styles = {
    error:   { bg: 'var(--af-danger-soft)',  color: 'var(--af-danger)' },
    success: { bg: 'var(--af-success-soft)', color: 'var(--af-success)' },
    info:    { bg: 'var(--af-info-soft)',    color: 'var(--af-info)' },
    warning: { bg: 'var(--af-warning-soft)', color: 'var(--af-warning)' },
  }
  const s = styles[type] || styles.error
  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.color}33`,
      borderRadius: 'var(--af-radius)',
      padding: '10px 14px',
      color: s.color,
      fontSize: 13,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 12,
    }}>
      <span>{children}</span>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>✕</button>}
    </div>
  )
}

export function EmptyState({ icon, title, desc }) {
  const DefaultIcon = <InboxIcon className="af-empty-icon" />
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--af-text-muted)' }}>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>{icon || DefaultIcon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--af-text)', marginBottom: 6 }}>{title}</div>
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
    <button onClick={copy} title="Copier"
      style={{
        background: 'var(--af-surface)',
        border: '1px solid var(--af-border)',
        borderRadius: 'var(--af-radius-sm)',
        color: copied ? 'var(--af-success)' : 'var(--af-text-muted)',
        cursor: 'pointer',
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
      }}>
      {copied ? '✓ Copié' : 'Copier'}
    </button>
  )
}

export function PeriodSelector({ value, onChange, options = ['7', '30', '90'] }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--af-surface-2)', padding: 4, borderRadius: 'var(--af-radius-pill)', border: '1px solid var(--af-border)' }}>
      {options.map(p => {
        const active = value === p
        return (
          <button key={p} onClick={() => onChange(p)}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: 'var(--af-radius-pill)',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              background: active ? 'var(--af-accent)' : 'transparent',
              color: active ? '#FFFFFF' : 'var(--af-text-muted)',
              transition: 'background 0.15s, color 0.15s',
            }}>
            {p}j
          </button>
        )
      })}
    </div>
  )
}

// Helper to export table data as PDF (print dialog → Save as PDF)
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
    body { font-family: 'Poppins', Arial, sans-serif; font-size: 11px; color: #1F2937; padding: 24px; }
    h1 { font-size: 18px; color: #E30613; margin-bottom: 4px; }
    .subtitle { font-size: 12px; color: #6B7280; margin-bottom: 4px; }
    .date { font-size: 11px; color: #6B7280; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #E30613; color: #FFFFFF; padding: 8px 10px; text-align: left; font-size: 11px; }
    td { padding: 7px 10px; border-bottom: 1px solid #E5E7EB; font-size: 11px; }
    tr:nth-child(even) td { background: #F9FAFB; }
    .footer { margin-top: 20px; font-size: 10px; color: #6B7280; text-align: right; }
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

export function exportCsv(rows, columns, filename = 'export.csv') {
  const header = columns.map(c => c.label).join(',')
  const lines = rows.map(row => columns.map(c => {
    const val = typeof c.value === 'function' ? c.value(row) : row[c.key]
    return `"${String(val ?? '').replace(/"/g, '""')}"`
  }).join(','))
  const csv = [header, ...lines].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
