import { useState, useEffect } from 'react'
import { isTokenValid, refreshTokens, getPlatformRole } from '@/utils/api'
import { syncThemeFromServer } from '@/utils/theme'

/**
 * Handles async token validation + silent refresh for protected layouts.
 * Returns { status: 'loading' | 'ok' | 'fail', redirectTo: string | null }
 *
 * @param {string|null} requiredRole  - if set, also checks platform_role after auth
 */
export default function useAuthGuard(requiredRole = null) {
    const [auth, setAuth] = useState(() => isTokenValid() ? 'ok' : 'loading')

    useEffect(() => {
        if (auth !== 'loading') return
        let cancelled = false
        refreshTokens().then(token => {
            if (!cancelled) {
                if (token) {
                    syncThemeFromServer().catch(() => {})
                }
                setAuth(token ? 'ok' : 'fail')
            }
        })
        return () => { cancelled = true }
    }, [auth])

    useEffect(() => {
        const handleLogout = () => setAuth('fail')
        const handleLogin = async () => {
            // Sync theme before marking as 'ok'
            await syncThemeFromServer()
            setAuth('ok')
        }
        const handleStorage = (e) => {
            if (e.key === 'cs_logout') {
                window.sessionStorage.removeItem('access_token')
                window.sessionStorage.removeItem('cs_session')
                setAuth('fail')
            }
            if (e.key === 'cs_remember' && e.newValue) {
                setAuth(isTokenValid() ? 'ok' : 'loading')
            }
        }
        window.addEventListener('auth:logout', handleLogout)
        window.addEventListener('auth:login', handleLogin)
        window.addEventListener('storage', handleStorage)
        return () => {
            window.removeEventListener('auth:logout', handleLogout)
            window.removeEventListener('auth:login', handleLogin)
            window.removeEventListener('storage', handleStorage)
        }
    }, [])

    if (auth === 'loading') return { status: 'loading', redirectTo: null }
    if (auth === 'fail') return { status: 'fail', redirectTo: '/login' }
    if (requiredRole && getPlatformRole() !== requiredRole) return { status: 'fail', redirectTo: '/projects/my' }
    return { status: 'ok', redirectTo: null }
}
