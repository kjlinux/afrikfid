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

// Sur 401 : émet un événement que AuthProvider intercepte pour logout + navigate
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/pay/')) {
      const role = roleFromPath(window.location.pathname)
      if (role) {
        localStorage.removeItem(tokenKey(role))
        localStorage.removeItem(userKey(role))
        localStorage.removeItem(`afrikfid_refresh_${role}`)
      }
      window.dispatchEvent(new CustomEvent('afrikfid:unauthorized'))
    }
    return Promise.reject(err)
  }
)

// Instance publique sans intercepteur (pour /pay/:code)
export const publicApi = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export default api
