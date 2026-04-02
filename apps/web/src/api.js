import axios from 'axios'
import { tokenKey, userKey, roleFromPath } from './auth-storage.js'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Inject JWT token — choisit le token du rôle correspondant à la page courante
api.interceptors.request.use(config => {
  const role = roleFromPath(window.location.pathname)
  const token = role
    ? localStorage.getItem(tokenKey(role))
    : (localStorage.getItem(tokenKey('admin')) || localStorage.getItem(tokenKey('merchant')))
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Sur 401 : redirection immédiate vers la page de connexion
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/pay/')) {
      const role = roleFromPath(window.location.pathname)
      redirectToLogin(role)
    }
    return Promise.reject(err)
  }
)

function redirectToLogin(role) {
  if (role) {
    localStorage.removeItem(tokenKey(role))
    localStorage.removeItem(userKey(role))
    localStorage.removeItem(`afrikfid_refresh_${role}`)
  }
  window.location.href = '/login'
}

// Instance publique sans intercepteur (pour /pay/:code)
export const publicApi = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export default api
