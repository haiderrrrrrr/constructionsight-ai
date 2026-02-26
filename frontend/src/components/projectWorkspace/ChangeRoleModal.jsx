import React, { useState, useEffect } from 'react'
import { FiMail, FiUser } from 'react-icons/fi'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiPatch } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import { SelectDropdown } from '@/components/shared/Dropdown'

const ChangeRoleModal = ({ projectId, member, onClose, onSuccess }) => {
    const [role, setRole] = useState(member?.project_role || '')
    const [loading, setLoading] = useState(false)


    const LABEL = 'fs-11 fw-semibold text-muted text-uppercase mb-1'
    const LABEL_STYLE = { letterSpacing: '0.06em' }

    // Note: PM role cannot be assigned or changed to by any PM user
    // Only admins can create/manage PM assignments at project creation
    const roleOptions = [
        { value: 'site_supervisor', label: 'Site Supervisor' },
        { value: 'safety_officer', label: 'Safety Officer' },
        { value: 'data_analyst', label: 'Data Analyst' },
        { value: 'stakeholder', label: 'Stakeholder' },
    ]

    useEffect(() => {
        setRole(member?.project_role || '')
    }, [member])

    const handleClose = () => {
        if (!loading) {
            onClose?.()
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!role) return

        setLoading(true)
        try {
            await apiPatch(`/projects/${projectId}/members/${member.user_id}`, { role })
            topTost(`Role changed to ${role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}`)
            broadcastRefresh('cs:project-members-refresh')
            onSuccess?.()
            onClose?.()
        } catch (err) {
            const msg = parseApiError(err, 'Failed to change role')
            topTostError(msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content">
                    <div className="modal-header">
                        <div>
                            <h5 className="modal-title mb-0">Change Member Role</h5>
                            <div className="fs-12 text-muted">Update the access level for this team member</div>
                        </div>
                        <button
                            type="button"
                            className="btn-close"
                            onClick={handleClose}
                            disabled={loading}
                        />
                    </div>
                    <form onSubmit={handleSubmit}>
                        <div className="modal-body">
                            <style>{`
                                .inv-error { background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.22); border-left: 3px solid #ef4444; }
                                html.app-skin-dark .inv-error { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.22); }
                                .inv-error svg { stroke:#ef4444!important;color:#ef4444!important; }
                            `}</style>

                            <div className="row g-3">
                                <div className="col-md-6">
                                    <label className={LABEL} style={LABEL_STYLE}>
                                        Member Name
                                    </label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiUser size={15} /></div>
                                        <input
                                            type="text"
                                            className="form-control"
                                            style={{ fontSize: '0.875rem' }}
                                            value={member?.full_name || ''}
                                            disabled
                                        />
                                    </div>
                                </div>

                                <div className="col-md-6">
                                    <label className={LABEL} style={LABEL_STYLE}>
                                        Email Address
                                    </label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiMail size={15} /></div>
                                        <input
                                            type="text"
                                            className="form-control"
                                            style={{ fontSize: '0.875rem' }}
                                            value={member?.email || ''}
                                            disabled
                                        />
                                    </div>
                                </div>

                                <div className="col-12">
                                    <label htmlFor="changeRole" className={LABEL} style={LABEL_STYLE}>
                                        New Project Role <span className="text-danger">*</span>
                                    </label>
                                    <SelectDropdown
                                        id="changeRole"
                                        value={role}
                                        placeholder="Select a role"
                                        options={roleOptions.map(o => ({ value: o.value, label: o.label }))}
                                        onChange={(v) => setRole(v)}
                                        disabled={loading}
                                        menuPosition="end"
                                        buttonStyle={{ fontSize: '0.875rem', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    />
                                    <small className="form-text text-danger d-block mt-2" style={{ letterSpacing: '0.02em' }}>
                                        Note: Project Manager role cannot be assigned by team members. Contact your administrator if you need to change PM assignments.
                                    </small>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-outline-secondary"
                                onClick={handleClose}
                                disabled={loading}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={loading || !role || role === member?.project_role}
                            >
                                {loading ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm me-2"></span>
                                        Updating…
                                    </>
                                ) : (
                                    'Update Role'
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}

export default ChangeRoleModal
