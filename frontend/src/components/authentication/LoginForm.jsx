import React, { useRef, useState } from 'react'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import { FcGoogle } from 'react-icons/fc'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import { apiPost, getPlatformRole, broadcastLogin } from '@/utils/api'
import { parseApiError } from '@/utils/errorHandler'
import topTostError from '@/utils/topTostError'
import topTost from '@/utils/topTost'

function redirectAfterLogin(navigate, next) {
    if (next && next.startsWith('/')) {
        navigate(next, { replace: true })
        return
    }
    const role = getPlatformRole()
    navigate(role === 'admin' ? '/admin/dashboards/analytics' : '/projects/my', { replace: true })
}

function extractInviteTokenFromNext(next) {
    if (!next || typeof next !== 'string') return null
    if (!next.startsWith('/invite/')) return null
    const token = next.split('/invite/')[1] || ''
    const cleaned = token.split('?')[0].split('#')[0].trim()
    return cleaned || null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{2,29}$/

const LoginForm = ({ registerPath, resetPath }) => {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const nextParam = searchParams.get('next')
    const inviteTokenFromNext = extractInviteTokenFromNext(nextParam)
    const userRef = useRef(null)
    const passRef = useRef(null)
    const rememberRef = useRef(null)
    const [loading, setLoading] = useState(false)
    const [showPass, setShowPass] = useState(false)

    const handleGoogleLogin = useGoogleLogin({
        flow: 'auth-code',
        onSuccess: async (codeResponse) => {
            setLoading(true)
            try {
                const data = await apiPost('/auth/google', { code: codeResponse.code, invite_token: inviteTokenFromNext || undefined }, { retryOn401: false })
                window.sessionStorage.setItem('access_token', data.access_token)
                window.sessionStorage.setItem('cs_session', '1')
                window.localStorage.removeItem('cs_remember')
                broadcastLogin(data.access_token)
                if (!inviteTokenFromNext) topTost('Signed in successfully')
                redirectAfterLogin(navigate, nextParam)
            } catch (err) {
                const msg = parseApiError(err)
                topTostError(msg || 'Google sign in failed. Please try again.')
            } finally {
                setLoading(false)
            }
        },
        onError: () => topTostError('Google sign in was cancelled or failed.'),
    })

    const onSubmit = async (e) => {
        e.preventDefault()
        if (loading) return

        const identifier = (userRef.current?.value || '').trim()
        const password = (passRef.current?.value || '')

        // — Client-side validation —
        if (!identifier) {
            topTostError('Please enter your email or username')
            return
        }
        if (!password) {
            topTostError('Please enter your password')
            return
        }
        const isEmail = identifier.includes('@')
        if (isEmail && !EMAIL_RE.test(identifier)) {
            topTostError('Please enter a valid email address')
            return
        }
        if (!isEmail && !USERNAME_RE.test(identifier)) {
            topTostError('Please enter a valid username (3–30 chars, starts with a letter)')
            return
        }

        const remember = !!rememberRef.current?.checked
        setLoading(true)
        try {
            const data = await apiPost('/auth/login', { identifier, password, remember }, { retryOn401: false })
            window.sessionStorage.setItem('access_token', data.access_token)
            // Session nonce: lets Landing know this is an active browser session.
            // Without this, closing + reopening the browser (no remember me) goes to /signup.
            window.sessionStorage.setItem('cs_session', '1')
            if (remember) {
                window.localStorage.setItem('cs_remember', '1')
            } else {
                window.localStorage.removeItem('cs_remember')
            }
            broadcastLogin(data.access_token)
            if (!inviteTokenFromNext) topTost('Signed in successfully')
            redirectAfterLogin(navigate, nextParam)
        } catch (err) {
            const msg = parseApiError(err)
            const lower = msg.toLowerCase()
            if (lower.includes('account disabled')) {
                topTostError('Account disabled. Contact support.')
            } else if (lower.includes('locked')) {
                topTostError('Account locked. Too many failed attempts. Try again in a few minutes.')
            } else if (lower.includes('too many') || lower.includes('rate')) {
                topTostError('Too many attempts. Please wait before trying again.')
            } else if (lower.includes('invalid credentials') || lower.includes('unauthorized') || lower.includes('invalid') || lower.includes('401')) {
                topTostError('Incorrect email/username or password.')
            } else {
                topTostError(msg || 'Sign in failed. Please try again.')
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'10px', fontWeight:700, letterSpacing:'1.1px', textTransform:'uppercase', padding:'5px 13px', borderRadius:'30px', background:'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color:'var(--bs-primary,#5b6abf)', border:'1px solid rgba(91,106,191,0.35)', width:'fit-content', marginBottom:'20px', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', boxShadow:'0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Welcome Back</div>
            <h2 className="fw-bolder mb-2" style={{ fontSize: '24px', lineHeight: '1.2' }}>Sign In</h2>
            <h4 className="fs-13 fw-bold mb-2">Access your ConstructionSight workspace</h4>
            <p className="fs-12 fw-medium text-muted mb-4" style={{ lineHeight: '1.6' }}>
                Sign in to monitor site safety, analyze activity insights and manage your ConstructionSight dashboard securely.
            </p>
            <form className="w-100" onSubmit={onSubmit}>
                <div className="mb-3">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Email or Username</label>
                    <input ref={userRef} type="text" className="form-control form-control-sm" placeholder="name@company.com or username" required disabled={loading} />
                </div>
                <div className="mb-3">
                    <div className="d-flex align-items-center justify-content-between mb-1">
                        <label className="fs-11 fw-semibold text-muted text-uppercase m-0" style={{ letterSpacing: '0.06em' }}>Password</label>
                        <Link to={resetPath} className="fs-11 text-primary">Forgot password?</Link>
                    </div>
                    <div className="input-group">
                        <input ref={passRef} type={showPass ? 'text' : 'password'} className="form-control form-control-sm" placeholder="Enter your password" required disabled={loading} />
                        <div className="input-group-text border-start bg-gray-2 c-pointer" data-bs-toggle="tooltip" title="Show/Hide Password" onClick={() => setShowPass(v => !v)}>
                            {showPass ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                        </div>
                    </div>
                </div>
                <div className="mb-4">
                    <div className="form-check">
                        <input ref={rememberRef} type="checkbox" className="form-check-input" id="rememberMe" disabled={loading} style={{ position: 'relative', top: 1 }} />
                        <label className="form-check-label c-pointer fs-12 text-muted" htmlFor="rememberMe">Remember this device</label>
                    </div>
                </div>
                <button type="submit" className="btn btn-lg btn-primary w-100 fw-semibold text-uppercase" style={{ letterSpacing: '0.08em' }} disabled={loading}>
                    {loading ? 'Signing in…' : 'Sign In'}
                </button>
            </form>
            <div className="w-100 mt-4 text-center mx-auto">
                <div className="d-flex align-items-center gap-3 my-4">
                    <hr className="flex-fill m-0" />
                    <span className="fs-11 fw-semibold text-uppercase text-muted" style={{ letterSpacing: '0.08em' }}>or</span>
                    <hr className="flex-fill m-0" />
                </div>
                <a href="#" className="btn btn-light-brand w-100" title="Sign in with Google"
                    onClick={(e) => { e.preventDefault(); handleGoogleLogin() }}>
                    <FcGoogle size={16} className="me-2" />Continue with Google
                </a>
            </div>
            <div className="mt-4 text-muted fs-12">
                <span>Don't have an account? </span>
                <Link to={registerPath} className="fw-semibold text-primary">Create an account</Link>
            </div>
        </>
    )
}

export default LoginForm
