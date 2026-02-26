import React, { useState } from 'react';
import { FiMapPin, FiClock, FiUser, FiX } from 'react-icons/fi';
import { apiPost } from '@/utils/api';
import topTostError from '@/utils/topTostError';

// Colors matched to app's actual theme ($blue:#3454d1, $red:#ea4d4d, $yellow:#ffa21d, $green:#17c666)
const ROLE_META = {
    project_manager: { label: 'Project Manager', color: '#3454d1', bg: 'rgba(52,84,209,.1)',   grad: 'linear-gradient(90deg,#3454d1,#5b7cf7)' },
    site_supervisor: { label: 'Site Supervisor',  color: '#0ea5e9', bg: 'rgba(14,165,233,.1)', grad: 'linear-gradient(90deg,#0ea5e9,#38bdf8)'  },
    safety_officer:  { label: 'Safety Officer',   color: '#ea4d4d', bg: 'rgba(234,77,77,.1)',  grad: 'linear-gradient(90deg,#ea4d4d,#f87171)'  },
    data_analyst:    { label: 'Data Analyst',     color: '#ffa21d', bg: 'rgba(255,162,29,.1)', grad: 'linear-gradient(90deg,#ffa21d,#fbbf24)'  },
    stakeholder:     { label: 'Stakeholder',      color: '#64748b', bg: 'rgba(100,116,139,.1)',grad: 'linear-gradient(90deg,#64748b,#94a3b8)'  },
};

const getInitials = (name) => {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
};

const InvitationItem = ({ invitation, onAccepted, onRejected }) => {
    const [accepting, setAccepting] = useState(false);
    const [rejecting, setRejecting] = useState(false);

    const now       = new Date();
    const expiresAt = new Date(invitation.expires_at);
    const isExpired = expiresAt < now;
    const daysLeft  = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    const expirySoon = !isExpired && daysLeft <= 3;

    const expiryStr = expirySoon
        ? `${daysLeft}d left`
        : expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    const rm = ROLE_META[invitation.role] || {
        label: invitation.role, color: '#64748b',
        bg: 'rgba(100,116,139,.1)', grad: 'linear-gradient(90deg,#64748b,#94a3b8)'
    };

    const handleAccept = async () => {
        setAccepting(true);
        try {
            const result = await apiPost(`/invitations/${invitation.token}/accept`, {});
            if (onAccepted) onAccepted(result.project_id);
        } catch (err) {
            let msg = 'Failed to accept invitation.';
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
            setAccepting(false);
        }
    };

    const handleReject = async () => {
        setRejecting(true);
        try {
            await apiPost(`/invitations/${invitation.token}/reject`, {});
            if (onRejected) onRejected(invitation.id);
        } catch (err) {
            let msg = 'Failed to decline invitation.';
            try { msg = JSON.parse(err.message)?.detail || msg; } catch {}
            topTostError(msg);
            setRejecting(false);
        }
    };

    return (
        <div className={`inv-card${isExpired ? ' inv-expired' : ''}`}>
            {/* role-gradient top accent bar */}
            <span className="inv-accent-bar" style={{ background: rm.grad }} />

            {/* single-row body */}
            <div className="inv-row">
                <img
                    src={invitation.project_logo_url || '/images/icons/project-icon.png'}
                    alt=""
                    className="inv-logo"
                />

                <div className="inv-content">
                    {/* line 1: name + role badge */}
                    <div className="inv-line1">
                        <span className="inv-project-name">{invitation.project_name}</span>
                        <span
                            className="inv-role-badge"
                            style={{
                                background: rm.bg,
                                color: rm.color,
                                borderColor: `${rm.color}33`,
                            }}
                        >
                            <span style={{ width:5, height:5, borderRadius:'50%', background:rm.color, display:'inline-block', flexShrink:0 }} />
                            {rm.label}
                        </span>
                        {isExpired && (
                            <span style={{
                                fontSize:'10px', fontWeight:700, padding:'2px 8px', borderRadius:'6px',
                                background:'rgba(100,116,139,.12)', color:'#64748b',
                                letterSpacing:'.3px', textTransform:'uppercase',
                            }}>Expired</span>
                        )}
                    </div>

                    {/* line 2: location · inviter · expiry */}
                    <div className="inv-line2">
                        {invitation.project_location && (
                            <>
                                <FiMapPin size={10} style={{ flexShrink:0 }} />
                                <span>{invitation.project_location}</span>
                                <span className="inv-line2-sep">·</span>
                            </>
                        )}
                        <FiUser size={10} style={{ flexShrink:0 }} />
                        <span>{invitation.invited_by_name || 'Unknown'}</span>
                        <span className="inv-line2-sep">·</span>
                        <FiClock size={10} style={{ flexShrink:0 }} />
                        <span className={expirySoon ? 'inv-expiry-soon' : ''}>{expiryStr}</span>
                    </div>
                </div>

                {!isExpired && (
                    <div className="inv-actions">
                        <button
                            className="inv-btn-accept"
                            onClick={handleAccept}
                            disabled={accepting || rejecting}
                        >
                            {accepting ? 'Accepting…' : 'Accept'}
                        </button>
                        <button
                            className="inv-btn-decline"
                            onClick={handleReject}
                            disabled={accepting || rejecting}
                            title="Decline"
                        >
                            {rejecting ? '…' : <FiX size={14} />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default InvitationItem;
