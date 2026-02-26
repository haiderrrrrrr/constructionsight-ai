import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiPost, apiPatch, apiUpload } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import {
    sanitizeProjectDetails,
    sanitizeProjectText,
    validatePersonName,
    validateProjectDetails,
} from '@/utils/projectValidation'
import { FiUser, FiMapPin, FiBriefcase, FiCalendar, FiMail, FiLink, FiShield, FiZap, FiCheckCircle, FiCopy, FiRefreshCw, FiArrowRight, FiGrid, FiUsers } from 'react-icons/fi'

const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
const DISPLAY_ORIGIN = FRONTEND_URL.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, 'https://constructionsightai.com');

const SectionLabel = ({ children }) => (
    <div className="d-flex align-items-center gap-2 mb-3" style={{ paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ width: 3, height: 16, borderRadius: 2, background: 'var(--bs-primary,#5b6abf)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bs-primary,#5b6abf)' }}>{children}</span>
    </div>
);

const SummaryRow = ({ icon: Icon, label, value }) => (
    <div className="d-flex align-items-center gap-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span className="d-flex align-items-center justify-content-center flex-shrink-0 rounded-2"
            style={{ width: 32, height: 32, background: 'rgba(91,106,191,0.08)', color: 'var(--bs-primary,#5b6abf)', flexShrink: 0 }}>
            <Icon size={14} strokeWidth={1.8} />
        </span>
        <span className="fs-12 text-muted" style={{ minWidth: 130, flexShrink: 0 }}>{label}</span>
        <span className="fs-13 fw-semibold text-dark">{value || <span className="text-muted fst-italic fw-normal">—</span>}</span>
    </div>
);

const formatDate = (d) => {
    if (!d) return null;
    try { return new Date(d).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }); }
    catch { return d; }
};

const projectTypeLabel = (v) =>
    v === 'project_personal' ? 'Personal Project' :
    v === 'project_team' ? 'Team Project' : null;

const projectManageLabel = (v) =>
    v === 'project_everyone' ? 'Everyone' :
    v === 'project_admins' ? 'Admins Only' :
    v === 'project_specific' ? 'Specific Members' : null;

const StatCard = ({ color, icon: Icon, value, label }) => (
    <div className={`card bg-soft-${color} border-soft-${color} text-${color} overflow-hidden h-100`} style={{ minHeight: '100px' }}>
        <div className="card-body py-3">
            <div className="d-flex align-items-center justify-content-between">
                <div>
                    <div className="fs-12 text-reset fw-normal">{label}</div>
                    <div className="fs-5 text-reset mt-1 mb-0 fw-bold">{value}</div>
                </div>
                <div className="fs-20 opacity-75"><Icon size={20} /></div>
            </div>
        </div>
    </div>
);

// admin_shell: POST /admin/projects → success panel with copy/resend actions
// pm_setup:    PATCH setup + POST activate → toast → call onActivated
const TabCompleted = ({
    formData,
    mode,
    projectId,
    onActivated,
    onCreated,
    onDetailValidationError,
    onPmValidationError,
}) => {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [created, setCreated] = useState(null); // { project, invitationToken, invitationId, invitationEmail }
    const [updated, setUpdated] = useState(false);
    const [copied, setCopied] = useState(false);
    const [resending, setResending] = useState(false);

    const getValidatedDetails = () => {
        const details = sanitizeProjectDetails(formData)
        const errors = validateProjectDetails(details)
        const firstError = Object.values(errors)[0]
        if (firstError) {
            if (onDetailValidationError) {
                onDetailValidationError(errors)
            } else {
                topTostError(firstError)
            }
            return null
        }
        return details
    }

    useEffect(() => {
        if (!created) return
        broadcastRefresh('cs:project-create:success')
        return () => broadcastRefresh('cs:project-create:reset')
    }, [created])

    const handleEditSubmit = async () => {
        setSubmitting(true);
        try {
            const details = getValidatedDetails();
            if (!details) {
                setSubmitting(false);
                return;
            }

            await apiPatch(`/admin/projects/${projectId}`, {
                name: details.name,
                location: details.location,
                description: details.description,
                client_name: details.client_name,
                ...(details.start_date && { start_date: details.start_date }),
                ...(details.end_date && { end_date: details.end_date }),
            });
            topTost("Project updated successfully!");
            setUpdated(true);
            broadcastRefresh('cs:projects-stats-refresh');
            setTimeout(() => navigate('/admin/projects/list'), 1500);
        } catch (err) {
            let msg = "Failed to update project.";
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const handleAdminSubmit = async () => {
        setSubmitting(true);
        try {
            const details = getValidatedDetails();
            if (!details) {
                setSubmitting(false);
                return;
            }

            const assignByEmail = formData.pm_assignment_type === 'email';
            const pmFullName = sanitizeProjectText(formData.pm_full_name);
            if (assignByEmail) {
                const pmNameErr = validatePersonName(pmFullName, 'PM full name');
                if (pmNameErr) {
                    if (onPmValidationError) {
                        onPmValidationError(pmNameErr);
                    } else {
                        topTostError(pmNameErr);
                    }
                    setSubmitting(false);
                    return;
                }
            }
            const payload = {
                name: details.name,
                location: details.location,
                ...(assignByEmail
                    ? { pm_email: sanitizeProjectText(formData.pm_email).toLowerCase(), pm_full_name: pmFullName }
                    : { pm_user_id: formData.pm_user_id }
                ),
                description: details.description,
                client_name: details.client_name,
                ...(details.start_date && { start_date: details.start_date }),
                ...(details.end_date && { end_date: details.end_date }),
            };
            const result = await apiPost("/admin/projects", payload);
            topTost("Project created successfully!");

            // Upload logo if selected (non-blocking)
            if (formData.logo_file) {
                try {
                    await apiUpload(`/admin/projects/${result.id}/logo`, formData.logo_file);
                } catch {
                    // Logo upload failure doesn't block project creation
                }
            }

            setCreated({
                project: result,
                invitationToken: result.invitation_token,
                invitationId: result.invitation_id,
                invitationEmail: result.invitation_email,
            });
            if (onCreated) onCreated();
        } catch (err) {
            let msg = "Failed to create project.";
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopyLink = () => {
        const url = `${FRONTEND_URL}/invite/${created.invitationToken}`;
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            topTost("Invite link copied!");
            setTimeout(() => setCopied(false), 2500);
        });
    };

    const handleResend = async () => {
        setResending(true);
        try {
            await apiPost(`/admin/projects/${created.project.id}/invitations/${created.invitationId}/resend`, {});
            topTost("Invitation email resent successfully.");
        } catch (err) {
            let msg = "Failed to resend invitation.";
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
        } finally {
            setResending(false);
        }
    };

    const handlePmActivate = async () => {
        setSubmitting(true);
        try {
            const details = getValidatedDetails();
            if (!details) {
                setSubmitting(false);
                return;
            }

            await apiPatch(`/projects/${projectId}/setup`, {
                name: details.name,
                location: details.location,
                description: details.description,
                client_name: details.client_name,
                ...(details.start_date && { start_date: details.start_date }),
                ...(details.end_date && { end_date: details.end_date }),
            });

            if (formData.logo_file) {
                try {
                    await apiUpload(`/projects/${projectId}/logo`, formData.logo_file);
                } catch {
                    // Logo upload failure doesn't block activation
                }
            }

            await apiPost(`/projects/${projectId}/activate`, {});
            topTost("Project activated successfully!");
            broadcastRefresh('cs:projects-stats-refresh');
            if (onActivated) onActivated();
        } catch (err) {
            let msg = "Failed to activate project.";
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    if (mode === "admin_shell") {
        // ── Success panel (shown after project created) ──
        if (created) {
            return (
                <section className="step-body mt-4">
                    <style>{`
                        .cs-created-title { color: rgba(2,6,23,0.86); }
                        html.app-skin-dark .cs-created-title { color: rgba(255,255,255,0.92); }
                        .cs-created-sub { color: rgba(2,6,23,0.62); }
                        html.app-skin-dark .cs-created-sub { color: rgba(255,255,255,0.70); }
                        .cs-created-invite-label { color: rgba(2,6,23,0.62); }
                        html.app-skin-dark .cs-created-invite-label { color: rgba(255,255,255,0.72); }
                        .cs-created-invite-text { color: rgba(2,6,23,0.76); }
                        html.app-skin-dark .cs-created-invite-text { color: rgba(255,255,255,0.86); }
                        .cs-created-surface { background: var(--bs-tertiary-bg, rgba(0,0,0,0.03)); border: 1px solid var(--bs-border-color); }
                        html.app-skin-dark .cs-created-surface { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); }
                        .cs-created-divider { height: 1px; background: var(--bs-border-color); }
                        html.app-skin-dark .cs-created-divider { background: rgba(255,255,255,0.10); }
                        .cs-created-icon-wrap { width:28px; height:28px; border-radius:7px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.06); border: 1px solid rgba(148,163,184,0.30); }
                        html.app-skin-dark .cs-created-icon-wrap { background:rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.10) !important; }
                        .cs-created-row-icon { transform: translateY(-1px); color: rgba(2,6,23,0.58); }
                        html.app-skin-dark .cs-created-row-icon { color: rgba(255,255,255,0.72) !important; }
                    `}</style>
                    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: '0 16px' }}>

                        {/* Icon */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, borderRadius: '50%', background: 'rgba(var(--bs-success-rgb),0.10)', border: '2px solid rgba(var(--bs-success-rgb),0.25)', marginBottom: 24 }}>
                            <FiCheckCircle size={36} style={{ color: '#10b981' }} />
                        </div>

                        {/* Heading */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '4px 14px', borderRadius: '20px', background: 'rgba(var(--bs-success-rgb),0.10)', color: 'var(--bs-success)', border: '1px solid rgba(var(--bs-success-rgb),0.25)', marginBottom: 14 }}>
                            Project Created
                        </div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '26px', lineHeight: '1.2' }}>
                            {created.project.name}
                        </h2>
                        <p className="text-muted mb-0" style={{ fontSize: '14px', lineHeight: 1.7 }}>
                            Project created and pending project manager acceptance
                        </p>

                        {/* Card */}
                        <div className="mt-4 rounded-3 text-start cs-created-surface overflow-hidden">
                            <div style={{ height: 3, background: 'linear-gradient(90deg, rgba(var(--bs-success-rgb),1) 0%, rgba(var(--bs-success-rgb),0.6) 100%)' }} />

                            {/* Invite link row */}
                            <div className="p-4 pb-3">
                                <style>{`
                                    @keyframes copy-pulse {
                                        0% { transform: scale(1); opacity: 1; }
                                        50% { transform: scale(1.15); opacity: 0.8; }
                                        100% { transform: scale(1); opacity: 1; }
                                    }
                                    .cs-copy-icon-animated {
                                        animation: copy-pulse 0.6s ease-in-out;
                                    }
                                `}</style>
                                <p className="mb-2 cs-created-invite-label" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase' }}>Invite Link</p>
                                <div className="d-flex align-items-center gap-2 px-3 py-3 rounded-3 cs-created-surface">
                                    <span className="cs-created-icon-wrap" style={{ background: 'rgba(var(--bs-primary-rgb),0.15)', border: '1px solid rgba(var(--bs-primary-rgb),0.35)', color: 'var(--bs-primary)' }}>
                                        <FiLink size={14} strokeWidth={2} style={{ color: 'var(--bs-primary)' }} />
                                    </span>
                                    <span className="cs-created-invite-text text-truncate flex-grow-1" style={{ fontSize: '13px', fontFamily: 'monospace' }}>
                                        {DISPLAY_ORIGIN}/invite/{created.invitationToken}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleCopyLink}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        {copied ? (
                                            <FiCheckCircle size={14} style={{ color: 'var(--bs-success)', flexShrink: 0 }} />
                                        ) : (
                                            <FiCopy size={14} className={copied ? 'cs-copy-icon-animated' : ''} style={{ color: 'var(--bs-primary)', flexShrink: 0 }} />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Divider */}
                            <div className="cs-created-divider" style={{ margin: '0 24px' }} />

                            <div className="px-4 py-3 d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                                <span style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 7,
                                    flexShrink: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'rgba(180, 83, 9, 0.16)',
                                    border: '1px solid rgba(180, 83, 9, 0.32)',
                                    color: '#b45309',
                                }}>
                                    <FiMail size={14} />
                                </span>
                                <span className="cs-created-sub text-truncate" style={{ fontSize: '12px', minWidth: 0 }}>
                                    Invitation email sent to <span style={{ color: '#b45309', fontWeight: 600 }}>{created.invitationEmail}</span>
                                </span>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="d-flex justify-content-center gap-3 mt-4 flex-wrap">
                            <button
                                type="button"
                                className="btn btn-danger d-inline-flex align-items-center gap-2"
                                onClick={handleResend}
                                disabled={resending}
                            >
                                <FiRefreshCw size={14} />{resending ? 'Sending...' : 'Resend Email'}
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary d-inline-flex align-items-center gap-2"
                                onClick={() => navigate('/admin/invitations/list')}
                            >
                                View Invitations <FiArrowRight size={14} />
                            </button>
                        </div>

                    </div>
                </section>
            );
        }

        // ── Review + Create panel ──
        const assignByEmail = formData.pm_assignment_type === 'email';
        const pm = formData.pm_user;
        const pmName = assignByEmail ? formData.pm_full_name : pm?.full_name;
        const pmEmail = assignByEmail ? formData.pm_email : pm?.email;
        const manageLabel = projectManageLabel(formData.projectManage);

        const DetailRow = ({ icon: Icon, label, value, isLast }) => (
            <div className={`d-flex align-items-center justify-content-between gap-3 py-3 ${isLast ? '' : 'cs-verify-info-row'}`}>
                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                    <span className="cam-icon-wrap">
                        <Icon size={13} strokeWidth={1.8} className="cs-verify-row-icon" />
                    </span>
                    <span className="fs-10 fw-bold text-muted text-uppercase" style={{ letterSpacing: '0.08em' }}>
                        {label}
                    </span>
                </div>
                <div style={{ minWidth: 0, textAlign: 'end' }}>
                    <span className="fs-12 fw-semibold cs-verify-details-value">{value || <span className="text-muted fst-italic fw-normal">—</span>}</span>
                </div>
            </div>
        );

        return (
            <section className="step-body mt-4">
                {/* Header - Keep exactly as is, outside card */}
                <div className="text-center mb-4">
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(var(--bs-primary-rgb),0.22) 0%, rgba(var(--bs-primary-rgb),0.07) 100%)', color: 'var(--bs-primary)', border: '1px solid rgba(var(--bs-primary-rgb),0.35)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)' }}>REVIEW</div>
                    <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Review Project Setup</h2>
                    <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>
                        Review the project details before creating the project
                    </p>
                </div>

                <style>{`
                    .cs-verify-info-row { border-bottom: 1px solid var(--bs-border-color); }
                    html.app-skin-dark .cs-verify-info-row { border-bottom-color: rgba(255,255,255,0.10); }
                    .cs-verify-row-icon { transform: translateY(-1px); color: rgba(2,6,23,0.58); }
                    html.app-skin-dark .cs-verify-row-icon { color: rgba(255,255,255,0.72) !important; }
                    .cam-icon-wrap { width:28px; height:28px; border-radius:7px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.06); color:rgba(2,6,23,0.78); }
                    html.app-skin-dark .cam-icon-wrap { background:rgba(255,255,255,0.08) !important; color:rgba(255,255,255,0.75) !important; }
                    .cs-verify-details-value { color: rgba(2,6,23,0.86); }
                    html.app-skin-dark .cs-verify-details-value { color: rgba(255,255,255,0.86) !important; }
                    .cs-verify-card-title { letter-spacing: 0; }
                    .cs-verify-card-sub { font-size: 0.75rem; font-weight: 400; letter-spacing: 0; line-height: 1.3; color: rgba(2,6,23,0.58); }
                    html.app-skin-dark .cs-verify-card-sub { color: rgba(255,255,255,0.62) !important; }

                    .cs-complete-details-card { border-color: rgba(148,163,184,0.45) !important; }
                    html.app-skin-dark .cs-complete-details-card { border-color: rgba(255,255,255,0.10) !important; }
                `}</style>

                <div className="card border shadow-sm mb-4 cs-complete-details-card">
                    <div className="card-header">
                        <div>
                            <div className="cs-verify-card-title h5">Project Summary</div>
                            <div className="cs-verify-card-sub">Overview of project configuration</div>
                        </div>
                    </div>
                    <div className="card-body">
                        {(() => {
                            const rows = [
                                { icon: FiBriefcase, label: 'Project Name', value: formData.name },
                                { icon: FiMapPin, label: 'Location', value: formData.location },
                                ...(formData.client_name ? [{ icon: FiBriefcase, label: 'Client Name', value: formData.client_name }] : []),
                                { icon: FiCalendar, label: 'Start Date', value: formatDate(formData.start_date) },
                                { icon: FiCalendar, label: 'End Date', value: formatDate(formData.end_date) },
                                ...(manageLabel ? [{ icon: FiShield, label: 'Access Control', value: manageLabel }] : []),
                                { icon: FiUser, label: 'Project Manager', value: pmName },
                                { icon: FiMail, label: 'Invitation Email', value: pmEmail },
                            ]
                            return rows.map((r, idx) => (
                                <DetailRow
                                    key={r.label}
                                    icon={r.icon}
                                    label={r.label}
                                    value={r.value}
                                    isLast={idx === rows.length - 1}
                                />
                            ))
                        })()}
                    </div>
                </div>

                <div className="mt-4 d-flex justify-content-center">
                    <button
                        className="btn btn-primary d-inline-flex align-items-center gap-2"
                        onClick={handleAdminSubmit}
                        disabled={submitting}
                    >
                        {submitting ? <><span className="spinner-border spinner-border-sm me-1" role="status" />Creating...</> : <><FiZap size={15} />Create Project</>}
                    </button>
                </div>
            </section>
        );
    }

    if (mode === "edit") {
        if (updated) {
            return (
                <section className="step-body mt-4">
                    <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', padding: '0 16px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 80, height: 80, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.25)', marginBottom: 24, boxShadow: '0 0 0 8px rgba(16,185,129,0.05)' }}>
                            <FiCheckCircle size={36} style={{ color: '#10b981' }} />
                        </div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '4px 14px', borderRadius: '20px', background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.25)', marginBottom: 14 }}>
                            Project Updated
                        </div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '26px', lineHeight: '1.2' }}>Changes Saved</h2>
                        <p className="text-muted mb-4" style={{ fontSize: '14px', lineHeight: 1.7 }}>
                            Project details have been updated successfully.
                        </p>
                        <button className="btn btn-primary" onClick={() => navigate('/admin/projects/list')}>
                            Return to Projects
                        </button>
                    </div>
                </section>
            );
        }

        return (
            <section className="step-body mt-4">
                <div className="text-center mb-4">
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(91,106,191,0.22) 0%, rgba(91,106,191,0.07) 100%)', color: 'var(--bs-primary,#5b6abf)', border: '1px solid rgba(91,106,191,0.35)', marginBottom: '14px' }}>Final Step</div>
                    <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Review Changes</h2>
                    <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>
                        Review the updated project details below, then click <strong>Update Project</strong>.
                    </p>
                </div>

                <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.025)', overflow: 'hidden' }}>
                    <div style={{ height: 3, background: 'linear-gradient(90deg, var(--bs-primary,#5b6abf) 0%, rgba(91,106,191,0.35) 100%)' }} />
                    <div style={{ padding: '28px 32px' }}>
                        <div className="mb-4">
                            <SectionLabel>Project Details</SectionLabel>
                            <SummaryRow icon={FiBriefcase} label="Project Name" value={formData.name} />
                            <SummaryRow icon={FiMapPin} label="Site Location" value={formData.location} />
                            <SummaryRow icon={FiBriefcase} label="Client Name" value={formData.client_name} />
                            <SummaryRow icon={FiCalendar} label="Start Date" value={formatDate(formData.start_date)} />
                        </div>
                    </div>
                </div>

                <div className="mt-4 d-flex justify-content-center">
                    <button
                        className="btn btn-primary d-inline-flex align-items-center gap-2"
                        onClick={handleEditSubmit}
                        disabled={submitting}
                    >
                        {submitting ? <><span className="spinner-border spinner-border-sm me-1" role="status" />Updating...</> : <><FiZap size={15} />Update Project</>}
                    </button>
                </div>
            </section>
        );
    }

    // pm_setup mode
    return (
        <section className="step-body mt-4 text-center">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(16,185,129,0.22) 0%, rgba(16,185,129,0.07) 100%)', color: '#10b981', border: '1px solid rgba(16,185,129,0.38)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(16,185,129,0.15), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(16,185,129,0.1)' }}>Setup Complete</div>
            <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Ready to Activate</h2>
            <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>Your setup is complete. Click <strong>Activate Project</strong> to go live.</p>
            <div className="mt-4 d-flex justify-content-center">
                <button className="btn btn-success btn-lg" onClick={handlePmActivate} disabled={submitting}>
                    {submitting ? <><span className="spinner-border spinner-border-sm me-2" role="status" />Activating...</> : "Activate Project"}
                </button>
            </div>
        </section>
    );
};

export default TabCompleted
