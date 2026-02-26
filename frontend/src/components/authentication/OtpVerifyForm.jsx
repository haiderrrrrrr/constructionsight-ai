import React, { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiPublicPost } from '../../utils/api'
import topTostError from '../../utils/topTostError'

const OtpVerifyForm = () => {
    const navigate = useNavigate()
    const [digits, setDigits] = useState(['', '', '', '', '', ''])
    const inputRefs = useRef([])
    const [loading, setLoading] = useState(false)
    const [resendCooldown, setResendCooldown] = useState(0)
    const [resendCount, setResendCount] = useState(0)
    const [email, setEmail] = useState('')

    useEffect(() => {
        const savedEmail = sessionStorage.getItem('reset_email')
        if (!savedEmail) {
            navigate('/forgot-password')
        } else {
            setEmail(savedEmail)
            // Restore resend count from sessionStorage
            const savedResendCount = sessionStorage.getItem(`reset_resend_count_${savedEmail}`)
            if (savedResendCount) {
                setResendCount(parseInt(savedResendCount, 10))
            }
            // Restore cooldown timer from sessionStorage
            const savedCooldownTimestamp = sessionStorage.getItem(`reset_cooldown_${savedEmail}`)
            if (savedCooldownTimestamp) {
                const timestamp = parseInt(savedCooldownTimestamp, 10)
                const secondsRemaining = Math.ceil((timestamp - Date.now()) / 1000)
                if (secondsRemaining > 0) {
                    setResendCooldown(secondsRemaining)
                } else {
                    sessionStorage.removeItem(`reset_cooldown_${savedEmail}`)
                }
            }
        }
    }, [navigate])

    useEffect(() => {
        if (resendCooldown > 0) {
            const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000)
            return () => clearTimeout(timer)
        }
    }, [resendCooldown])

    const maskEmail = (email) => {
        if (!email || !email.includes('@')) return email
        const [name, domain] = email.split('@')
        if (name.length <= 3) return `${name[0]}***@${domain}`
        return `${name[0]}***${name[name.length - 1]}@${domain}`
    }

    const handleDigitChange = (index, value) => {
        if (!/^\d?$/.test(value)) return
        const newDigits = [...digits]
        newDigits[index] = value
        setDigits(newDigits)

        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus()
        }
    }

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace') {
            e.preventDefault()
            if (digits[index]) {
                const newDigits = [...digits]
                newDigits[index] = ''
                setDigits(newDigits)
            } else if (index > 0) {
                inputRefs.current[index - 1]?.focus()
                const newDigits = [...digits]
                newDigits[index - 1] = ''
                setDigits(newDigits)
            }
        }
    }

    const handlePaste = (e) => {
        e.preventDefault()
        let pastedData = ''
        try {
            // Try standard clipboard API first, then fallback to older IE API
            const clipboard = e.clipboardData
            pastedData = clipboard?.getData('text') || ''
        } catch (err) {
            // Silent catch for old browsers
        }
        const digits_only = pastedData.replace(/\D/g, '').slice(0, 6)
        if (digits_only.length > 0) {
            const newDigits = digits_only.split('').concat(digits.slice(digits_only.length))
            setDigits(newDigits.slice(0, 6))
            if (digits_only.length === 6) {
                inputRefs.current[5]?.blur()
            }
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        const otp = digits.join('')
        if (otp.length !== 6) {
            topTostError('Please enter all 6 digits')
            return
        }

        setLoading(true)

        try {
            const response = await apiPublicPost('/auth/verify-password-reset-otp', {
                email,
                otp,
            })
            sessionStorage.setItem('reset_token', response.reset_token)
            // Clean up sessionStorage when successful
            sessionStorage.removeItem(`reset_resend_count_${email}`)
            sessionStorage.removeItem(`reset_cooldown_${email}`)
            navigate('/reset-password')
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Invalid code. Please try again.')
            setDigits(['', '', '', '', '', ''])
            inputRefs.current[0]?.focus()
        } finally {
            setLoading(false)
        }
    }

    const handleResend = async () => {
        if (resendCount >= 3) return
        setLoading(true)

        try {
            await apiPublicPost('/auth/request-password-reset', { email })
            const newResendCount = resendCount + 1
            setResendCount(newResendCount)
            // Persist resend count to sessionStorage
            sessionStorage.setItem(`reset_resend_count_${email}`, newResendCount.toString())
            // Persist cooldown timer (store when it expires, not just the duration)
            const cooldownExpiry = Date.now() + 60 * 1000 // 60 seconds from now
            sessionStorage.setItem(`reset_cooldown_${email}`, cooldownExpiry.toString())
            setResendCooldown(60)
        } catch (err) {
            topTostError('Failed to resend code. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'10px', fontWeight:700, letterSpacing:'1.1px', textTransform:'uppercase', padding:'5px 13px', borderRadius:'30px', background:'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color:'var(--bs-primary,#5b6abf)', border:'1px solid rgba(91,106,191,0.35)', width:'fit-content', marginBottom:'20px', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', boxShadow:'0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Verify Code</div>

            <h2 className="fw-bolder mb-2" style={{ fontSize: '24px', lineHeight: '1.2' }}>Verify your code</h2>
            <h4 className="fs-13 fw-bold mb-2">Enter the 6-digit verification code</h4>
            <p className="fs-12 fw-medium text-muted mb-4" style={{ lineHeight: '1.6' }}>
                A 6-digit verification code was sent to <strong>{maskEmail(email)}</strong>.
            </p>
            <form className="w-100" onSubmit={handleSubmit}>
                <div id="otp" className="inputs d-flex flex-row justify-content-center gap-2 mb-4">
                    {digits.map((digit, index) => (
                        <input
                            key={index}
                            ref={(el) => (inputRefs.current[index] = el)}
                            className="text-center form-control form-control-sm rounded"
                            type="text"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleDigitChange(index, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(index, e)}
                            onPaste={handlePaste}
                            disabled={loading}
                            style={{ width: '48px' }}
                        />
                    ))}
                </div>
                <div className="mb-4">
                    <button
                        type="submit"
                        className="btn btn-lg btn-primary w-100 fw-semibold text-uppercase"
                        style={{ letterSpacing: '0.08em' }}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                Verifying...
                            </>
                        ) : (
                            'Verify Code'
                        )}
                    </button>
                </div>
                <div className="text-muted fs-12">
                    <span>Didn’t receive the code? </span>
                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={resendCooldown > 0 || resendCount >= 3 || loading}
                        style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: resendCooldown > 0 || resendCount >= 3 ? 'not-allowed' : 'pointer',
                            color: resendCooldown > 0 || resendCount >= 3 ? '#6c757d' : 'var(--bs-primary)',
                        }}
                        className="fw-bold"
                    >
                        {resendCooldown > 0
                            ? `Resend code (${resendCooldown}s)`
                            : resendCount >= 3
                            ? 'Maximum resend attempts reached'
                            : `Resend code (${resendCount}/3)`}
                    </button>
                </div>
            </form>
            <div className="mt-3">
                <Link
                    to="/forgot-password"
                    className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-2"
                    style={{
                        borderColor: 'rgba(var(--bs-secondary-rgb), 0.28)',
                        color: 'var(--bs-secondary-color)',
                        background: 'rgba(var(--bs-secondary-rgb), 0.06)',
                    }}
                >
                    <span aria-hidden="true">←</span>
                    Back to Reset
                </Link>
            </div>
        </>
    )
}

export default OtpVerifyForm
