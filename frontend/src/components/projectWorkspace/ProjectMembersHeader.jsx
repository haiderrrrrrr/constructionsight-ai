import React, { useEffect, useState } from 'react'
import { FiBarChart, FiFilter, FiList, FiUsers, FiShield, FiActivity, FiEye, FiPaperclip } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypePdf, BsFiletypeXml, BsFiletypeTsx, BsFiletypeExe, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { useNavigate, useLocation } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'
import topTostError from '@/utils/topTostError'

const ProjectMembersHeader = ({ projectId, myRole }) => {
    const navigate = useNavigate()
    const location = useLocation()
    const [statsOpen, setStatsOpen] = useState(true)
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    useEffect(() => {
        const el = document.getElementById('collapseProjectMembers')
        if (!el) return
        const onShown = () => setStatsOpen(true)
        const onHidden = () => setStatsOpen(false)
        el.addEventListener('shown.bs.collapse', onShown)
        el.addEventListener('hidden.bs.collapse', onHidden)
        setStatsOpen(el.classList.contains('show'))
        return () => {
            el.removeEventListener('shown.bs.collapse', onShown)
            el.removeEventListener('hidden.bs.collapse', onHidden)
        }
    }, [])

    const setFilter = (next) => {
        const p = new URLSearchParams(location.search)
        const value = String(next || '').toLowerCase()
        if (!value || value === 'all') p.delete('filter')
        else p.set('filter', value)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    const filterItems = [
        { label: 'All', icon: <FiList /> },
        { label: 'Project Manager', icon: <FiUsers /> },
        { label: 'Site Supervisor', icon: <FiActivity /> },
        { label: 'Safety Officer', icon: <FiShield /> },
        { label: 'Data Analyst', icon: <FiActivity /> },
        { label: 'Stakeholder', icon: <FiEye /> },
    ]

    const activeFilterLabel = (() => {
        const map = {
            all: 'All',
            project_manager: 'Project Manager',
            site_supervisor: 'Site Supervisor',
            safety_officer: 'Safety Officer',
            data_analyst: 'Data Analyst',
            stakeholder: 'Stakeholder',
        }
        return map[activeFilter] || 'All'
    })()

    const handleFilterClick = (label) => {
        const v = String(label || '').toLowerCase()
        const map = {
            all: 'all',
            'project manager': 'project_manager',
            'site supervisor': 'site_supervisor',
            'safety officer': 'safety_officer',
            'data analyst': 'data_analyst',
            stakeholder: 'stakeholder',
        }
        if (!map[v]) return
        setFilter(map[v])
    }

    const fileType = [
        { label: "PDF", icon: <BsFiletypePdf /> },
        { label: "CSV", icon: <BsFiletypeCsv /> },
        { label: "XML", icon: <BsFiletypeXml /> },
        { label: "Text", icon: <BsFiletypeTsx /> },
        { label: "Excel", icon: <BsFiletypeExe /> },
        { label: "Print", icon: <BsPrinter /> },
    ]

    const handleFileExport = (label) => {
        const v = String(label || '').toLowerCase()
        window.dispatchEvent(new CustomEvent('cs:members-export', { detail: { format: v } }))
    }

    const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
            <button
                type="button"
                className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                data-bs-toggle="collapse"
                data-bs-target="#collapseProjectMembers"
                aria-expanded={statsOpen ? 'true' : 'false'}
                aria-controls="collapseProjectMembers"
                onClick={closePanel}
            >
                <FiBarChart size={16} />
                <span className="d-inline d-md-none ms-2">Statistics</span>
            </button>
            <Dropdown
                dropdownItems={filterItems}
                triggerPosition={"0, 12"}
                triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                triggerClass='btn btn-icon btn-light-brand'
                triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
                isAvatar={false}
                onClick={(label) => { handleFilterClick(label); closePanel() }}
                active={activeFilterLabel}
                dataBsToggle=""
            />
            <Dropdown
                dropdownItems={fileType}
                triggerPosition={"0, 12"}
                triggerIcon={<FiPaperclip size={16} strokeWidth={1.6} />}
                triggerClass='btn btn-icon btn-light-brand'
                triggerText={<span className="d-inline d-md-none ms-2">Export</span>}
                iconStrokeWidth={0}
                isAvatar={false}
                onClick={(label) => { handleFileExport(label); closePanel() }}
                dataBsToggle=""
            />
        </div>
    )
}

export const ProjectMembersHeaderContent = ({ projectId }) => {
    const [stats, setStats] = useState({
        project_manager: 0,
        site_supervisor: 0,
        safety_officer: 0,
        data_analyst: 0,
        stakeholder: 0,
    })
    const [useEventStats, setUseEventStats] = useState(false)
    const location = useLocation()
    const navigate = useNavigate()

    const load = React.useCallback(() => {
        apiGet(`/projects/${projectId}/members`)
            .then(members => {
                const counts = {
                    project_manager: 0,
                    site_supervisor: 0,
                    safety_officer: 0,
                    data_analyst: 0,
                    stakeholder: 0,
                }
                members.forEach(m => {
                    if (counts.hasOwnProperty(m.project_role)) {
                        counts[m.project_role]++
                    }
                })
                setStats(counts)
            })
            .catch(() => topTostError('Failed to load member stats'))
    }, [projectId])

    useEffect(() => {
        const onStats = (payload) => {
            const d = payload || {}
            setStats({
                project_manager: Number(d.project_manager || 0),
                site_supervisor: Number(d.site_supervisor || 0),
                safety_officer: Number(d.safety_officer || 0),
                data_analyst: Number(d.data_analyst || 0),
                stakeholder: Number(d.stakeholder || 0),
            })
            setUseEventStats(true)
        }
        const unsubStats = onBroadcast('cs:project-members-stats', onStats)
        return () => { unsubStats() }
    }, [load])

    useEffect(() => {
        if (useEventStats) return
        load()
    }, [useEventStats, load])

    const roleLabels = {
        project_manager: 'Project Managers',
        site_supervisor: 'Site Supervisors',
        safety_officer: 'Safety Officers',
        data_analyst: 'Data Analysts',
        stakeholder: 'Stakeholders',
    }

    return (
        <>
            <style>{`
                html:not(.app-skin-dark) #collapseProjectMembers .customer-header-card .card {
                    border: 1px solid rgba(15, 23, 42, 0.1);
                    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
                }
            `}</style>
            <div id="collapseProjectMembers" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {[
                        { role: 'project_manager', icon: 'feather-briefcase', color: 'success' },
                        { role: 'site_supervisor', icon: 'feather-activity', color: 'primary' },
                        { role: 'safety_officer', icon: 'feather-shield', color: 'danger' },
                        { role: 'data_analyst', icon: 'feather-bar-chart-2', color: 'warning' },
                        { role: 'stakeholder', icon: 'feather-eye', color: 'info' },
                    ].map(({ role, icon, color }) => (
                        <div key={role} className="col-xxl-3 col-md-6 customer-header-card">
                            <a
                                href="#"
                                className="card stretch stretch-full text-decoration-none"
                                onClick={(e) => {
                                    e.preventDefault()
                                    const p = new URLSearchParams(location.search)
                                    if (!role || role === 'all') p.delete('filter')
                                    else p.set('filter', role)
                                    const search = p.toString()
                                    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
                                }}
                            >
                                <div className="card-body">
                                    <div className="d-flex align-items-center justify-content-between">
                                        <div className="d-flex align-items-center gap-3">
                                            <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                                {React.cloneElement(getIcon(icon), { size: 17 })}
                                            </div>
                                            <span className="fw-bold d-block">
                                                <span className="text-truncate-1-line">{roleLabels[role]}</span>
                                                <span className="fs-24 fw-bolder d-block">{Number(stats[role] || 0).toLocaleString()}</span>
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </a>
                        </div>
                    ))}
                </div>
            </div>
            </div>
        </>
    )
}

export default ProjectMembersHeader
