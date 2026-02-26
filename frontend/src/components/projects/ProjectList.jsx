import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMapPin, FiChevronRight, FiBriefcase } from 'react-icons/fi';

// Colors matched to app's actual theme ($blue: #3454d1, $green: #17c666, $yellow: #ffa21d)
const STATUS_META = {
    draft:             { color: '#64748b', bar: '#64748b', bg: 'rgba(100,116,139,.12)', label: 'Draft'    },
    setup_in_progress: { color: '#ffa21d', bar: '#ffa21d', bg: 'rgba(255,162,29,.12)',  label: 'Setup'    },
    active:            { color: '#17c666', bar: '#17c666', bg: 'rgba(23,198,102,.12)',   label: 'Active'   },
    archived:          { color: '#4b5563', bar: '#4b5563', bg: 'rgba(75,85,99,.12)',     label: 'Archived' },
};

const ROLE_META = {
    project_manager: { label: 'Project Manager', bg: 'rgba(52,84,209,.1)',   text: '#3454d1' },
    site_supervisor: { label: 'Site Supervisor',  bg: 'rgba(14,165,233,.1)', text: '#0ea5e9' },
    safety_officer:  { label: 'Safety Officer',   bg: 'rgba(234,77,77,.1)',  text: '#ea4d4d' },
    data_analyst:    { label: 'Data Analyst',     bg: 'rgba(255,162,29,.1)', text: '#ffa21d' },
    stakeholder:     { label: 'Stakeholder',      bg: 'rgba(100,116,139,.1)',text: '#64748b' },
};

const ProjectList = ({ projects }) => {
    const navigate = useNavigate();

    const handleClick = (project) => {
        const needsSetup = (
            project.my_role === 'project_manager' &&
            (project.status === 'draft' || project.status === 'setup_in_progress')
        );
        navigate(needsSetup ? `/projects/${project.id}/setup` : `/projects/${project.id}/dashboard`);
    };

    return (
        <div style={{ width:'100%', position:'relative', zIndex:1 }}>
            <div className="up-pl-header">
                <p className="up-pl-title">My Projects</p>
                <span className="up-pl-badge">{projects.length}</span>
            </div>

            <div>
                {projects.map((project, i) => {
                    const sm = STATUS_META[project.status] || STATUS_META.draft;
                    const rm = ROLE_META[project.my_role] || { label: project.my_role, bg: 'rgba(100,116,139,.1)', text: '#64748b' };
                    return (
                        <button
                            key={project.id}
                            className="pl-card"
                            style={{ animationDelay: `${i * 0.06}s` }}
                            onClick={() => handleClick(project)}
                        >
                            <div className="pl-card-bg" />
                            {/* left status accent bar */}
                            <div className="pl-accent" style={{ background: sm.bar }} />
                            <div className="pl-card-body">
                                <img
                                    src={project.logo_url || '/images/icons/project-icon.png'}
                                    alt=""
                                    className="pl-icon"
                                />
                                <div className="pl-info">
                                    <div className="pl-name">{project.name}</div>
                                    {project.description && (
                                        <div className="pl-desc">{project.description}</div>
                                    )}
                                    <div className="pl-location">
                                        <FiMapPin size={10} style={{ flexShrink:0 }} />
                                        <span>{project.location}</span>
                                        {project.client_name && (
                                            <>
                                                <span className="pl-loc-sep">·</span>
                                                <FiBriefcase size={10} style={{ flexShrink:0 }} />
                                                <span>{project.client_name}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="pl-meta">
                                    <span
                                        className="pl-status-pill"
                                        style={{ background: sm.bg, color: sm.color }}
                                    >
                                        <span style={{ width:5, height:5, borderRadius:'50%', background:sm.color, flexShrink:0, display:'inline-block' }} />
                                        {sm.label}
                                    </span>
                                    <span
                                        className="pl-role-chip"
                                        style={{ background: rm.bg, color: rm.text }}
                                    >
                                        {rm.label}
                                    </span>
                                </div>
                            </div>
                            <div className="pl-chevron">
                                <FiChevronRight size={15} />
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ProjectList;
    