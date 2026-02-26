import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../utils/api';
import PageLoader from '@/components/shared/PageLoader'
import topTostError from '../../utils/topTostError';

const ProjectDashboard = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const [project, setProject] = useState(null);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [markingComplete, setMarkingComplete] = useState(false);

    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                // Redirect PM to setup if project not yet active
                if (
                    (data.status === 'draft' || data.status === 'setup_in_progress') &&
                    data.my_role === 'project_manager'
                ) {
                    navigate(`/projects/${projectId}/setup`, { replace: true });
                    return;
                }
                setProject(data);
                return apiGet(`/projects/${projectId}/members`);
            })
            .then(memberData => {
                if (memberData) setMembers(memberData);
            })
            .catch(() => navigate('/projects/my', { replace: true }))
            .finally(() => setLoading(false));
    }, [projectId]);

    if (loading) return <PageLoader minHeight="60vh" />

    if (!project) return null;

    const statusBadge = {
        draft: 'secondary',
        setup_in_progress: 'warning',
        active: 'success',
        completed: 'primary',
        archived: 'dark',
    }[project.status] || 'secondary';

    const roleBadge = {
        project_manager: 'primary',
        site_supervisor: 'info',
        safety_officer: 'danger',
        data_analyst: 'warning',
        stakeholder: 'secondary',
    }[project.my_role] || 'secondary';

    const handleMarkComplete = async () => {
        setMarkingComplete(true);
        try {
            await apiPost(`/projects/${projectId}/complete`, {});
            topTostError('Project marked as complete', 'success');
            setProject(p => ({ ...p, status: 'completed' }));
        } catch (err) {
            topTostError(err.response?.data?.detail || 'Failed to mark project complete');
        } finally {
            setMarkingComplete(false);
        }
    };

    return (
        <div className="nxl-content-inner">
            <div className="page-header">
                <div className="page-header-left d-flex align-items-center gap-3">
                    <img
                        src={project.logo_url || '/images/icons/project-icon.png'}
                        alt=""
                        className="rounded-3"
                        style={{ width: 44, height: 44, objectFit: 'cover', flexShrink: 0 }}
                    />
                    <div>
                        <h5 className="page-header-title fw-bold mb-1">{project.name}</h5>
                        <p className="text-muted mb-0 small">{project.location}</p>
                    </div>
                    <span className={`badge bg-${statusBadge} text-capitalize`}>{project.status.replace(/_/g, ' ')}</span>
                    <span className={`badge bg-${roleBadge} text-capitalize`}>{project.my_role?.replace(/_/g, ' ')}</span>
                </div>
                {project.status === 'active' && project.my_role === 'project_manager' && (
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleMarkComplete}
                        disabled={markingComplete}
                    >
                        {markingComplete && <span className="spinner-border spinner-border-sm me-2"></span>}
                        Mark Complete
                    </button>
                )}
            </div>

            {project.status === 'archived' && (
                <div className="alert alert-dark d-flex align-items-center gap-2 mb-0">
                    <i className="feather-archive"></i>
                    <span>This project is <strong>archived</strong> and read-only. No changes can be made.</span>
                </div>
            )}
            {(project.status === 'draft' || project.status === 'setup_in_progress') && (
                <div className="alert alert-warning d-flex align-items-center gap-2 mb-0">
                    <i className="feather-alert-triangle"></i>
                    <span>
                        {project.my_role === 'project_manager'
                            ? <>This project is in setup. <a href={`/projects/${projectId}/setup`}>Continue setup →</a></>
                            : 'This project is being set up by the Project Manager and is not yet active.'
                        }
                    </span>
                </div>
            )}
            {project.status === 'completed' && (
                <div className="alert alert-info d-flex align-items-center gap-2 mb-0">
                    <i className="feather-check-circle"></i>
                    <span>This project is marked as completed.</span>
                </div>
            )}

            <div className="row g-3 mt-2">
                <div className="col-md-4">
                    <div className="card">
                        <div className="card-header">
                            <h6 className="card-title mb-0">Team Members</h6>
                        </div>
                        <div className="card-body p-0">
                            {members.length === 0 ? (
                                <p className="text-muted text-center py-3 mb-0 small">No members yet.</p>
                            ) : (
                                <ul className="list-group list-group-flush">
                                    {members.map(m => (
                                        <li key={m.id} className="list-group-item d-flex align-items-center justify-content-between">
                                            <div>
                                                <div className="fw-semibold small">{m.full_name}</div>
                                                <div className="text-muted" style={{ fontSize: '0.75rem' }}>{m.email}</div>
                                            </div>
                                            <span className="badge bg-light text-dark text-capitalize" style={{ fontSize: '0.7rem' }}>
                                                {m.project_role.replace(/_/g, ' ')}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

                <div className="col-md-8">
                    <div className="card h-100">
                        <div className="card-header">
                            <h6 className="card-title mb-0">Project Overview</h6>
                        </div>
                        <div className="card-body">
                            <dl className="row mb-0">
                                <dt className="col-sm-4 text-muted">Client</dt>
                                <dd className="col-sm-8">{project.client_name || '—'}</dd>
                                <dt className="col-sm-4 text-muted">Start Date</dt>
                                <dd className="col-sm-8">{project.start_date || '—'}</dd>
                                <dt className="col-sm-4 text-muted">Description</dt>
                                <dd className="col-sm-8">{project.description || '—'}</dd>
                            </dl>
                        </div>
                    </div>
                </div>
            </div>

            <div className="row g-3 mt-1">
                <div className="col-md-4">
                    <div className="card h-100">
                        <div className="card-body text-center d-flex flex-column align-items-center justify-content-center py-4">
                            <i className="feather-check-square fs-2 text-primary d-block mb-2"></i>
                            <p className="fw-semibold mb-1">Project Tasks</p>
                            <p className="text-muted small mb-3">Track and manage team tasks</p>
                            <a href={`/projects/${projectId}/tasks`} className="btn btn-sm btn-outline-primary">
                                View Tasks
                            </a>
                        </div>
                    </div>
                </div>
                <div className="col-md-8">
                    <div className="card h-100">
                        <div className="card-body text-center d-flex flex-column align-items-center justify-content-center py-4">
                            <i className="feather-camera fs-2 text-primary d-block mb-2"></i>
                            <p className="fw-semibold mb-1">Cameras &amp; Zones</p>
                            <p className="text-muted small mb-3">View assigned cameras and manage zones</p>
                            <a href={`/projects/${projectId}/cameras`} className="btn btn-sm btn-outline-primary">
                                View Cameras
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProjectDashboard;
