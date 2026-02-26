import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FiEye, FiEyeOff } from 'react-icons/fi'
import { apiPublicPost } from '../../utils/api'
import topTost from '../../utils/topTost'
import topTostError from '../../utils/topTostError'

const PASSWORD_CHECKS = [
    { re: /.{8,}/,        msg: 'at least 8 characters' },
    { re: /[A-Z]/,        msg: 'an uppercase letter' },
    { re: /[a-z]/,        msg: 'a lowercase letter' },
    { re: /\d/,           msg: 'a number' },
    { re: /[^A-Za-z0-9]/, msg: 'a special character' },
]

const SetNewPasswordForm = () => {
    const navigate = useNavigate()
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showNew, setShowNew] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const [loading, setLoading] = useState(false)
    const [resetToken, setResetToken] = useState('')
    const [strength, setStrength] = useState(0)
    const [passTouched, setPassTouched] = useState(false)

    useEffect(() => {
        const token = sessionStorage.getItem('reset_token')
        if (!token) {
            navigate('/forgot-password')
        } else {
            setResetToken(token)
        }
    }, [navigate])

    const onPasswordInput = (e) => {
        const val = e.target.value || ''
        if (!passTouched) setPassTouched(true)
        const score = PASSWORD_CHECKS.reduce((acc, c) => acc + (c.re.test(val) ? 1 : 0), 0)
        setStrength(Math.min(4, Math.max(0, score)))
    }

    const validatePassword = () => {
        if (newPassword.length < 8) {
            return 'Password must be at least 8 characters long'
        }
        if (newPassword.length > 128) {
            return 'Password must not exceed 128 characters'
        }
        if (!/[A-Z]/.test(newPassword)) {
            return 'Password must include an uppercase letter'
        }
        if (!/[a-z]/.test(newPassword)) {
            return 'Password must include a lowercase letter'
        }
        if (!/\d/.test(newPassword)) {
            return 'Password must include a number'
        }
        if (!/[^A-Za-z0-9]/.test(newPassword)) {
            return 'Password must include a special character'
        }
        if (newPassword !== confirmPassword) {
            return 'Passwords do not match'
        }
        return ''
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        const validationError = validatePassword()
        if (validationError) {
            topTostError(validationError)
            return
        }

        setLoading(true)

        try {
            await apiPublicPost('/auth/reset-password', {
                reset_token: resetToken,
                new_password: newPassword,
            })
            topTost('Password reset successfully')
            sessionStorage.removeItem('reset_email')
            sessionStorage.removeItem('reset_token')
            setTimeout(() => {
                navigate('/login')
            }, 2500)
        } catch (err) {
            const detail = err.response?.data?.detail
            if (detail?.includes('Invalid') || detail?.includes('expired')) {
                topTostError('Reset session expired. Please start again.')
            } else {
                topTostError(detail || 'Failed to reset password. Please try again.')
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'10px', fontWeight:700, letterSpacing:'1.1px', textTransform:'uppercase', padding:'5px 13px', borderRadius:'30px', background:'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color:'var(--bs-primary,#5b6abf)', border:'1px solid rgba(91,106,191,0.35)', width:'fit-content', marginBottom:'20px', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', boxShadow:'0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Reset Password</div>
            <h2 className="fw-bolder mb-2" style={{ fontSize: '24px', lineHeight: '1.2' }}>Create a new password</h2>
            <p className="fs-12 fw-medium text-muted mb-4" style={{ lineHeight: '1.6' }}>
                Set a strong password for your ConstructionSight account.
            </p>
            <form className="w-100" onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>New Password</label>
                    <div className="input-group field">
                        <input
                            type={showNew ? 'text' : 'password'}
                            className="form-control form-control-sm password"
                            id="newPassword"
                            placeholder="Create a strong password"
                            required
                            value={newPassword}
                            onChange={(e) => {
                                setNewPassword(e.target.value)
                                onPasswordInput(e)
                            }}
                            disabled={loading}
                        />
                        <div
                            className="input-group-text border-start bg-gray-2 c-pointer"
                            data-bs-toggle="tooltip"
                            title="Show/Hide Password"
                            onClick={() => setShowNew(v => !v)}
                        >
                            {showNew ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                        </div>
                    </div>
                    {passTouched && <div className="progress-bar mt-2" aria-label="Password strength">
                        {[0, 1, 2, 3].map((i) => {
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
                    <div className="input-group field">
                        <input
                            type={showConfirm ? 'text' : 'password'}
                            className="form-control form-control-sm password"
                            placeholder="Re-enter your password"
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={loading}
                        />
                        <div
                            className="input-group-text border-start bg-gray-2 c-pointer"
                            data-bs-toggle="tooltip"
                            title="Show/Hide Password"
                            onClick={() => setShowConfirm(v => !v)}
                        >
                            {showConfirm ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                        </div>
                    </div>
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
                                Resetting...
                            </>
                        ) : (
                            'Reset Password'
                        )}
                    </button>
                </div>
            </form>
            <div className="text-muted fs-12">
                <span>Remember your password? </span>
                <Link to="/login" className="fw-semibold text-primary">Sign in</Link>
            </div>
        </>
    )
}

export default SetNewPasswordForm
