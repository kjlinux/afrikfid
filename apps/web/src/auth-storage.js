// Clés localStorage isolées par rôle — évite les conflits multi-onglets
export function tokenKey(role) { return `afrikfid_token_${role || 'unknown'}` }
export function userKey(role)  { return `afrikfid_user_${role || 'unknown'}` }

// Détecte le rôle depuis l'URL courante
export function roleFromPath(path = window.location.pathname) {
  if (path.startsWith('/admin'))    return 'admin'
  if (path.startsWith('/merchant')) return 'merchant'
  if (path.startsWith('/client'))   return 'client'
  return null
}
