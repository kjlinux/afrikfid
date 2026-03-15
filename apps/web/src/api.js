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
    : (localStorage.getItem(tokenKey('admin')) || localStorage.getItem(tokenKey('merchant')) || localStorage.getItem(tokenKey('client')))
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Refresh automatique du token sur 401
let refreshing = false
let pendingQueue = []

function processQueue(error, token = null) {
  pendingQueue.forEach(p => error ? p.reject(error) : p.resolve(token))
  pendingQueue = []
}

api.interceptors.response.use(
  res => res,
  async err => {
    const originalReq = err.config

    // Ignorer les pages publiques et les requêtes de refresh elles-mêmes
    if (window.location.pathname.startsWith('/pay/') || originalReq._retry) {
      return Promise.reject(err)
    }

    if (err.response?.status === 401) {
      const role = roleFromPath(window.location.pathname)

      if (refreshing) {
        // Mettre en file d'attente pendant le refresh en cours
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject })
        }).then(token => {
          originalReq.headers.Authorization = `Bearer ${token}`
          return api(originalReq)
        })
      }

      originalReq._retry = true
      refreshing = true

      const refreshKey = `afrikfid_refresh_${role || 'unknown'}`
      const refreshToken = localStorage.getItem(refreshKey)

      if (!refreshToken) {
        refreshing = false
        redirectToLogin(role)
        return Promise.reject(err)
      }

      try {
        const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken })
        const newToken = data.accessToken

        // Mettre à jour le token stocké
        localStorage.setItem(tokenKey(role), newToken)

        processQueue(null, newToken)
        originalReq.headers.Authorization = `Bearer ${newToken}`
        return api(originalReq)
      } catch (refreshErr) {
        processQueue(refreshErr, null)
        redirectToLogin(role)
        return Promise.reject(refreshErr)
      } finally {
        refreshing = false
      }
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
