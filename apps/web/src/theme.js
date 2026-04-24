import React from 'react'

/**
 * Tokens de thème Afrik'Fid pour Recharts et styles inline React
 * qui n'ont pas accès aux CSS variables (Recharts sérialise certaines props en strings).
 *
 * - `theme` : export par défaut, structure historique conservée (colors/fonts/radius/focusRing).
 *   Les valeurs reflètent le *light mode* pour rétrocompat — utilisez `useTheme()` pour
 *   obtenir les tokens du thème actif.
 * - `tokens.light` / `tokens.dark` : palettes complètes exposées au runtime.
 * - `useTheme()` : hook React qui expose `{ theme, tokens, toggle, setTheme }`, synchronise
 *   `<html data-theme>`, persiste dans localStorage, et initialise depuis `prefers-color-scheme`.
 */

export const THEME_STORAGE_KEY = 'afrikfid-theme'

export const tokens = {
  light: {
    brand: '#E30613',
    brandSoft: 'rgba(227,6,19,0.12)',
    accent: '#E30613',
    accentSoft: 'rgba(227,6,19,0.12)',
    accentBright: '#F52030',

    topbarBg: '#FFFFFF',
    topbarFg: '#1F2937',
    navBg: '#FFFFFF',
    navFg: '#4B5563',

    bg: '#F5F6F8',
    surface: '#FFFFFF',
    surface2: '#EEF0F4',
    surface3: '#F9FAFB',
    border: '#E5E7EB',
    borderStrong: '#D1D5DB',

    text: '#1F2937',
    textMuted: '#6B7280',
    textFaint: '#9CA3AF',
    textInvert: '#FFFFFF',

    success: '#059669',
    warning: '#D97706',
    danger: '#DC2626',
    info: '#7C3AED',

    kpi: {
      red: '#EF4444',
      violet: '#A78BFA',
      yellow: '#EAB308',
      green: '#10B981',
      blue: '#3B82F6',
      orange: '#E30613',
    },

    nav: {
      dashboard: '#3B82F6',
      partners: '#E30613',
      consumers: '#10B981',
      loyalty: '#A78BFA',
      gift: '#E30613',
      wallet: '#10B981',
      transactions: '#A78BFA',
      finance: '#E30613',
    },

    loyalty: {
      OPEN: '#6B7280',
      LIVE: '#3B82F6',
      GOLD: '#F59E0B',
      ROYAL: '#8B5CF6',
      ROYAL_ELITE: '#EC4899',
    },
  },
  dark: {
    brand: '#E30613',
    brandSoft: 'rgba(227,6,19,0.22)',
    accent: '#E30613',
    accentSoft: 'rgba(227,6,19,0.22)',
    accentBright: '#FF3040',

    topbarBg: '#0F1115',
    topbarFg: '#F3F4F6',
    navBg: '#15181E',
    navFg: '#D1D5DB',

    bg: '#1A1D23',
    surface: '#23272F',
    surface2: '#2D323C',
    surface3: '#1F232A',
    border: '#353A45',
    borderStrong: '#4B5563',

    text: '#F3F4F6',
    textMuted: '#9CA3AF',
    textFaint: '#6B7280',
    textInvert: '#FFFFFF',

    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    info: '#8B5CF6',

    kpi: {
      red: '#EF4444',
      violet: '#A78BFA',
      yellow: '#EAB308',
      green: '#10B981',
      blue: '#3B82F6',
      orange: '#E30613',
    },

    nav: {
      dashboard: '#60A5FA',
      partners: '#E30613',
      consumers: '#10B981',
      loyalty: '#A78BFA',
      gift: '#E30613',
      wallet: '#10B981',
      transactions: '#A78BFA',
      finance: '#E30613',
    },

    loyalty: {
      OPEN: '#9CA3AF',
      LIVE: '#60A5FA',
      GOLD: '#FBBF24',
      ROYAL: '#A78BFA',
      ROYAL_ELITE: '#F472B6',
    },
  },
}

// ─── Rétro-compat : structure historique (light) ──────────────────────────────
export const theme = {
  colors: {
    primary: tokens.light.brand,
    primaryDark: '#B82C37',
    secondary: '#C11A27',
    accent: tokens.light.accent,
    accentBright: tokens.light.accentBright,
    gold: tokens.light.kpi.yellow,

    bg: tokens.light.bg,
    surface: tokens.light.surface,
    surface2: tokens.light.surface2,
    border: tokens.light.border,

    text: tokens.light.text,
    textMuted: tokens.light.textMuted,
    textInvert: tokens.light.textInvert,

    success: tokens.light.success,
    info: tokens.light.info,
    warning: tokens.light.warning,
    error: tokens.light.danger,

    loyalty: tokens.light.loyalty,
  },
  fonts: {
    body: "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    heading: "'Montserrat', 'Poppins', sans-serif",
  },
  radius: {
    sm: '6px',
    md: '8px',
    lg: '12px',
  },
  focusRing: '0 0 0 3px rgba(227,6,19,0.25)',
}

export default theme

// ─── Hook useTheme ────────────────────────────────────────────────────────────
const ThemeContext = React.createContext(null)

function readInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* ignore */ }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(value) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', value)
}

export function ThemeProvider({ children }) {
  const [current, setCurrent] = React.useState(readInitialTheme)

  React.useEffect(() => {
    applyTheme(current)
    try { localStorage.setItem(THEME_STORAGE_KEY, current) } catch { /* ignore */ }
  }, [current])

  const value = React.useMemo(() => ({
    theme: current,
    tokens: tokens[current],
    toggle: () => setCurrent(t => (t === 'dark' ? 'light' : 'dark')),
    setTheme: setCurrent,
  }), [current])

  return React.createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (ctx) return ctx
  // Fallback sans provider : lit l'attribut data-theme courant (SSR safe)
  const active = typeof document !== 'undefined'
    ? (document.documentElement.getAttribute('data-theme') || 'light')
    : 'light'
  return {
    theme: active,
    tokens: tokens[active] || tokens.light,
    toggle: () => {},
    setTheme: () => {},
  }
}
