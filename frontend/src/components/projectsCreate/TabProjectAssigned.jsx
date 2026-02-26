import React, { useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'
import { validatePersonName } from '@/utils/projectValidation'
import {
    FiSearch, FiCheck, FiAlertCircle,
    FiHardDrive, FiShield, FiBarChart2, FiEye, FiStar,
    FiMail, FiSend, FiUsers, FiUserPlus, FiUser, FiArrowRight, FiX,
} from 'react-icons/fi'

// admin_shell mode: PM user card selector
// pm_setup mode: invite team members by email + role
const TabProjectAssigned = ({ formData, setFormData, mode, projectId, pmError, setPmError }) => {
    if (mode === "admin_shell") {
        return <AdminPMSelector formData={formData} setFormData={setFormData} pmError={pmError} setPmError={setPmError} />;
    }
    return <TeamInvitePanel projectId={projectId} />;
};

export default TabProjectAssigned;

// --- Helpers ---

const initials = (name = '') =>
    name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';

const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];
const avatarColor = (id) => AVATAR_COLORS[id % AVATAR_COLORS.length];

// --- Admin Shell: PM Selector (dual mode: existing user OR invite by email) ---

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AdminPMSelector = ({ formData, setFormData, pmError, setPmError }) => {
    const assignType = formData.pm_assignment_type || 'existing';
    const setAssignType = (t) => {
        // clear the other mode's data when switching
        if (t === 'existing') {
            setFormData(prev => ({ ...prev, pm_assignment_type: 'existing', pm_email: '', pm_full_name: '' }));
        } else {
            setFormData(prev => ({ ...prev, pm_assignment_type: 'email', pm_user_id: null, pm_user: null }));
        }
        if (setPmError) setPmError(null);
    };

    return (
        <section className="step-body mt-4 body current">
            <style>{`.pm-error svg{stroke:#ef4444!important;color:#ef4444!important;}`}</style>
            <form id="project-assigned">
                <fieldset>
                    <div className="mb-5 text-center">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(var(--bs-primary-rgb),0.22) 0%, rgba(var(--bs-primary-rgb),0.07) 100%)', color: 'var(--bs-primary)', border: '1px solid rgba(var(--bs-primary-rgb),0.35)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)' }}>Assignment</div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Assign Project Manager</h2>
                        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>The project manager will receive an invitation and must accept it before project setup can begin</p>
                    </div>

                    {/* Mode toggle — centered */}
                    <div className="d-flex justify-content-center mb-4">
                        <div
                            className="cs-pm-toggle d-flex gap-2 p-1 rounded-3"
                            style={{
                                background: 'rgba(var(--bs-primary-rgb), 0.04)',
                                border: '1px solid var(--bs-border-color, rgba(0,0,0,0.10))',
                            }}
                        >
                            <button
                                type="button"
                                className="btn btn-sm d-inline-flex align-items-center gap-2"
                                style={{
                                    borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, padding: '7px 18px',
                                    background: assignType === 'existing' ? 'var(--bs-primary)' : 'transparent',
                                    color: assignType === 'existing' ? '#fff' : 'var(--bs-secondary-color,#6c757d)',
                                    border: 'none', transition: 'all 0.15s',
                                    boxShadow: 'none',
                                }}
                                onClick={() => setAssignType('existing')}
                            >
                                <FiUsers size={13} /> Select Existing User
                            </button>
                            <button
                                type="button"
                                className="btn btn-sm d-inline-flex align-items-center gap-2"
                                style={{
                                    borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, padding: '7px 18px',
                                    background: assignType === 'email' ? 'var(--bs-primary)' : 'transparent',
                                    color: assignType === 'email' ? '#fff' : 'var(--bs-secondary-color,#6c757d)',
                                    border: 'none', transition: 'all 0.15s',
                                    boxShadow: 'none',
                                }}
                                onClick={() => setAssignType('email')}
                            >
                                <FiUserPlus size={13} /> Invite by Email
                            </button>
                        </div>
                    </div>

                    {/* Content panel */}
                    <div style={{ maxWidth: 540, margin: '0 auto' }}>
                        {assignType === 'existing'
                            ? <ExistingUserPicker formData={formData} setFormData={setFormData} pmError={pmError} setPmError={setPmError} />
                            : <EmailInviteForm formData={formData} setFormData={setFormData} pmError={pmError} setPmError={setPmError} />
                        }
                    </div>
                </fieldset>
            </form>
        </section>
    );
};

// Select from registered users
const ExistingUserPicker = ({ formData, setFormData, pmError, setPmError }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(null);
    const [search, setSearch] = useState('');
    const [hoveredId, setHoveredId] = useState(null);

    const loadUsers = () => {
        setLoading(true);
        setFetchError(null);
        apiGet("/admin/projects/users/list")
            .then(data => setUsers(data))
            .catch(() => setFetchError("Failed to load users."))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadUsers();
        // Auto-refresh when a user is approved/unapproved in another tab or this tab
        const unsub = onBroadcast('cs:users-stats-refresh', loadUsers)
        window.addEventListener('cs:users-stats-refresh', loadUsers)
        return () => {
            unsub()
            window.removeEventListener('cs:users-stats-refresh', loadUsers)
        }
    }, []);

    const filtered = users.filter(u =>
        !search ||
        u.full_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    );

    const selectedId = formData.pm_user_id;

    if (loading) return (
        <div className="d-flex align-items-center gap-2 text-muted py-3">
            <div className="spinner-border spinner-border-sm" role="status"></div>
            <span className="small">Loading users...</span>
        </div>
    );
    if (fetchError) return (
        <div className="alert alert-danger small d-flex align-items-center justify-content-between">
            <span>{fetchError}</span>
            <button className="btn btn-sm btn-outline-danger ms-2" onClick={loadUsers}>Retry</button>
        </div>
    );

    return (
        <>
            {users.length > 5 && (
                <div className="input-group mb-4">
                    <div className="input-group-text"><FiSearch size={14} /></div>
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Search users"
                        style={{ fontSize: '0.875rem' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            )}

            <div style={{ maxHeight: 340, overflowY: 'auto', paddingRight: 4 }}>
                {filtered.length === 0 && (
                    <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: 180 }}>
                        <div
                            className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                            style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                        >
                            <FiSearch size={18} />
                        </div>
                        <h6 className="fw-bold fs-16 mb-1">
                            No users found
                        </h6>
                        <div className="fs-13 text-muted mt-1">
                            {String(search || '').trim()
                                ? 'Try a different search term'
                                : 'No users found.'}
                        </div>
                    </div>
                )}
                {filtered.map(u => {
                    const isSelected = selectedId === u.id;
                    const isHovered = hoveredId === u.id && !isSelected;
                    return (
                        <div
                            key={u.id}
                            className="cs-pm-usercard d-flex flex-row justify-content-between align-items-center px-4 py-4 mb-3 rounded-3"
                            style={{
                                cursor: 'pointer',
                                border: isSelected ? '1.5px solid #10b981' : '1.5px solid var(--bs-border-color, rgba(0,0,0,0.10))',
                                borderLeft: isSelected ? '4px solid #10b981' : '1.5px solid var(--bs-border-color, rgba(0,0,0,0.10))',
                                background: isSelected ? 'rgba(16,185,129,0.07)' : isHovered ? 'rgba(var(--bs-primary-rgb), 0.04)' : 'transparent',
                                boxShadow: isHovered ? '0 10px 30px rgba(0,0,0,0.06)' : 'none',
                                transition: 'all 0.15s ease',
                            }}
                            onClick={() => {
                                if (isSelected) {
                                    setFormData(prev => ({ ...prev, pm_user_id: null, pm_user: null }))
                                } else {
                                    setFormData(prev => ({ ...prev, pm_user_id: u.id, pm_user: u }))
                                }
                                if (setPmError) setPmError(null)
                            }}
                            onMouseEnter={() => setHoveredId(u.id)}
                            onMouseLeave={() => setHoveredId(null)}
                        >
                            <span className="hstack gap-3">
                                <span
                                    className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                                    style={{
                                        width: 42, height: 42, fontSize: 13, fontWeight: 700,
                                        background: avatarColor(u.id), color: '#fff',
                                        boxShadow: isSelected ? '0 0 0 3px rgba(16,185,129,0.25)' : 'none',
                                        transition: 'box-shadow 0.15s ease',
                                    }}
                                >
                                    {initials(u.full_name)}
                                </span>
                                <span>
                                    <span className="cs-pm-user-name d-block fs-13 fw-bold">{u.full_name}</span>
                                    <span className="d-block text-muted mb-0" style={{ fontSize: '0.78rem' }}>{u.email}</span>
                                </span>
                            </span>
                            <span style={{ width: 24 }} />
                        </div>
                    );
                })}
            </div>

            {pmError && (
                <div className="pm-error d-flex align-items-center gap-2 mt-3 px-3 py-2 rounded-2"
                    style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', borderLeft: '3px solid #ef4444' }}>
                    <FiAlertCircle size={14} color="#ef4444" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>{pmError}</span>
                </div>
            )}

            {selectedId && (() => {
                const sel = users.find(u => u.id === selectedId);
                return sel ? (
                    <div
                        className="card border mt-5 cs-pm-selected-card"
                    >
                        <style>{`
                            html.app-skin-dark .cs-pm-selected-card {
                                border-color: rgba(255,255,255,0.10) !important;
                                background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.22) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.18) 100%) !important;
                            }
                            .cs-pm-selected-card {
                                overflow: hidden;
                                border-color: rgba(var(--bs-primary-rgb), 0.18) !important;
                                background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(var(--bs-primary-rgb), 0.05) 55%, rgba(var(--bs-info-rgb), 0.10) 100%);
                                color: var(--bs-body-color);
                            }
                            html.app-skin-dark .cs-pm-selected-card {
                                color: rgba(255,255,255,0.92);
                            }
                            .cs-pm-selected-card .cs-pm-head {
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                gap: 12px;
                                margin-bottom: 12px;
                            }
                            .cs-pm-selected-card .cs-pm-title {
                                font-weight: 800;
                                font-size: 14px;
                                letter-spacing: 0.2px;
                                color: var(--bs-heading-color);
                            }
                            html.app-skin-dark .cs-pm-selected-card .cs-pm-title {
                                color: rgba(255,255,255,0.96);
                            }
                            .cs-pm-selected-card .cs-pm-sub {
                                font-size: 12px;
                                color: var(--bs-secondary-color);
                            }
                            html.app-skin-dark .cs-pm-selected-card .cs-pm-sub {
                                color: rgba(255,255,255,0.74);
                            }
                            .cs-pm-selected-card .text-muted {
                                color: var(--bs-secondary-color) !important;
                            }
                            html.app-skin-dark .cs-pm-selected-card .text-muted {
                                color: rgba(255,255,255,0.70) !important;
                            }

                            .cs-pm-selected-card,
                            .cs-pm-selected-card * {
                                transition: none !important;
                            }

                            .cs-pm-selected-card .cs-invite-line,
                            .cs-pm-selected-card .cs-invite-line svg {
                                color: #b45309 !important;
                                stroke: #b45309 !important;
                            }

                            .cs-pm-selected-card .cs-invite-card {
                                display: flex; align-items: center; padding-left: 12px;
                                border-left: 4px solid #b45309 !important;
                                margin-top: 8px;
                            }
                            .cs-pm-selected-card .cs-invite-line { margin-top: 0; font-size: 12px; color: rgba(2, 6, 23, 0.72); }
                            html.app-skin-dark .cs-pm-selected-card .cs-invite-line { color: rgba(255, 255, 255, 0.76); }
                            .cs-pm-logo { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 52px; height: 52px; border-radius: 12px; background: rgba(52,84,209,0.18); color: var(--bs-primary, #3454d1); }
                            .cs-pm-user-name { font-weight: bold; font-size: 14px; line-height: 1.3; margin-bottom: 4px; }
                        `}</style>
                        <div className="card-body pt-4 pb-3 px-4">
                            <div className="cs-pm-head mb-4">
                                <div className="fw-bold text-muted text-uppercase" style={{ fontSize: '14px', lineHeight: '1.2', letterSpacing: '0.5px' }}>
                                    Selected Project Manager
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">PENDING</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setFormData(prev => ({ ...prev, pm_user_id: null, pm_user: null }));
                                            setPmError(null);
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '4px 8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: '6px',
                                            color: 'var(--bs-secondary-color)',
                                            transition: 'all 0.15s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                                            e.currentTarget.style.color = '#ef4444';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.color = 'var(--bs-secondary-color)';
                                        }}
                                        title="Remove selection"
                                    >
                                        <FiX size={16} strokeWidth={2.5} />
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div className="d-flex align-items-center gap-4">
                                    <span className="cs-pm-logo">
                                        <FiUser size={36} strokeWidth={1.7} />
                                    </span>
                                    <div className="flex-grow-1">
                                        <div className="cs-pm-user-name">{sel.full_name}</div>
                                        <div className="d-block text-muted mb-0 fw-normal" style={{ fontSize: '12px', lineHeight: 1.3, marginBottom: '10px' }}>
                                            {sel.email}
                                        </div>
                                    </div>
                                </div>
                                <div className="cs-invite-card">
                                    <span className="cs-invite-line">The invitation will be sent after the project is created</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : null;
            })()}
        </>
    );
};

// Invite a non-registered user by email
const EmailInviteForm = ({ formData, setFormData, pmError, setPmError }) => {
    const [errors, setErrors] = useState({});
    const [submitted, setSubmitted] = useState(false); // Show card only after successful button click

    const validateName = (value) => {
        return validatePersonName(value);
    };

    const validateEmail = (value) => {
        const trimmed = (value || '').trim();
        if (!trimmed) return 'Email address is required';
        if (!EMAIL_RE.test(trimmed)) return 'Invalid email address';
        return null;
    };

    // When parent validation fails, show ALL field errors at once and hide card
    useEffect(() => {
        if (pmError) {
            const newErrors = {};
            const nameErr = validateName(formData.pm_full_name);
            const emailErr = validateEmail(formData.pm_email);

            if (nameErr) newErrors.pm_full_name = nameErr;
            if (emailErr) newErrors.pm_email = emailErr;

            setErrors(newErrors);
            setSubmitted(false); // Hide card on validation failure
        }
    }, [pmError]);

    const update = (field, val) => {
        setFormData(prev => ({ ...prev, [field]: val }));
        if (setPmError) setPmError(null);

        // Only clear error if field had one (don't validate until button click)
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: null }));
        }
    };

    const emailValid = !errors.pm_email && (formData.pm_email || '').trim();
    const nameValid = !errors.pm_full_name && (formData.pm_full_name || '').trim();
    const ready = emailValid && nameValid;

    const FieldError = ({ field }) => errors[field] ? (
        <span className="field-error d-flex align-items-center gap-1 mt-1" style={{ fontSize: '0.72rem', color: '#ef4444' }}>
            <FiAlertCircle size={11} style={{ flexShrink: 0 }} />{errors[field]}
        </span>
    ) : null;

    const handleAddPM = () => {
        // Validate all fields on button click
        const nameErr = validateName(formData.pm_full_name);
        const emailErr = validateEmail(formData.pm_email);

        setErrors({
            pm_full_name: nameErr,
            pm_email: emailErr,
        });

        // Only proceed if both are valid
        if (nameErr || emailErr) {
            setSubmitted(false); // Hide card if validation fails
            return;
        }

        setSubmitted(true); // Show card on successful validation
        if (setPmError) setPmError(null);
    };

    return (
        <>
            <div className="mb-3">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                    Full Name <span className="text-danger">*</span>
                </label>
                <div className="input-group">
                    <div className="input-group-text"><FiUser size={14} /></div>
                    <input
                        type="text"
                        className={`form-control ${errors.pm_full_name ? 'is-invalid' : ''}`}
                        placeholder="Enter full name"
                        style={{ fontSize: '0.875rem' }}
                        value={formData.pm_full_name || ''}
                        onChange={e => update('pm_full_name', e.target.value)}
                        maxLength={100}
                    />
                </div>
                <FieldError field="pm_full_name" />
            </div>

            <div className="mb-4">
                <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                    Email Address <span className="text-danger">*</span>
                </label>
                <div className="input-group">
                    <div className="input-group-text"><FiMail size={14} /></div>
                    <input
                        type="email"
                        className={`form-control ${errors.pm_email ? 'is-invalid' : ''}`}
                        placeholder="Enter email address"
                        style={{ fontSize: '0.875rem' }}
                        value={formData.pm_email || ''}
                        onChange={e => update('pm_email', e.target.value)}
                    />
                </div>
                <FieldError field="pm_email" />
                <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>
                    An account will be created after the invitation is accepted
                </div>
            </div>

            <div className="mt-4 d-flex justify-content-center">
                <button
                    type="button"
                    onClick={handleAddPM}
                    disabled={!ready}
                    className="btn btn-sm btn-success d-inline-flex align-items-center gap-1"
                    style={!ready ? { pointerEvents: 'none', opacity: 0.5 } : {}}
                >
                    <FiArrowRight size={12} />
                    Assign Project Manager
                </button>
            </div>

            {submitted && (
                <div className="card border mt-5 cs-pm-selected-card">
                    <style>{`
                        html.app-skin-dark .cs-pm-selected-card {
                            border-color: rgba(255,255,255,0.10) !important;
                            background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.22) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.18) 100%) !important;
                        }
                        .cs-pm-selected-card {
                            overflow: hidden;
                            border-color: rgba(var(--bs-primary-rgb), 0.18) !important;
                            background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(var(--bs-primary-rgb), 0.05) 55%, rgba(var(--bs-info-rgb), 0.10) 100%);
                            color: var(--bs-body-color);
                        }
                        html.app-skin-dark .cs-pm-selected-card { color: rgba(255,255,255,0.92); }
                        .cs-pm-selected-card .cs-pm-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
                        .cs-pm-selected-card .cs-pm-title { font-weight: 800; font-size: 14px; letter-spacing: 0.2px; color: var(--bs-heading-color); }
                        html.app-skin-dark .cs-pm-selected-card .cs-pm-title { color: rgba(255,255,255,0.96); }
                        .cs-pm-selected-card .cs-pm-sub { font-size: 12px; color: var(--bs-secondary-color); }
                        html.app-skin-dark .cs-pm-selected-card .cs-pm-sub { color: rgba(255,255,255,0.74); }
                        .cs-pm-selected-card .text-muted { color: var(--bs-secondary-color) !important; }
                        html.app-skin-dark .cs-pm-selected-card .text-muted { color: rgba(255,255,255,0.70) !important; }
                        .cs-pm-selected-card .cs-invite-card {
                            display: flex; align-items: center; padding-left: 12px;
                            border-left: 4px solid #b45309 !important;
                            margin-top: 8px;
                        }
                        .cs-pm-selected-card .cs-invite-line,
                        .cs-pm-selected-card .cs-invite-line svg {
                            color: #b45309 !important;
                            stroke: #b45309 !important;
                        }
                        .cs-pm-selected-card .cs-invite-line { margin-top: 0; font-size: 12px; }
                        html.app-skin-dark .cs-pm-selected-card .cs-invite-line { color: #b45309 !important; }
                        .cs-pm-logo { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 52px; height: 52px; border-radius: 12px; background: rgba(52,84,209,0.18); color: var(--bs-primary, #3454d1); }
                        .cs-pm-user-name { font-weight: bold; font-size: 14px; line-height: 1.3; margin-bottom: 4px; }
                    `}</style>
                    <div className="card-body pt-4 pb-3 px-4">
                        <div className="cs-pm-head mb-4">
                            <div className="fw-bold text-muted text-uppercase" style={{ fontSize: '14px', lineHeight: '1.2', letterSpacing: '0.5px' }}>
                                Project Manager Invite
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">PENDING</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSubmitted(false);
                                        setFormData(prev => ({ ...prev, pm_email: '', pm_full_name: '' }));
                                        setErrors({});
                                        setPmError(null);
                                    }}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '6px',
                                        color: 'var(--bs-secondary-color)',
                                        transition: 'all 0.15s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
                                        e.currentTarget.style.color = '#ef4444';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'transparent';
                                        e.currentTarget.style.color = 'var(--bs-secondary-color)';
                                    }}
                                    title="Remove and try again"
                                >
                                    <FiX size={16} strokeWidth={2.5} />
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div className="d-flex align-items-center gap-4">
                                <span className="cs-pm-logo">
                                    <FiUser size={36} strokeWidth={1.7} />
                                </span>
                                <div className="flex-grow-1">
                                    <div className="cs-pm-user-name">{formData.pm_full_name}</div>
                                    <div className="d-block text-muted mb-0 fw-normal" style={{ fontSize: '12px', lineHeight: 1.3, marginBottom: '10px' }}>
                                        {formData.pm_email}
                                    </div>
                                </div>
                            </div>
                            <div className="cs-invite-card">
                                <span className="cs-invite-line">The invitation will be sent after the project is created</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// --- PM Setup: Team Invite Panel ---

const ROLE_OPTIONS = [
    { value: "site_supervisor", label: "Site Supervisor",  Icon: FiHardDrive,  hex: "#0891b2" },
    { value: "safety_officer",  label: "Safety Officer",   Icon: FiShield,     hex: "#dc2626" },
    { value: "data_analyst",    label: "Data Analyst",     Icon: FiBarChart2,  hex: "#d97706" },
    { value: "stakeholder",     label: "Stakeholder",      Icon: FiEye,        hex: "#6b7280" },
    { value: "project_manager", label: "Project Manager",  Icon: FiStar,       hex: "#4f46e5" },
];

const TeamInvitePanel = ({ projectId }) => {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("site_supervisor");
    const [hoveredRole, setHoveredRole] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [sentList, setSentList] = useState([]);
    const [inviteError, setInviteError] = useState(null);

    const handleInvite = async (e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setSubmitting(true);
        setInviteError(null);
        try {
            await apiPost(`/projects/${projectId}/members/invite`, { email: email.trim(), role });
            const roleLabel = ROLE_OPTIONS.find(r => r.value === role)?.label || role;
            setSentList(prev => [...prev, { email: email.trim(), role: roleLabel }]);
            setEmail("");
        } catch (err) {
            let msg = "Failed to send invitation.";
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            setInviteError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const selectedRole = ROLE_OPTIONS.find(r => r.value === role);

    return (
        <section className="step-body mt-4 body current">
            <form id="project-team-invite" onSubmit={handleInvite}>
                <fieldset>
                    <div className="mb-5 text-center">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.1px', textTransform: 'uppercase', padding: '5px 13px', borderRadius: '30px', background: 'linear-gradient(135deg, rgba(var(--bs-primary-rgb),0.22) 0%, rgba(var(--bs-primary-rgb),0.07) 100%)', color: 'var(--bs-primary)', border: '1px solid rgba(var(--bs-primary-rgb),0.35)', marginBottom: '14px', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(var(--bs-primary-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(var(--bs-primary-rgb),0.12)' }}>Team Setup</div>
                        <h2 className="fw-bolder mb-2" style={{ fontSize: '22px', lineHeight: '1.2' }}>Invite Team Members</h2>
                        <p className="fs-12 fw-medium text-muted mb-0" style={{ lineHeight: '1.6' }}>Send invitations to your project team. Invitations expire in 24 hours. You can also invite members after the project is activated.</p>
                    </div>

                    {/* Role selection cards — premium div-based selector */}
                    <div className="mb-4">
                        <label className="fs-11 fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.06em' }}>Select Role</label>
                        <div className="row g-2">
                            {ROLE_OPTIONS.map(r => {
                                const isSelected = role === r.value;
                                const isHovered  = hoveredRole === r.value && !isSelected;
                                return (
                                    <div className="col-md-4 col-6" key={r.value}>
                                        <div
                                            className="d-flex flex-row align-items-center gap-2 px-3 py-3 rounded-3"
                                            style={{
                                                cursor: 'pointer',
                                                border: isSelected
                                                    ? `1.5px solid ${r.hex}`
                                                    : '1.5px solid rgba(255,255,255,0.07)',
                                                borderLeft: isSelected ? `4px solid ${r.hex}` : '1.5px solid rgba(255,255,255,0.07)',
                                                background: isSelected
                                                    ? `${r.hex}12`
                                                    : isHovered
                                                        ? 'rgba(255,255,255,0.03)'
                                                        : 'transparent',
                                                transition: 'all 0.15s ease',
                                            }}
                                            onClick={() => setRole(r.value)}
                                            onMouseEnter={() => setHoveredRole(r.value)}
                                            onMouseLeave={() => setHoveredRole(null)}
                                        >
                                            <span
                                                className="d-flex align-items-center justify-content-center rounded-2 flex-shrink-0"
                                                style={{
                                                    width: 32, height: 32,
                                                    background: `${r.hex}1a`,
                                                    color: r.hex,
                                                    boxShadow: isSelected ? `0 0 0 2px ${r.hex}33` : 'none',
                                                    transition: 'box-shadow 0.15s ease',
                                                }}
                                            >
                                                <r.Icon size={14} />
                                            </span>
                                            <span className="d-flex flex-column">
                                                <span className="fs-12 fw-bold text-dark">{r.label}</span>
                                                {isSelected && (
                                                    <span style={{ fontSize: '0.68rem', color: r.hex, fontWeight: 600 }}>Selected</span>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <hr className="my-4" />

                    {/* Email input + send button */}
                    <div className="mb-4">
                        <label className="fs-11 fw-semibold text-muted text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                            Email Address <span className="text-danger">*</span>
                        </label>
                        <div className="input-group">
                            <div className="input-group-text"><FiMail size={15} /></div>
                            <input
                                type="email"
                                className="form-control"
                                placeholder="colleague@company.com"
                                style={{ fontSize: '0.875rem' }}
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                            />
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={submitting || !email.trim()}
                            >
                                {submitting
                                    ? <><span className="spinner-border spinner-border-sm me-1" role="status"></span>Sending...</>
                                    : <><FiSend size={13} className="me-1" />Invite as {selectedRole?.label}</>
                                }
                            </button>
                        </div>
                    </div>

                    {inviteError && (
                        <div className="alert alert-danger small d-flex align-items-center gap-2 py-2">
                            <FiAlertCircle size={15} className="flex-shrink-0" />
                            {inviteError}
                        </div>
                    )}

                    {/* Sent confirmations */}
                    {sentList.length > 0 && (
                        <div className="mt-4">
                            <h6 className="fw-semibold text-dark mb-3">
                                Invitations Sent
                                <span className="badge bg-success ms-2">{sentList.length}</span>
                            </h6>
                            {sentList.map((s, i) => (
                                <div key={i} className="d-flex align-items-center gap-3 p-3 border rounded mb-2">
                                    <span className="avatar-text avatar-sm bg-success bg-opacity-10 text-success">
                                        <FiCheck size={14} />
                                    </span>
                                    <span>
                                        <span className="d-block fs-13 fw-semibold text-dark">{s.email}</span>
                                        <span className="text-muted" style={{ fontSize: '0.76rem' }}>{s.role}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </fieldset>
            </form>
        </section>
    );
};
