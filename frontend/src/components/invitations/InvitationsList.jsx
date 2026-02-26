import React, { useEffect, useState } from 'react';
import { FiUser, FiCalendar, FiCheck, FiX } from 'react-icons/fi';
import PageLoader from '@/components/shared/PageLoader'
import { apiPost } from '@/utils/api';
import topTost from '@/utils/topTost';
import topTostError from '@/utils/topTostError';
import { apiGet } from '@/utils/api';

const DEFAULT_PROJECT_LOGO = '/images/icons/project-icon.png';

const InvitationsList = () => {
    const [invitations, setInvitations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState(null);
    const [acting, setActing] = useState(null);

    const roleColorMap = {
        project_manager: 'bg-soft-success text-success',
        site_supervisor: 'bg-soft-primary text-primary',
        safety_officer: 'bg-soft-danger text-danger',
        data_analyst: 'bg-soft-warning text-warning',
        stakeholder: 'bg-soft-info text-info',
    };

    const load = () => {
        setLoading(true);
        apiGet('/invitations/me')
            .then(data => setInvitations(data || []))
            .catch(() => setFetchError("Failed to load invitations."))
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const handleAccept = async (inv) => {
        setActing(inv.id);
        try {
            await apiPost(`/invitations/${inv.token}/accept`, {});
            setInvitations(prev => prev.filter(i => i.id !== inv.id));
            topTost(`Accepted invitation from ${inv.project_name}`);
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to accept invitation');
            setActing(null);
        }
    };

    const handleReject = async (inv) => {
        setActing(inv.id);
        try {
            await apiPost(`/invitations/${inv.token}/reject`, {});
            setInvitations(prev => prev.filter(i => i.id !== inv.id));
            topTost('Invitation declined');
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to decline invitation');
            setActing(null);
        }
    };

    const formatDate = (date) => {
        if (!date) return '—';
        const d = new Date(date);
        const now = new Date();
        const isExpired = d < now;
        const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        if (isExpired) return `${dateStr} (Expired)`;
        if (!isExpired && daysLeft <= 3) return `${daysLeft}d left`;
        return dateStr;
    };

    const getRoleLabel = (role) => {
        const map = {
            project_manager: 'Project Manager',
            site_supervisor: 'Site Supervisor',
            safety_officer: 'Safety Officer',
            data_analyst: 'Data Analyst',
            stakeholder: 'Stakeholder',
        };
        return map[role] || role;
    };

    if (loading) return <PageLoader />

    if (fetchError) {
        return <div className="alert alert-danger">{fetchError}</div>;
    }

    if (invitations.length === 0) {
        return (
            <div className="text-center text-muted py-5">
                <i className="feather-mail fs-2 d-block mb-2"></i>
                <p className="mb-0">No pending invitations.</p>
            </div>
        );
    }

    return (
        <div className="card border-0 shadow-none">
            <div className="table-responsive">
                <table className="table table-hover align-middle">
                    <thead className="table-light">
                        <tr>
                            <th style={{ width: '25%' }}>Project</th>
                            <th style={{ width: '20%' }}>Invitation Sent By</th>
                            <th style={{ width: '15%' }}>Project Role</th>
                            <th style={{ width: '20%' }}>Invitation Expires At</th>
                            <th style={{ width: '20%' }} className="text-end">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invitations.map(inv => {
                            const isExpired = new Date(inv.expires_at) < new Date();
                            return (
                                <tr key={inv.id} className={isExpired ? 'opacity-50' : ''}>
                                    <td>
                                        <div className="d-flex align-items-center gap-2">
                                            <img
                                                src={inv.project_logo_url || DEFAULT_PROJECT_LOGO}
                                                alt=""
                                                className="rounded-circle"
                                                style={{ width: 32, height: 32, objectFit: 'cover' }}
                                            />
                                            <span className="fw-semibold">{inv.project_name}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="d-flex align-items-center gap-2">
                                            <FiUser size={14} className="text-muted" />
                                            <span>{inv.invited_by_name || '—'}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`badge ${roleColorMap[inv.role] || 'bg-soft-secondary text-secondary'}`}>
                                            {getRoleLabel(inv.role)}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="d-flex align-items-center gap-2">
                                            <FiCalendar size={14} className={isExpired ? 'text-danger' : 'text-muted'} />
                                            <span className={isExpired ? 'text-danger' : ''}>{formatDate(inv.expires_at)}</span>
                                        </div>
                                    </td>
                                    <td className="text-end">
                                        <button
                                            className="btn btn-sm btn-soft-success me-2"
                                            onClick={() => handleAccept(inv)}
                                            disabled={isExpired || acting === inv.id}
                                            title={isExpired ? 'Invitation expired' : 'Accept'}
                                        >
                                            {acting === inv.id ? '…' : <FiCheck size={14} />}
                                        </button>
                                        <button
                                            className="btn btn-sm btn-soft-danger"
                                            onClick={() => handleReject(inv)}
                                            disabled={acting === inv.id}
                                            title="Decline"
                                        >
                                            {acting === inv.id ? '…' : <FiX size={14} />}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InvitationsList;
