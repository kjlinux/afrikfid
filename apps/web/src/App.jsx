import React, { createContext, useContext, useState, useEffect } from 'react'
import { ToastProvider } from './components/ToastNotification.jsx'
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom'
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
} from '@heroicons/react/24/outline'

// Pages
import Login from './pages/Login.jsx'
import AdminDashboard from './pages/admin/Dashboard.jsx'
import AdminMerchants from './pages/admin/Merchants.jsx'
import AdminClients from './pages/admin/Clients.jsx'
import AdminTransactions from './pages/admin/Transactions.jsx'
import AdminLoyalty from './pages/admin/Loyalty.jsx'
import AdminWebhooks from './pages/admin/Webhooks.jsx'
import AdminFraud from './pages/admin/Fraud.jsx'
import AdminExchangeRates from './pages/admin/ExchangeRates.jsx'
import AdminAuditLogs from './pages/admin/AuditLogs.jsx'
import AdminRefunds from './pages/admin/Refunds.jsx'
import AdminDisputes from './pages/admin/Disputes.jsx'
import AdminProfile from './pages/admin/Profile.jsx'
import MerchantDashboard from './pages/merchant/Dashboard.jsx'
import MerchantTransactions from './pages/merchant/Transactions.jsx'
import MerchantLinks from './pages/merchant/PaymentLinks.jsx'
import MerchantClients from './pages/merchant/Clients.jsx'
import MerchantSettings from './pages/merchant/Settings.jsx'
import MerchantRefunds from './pages/merchant/Refunds.jsx'
import MerchantKyc from './pages/merchant/Kyc.jsx'
import PaymentPage from './pages/pay/PaymentPage.jsx'
import Register from './pages/Register.jsx'
import RegisterClient from './pages/RegisterClient.jsx'
import ClientDashboard from './pages/client/Dashboard.jsx'

// ─── Auth Context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null)

export function useAuth() { return useContext(AuthContext) }

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('afrikfid_user')) } catch { return null }
  })

  const login = (userData, token) => {
    localStorage.setItem('afrikfid_token', token)
    localStorage.setItem('afrikfid_user', JSON.stringify(userData))
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('afrikfid_token')
    localStorage.removeItem('afrikfid_user')
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function Protected({ children, role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to="/login" replace />
  return children
}

// ─── Admin Sidebar Layout ────────────────────────────────────────────────────
function AdminLayout({ children }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const nav = [
    { path: '/admin', label: 'Dashboard', icon: ChartBarIcon },
    { path: '/admin/merchants', label: 'Marchands', icon: BuildingStorefrontIcon },
    { path: '/admin/clients', label: 'Clients', icon: UsersIcon },
    { path: '/admin/transactions', label: 'Transactions', icon: CreditCardIcon },
    { path: '/admin/loyalty', label: 'Fidélité', icon: StarIcon },
    { path: '/admin/webhooks', label: 'Webhooks', icon: BellIcon },
    { path: '/admin/fraud', label: 'Fraude', icon: ShieldCheckIcon },
    { path: '/admin/exchange-rates', label: 'Taux de change', icon: ArrowsRightLeftIcon },
    { path: '/admin/refunds', label: 'Remboursements', icon: ArrowUturnLeftIcon },
    { path: '/admin/disputes', label: 'Litiges', icon: ScaleIcon },
    { path: '/admin/audit-logs', label: 'Journal d\'audit', icon: ClipboardDocumentListIcon },
    { path: '/admin/profile', label: 'Profil & Sécurité', icon: UserCircleIcon },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a' }}>
      {/* Sidebar */}
      <aside style={{ width: 240, background: '#1e293b', borderRight: '1px solid #334155', padding: '0 0 24px 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid #334155', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>A</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Afrik'Fid</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Administration</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
          {nav.map(item => (
            <Link key={item.path} to={item.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
                marginBottom: 2, textDecoration: 'none', fontSize: 13, fontWeight: 500,
                background: location.pathname === item.path ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: location.pathname === item.path ? '#f59e0b' : '#94a3b8',
                transition: 'all 0.15s',
              }}>
              <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #334155' }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{user?.email}</div>
          <button onClick={() => { logout(); navigate('/login') }}
            style={{ width: '100%', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Content */}
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}

// ─── Merchant Layout ──────────────────────────────────────────────────────────
function MerchantLayout({ children }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const nav = [
    { path: '/merchant', label: 'Dashboard', icon: ChartBarIcon },
    { path: '/merchant/transactions', label: 'Transactions', icon: CreditCardIcon },
    { path: '/merchant/links', label: 'Liens de paiement', icon: LinkIcon },
    { path: '/merchant/clients', label: 'Clients fidélisés', icon: UsersIcon },
    { path: '/merchant/refunds', label: 'Remboursements', icon: ArrowUturnLeftIcon },
    { path: '/merchant/kyc', label: 'Vérification KYC', icon: ShieldCheckIcon },
    { path: '/merchant/settings', label: 'Paramètres', icon: Cog6ToothIcon },
  ]

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a' }}>
      <aside style={{ width: 220, background: '#1e293b', borderRight: '1px solid #334155', padding: '0 0 24px 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 16px', borderBottom: '1px solid #334155', marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#f59e0b' }}>Afrik'Fid</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Espace Marchand</div>
        </div>
        <nav style={{ flex: 1, padding: '8px 8px' }}>
          {nav.map(item => (
            <Link key={item.path} to={item.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                marginBottom: 2, textDecoration: 'none', fontSize: 14,
                background: location.pathname === item.path ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: location.pathname === item.path ? '#f59e0b' : '#94a3b8',
              }}>
              <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} /><span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div style={{ padding: '12px 16px', borderTop: '1px solid #334155' }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>{user?.name || user?.email}</div>
          <button onClick={() => { logout(); navigate('/login') }}
            style={{ width: '100%', padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444', cursor: 'pointer', fontSize: 13 }}>
            Déconnexion
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>{children}</main>
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register-client" element={<RegisterClient />} />
          <Route path="/pay/:code" element={<PaymentPage />} />

          {/* Admin */}
          <Route path="/admin" element={<Protected role="admin"><AdminLayout><AdminDashboard /></AdminLayout></Protected>} />
          <Route path="/admin/merchants" element={<Protected role="admin"><AdminLayout><AdminMerchants /></AdminLayout></Protected>} />
          <Route path="/admin/clients" element={<Protected role="admin"><AdminLayout><AdminClients /></AdminLayout></Protected>} />
          <Route path="/admin/transactions" element={<Protected role="admin"><AdminLayout><AdminTransactions /></AdminLayout></Protected>} />
          <Route path="/admin/loyalty" element={<Protected role="admin"><AdminLayout><AdminLoyalty /></AdminLayout></Protected>} />
          <Route path="/admin/webhooks" element={<Protected role="admin"><AdminLayout><AdminWebhooks /></AdminLayout></Protected>} />
          <Route path="/admin/fraud" element={<Protected role="admin"><AdminLayout><AdminFraud /></AdminLayout></Protected>} />
          <Route path="/admin/exchange-rates" element={<Protected role="admin"><AdminLayout><AdminExchangeRates /></AdminLayout></Protected>} />
          <Route path="/admin/refunds" element={<Protected role="admin"><AdminLayout><AdminRefunds /></AdminLayout></Protected>} />
          <Route path="/admin/disputes" element={<Protected role="admin"><AdminLayout><AdminDisputes /></AdminLayout></Protected>} />
          <Route path="/admin/audit-logs" element={<Protected role="admin"><AdminLayout><AdminAuditLogs /></AdminLayout></Protected>} />
          <Route path="/admin/profile" element={<Protected role="admin"><AdminLayout><AdminProfile /></AdminLayout></Protected>} />

          {/* Merchant */}
          <Route path="/merchant" element={<Protected role="merchant"><MerchantLayout><MerchantDashboard /></MerchantLayout></Protected>} />
          <Route path="/merchant/transactions" element={<Protected role="merchant"><MerchantLayout><MerchantTransactions /></MerchantLayout></Protected>} />
          <Route path="/merchant/links" element={<Protected role="merchant"><MerchantLayout><MerchantLinks /></MerchantLayout></Protected>} />
          <Route path="/merchant/clients" element={<Protected role="merchant"><MerchantLayout><MerchantClients /></MerchantLayout></Protected>} />
          <Route path="/merchant/refunds" element={<Protected role="merchant"><MerchantLayout><MerchantRefunds /></MerchantLayout></Protected>} />
          <Route path="/merchant/settings" element={<Protected role="merchant"><MerchantLayout><MerchantSettings /></MerchantLayout></Protected>} />
          <Route path="/merchant/kyc" element={<Protected role="merchant"><MerchantLayout><MerchantKyc /></MerchantLayout></Protected>} />

          {/* Client */}
          <Route path="/client" element={<Protected role="client"><ClientDashboard /></Protected>} />

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
