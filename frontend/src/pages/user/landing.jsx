import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { refreshTokens, getPlatformRole, isTokenValid } from '@/utils/api'

function roleHome() {
  return getPlatformRole() === 'admin' ? '/admin/dashboards/analytics' : '/projects/my'
}

// Default landing behavior:
// - If a JWT exists in storage, send user to their role-based home
// - Otherwise, attempt silent refresh via cookie, then fall back to register
const Landing = () => {
  // Lazy initializer runs synchronously before first paint —
  // if a token is already in sessionStorage, dest is set immediately (no flash).
  const [dest, setDest] = useState(() => {
    return isTokenValid() ? roleHome() : null
  })

  useEffect(() => {
    if (dest) return  // already resolved synchronously
    // Only attempt silent refresh if:
    // - user chose "remember me" (persisted in localStorage), OR
    // - we're in the same browser session (nonce in sessionStorage)
    // This prevents Chrome's session-restore from silently re-logging
    // in a user who closed the browser without remember me.
    const shouldTry =
      !!window.localStorage.getItem('cs_remember') ||
      !!window.sessionStorage.getItem('cs_session')
    if (!shouldTry) {
      setDest('/login')
      return
    }
    refreshTokens().then((newToken) => {
      if (!newToken) window.localStorage.removeItem('cs_remember')
      setDest(newToken ? roleHome() : '/login')
    }).catch(() => {
      window.localStorage.removeItem('cs_remember')
      setDest('/login')
    })
  }, [])

  if (!dest) return null
  return <Navigate to={dest} replace />
}

export default Landing
