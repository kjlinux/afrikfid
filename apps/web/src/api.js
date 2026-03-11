import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Inject JWT token
api.interceptors.request.use(config => {
  const token = localStorage.getItem('afrikfid_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle auth errors — ne pas rediriger depuis les pages publiques (/pay/...)
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/pay/')) {
      localStorage.removeItem('afrikfid_token')
      localStorage.removeItem('afrikfid_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Instance publique sans intercepteur de redirection (pour /pay/:code)
export const publicApi = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export default api
