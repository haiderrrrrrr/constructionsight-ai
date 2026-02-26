import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const Logout = () => {
  const navigate = useNavigate()

  useEffect(() => {
    const accessToken = window.sessionStorage.getItem('access_token')
    const url = accessToken ? `${API_BASE}/auth/logout-all` : `${API_BASE}/auth/logout`
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined

    fetch(url, { method: 'POST', credentials: 'include', headers })
      .catch(() => {})
      .finally(() => {
        window.sessionStorage.removeItem('access_token')
        window.sessionStorage.removeItem('cs_session')
        window.localStorage.removeItem('cs_remember')
        // Signal all other tabs to logout — localStorage 'storage' event fires cross-tab
        window.localStorage.setItem('cs_logout', Date.now())
        window.localStorage.removeItem('cs_logout')
        window.dispatchEvent(new Event('auth:logout'))
        topTostError('Logged out successfully', 'success')
        navigate('/login', { replace: true })
      })
  }, [navigate])

  return (
    <div className="container py-5 text-center">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Logging out...</span>
      </div>
      <p className="mt-3">Logging out...</p>
    </div>
  )
}

export default Logout
