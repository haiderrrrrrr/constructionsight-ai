import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiPublicPost } from '../../utils/api'
import topTost from '../../utils/topTost'
import topTostError from '../../utils/topTostError'

const ResetForm = () => {
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)

        try {
            const normalizedEmail = email.trim().toLowerCase()
            await apiPublicPost('/auth/request-password-reset', { email: normalizedEmail })
            topTost('Check your email for the verification code')
            sessionStorage.setItem('reset_email', normalizedEmail)

            setTimeout(() => {
                navigate('/verify-reset-code')
            }, 1500)
        } catch (err) {
            const detail = err.response?.data?.detail
            topTostError(detail || 'Unable to process request. Please try again.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'10px', fontWeight:700, letterSpacing:'1.1px', textTransform:'uppercase', padding:'5px 13px', borderRadius:'30px', background:'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color:'var(--bs-primary,#5b6abf)', border:'1px solid rgba(91,106,191,0.35)', width:'fit-content', marginBottom:'20px', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', boxShadow:'0 4px 14px rgba(91,106,191,0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(91,106,191,0.12)' }}>Reset Password</div>
            <h2 className="fw-bolder mb-2" style={{ fontSize: '24px', lineHeight: '1.2' }}>Forgot Password?</h2>
            <h4 className="fs-13 fw-bold mb-2">Regain access to your ConstructionSight account</h4>
            <p className="fs-12 fw-medium text-muted mb-4" style={{ lineHeight: '1.6' }}>
                Enter your email address to receive a verification code.
            </p>

            <form className="w-100" onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>Email Address</label>
                    <input
                        type="email"
                        className="form-control form-control-sm"
                        placeholder="name@company.com"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={loading}
                    />
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
                                Sending...
                            </>
                        ) : (
                            'Send Code'
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

export default ResetForm
