import React, { useEffect, useRef, useState } from 'react'
import { FiEye, FiEyeOff, FiShuffle, FiMail, FiLock } from 'react-icons/fi'
import { FcGoogle } from 'react-icons/fc'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import { apiGet, apiPost } from '@/utils/api'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'

const UNAME_RE = /^[a-z][a-z0-9_.-]{2,29}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const FULLNAME_RE = /^[A-Za-z][A-Za-z\s'\-.]{1,99}$/

const PASSWORD_CHECKS = [
    { re: /.{8,}/,        msg: 'at least 8 characters' },
    { re: /[A-Z]/,        msg: 'an uppercase letter' },
    { re: /[a-z]/,        msg: 'a lowercase letter' },
    { re: /\d/,           msg: 'a number' },
    { re: /[^A-Za-z0-9]/, msg: 'a special character' },
]

const RegisterForm = ({ path }) => {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [strength, setStrength] = useState(0)
    const [passTouched, setPassTouched] = useState(false)
    const [showPass, setShowPass] = useState(false)
    const [loading, setLoading] = useState(false)
    const [inviteEmail, setInviteEmail] = useState(null) // locked email from invite

    const inviteToken = searchParams.get('invite_token')

    const nameRef = useRef(null)
    const emailRef = useRef(null)
    const userRef = useRef(null)
    const passRef = useRef(null)
    const pass2Ref = useRef(null)

    useEffect(() => {
        if (!inviteToken) return
        apiGet(`/invite/${inviteToken}`)
            .then(data => {
                if (data.invited_email) {
                    setInviteEmail(data.invited_email)
                    if (emailRef.current) emailRef.current.value = data.invited_email
                }
            })
            .catch(() => { /* silently ignore — form still usable */ })
    }, [inviteToken])

    const handleGoogleRegister = useGoogleLogin({
        flow: 'auth-code',
        onSuccess: async (codeResponse) => {
            setLoading(true)
            try {
                const data = await apiPost('/auth/google', { code: codeResponse.code, invite_token: inviteToken || undefined }, { retryOn401: false })
                window.sessionStorage.setItem('access_token', data.access_token)
                window.sessionStorage.setItem('cs_session', '1')
                window.localStorage.removeItem('cs_remember')
                topTost('Account ready! Welcome to ConstructionSight.')
                navigate('/')
            } catch (err) {
                const msg = parseApiError(err)
                topTostError(msg || 'Google sign up failed. Please try again.')
            } finally {
                setLoading(false)
            }
        },
        onError: () => topTostError('Google sign up was cancelled or failed.'),
    })

    const onSubmit = async (e) => {
        e.preventDefault()
        if (loading) return

        const full_name = (nameRef.current?.value || '').trim()
        const email = (emailRef.current?.value || '').trim().toLowerCase()
        const username = (userRef.current?.value || '').trim().toLowerCase()
        const password = passRef.current?.value || ''
        const password2 = pass2Ref.current?.value || ''

        // — Full name —
        if (!full_name) {
            topTostError('Full name is required')
            return
        }
        if (full_name.length < 2 || full_name.length > 100) {
            topTostError('Full name must be 2–100 characters long')
            return
        }
        if (!FULLNAME_RE.test(full_name)) {
            topTostError('Full name contains invalid characters')
            return
        }

        // — Email —
        if (!email) {
            topTostError('Work email is required')
            return
        }
        if (!EMAIL_RE.test(email)) {
            topTostError('Please enter a valid email address')
            return
        }
        if (inviteEmail && email !== inviteEmail.toLowerCase()) {
            topTostError('You must register with the invited email address.')
            return
        }

        // — Username —
        if (!username) {
            topTostError('Username is required')
            return
        }
        if (!UNAME_RE.test(username)) {
            topTostError('Username must be 3–30 chars, start with a letter, and use only letters, digits, _ . -')
            return
        }

        // — Password policy —
        if (!password) {
            topTostError('Password is required')
            return
        }
        const failedCheck = PASSWORD_CHECKS.find(c => !c.re.test(password))
        if (failedCheck) {
            topTostError(`Password must include ${failedCheck.msg}`)
            return
        }
        if (password !== password.trim()) {
            topTostError('Password must not start or end with spaces')
            return
        }

        // — Confirm password —
        if (!password2) {
            topTostError('Please confirm your password')
            return
        }
        if (password !== password2) {
            topTostError('Passwords do not match')
            return
        }

        setLoading(true)
        try {
            await apiPost('/auth/signup', { full_name, email, username, password, invite_token: inviteToken || undefined })
            topTost('Account created successfully')
            // If from invite, redirect to login with next= so they complete the invite flow
            navigate(inviteToken ? `/login?next=/invite/${inviteToken}` : path)
        } catch (err) {
            const msg = parseApiError(err)
            const lower = msg.toLowerCase()
            if (lower.includes('email already registered')) {
                topTostError('This email is already registered. Try signing in or use a different email.')
            } else if (lower.includes('username already taken')) {
                topTostError('That username is already taken. Please choose another.')
            } else if (lower.includes('full name') || lower.includes('username') || lower.includes('password')) {
                topTostError(msg)
            } else {
                topTostError(msg || 'Registration failed. Please try again.')
            }
        } finally {
            setLoading(false)
        }
    }

    const onPasswordInput = (e) => {
        const val = e.target.value || ''
        if (!passTouched) setPassTouched(true)
        const score = PASSWORD_CHECKS.reduce((acc, c) => acc + (c.re.test(val) ? 1 : 0), 0)
        setStrength(Math.min(4, Math.max(0, score)))
    }

    const generatePassword = () => {
        const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        const lower = 'abcdefghijklmnopqrstuvwxyz'
        const digits = '0123456789'
        const specials = '!@#$%^&*()-_=+[]{};:,./?'
        const all = upper + lower + digits + specials
        const len = 12
        function pick(str) { return str[Math.floor(Math.random() * str.length)] }
        let pwd = pick(upper) + pick(lower) + pick(digits) + pick(specials)
        for (let i = pwd.length; i < len; i++) pwd += pick(all)
        pwd = pwd.split('').sort(() => Math.random() - 0.5).join('')
        if (passRef.current) passRef.current.value = pwd
        if (pass2Ref.current) pass2Ref.current.value = pwd
        const score = PASSWORD_CHECKS.reduce((acc, c) => acc + (c.re.test(pwd) ? 1 : 0), 0)
        setPassTouched(true)
        setStrength(Math.min(4, Math.max(0, score)))
    }

    return (
        <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'10px', fontWeight:700, letterSpacing:'1.1px', textTransform:'uppercase', padding:'5px 13px', borderRadius:'30px', background:'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color:'var(--bs-primary,#5b6abf)', border:'1px solid rgba(91,106,191,0.35)', width:'fit-content', marginBottom:'20px', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', boxShadow:'0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Get Started</div>
            <h2 className="fw-bolder mb-2" style={{ fontSize: '24px', lineHeight: '1.2' }}>Create Account</h2>
            <h4 className="fs-13 fw-bold mb-2">AI-Powered Construction Intelligence</h4>
            <p className="fs-12 fw-medium text-muted mb-4" style={{ lineHeight: '1.6' }}>
                Create your ConstructionSight account to access real-time site visibility including PPE compliance, zone activity analytics, risk alerts and automated reports
            </p>
            <form className="w-100" onSubmit={onSubmit}>
                <div className="mb-3">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Full Name</label>
                    <input ref={nameRef} type="text" className="form-control form-control-sm" placeholder="Enter your full name" required disabled={loading} />
                </div>
                <div className="mb-3">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Work Email</label>
                    <input
                        ref={emailRef}
                        type="email"
                        className="form-control form-control-sm"
                        placeholder="name@company.com"
                        required
                        disabled={loading}
                        readOnly={!!inviteEmail}
                        style={inviteEmail ? { background: 'var(--bs-tertiary-bg, rgba(0,0,0,0.04))', cursor: 'not-allowed' } : undefined}
                    />
                    {inviteEmail && (
                        <>
                        <style>{`
                            html.app-skin-dark .invite-email-hint { color: var(--bs-success) !important; }
                            html.app-skin-dark .invite-email-icon { color: var(--bs-success) !important; }
                            html.app-skin-dark .invite-email-box { background: rgba(var(--bs-success-rgb), 0.10) !important; border-color: rgba(var(--bs-success-rgb), 0.35) !important; }
                        `}</style>
                        <div className="invite-email-box" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '6px 10px', borderRadius: 6, background: 'rgba(var(--bs-success-rgb), 0.10)', border: '1px solid rgba(var(--bs-success-rgb), 0.35)' }}>
                            <FiMail size={18} className="invite-email-icon" style={{ color: 'var(--bs-success)', flexShrink: 0 }} />
                            <span className="invite-email-hint" style={{ fontSize: 11, color: 'var(--bs-success)', lineHeight: 1.5, fontWeight: 600 }}>
                                Your account must be created with the invited email
                            </span>
                        </div>
                        </>
                    )}
                </div>
                <div className="mb-3">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Username</label>
                    <input ref={userRef} type="text" className="form-control form-control-sm" placeholder="Choose a username" required disabled={loading} />
                </div>
                <div className="mb-3 generate-pass">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Password</label>
                    <div className="input-group field">
                        <input ref={passRef} type={showPass ? 'text' : 'password'} className="form-control form-control-sm password" id="newPassword" placeholder="Create a strong password" onInput={onPasswordInput} disabled={loading} />
                        <div className="input-group-text c-pointer gen-pass" data-bs-toggle="tooltip" title="Generate Password" onClick={generatePassword}><FiShuffle size={16}/></div>
                        <div className="input-group-text border-start bg-gray-2 c-pointer" data-bs-toggle="tooltip" title="Show/Hide Password" onClick={() => setShowPass(v => !v)}>{showPass ? <FiEyeOff size={16}/> : <FiEye size={16}/>}</div>
                    </div>
                    {passTouched && <div className="progress-bar mt-2" aria-label="Password strength">
                        {[0,1,2,3].map((i) => {
                            let color = 'var(--bs-gray-400)'
                            if (strength > 0 && i === 0) color = '#dc3545'
                            if (strength > 1 && i === 1) color = '#fd7e14'
                            if (strength > 2 && i === 2) color = '#ffc107'
                            if (strength > 3 && i === 3) color = '#28a745'
                            return (
                                <div key={i} style={{
                                    height: '4px',
                                    flex: 1,
                                    marginRight: i !== 3 ? '6px' : 0,
                                    borderRadius: '2px',
                                    transition: 'background-color 200ms ease',
                                    backgroundColor: color
                                }} />
                            )
                        })}
                    </div>}
                </div>
                <div className="mb-4">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Confirm Password</label>
                    <input ref={pass2Ref} type={showPass ? 'text' : 'password'} className="form-control form-control-sm" placeholder="Re-enter your password" required disabled={loading} />
                </div>
                <div className="mb-4">
                    <div className="custom-control custom-checkbox mb-2">
                        <input type="checkbox" className="custom-control-input" id="receiveMial" disabled={loading} />
                        <label className="custom-control-label c-pointer text-muted fs-12" htmlFor="receiveMial">
                            Send me product updates and safety insights
                        </label>
                    </div>
                    <div className="custom-control custom-checkbox">
                        <input type="checkbox" className="custom-control-input" id="termsCondition" required disabled={loading} />
                        <label className="custom-control-label c-pointer text-muted fs-12" htmlFor="termsCondition">
                            I agree to the <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>
                        </label>
                    </div>
                </div>
                <button type="submit" className="btn btn-lg btn-primary w-100 fw-semibold text-uppercase" style={{ letterSpacing: '0.08em' }} disabled={loading}>
                    {loading ? 'Creating account…' : 'Create Account'}
                </button>
            </form>
            <div className="w-100 mt-4 text-center mx-auto">
                <div className="d-flex align-items-center gap-3 my-4">
                    <hr className="flex-fill m-0" />
                    <span className="fs-11 fw-semibold text-uppercase text-muted" style={{ letterSpacing: '0.08em' }}>or</span>
                    <hr className="flex-fill m-0" />
                </div>
                <a href="#" className="btn btn-light-brand w-100" data-bs-toggle="tooltip" data-bs-trigger="hover" title="Sign up with Google"
                    onClick={(e) => { e.preventDefault(); handleGoogleRegister() }}>
                    <FcGoogle size={16} className="me-2" />Continue with Google
                </a>
            </div>
            <div className="mt-4 text-muted fs-12">
                <span>Already have an account? </span>
                <Link to={path} className="fw-semibold text-primary">Sign in</Link>
            </div>
        </>
    )
}

export default RegisterForm
