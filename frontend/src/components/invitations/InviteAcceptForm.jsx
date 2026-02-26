import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import PageLoader from '@/components/shared/PageLoader'
import { apiGet, apiPost, isTokenValid, refreshTokens } from '@/utils/api';
import topTostError from '@/utils/topTostError';
import {
    FiBriefcase, FiShield, FiMail, FiCalendar,
    FiCheckCircle, FiXCircle, FiAlertCircle, FiLogIn, FiUserPlus, FiRefreshCw,
} from 'react-icons/fi';
import { onBroadcast } from '@/utils/broadcast';

const InviteAcceptForm = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(null);
    const [accepting, setAccepting] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [loggedIn, setLoggedIn] = useState(isTokenValid());

    // Restore theme from localStorage (no Header on this public page), default to dark
    useEffect(() => {
        const skin = localStorage.getItem('skinTheme') || 'dark'
        if (skin === 'dark') {
            document.documentElement.classList.add('app-skin-dark')
            document.documentElement.classList.add('app-navigation-dark')
            document.documentElement.classList.add('app-header-dark')
        } else {
            document.documentElement.classList.remove('app-skin-dark')
            document.documentElement.classList.remove('app-navigation-dark')
            document.documentElement.classList.remove('app-header-dark')
        }
        const handler = () => {
            const s = localStorage.getItem('skinTheme') || 'dark'
            if (s === 'dark') {
                document.documentElement.classList.add('app-skin-dark','app-navigation-dark','app-header-dark')
            } else {
                document.documentElement.classList.remove('app-skin-dark','app-navigation-dark','app-header-dark')
            }
        }
        window.addEventListener('cs:theme-skin-change', handler)
        const unsub = onBroadcast('cs:theme-skin-change', handler)
        return () => {
            window.removeEventListener('cs:theme-skin-change', handler)
            unsub()
        }
    }, []);

    useEffect(() => {
        if (!loggedIn) {
            refreshTokens().then(token => { if (token) setLoggedIn(true) })
        }
    }, [])

    useEffect(() => {
        apiGet(`/invite/${token}`)
            .then(data => setInfo(data))
            .catch(err => {
                let msg = 'This invitation link is invalid or has expired.';
                try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
                setFetchError(msg);
            })
            .finally(() => setLoading(false));
    }, [token]);

    const handleAccept = async () => {
        setAccepting(true);
        try {
            await apiPost(`/invitations/${token}/accept`, {});
            topTostError('Invitation accepted!', 'success');
            navigate('/projects/my', { replace: true });
        } catch (err) {
            let msg = 'Failed to accept invitation.';
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
            setAccepting(false);
        }
    };

    const handleDecline = async () => {
        setRejecting(true);
        try {
            await apiPost(`/invitations/${token}/reject`, {});
            topTostError('Invitation declined', 'success');
            navigate('/projects/my', { replace: true });
        } catch (err) {
            let msg = 'Failed to decline invitation.';
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
            setRejecting(false);
        }
    };

    const handleSignOut = async () => {
        try { await apiPost('/auth/logout', {}); } catch {}
        localStorage.removeItem('access_token');
        sessionStorage.removeItem('access_token');
        navigate(`/login?next=/invite/${token}`, { replace: true });
    };

    // ── Loading ──
    if (loading) return <PageLoader minHeight="100vh" />

    // ── Error ──
    if (fetchError) {
        return (
            <div className="nxl-content-inner d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', padding: '24px 16px' }}>
                <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', border: '2px solid rgba(239,68,68,0.25)', marginBottom: 20 }}>
                        <FiAlertCircle size={32} style={{ color: '#ef4444' }} />
                    </div>
                    <h5 className="fw-bold mb-2">Invitation Unavailable</h5>
                    <p className="text-muted fs-14 mb-0">{fetchError}</p>
                </div>
            </div>
        );
    }

    const roleLabel = (info.role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const expiresAt = new Date(info.expires_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

    // ── Determine which action block to show ──
    const renderActions = () => {
        if (!loggedIn) {
            if (info.account_exists) {
                // Case A
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="alert alert-primary mb-2 text-center" role="alert" style={{ fontSize: '13px' }}>
                            This invitation is for <strong>{info.email}</strong>
                        </div>
                        <Link
                            to={`/login?next=/invite/${token}`}
                            className="btn btn-primary w-100"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                            <FiLogIn size={14} /> Sign In to Accept
                        </Link>
                    </div>
                );
            } else {
                // Case B
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="alert alert-primary mb-2 text-center" role="alert" style={{ fontSize: '13px' }}>
                            Your account must be created with the invited email.<br />
                            <strong>{info.email}</strong>
                        </div>
                        <Link
                            to={`/signup?invite_token=${token}`}
                            className="btn btn-primary w-100"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                            <FiUserPlus size={14} /> Create Account to Accept
                        </Link>
                        <Link
                            to={`/login?next=/invite/${token}`}
                            className="btn btn-light-brand w-100"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                            <FiLogIn size={14} /> Already have an account? Sign In
                        </Link>
                    </div>
                );
            }
        }

        // Logged in
        if (info.email_matches === false) {
            // Case D — wrong account
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="invite-wrong-account-alert" role="alert" style={{ padding: 12, borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                            <span className="invite-wrong-account-icon" style={{ flexShrink: 0, marginTop: -1 }}>
                                <FiAlertCircle size={16} />
                            </span>
                            <span className="invite-wrong-account-text" style={{ fontSize: 13, fontWeight: 700, marginTop: -1 }}>Wrong Account</span>
                        </div>
                        <p className="invite-wrong-account-text" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
                            This invitation was sent to <strong>{info.email}</strong>,
                            but you are signed in as <strong>{info.current_email_masked}</strong>.
                        </p>
                    </div>
                    <button
                        className="btn btn-primary w-100"
                        onClick={handleSignOut}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                        <FiRefreshCw size={14} /> Sign In with Correct Account
                    </button>
                </div>
            );
        }

        // Case C — logged in, email matches
        return (
            <div style={{ display: 'flex', gap: 10 }}>
                <button
                    className="btn btn-primary flex-grow-1"
                    onClick={handleAccept}
                    disabled={accepting || rejecting}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                    {accepting
                        ? <><span className="spinner-border spinner-border-sm" role="status" /> Accepting...</>
                        : <><FiCheckCircle size={14} /> Accept Invitation</>
                    }
                </button>
                <button
                    className="btn btn-decline flex-grow-1"
                    onClick={handleDecline}
                    disabled={accepting || rejecting}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                    {rejecting
                        ? <><span className="spinner-border spinner-border-sm" role="status" /> Declining...</>
                        : <><FiXCircle size={14} /> Decline</>
                    }
                </button>
            </div>
        );
    };

    return (
        <div className="nxl-content-inner d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', padding: '32px 16px' }}>
            <div style={{ maxWidth: 460, width: '100%' }}>

                {/* Brand logo + wordmark */}
                <div className="d-flex align-items-center justify-content-center gap-3 mb-4">
                    <div style={{ width: 40, flexShrink: 0 }}>
                        <img src="/images/logo-abbr.png" alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
                    </div>
                    <img src="/images/logo-full.png" alt="ConstructionSight AI" className="auth-logo-full" style={{ height: 17, width: 'auto', display: 'block' }} />
                </div>

                {/* Main card */}
                <div className="card border shadow-sm" style={{ borderTop: '3px solid var(--bs-primary, #5b6abf)' }}>
                    <div className="card-body">
                        {/* Project logo + heading */}
                        <div className="text-center mb-4">
                            <div className="flex-shrink-0 proj-logo-circle d-inline-flex align-items-center justify-content-center mb-3"
                                style={{ width: 68, height: 68, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)' }}>
                                <img
                                    src={info.project_logo_url || '/images/icons/project-icon.png'}
                                    alt=""
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
                                />
                            </div>
                            <h4 className="fw-bold mb-2">Project Invitation</h4>
                            <p className="text-muted fs-14 mb-0">You have been invited to join a project</p>
                        </div>

                        <style>{`
                            .proj-logo-circle { background: var(--bs-secondary-bg); }
                            html.app-skin-dark .proj-logo-circle { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.08) !important; }

                            .invite-icon-wrap { width: 28px; height: 28px; border-radius: 7px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(2,6,23,0.06); color: rgba(2,6,23,0.78); }
                            html.app-skin-dark .invite-icon-wrap { background: rgba(255,255,255,0.08) !important; color: rgba(255,255,255,0.75) !important; }

                            .invite-info-row { border-bottom: 1px solid rgba(148,163,184,0.35); }
                            html.app-skin-dark .invite-info-row { border-bottom: 1px solid rgba(255,255,255,0.10); }

                            .invite-info-val { color: rgba(2,6,23,0.88); }
                            html.app-skin-dark .invite-info-val { color: rgba(255,255,255,0.88) !important; }

                            .invite-wrong-account-alert { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); }
                            html.app-skin-dark .invite-wrong-account-alert { background: rgba(239,68,68,0.08) !important; border-color: rgba(239,68,68,0.2) !important; }

                            .invite-wrong-account-text { color: #ef4444; }
                            html.app-skin-dark .invite-wrong-account-text { color: #ef4444 !important; }

                            .invite-wrong-account-icon svg { stroke: #ef4444 !important; color: #ef4444 !important; }

                            .btn-decline { background: #ef4444; border-color: #ef4444; color: #fff; }
                            .btn-decline:hover:not(:disabled) { background: #dc2626; border-color: #dc2626; }
                            html.app-skin-dark .btn-decline { background: #ef4444; border-color: #ef4444; }
                            html.app-skin-dark .btn-decline:hover:not(:disabled) { background: #dc2626; border-color: #dc2626; }
                        `}</style>

                        {/* Info rows */}
                        <div className="overflow-hidden mb-4">
                            {[
                                { label: 'Project',       value: info.project_name, icon: FiBriefcase },
                                { label: 'Role',          value: roleLabel,         icon: FiShield },
                                { label: 'Invited email', value: info.email,        icon: FiMail },
                                { label: 'Expires',       value: expiresAt,         icon: FiCalendar },
                            ].map(({ label, value, icon: Icon }, i, arr) => (
                                <div key={label} className={i < arr.length - 1 ? 'invite-info-row' : ''} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 16px' }}>
                                    <span className="invite-icon-wrap">
                                        <Icon size={13} strokeWidth={2} />
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                                        <span className="fs-10 fw-bold text-muted text-uppercase" style={{ letterSpacing: '0.08em' }}>{label}</span>
                                        <span className="invite-info-val fs-12 text-break">{value}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Contextual action block */}
                        {renderActions()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InviteAcceptForm;
