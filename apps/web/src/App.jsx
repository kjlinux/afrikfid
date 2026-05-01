import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { ToastProvider } from './components/ToastNotification.jsx'
import { ThemeProvider, useTheme } from './theme.js'
import { BrowserRouter, Routes, Route, Navigate, Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ChartBarIcon,
  BuildingStorefrontIcon,
  UsersIcon,
  CreditCardIcon,
  StarIcon,
  BellIcon,
  ShieldCheckIcon,
  ArrowsRightLeftIcon,
  ArrowUturnLeftIcon,
  ScaleIcon,
  ClipboardDocumentListIcon,
  LinkIcon,
  Cog6ToothIcon,
  UserCircleIcon,
  BellAlertIcon,
  ChevronDownIcon,
  HomeIcon,
  SunIcon,
  MoonIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline'

// Pages
import Login from './pages/Login.jsx'
import AdminDashboard from './pages/admin/Dashboard.jsx'
import AdminMerchants from './pages/admin/Merchants.jsx'
import AdminClients from './pages/admin/Clients.jsx'
import AdminTransactions from './pages/admin/Transactions.jsx'
import AdminLoyalty from './pages/admin/Loyalty.jsx'
import AdminLoyaltyBridge from './pages/admin/LoyaltyBridge.jsx'
import AdminWebhooks from './pages/admin/Webhooks.jsx'
import AdminFraud from './pages/admin/Fraud.jsx'
import AdminExchangeRates from './pages/admin/ExchangeRates.jsx'
import AdminAuditLogs from './pages/admin/AuditLogs.jsx'
import AdminRefunds from './pages/admin/Refunds.jsx'
import AdminDisputes from './pages/admin/Disputes.jsx'
import AdminProfile from './pages/admin/Profile.jsx'
import AdminSubscriptions from './pages/admin/Subscriptions.jsx'
import AdminSuccessFees from './pages/admin/SuccessFees.jsx'
import AdminRFM from './pages/admin/RFM.jsx'
import AdminCampaigns from './pages/admin/Campaigns.jsx'
import AdminAbandonProtocol from './pages/admin/AbandonProtocol.jsx'
import AdminChurnAlerts from './pages/admin/ChurnAlerts.jsx'
import MerchantDashboard from './pages/merchant/Dashboard.jsx'
import MerchantTransactions from './pages/merchant/Transactions.jsx'
import MerchantLinks from './pages/merchant/PaymentLinks.jsx'
import MerchantClients from './pages/merchant/Clients.jsx'
import MerchantSettings from './pages/merchant/Settings.jsx'
import MerchantRefunds from './pages/merchant/Refunds.jsx'
import MerchantIntelligence from './pages/merchant/Intelligence.jsx'
import MerchantChurnAlerts from './pages/merchant/ChurnAlerts.jsx'
import MerchantCampaigns from './pages/merchant/Campaigns.jsx'
import MerchantKyc from './pages/merchant/Kyc.jsx'
import MerchantProfile from './pages/merchant/Profile.jsx'
import ClientProfile from './pages/client/Profile.jsx'
import PaymentPage from './pages/pay/PaymentPage.jsx'
import Register from './pages/Register.jsx'
import ClientDashboard from './pages/client/Dashboard.jsx'

// ─── Auth Context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null)

export function useAuth() { return useContext(AuthContext) }

import { tokenKey, userKey, roleFromPath } from './auth-storage.js'

function AuthProvider({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeRole = roleFromPath(location.pathname)

  const [user, setUser] = useState(() => {
    const role = roleFromPath(window.location.pathname)
    const key = role ? userKey(role) : null
    if (key) {
      try { const u = JSON.parse(localStorage.getItem(key)); if (u) return u } catch { /* ignore */ }
    }
    for (const r of ['admin', 'merchant', 'client']) {
      try { const u = JSON.parse(localStorage.getItem(userKey(r))); if (u) return u } catch { /* ignore */ }
    }
    return null
  })

  const login = (userData, token, refreshToken) => {
    const role = userData.role
    localStorage.setItem(tokenKey(role), token)
    localStorage.setItem(userKey(role), JSON.stringify(userData))
    if (refreshToken) localStorage.setItem(`afrikfid_refresh_${role}`, refreshToken)
    setUser(userData)
  }

  const logout = () => {
    if (activeRole) {
      localStorage.removeItem(tokenKey(activeRole))
      localStorage.removeItem(userKey(activeRole))
    }
    setUser(null)
  }

  useEffect(() => {
    const onUnauthorized = () => { logout(); navigate('/login', { replace: true }) }
    window.addEventListener('afrikfid:unauthorized', onUnauthorized)
    return () => window.removeEventListener('afrikfid:unauthorized', onUnauthorized)
  }, [activeRole])

  const updateUser = (patch) => {
    setUser(prev => {
      const updated = { ...prev, ...patch }
      const role = updated.role
      if (role) localStorage.setItem(userKey(role), JSON.stringify(updated))
      return updated
    })
  }

  return <AuthContext.Provider value={{ user, login, logout, updateUser }}>{children}</AuthContext.Provider>
}

function Protected({ children, role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to="/login" replace />
  return children
}

// ─── Theme toggle button ─────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const Icon = theme === 'dark' ? SunIcon : MoonIcon
  return (
    <button
      className="af-topbar__icon-btn"
      onClick={toggle}
      title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      aria-label="Basculer le thème">
      <Icon style={{ width: 20, height: 20 }} />
    </button>
  )
}

// ─── Topbar (partagé admin/merchant/client) ──────────────────────────────────
function Topbar({ user, logoUrl, onLogout, onHome }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const initials = (user?.name || user?.email || 'U')
    .split(/[@\s.]/)[0]
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="af-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: '0 0 auto' }}>
        <button
          onClick={onHome}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          title="Accueil">
          <img src="/afrikfid-logo.png" alt="Afrik'Fid" className="af-topbar__logo" />
        </button>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto', position: 'relative' }} ref={menuRef}>
        <ThemeToggle />
        {user && (
          <>
            <div className="af-topbar__user" onClick={() => setMenuOpen(v => !v)}>
              {logoUrl
                ? <img src={logoUrl} alt="" className="af-topbar__avatar" style={{ objectFit: 'cover', padding: 0 }} />
                : <div className="af-topbar__avatar">{initials}</div>}
              <div>
                <div className="af-topbar__user-name">{user.name || user.email?.split('@')[0] || 'Utilisateur'}</div>
                <div className="af-topbar__user-role">{user.role}</div>
              </div>
              <ChevronDownIcon style={{ width: 14, height: 14, color: 'var(--af-text-muted)' }} />
            </div>
            {menuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                minWidth: 180, background: 'var(--af-surface)',
                border: '1px solid var(--af-border)', borderRadius: 'var(--af-radius)',
                boxShadow: 'var(--af-shadow-elevated)', padding: 6, zIndex: 100,
              }}>
                <button onClick={() => { setMenuOpen(false); onLogout() }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '10px 12px', background: 'transparent', border: 'none',
                    borderRadius: 'var(--af-radius-sm)', color: 'var(--af-danger)',
                    fontSize: 13, cursor: 'pointer', textAlign: 'left',
                  }}>
                  <ArrowRightOnRectangleIcon style={{ width: 16, height: 16 }} />
                  Déconnexion
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </header>
  )
}

// ─── Nav horizontale ─────────────────────────────────────────────────────────
function Navbar({ items }) {
  return (
    <nav className="af-navbar">
      {items.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.end}
          className={({ isActive }) => 'af-nav-item' + (isActive ? ' is-active' : '')}>
          {item.Icon && <item.Icon className="af-nav-icon" />}
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

// ─── Admin Layout ────────────────────────────────────────────────────────────
function AdminLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const items = [
    { path: '/admin',                   end: true, label: 'Dashboard',          Icon: ChartBarIcon },
    { path: '/admin/merchants',         label: 'Marchands',                    Icon: BuildingStorefrontIcon },
    { path: '/admin/clients',           label: 'Clients',                      Icon: UsersIcon },
    { path: '/admin/transactions',      label: 'Transactions',                 Icon: CreditCardIcon },
    { path: '/admin/loyalty',           label: 'Fidélité',                     Icon: StarIcon },
    { path: '/admin/loyalty-bridge',    label: 'Pont',            Icon: LinkIcon },
    { path: '/admin/webhooks',          label: 'Webhooks',                     Icon: BellIcon },
    { path: '/admin/fraud',             label: 'Fraude',                       Icon: ShieldCheckIcon },
    { path: '/admin/exchange-rates',    label: 'Taux de change',               Icon: ArrowsRightLeftIcon },
    { path: '/admin/refunds',           label: 'Remboursements',               Icon: ArrowUturnLeftIcon },
    { path: '/admin/disputes',          label: 'Litiges',                      Icon: ScaleIcon },
    { path: '/admin/subscriptions',     label: 'Abonnements',                  Icon: CreditCardIcon },
    { path: '/admin/success-fees',      label: 'Success Fees',                 Icon: ChartBarIcon },
    { path: '/admin/rfm',               label: 'Segmentation RFM',             Icon: ChartBarIcon },
    { path: '/admin/campaigns',         label: 'Campagnes',                    Icon: BellAlertIcon },
    { path: '/admin/abandon-protocol',  label: 'Protocole abandon',            Icon: BellAlertIcon },
    { path: '/admin/churn-alerts',      label: 'Alertes Churn',                Icon: ShieldCheckIcon },
    { path: '/admin/audit-logs',        label: "Journal d'audit",              Icon: ClipboardDocumentListIcon },
    { path: '/admin/profile',           label: 'Profil & Sécurité',            Icon: UserCircleIcon },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--af-bg)', color: 'var(--af-text)', display: 'flex', flexDirection: 'column' }}>
      <Topbar user={user} onLogout={() => { logout(); navigate('/login') }} onHome={() => navigate('/admin')} />
      <Navbar items={items} />
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}

// ─── Merchant Layout ──────────────────────────────────────────────────────────
function MerchantLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [merchantLogoUrl, setMerchantLogoUrl] = useState(null)
  useEffect(() => {
    import('./api.js').then(m => m.default.get('/merchants/me/profile'))
      .then(r => setMerchantLogoUrl(r.data.merchant?.logoUrl || null))
      .catch(() => {})
  }, [user?.id])

  const items = [
    { path: '/merchant',               end: true, label: 'Dashboard',          Icon: ChartBarIcon },
    { path: '/merchant/transactions',  label: 'Transactions',                 Icon: CreditCardIcon },
    { path: '/merchant/links',         label: 'Liens de paiement',            Icon: LinkIcon },
    { path: '/merchant/clients',       label: 'Clients fidélisés',            Icon: UsersIcon },
    { path: '/merchant/intelligence',  label: 'Intelligence',                 Icon: ChartBarIcon },
    { path: '/merchant/campaigns',    label: 'Campagnes',                    Icon: BellAlertIcon },
    { path: '/merchant/refunds',       label: 'Remboursements',               Icon: ArrowUturnLeftIcon },
    { path: '/merchant/kyc',           label: 'Vérification KYC',             Icon: ShieldCheckIcon },
    { path: '/merchant/settings',      label: 'Paramètres',                   Icon: Cog6ToothIcon },
    { path: '/merchant/profile',       label: 'Profil & Sécurité',            Icon: UserCircleIcon },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--af-bg)', color: 'var(--af-text)', display: 'flex', flexDirection: 'column' }}>
      <Topbar user={user} logoUrl={merchantLogoUrl} onLogout={() => { logout(); navigate('/login') }} onHome={() => navigate('/merchant')} />
      <Navbar items={items} />
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}

// ─── Breadcrumb helper (exporté pour les pages) ──────────────────────────────
export function Breadcrumb({ title, segments = [] }) {
  return (
    <div className="af-breadcrumb">
      <div className="af-breadcrumb__title">{title}</div>
      <span className="af-breadcrumb__sep">|</span>
      <HomeIcon className="af-breadcrumb__home" />
      {segments.map((seg, i) => (
        <React.Fragment key={i}>
          <span className="af-breadcrumb__sep">›</span>
          {seg.to
            ? <Link to={seg.to} className="af-breadcrumb__item">{seg.label}</Link>
            : <span className={'af-breadcrumb__item' + (i === segments.length - 1 ? ' is-current' : '')}>{seg.label}</span>}
        </React.Fragment>
      ))}
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            {/* /register-client retiré : inscription client géré côté business-api uniquement */}
            <Route path="/register-client" element={<Navigate to="/login" replace />} />
            <Route path="/pay/:code" element={<PaymentPage />} />

            {/* Admin */}
            <Route path="/admin" element={<Protected role="admin"><AdminLayout><AdminDashboard /></AdminLayout></Protected>} />
            <Route path="/admin/merchants" element={<Protected role="admin"><AdminLayout><AdminMerchants /></AdminLayout></Protected>} />
            <Route path="/admin/clients" element={<Protected role="admin"><AdminLayout><AdminClients /></AdminLayout></Protected>} />
            <Route path="/admin/transactions" element={<Protected role="admin"><AdminLayout><AdminTransactions /></AdminLayout></Protected>} />
            <Route path="/admin/loyalty" element={<Protected role="admin"><AdminLayout><AdminLoyalty /></AdminLayout></Protected>} />
            <Route path="/admin/loyalty-bridge" element={<Protected role="admin"><AdminLayout><AdminLoyaltyBridge /></AdminLayout></Protected>} />
            <Route path="/admin/webhooks" element={<Protected role="admin"><AdminLayout><AdminWebhooks /></AdminLayout></Protected>} />
            <Route path="/admin/fraud" element={<Protected role="admin"><AdminLayout><AdminFraud /></AdminLayout></Protected>} />
            <Route path="/admin/exchange-rates" element={<Protected role="admin"><AdminLayout><AdminExchangeRates /></AdminLayout></Protected>} />
            <Route path="/admin/refunds" element={<Protected role="admin"><AdminLayout><AdminRefunds /></AdminLayout></Protected>} />
            <Route path="/admin/disputes" element={<Protected role="admin"><AdminLayout><AdminDisputes /></AdminLayout></Protected>} />
            <Route path="/admin/subscriptions" element={<Protected role="admin"><AdminLayout><AdminSubscriptions /></AdminLayout></Protected>} />
            <Route path="/admin/success-fees" element={<Protected role="admin"><AdminLayout><AdminSuccessFees /></AdminLayout></Protected>} />
            <Route path="/admin/rfm" element={<Protected role="admin"><AdminLayout><AdminRFM /></AdminLayout></Protected>} />
            <Route path="/admin/campaigns" element={<Protected role="admin"><AdminLayout><AdminCampaigns /></AdminLayout></Protected>} />
            <Route path="/admin/abandon-protocol" element={<Protected role="admin"><AdminLayout><AdminAbandonProtocol /></AdminLayout></Protected>} />
            <Route path="/admin/churn-alerts" element={<Protected role="admin"><AdminLayout><AdminChurnAlerts /></AdminLayout></Protected>} />
            <Route path="/admin/audit-logs" element={<Protected role="admin"><AdminLayout><AdminAuditLogs /></AdminLayout></Protected>} />
            <Route path="/admin/profile" element={<Protected role="admin"><AdminLayout><AdminProfile /></AdminLayout></Protected>} />

            {/* Merchant */}
            <Route path="/merchant" element={<Protected role="merchant"><MerchantLayout><MerchantDashboard /></MerchantLayout></Protected>} />
            <Route path="/merchant/transactions" element={<Protected role="merchant"><MerchantLayout><MerchantTransactions /></MerchantLayout></Protected>} />
            <Route path="/merchant/links" element={<Protected role="merchant"><MerchantLayout><MerchantLinks /></MerchantLayout></Protected>} />
            <Route path="/merchant/clients" element={<Protected role="merchant"><MerchantLayout><MerchantClients /></MerchantLayout></Protected>} />
            <Route path="/merchant/intelligence" element={<Protected role="merchant"><MerchantLayout><MerchantIntelligence /></MerchantLayout></Protected>} />
            <Route path="/merchant/churn-alerts" element={<Protected role="merchant"><MerchantLayout><MerchantChurnAlerts /></MerchantLayout></Protected>} />
            <Route path="/merchant/campaigns" element={<Protected role="merchant"><MerchantLayout><MerchantCampaigns /></MerchantLayout></Protected>} />
            <Route path="/merchant/refunds" element={<Protected role="merchant"><MerchantLayout><MerchantRefunds /></MerchantLayout></Protected>} />
            <Route path="/merchant/settings" element={<Protected role="merchant"><MerchantLayout><MerchantSettings /></MerchantLayout></Protected>} />
            <Route path="/merchant/kyc" element={<Protected role="merchant"><MerchantLayout><MerchantKyc /></MerchantLayout></Protected>} />
            <Route path="/merchant/profile" element={<Protected role="merchant"><MerchantLayout><MerchantProfile /></MerchantLayout></Protected>} />

            {/* Client */}
            <Route path="/client" element={<Protected role="client"><ClientDashboard /></Protected>} />
            <Route path="/client/profile" element={<Protected role="client"><ClientProfile /></Protected>} />

            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
