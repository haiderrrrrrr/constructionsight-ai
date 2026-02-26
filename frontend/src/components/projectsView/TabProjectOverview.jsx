import React, { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import ImageGroup from '@/components/shared/ImageGroup'
import { apiGet, API_BASE } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'


const DEFAULT_AVATAR = '/images/icons/profile-picture.png'

export const imageList = [
    {
        id: 1,
        user_name: "Janette Dalton",
        user_img: "/images/avatar/2.png"
    },
    {
        id: 2,
        user_name: "Mikal Bon",
        user_img: "/images/avatar/3.png"
    },
    {
        id: 3,
        user_name: "Socrates Itumay",
        user_img: "/images/avatar/4.png"
    },
    {
        id: 4,
        user_name: "Jakson Jak",
        user_img: "/images/avatar/6.png"
    },
    {
        id: 5,
        user_name: "Socrates Itumay",
        user_img: "/images/avatar/5.png"
    },
]

const statusBadgeMap = {
    draft: { label: 'Draft', cls: 'bg-soft-secondary text-secondary' },
    setup_in_progress: { label: 'Setup In Progress', cls: 'bg-soft-warning text-warning' },
    active: { label: 'Active', cls: 'bg-soft-success text-success' },
    archived: { label: 'Archived', cls: 'bg-soft-danger text-danger' },
    completed: { label: 'Completed', cls: 'bg-soft-primary text-primary' },
}

const roleLabels = {
    project_manager: 'Project Manager',
    site_supervisor: 'Site Supervisor',
    safety_officer: 'Safety Officer',
    data_analyst: 'Data Analyst',
    stakeholder: 'Stakeholder',
}

const cameraStatusMap = {
    draft: { label: 'Draft', cls: 'bg-soft-secondary text-secondary' },
    verifying: { label: 'Verifying', cls: 'bg-soft-info text-info' },
    verified: { label: 'Verified', cls: 'bg-soft-success text-success' },
    verify_failed: { label: 'Failed', cls: 'bg-soft-danger text-danger' },
    archived: { label: 'Archived', cls: 'bg-soft-dark text-dark' },
}

const TabProjectOverview = () => {
    const { id } = useParams()
    const [project, setProject] = useState(null)
    const [members, setMembers] = useState([])
    const [invitations, setInvitations] = useState([])
    const [cameras, setCameras] = useState([])

    const loadData = useCallback(async () => {
        try {
            const [projData, membersData, invitationsData, camerasData] = await Promise.all([
                apiGet(`/admin/projects/${id}`),
                apiGet(`/admin/projects/${id}/members`),
                apiGet(`/admin/invitations?project_id=${id}`),
                apiGet(`/admin/projects/${id}/cameras`)
            ])
            setProject(projData)
            setMembers(membersData || [])
            setInvitations(invitationsData || [])
            setCameras(camerasData || [])
        } catch (err) {
            console.error('Failed to load project data:', err)
        }
    }, [id])

    useEffect(() => {
        loadData()
    }, [loadData])

    // Broadcast listener for project/member/camera changes
    useEffect(() => {
        const handler = () => loadData()
        window.addEventListener('cs:projects-stats-refresh', handler)
        window.addEventListener('cs:project-members-refresh', handler)
        window.addEventListener('cs:project-cameras-refresh', handler)
        const unsub1 = onBroadcast('cs:projects-stats-refresh', handler)
        const unsub2 = onBroadcast('cs:project-members-refresh', handler)
        const unsub3 = onBroadcast('cs:project-cameras-refresh', handler)
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', handler)
            window.removeEventListener('cs:project-members-refresh', handler)
            window.removeEventListener('cs:project-cameras-refresh', handler)
            unsub1()
            unsub2()
            unsub3()
        }
    }, [loadData])

    // Visibility change listener
    useEffect(() => {
        const handler = () => { if (!document.hidden) loadData() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [loadData])
    return (
        <div className="tab-pane fade active show" id="overviewTab">
            <div className="row">
                {/* ── Project Header Card ── */}
                <div className="col-12">
                    <div className="card stretch stretch-full">
                        <div className="card-body task-header">
                            {project && (
                                <>
                                    <h4 className="mb-3 fw-bold d-flex align-items-center gap-3">
                                        <span className="text-truncate-1-line">{project.name}</span>
                                        <span className={`badge ${statusBadgeMap[project.status]?.cls || 'bg-soft-secondary'}`}>
                                            {statusBadgeMap[project.status]?.label || project.status}
                                        </span>
                                    </h4>
                                    <div className="img-group lh-0 justify-content-start">
                                        <ImageGroup
                                            data={members
                                                .filter(m => m.status === 'active')
                                                .map(m => ({
                                                    id: m.user_id,
                                                    user_name: m.full_name,
                                                    user_img: m.avatar_url || DEFAULT_AVATAR,
                                                }))}
                                            avatarSize='avatar-md'
                                        />
                                        <span className="fs-12 text-muted ms-3">
                                            {members.filter(m => m.status === 'active').length} members
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Project Details Card ── */}
                <div className="col-12">
                    <div className="card stretch stretch-full">
                        <div className="card-header">
                            <h5 className="card-title mb-0">Project Details</h5>
                        </div>
                        <div className="card-body">
                            <div className="row">
                                {project && (
                                    <>
                                        <div className="col-md-6 mb-4">
                                            <label className="form-label">Project Name</label>
                                            <p>{project.name || 'N/A'}</p>
                                        </div>
                                        <div className="col-md-6 mb-4">
                                            <label className="form-label">Status</label>
                                            <p>
                                                <span className={`badge ${statusBadgeMap[project.status]?.cls || 'bg-soft-secondary'}`}>
                                                    {statusBadgeMap[project.status]?.label || project.status || 'N/A'}
                                                </span>
                                            </p>
                                        </div>
                                        <div className="col-md-6 mb-4">
                                            <label className="form-label">Location</label>
                                            <p>{project.location || 'N/A'}</p>
                                        </div>
                                        <div className="col-md-6 mb-4">
                                            <label className="form-label">Client Name</label>
                                            <p>{project.client_name || 'N/A'}</p>
                                        </div>
                                        <div className="col-md-6 mb-4">
                                            <label className="form-label">Start Date</label>
                                            <p>{project.start_date ? new Date(project.start_date).toLocaleDateString() : 'N/A'}</p>
                                        </div>
                                        <div className="col-md-6 mb-4">
                                            <label className="form-label">End Date</label>
                                            <p>{project.end_date ? new Date(project.end_date).toLocaleDateString() : 'N/A'}</p>
                                        </div>
                                        <div className="col-md-12">
                                            <label className="form-label">Description</label>
                                            <p>{project.description || 'No description provided'}</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Team Section Card ── */}
            <div className="row mt-4">
                <div className="col-12">
                    <div className="card stretch stretch-full">
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <h5 className="card-title mb-0">Team Members</h5>
                            <span className="badge bg-soft-primary text-primary">
                                {members.length + invitations.filter(i => i.status === 'pending').length}
                            </span>
                        </div>
                        <div className="card-body p-0">
                            {members.length === 0 && invitations.filter(i => i.status === 'pending').length === 0 ? (
                                <EmptyState message="No team members added yet" />
                            ) : (
                                <div className="table-responsive">
                                    <table className="table table-hover align-middle mb-0">
                                        <thead className="bg-light">
                                            <tr>
                                                <th className="ps-4 py-3 fw-semibold fs-12 text-uppercase text-muted">Member</th>
                                                <th className="py-3 fw-semibold fs-12 text-uppercase text-muted">Email</th>
                                                <th className="py-3 fw-semibold fs-12 text-uppercase text-muted">Role</th>
                                                <th className="py-3 fw-semibold fs-12 text-uppercase text-muted">Joined</th>
                                                <th className="py-3 fw-semibold fs-12 text-uppercase text-muted">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {members.map(m => (
                                                <tr key={m.id}>
                                                    <td className="ps-4">
                                                        <div className="d-flex align-items-center gap-2">
                                                            <img
                                                                src={m.avatar_url || DEFAULT_AVATAR}
                                                                className="rounded-circle"
                                                                style={{ width: 34, height: 34, objectFit: 'cover' }}
                                                                alt={m.full_name}
                                                            />
                                                            <span className="fw-semibold fs-13">{m.full_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="fs-13 text-muted">{m.email}</td>
                                                    <td className="fs-13">{roleLabels[m.project_role] || m.project_role}</td>
                                                    <td className="fs-12 text-muted">
                                                        {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                                                    </td>
                                                    <td>
                                                        <span className="badge bg-soft-success text-success">Active</span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {invitations.filter(i => i.status === 'pending').map(inv => (
                                                <tr key={inv.id}>
                                                    <td className="ps-4">
                                                        <div className="d-flex align-items-center gap-2">
                                                            <div className="avatar-text rounded-circle bg-soft-warning text-warning"
                                                                style={{ width: 34, height: 34, fontSize: 14 }}>
                                                                {inv.email.charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="fw-semibold fs-13 text-muted">{inv.email}</span>
                                                        </div>
                                                    </td>
                                                    <td className="fs-13 text-muted">{inv.email}</td>
                                                    <td className="fs-13">{roleLabels[inv.role] || inv.role}</td>
                                                    <td className="fs-12 text-muted">—</td>
                                                    <td>
                                                        <span className="badge bg-soft-warning text-warning">Invited</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Cameras Card ── */}
            <div className="row mt-4">
                <div className="col-12">
                    <div className="card stretch stretch-full">
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <h5 className="card-title mb-0">Assigned Cameras</h5>
                            <span className="badge bg-soft-primary text-primary">{cameras.length}</span>
                        </div>
                        <div className="card-body">
                            {cameras.length === 0 ? (
                                <EmptyState message="No cameras assigned yet" />
                            ) : (
                                <div className="row g-3">
                                    {cameras.map(c => (
                                        <CameraCard key={c.id} camera={c} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>

    )
}

export default TabProjectOverview


// Empty state component
const EmptyState = ({ message }) => (
    <div className="text-center py-5 text-muted">
        <i className="feather-inbox fs-30 mb-3 d-block" />
        <p className="mb-0">{message}</p>
    </div>
);

// Camera card component with live stream + zone
const CameraCard = ({ camera }) => {
    const status = cameraStatusMap[camera.registry_status] || {
        label: camera.registry_status || 'Unknown',
        cls: 'bg-soft-secondary text-secondary',
    };
    const token = window.sessionStorage.getItem('access_token');
    const streamUrl = `${API_BASE}/admin/cameras/${camera.id}/mjpeg-stream?token=${token}`;
    const isStreamable = camera.registry_status === 'verified';

    return (
        <div className="col-xl-4 col-md-6">
            <div className="card border h-100">
                {/* Live stream or placeholder */}
                <div className="position-relative bg-dark" style={{ height: 160, overflow: 'hidden', borderRadius: '8px 8px 0 0' }}>
                    {isStreamable ? (
                        <img
                            src={streamUrl}
                            alt={camera.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                    ) : null}
                    <div
                        className="d-flex align-items-center justify-content-center text-muted flex-column"
                        style={{ position: isStreamable ? 'absolute' : 'static', inset: 0, height: isStreamable ? 'auto' : 160, display: isStreamable ? 'none' : 'flex' }}
                    >
                        <i className="feather-camera-off fs-24 mb-1" />
                        <span className="fs-11">No stream available</span>
                    </div>
                    <span className={`badge position-absolute top-0 end-0 m-2 ${status.cls}`}>{status.label}</span>
                </div>
                {/* Camera details */}
                <div className="card-body p-3">
                    <div className="fw-semibold fs-13 mb-1">{camera.name}</div>
                    <div className="text-muted fs-12 mb-2">
                        {[camera.vendor, camera.model].filter(Boolean).join(' · ') || 'No model info'}
                    </div>
                    <div className="d-flex align-items-center gap-1 fs-12 text-muted">
                        <i className="feather-map-pin me-1" />
                        {camera.zone_name
                            ? <span className="badge bg-soft-info text-info">{camera.zone_name}</span>
                            : <span className="fst-italic">No zone assigned</span>
                        }
                    </div>
                </div>
            </div>
        </div>
    );
};
