import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FiMail, FiShield, FiUser } from 'react-icons/fi'
import { SelectDropdown } from '@/components/shared/Dropdown'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiPost } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'

const InviteMemberModal = ({ projectId: propProjectId }) => {
    const { projectId: paramProjectId } = useParams()
    const projectId = propProjectId || parseInt(paramProjectId, 10)

    const [isOpen, setIsOpen] = useState(false)
    const [email, setEmail] = useState('')
    const [fullName, setFullName] = useState('')
    const [role, setRole] = useState('site_supervisor')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState(null)

    const LABEL = 'fs-11 fw-semibold text-muted text-uppercase mb-1'
    const LABEL_STYLE = { letterSpacing: '0.06em' }

    const roleOptions = [
        { value: 'site_supervisor', label: 'Site Supervisor' },
        { value: 'safety_officer', label: 'Safety Officer' },
        { value: 'data_analyst', label: 'Data Analyst' },
        { value: 'stakeholder', label: 'Stakeholder' },
    ]

    useEffect(() => {
        const handler = () => setIsOpen(true)
        window.addEventListener('cs:open-invite-modal', handler)
        return () => window.removeEventListener('cs:open-invite-modal', handler)
    }, [])

    const handleClose = () => {
        if (!isLoading) {
            setIsOpen(false)
            setEmail('')
            setFullName('')
            setRole('site_supervisor')
            setError(null)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)

        if (!email.trim()) {
            setError('Email is required')
            return
        }

        setIsLoading(true)
        try {
            await apiPost(`/projects/${projectId}/members/invite`, {
                email: email.trim().toLowerCase(),
                role,
                full_name: fullName.trim() || undefined,
                send_email: true,
            })
            topTost(`Invitation sent to ${email}`)
            handleClose()
            broadcastRefresh('cs:project-invitations-refresh')
        } catch (err) {
            const errorMsg = parseApiError(err, 'Failed to send invitation')
            setError(errorMsg)
            topTostError(errorMsg)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '16px' }}>
            <div className="modal-dialog modal-dialog-centered modal-lg" style={{ margin: '0 auto' }}>
                <div className="modal-content">
                    <div className="modal-header">
                        <div>
                            <h5 className="modal-title mb-0">Invite Member</h5>
                            <div className="fs-12 text-muted">Send an invitation and assign access to this project</div>
                        </div>
                        <button
                            type="button"
                            className="btn-close"
                            onClick={handleClose}
                            disabled={isLoading}
                        ></button>
                    </div>
                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            <style>{`
                                .inv-error { background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.22); border-left: 3px solid #ef4444; }
                                html.app-skin-dark .inv-error { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.22); }
                                .inv-error svg { stroke:#ef4444!important;color:#ef4444!important; }
                            `}</style>
                            {error && (
                                <div className="inv-error d-flex align-items-start gap-2 px-3 py-2 rounded-2 mb-3">
                                    <FiShield size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{error}</span>
                                </div>
                            )}

                            <div className="row g-3">
                                <div className="col-12">
                                    <label htmlFor="inviteRole" className={LABEL} style={LABEL_STYLE}>
                                        Project Role <span className="text-danger">*</span>
                                    </label>
                                    <SelectDropdown
                                        id="inviteRole"
                                        value={role}
                                        options={roleOptions}
                                        onChange={(v) => setRole(v)}
                                        disabled={isLoading}
                                        fullWidth={true}
                                        showCaret={true}
                                        buttonStyle={{ fontSize: '0.875rem' }}
                                    />
                                </div>

                                <div className="col-md-6">
                                    <label htmlFor="inviteEmail" className={LABEL} style={LABEL_STYLE}>
                                        Email Address <span className="text-danger">*</span>
                                    </label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiMail size={15} /></div>
                                        <input
                                            id="inviteEmail"
                                            type="email"
                                            className="form-control"
                                            placeholder="Enter email address"
                                            style={{ fontSize: '0.875rem' }}
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            disabled={isLoading}
                                            required
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>

                                <div className="col-md-6">
                                    <label htmlFor="inviteFullName" className={LABEL} style={LABEL_STYLE}>
                                        Full Name
                                    </label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiUser size={15} /></div>
                                        <input
                                            id="inviteFullName"
                                            type="text"
                                            className="form-control"
                                            placeholder="Enter full name"
                                            style={{ fontSize: '0.875rem' }}
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                            disabled={isLoading}
                                            autoComplete="off"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-lg btn-outline-secondary fw-semibold text-uppercase"
                                onClick={handleClose}
                                disabled={isLoading}
                                style={{ letterSpacing: '0.08em' }}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-lg btn-primary fw-semibold text-uppercase"
                                disabled={isLoading}
                                style={{ letterSpacing: '0.08em' }}
                            >
                                {isLoading ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm me-2"></span>
                                        Sending…
                                    </>
                                ) : (
                                    'Send Invitation'
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}

export default InviteMemberModal
