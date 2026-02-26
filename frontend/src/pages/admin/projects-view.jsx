import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FiCheckCircle, FiCalendar, FiUsers, FiUser, FiMapPin, FiFileText, FiBriefcase, FiActivity } from 'react-icons/fi'
import ImageGroup from '@/components/shared/ImageGroup'
import ReactApexChart from 'react-apexcharts'
import { projectViewAreaChartOptions } from '@/utils/chartsLogic/projectViewAreaChartOptions'
import { apiGet, apiPost } from '@/utils/api'
import { onBroadcast, broadcastRefresh } from '@/utils/broadcast'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import { getProjectStatusMeta } from '@/utils/projectStatusMeta'
import ProjectViewHeader from '@/components/projectsView/ProjectViewHeader'
import AdminProjectCamerasTab from '@/components/projectsView/AdminProjectCamerasTab'

const DEFAULT_AVATAR = '/images/icons/profile-picture.png'

const buildTaskChartData = (tasks, projectCreatedAt) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    const projectStart = projectCreatedAt ? new Date(projectCreatedAt) : null
    if (projectStart) projectStart.setHours(0, 0, 0, 0)
    const startDay = (projectStart && projectStart > sevenDaysAgo) ? projectStart : sevenDaysAgo
    const days = []
    const cursor = new Date(startDay)
    while (cursor <= today) {
        days.push(new Date(cursor))
        cursor.setDate(cursor.getDate() + 1)
    }
    const labels = days.map(d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    const created = days.map(day => {
        const next = new Date(day); next.setDate(next.getDate() + 1)
        return tasks.filter(t => { const at = t.created_at ? new Date(t.created_at) : null; return at && at >= day && at < next }).length
    })
    const done = days.map(day => {
        const next = new Date(day); next.setDate(next.getDate() + 1)
        return tasks.filter(t => { const at = t.done_at ? new Date(t.done_at) : null; return at && at >= day && at < next }).length
    })
    return { labels, created, done }
}

const AdminProjectsView = () => {
    const { id } = useParams()
    const [project, setProject] = useState(null)
    const [members, setMembers] = useState([])
    const [progressPct, setProgressPct] = useState(0)
    const [taskChartData, setTaskChartData] = useState(null)
    const [activeTab, setActiveTab] = useState('overview')
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('app-skin-dark'))
    const baseChartOptions = projectViewAreaChartOptions()

    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    const loadData = useCallback(async () => {
        try {
            const [projData, membersData, tasksData] = await Promise.all([
                apiGet(`/admin/projects/${id}`),
                apiGet(`/admin/projects/${id}/members`),
                apiGet(`/admin/projects/${id}/tasks`).catch(() => []),
            ])
            setProject(projData)
            setMembers(membersData || [])
            const tasks = Array.isArray(tasksData) ? tasksData : []
            if (tasks.length > 0) {
                const completed = tasks.filter(t => t?.is_done).length
                setProgressPct(Math.round((completed / tasks.length) * 100))
            } else {
                setProgressPct(0)
            }
            setTaskChartData(buildTaskChartData(tasks, projData.created_at))
        } catch (err) {
            console.error('Failed to load project data:', err)
            setProgressPct(0)
            setTaskChartData(buildTaskChartData([], null))
        }
    }, [id])

    useEffect(() => { loadData() }, [loadData])

    // Broadcast listener for project changes
    useEffect(() => {
        const handler = () => loadData()
        window.addEventListener('cs:projects-stats-refresh', handler)
        const unsub = onBroadcast('cs:projects-stats-refresh', handler)
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', handler)
            unsub()
        }
    }, [loadData])

    // Broadcast listeners for zone and camera changes
    useEffect(() => {
        const handler = () => loadData()
        window.addEventListener('cs:project-zones-refresh', handler)
        window.addEventListener('cs:project-cameras-refresh', handler)
        const unsubZones = onBroadcast('cs:project-zones-refresh', handler)
        const unsubCameras = onBroadcast('cs:project-cameras-refresh', handler)
        return () => {
            window.removeEventListener('cs:project-zones-refresh', handler)
            window.removeEventListener('cs:project-cameras-refresh', handler)
            unsubZones()
            unsubCameras()
        }
    }, [loadData])

    // Visibility change listener
    useEffect(() => {
        const handler = () => { if (!document.hidden) loadData() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [loadData])

    const handleMarkComplete = async () => {
        try {
            await apiPost(`/admin/projects/${id}/complete`, {})
            setProject(prev => ({ ...prev, status: 'completed' }))
            broadcastRefresh('cs:projects-stats-refresh')
            topTost('Project marked as complete')
        } catch (err) {
            topTostError(err?.response?.data?.detail || 'Failed to mark as complete')
        }
    }

    const handleUnmarkComplete = async () => {
        try {
            await apiPost(`/admin/projects/${id}/uncomplete`, {})
            setProject(prev => ({ ...prev, status: 'active' }))
            broadcastRefresh('cs:projects-stats-refresh')
            topTost('Project marked as active')
        } catch (err) {
            topTostError(err?.response?.data?.detail || 'Failed to unmark complete')
        }
    }

    const chartOptions = taskChartData ? {
        ...baseChartOptions,
        chart: { ...baseChartOptions.chart, foreColor: isDark ? 'rgba(255,255,255,0.62)' : '#64748b' },
        xaxis: {
            ...baseChartOptions.xaxis,
            categories: taskChartData.labels,
            labels: { ...baseChartOptions.xaxis?.labels, style: { ...(baseChartOptions.xaxis?.labels?.style || {}), colors: isDark ? 'rgba(255,255,255,0.62)' : '#64748b' } },
        },
        yaxis: {
            min: 0,
            max: (() => { const maxVal = Math.max(0, ...taskChartData.created, ...taskChartData.done); return Math.max(5, Math.ceil((maxVal || 1) / 5) * 5) })(),
            tickAmount: 5,
            labels: { formatter: (v) => Math.round(v), offsetX: -15, offsetY: 0, style: { fontSize: '10px', colors: isDark ? 'rgba(255,255,255,0.62)' : '#64748b' } },
        },
        grid: { ...baseChartOptions.grid, borderColor: isDark ? 'rgba(255,255,255,0.10)' : '#ebebf3', row: { ...(baseChartOptions.grid?.row || {}), colors: [isDark ? 'rgba(255,255,255,0.10)' : '#ebebf3', 'transparent'], opacity: isDark ? 0.05 : 0.02 } },
        tooltip: { ...baseChartOptions.tooltip, theme: isDark ? 'dark' : 'light', y: { formatter: (v) => `${Math.round(v)} tasks` } },
        series: [
            { name: 'Tasks Created', data: taskChartData.created, type: 'area' },
            { name: 'Tasks Done', data: taskChartData.done, type: 'area' },
        ],
    } : baseChartOptions

    const activeMembers = members.filter(m => m.status === 'active')
    const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : 'N/A')
    const statusMeta = getProjectStatusMeta(project?.status)

    let progressColorClass = 'bg-danger'
    if (progressPct >= 67) progressColorClass = 'bg-success'
    else if (progressPct >= 34) progressColorClass = 'bg-warning'
    const progressTextClass = progressColorClass.replace('bg-', 'text-')

    const DetailLabel = ({ Icon, children }) => (
        <label className="form-label fs-10 fw-bold text-muted text-uppercase project-info-label d-inline-flex align-items-center gap-2">
            <span className="cam-icon-wrap"><Icon size={13} strokeWidth={2} /></span>
            {children}
        </label>
    )

    const statCards = project ? (() => {
        const statusColor = project.status === 'active' ? 'success' : project.status === 'draft' ? 'danger' : 'warning'
        const duration = project.start_date && project.end_date
            ? (() => {
                const start = new Date(project.start_date)
                const end = new Date(project.end_date)
                const total = Math.ceil((end - start) / (1000 * 60 * 60 * 24))
                const elapsed = Math.ceil((new Date() - start) / (1000 * 60 * 60 * 24))
                return `Day ${Math.max(0, elapsed)} of ${total}`
            })()
            : 'N/A'
        return [
            { key: 'status', icon: <FiCheckCircle />, value: statusMeta.label || 'N/A', label: 'Project Status', color: statusColor },
            { key: 'duration', icon: <FiCalendar />, value: duration, label: 'Duration', color: 'info' },
            { key: 'team', icon: <FiUsers />, value: String(activeMembers.length), label: 'Team Size', color: 'primary' },
            { key: 'client', icon: <FiUser />, value: (project.client_name || 'N/A').substring(0, 10), label: 'Client', color: 'warning' },
        ]
    })() : []

    return (
        <>
            <PageHeader>
                <ProjectViewHeader project={project} showPin={false} onMarkComplete={handleMarkComplete} onUnmarkComplete={handleUnmarkComplete} />
            </PageHeader>
            <style>{`
                .customers-nav-tabs { margin-bottom: -1px; }
                .customers-nav-tabs { padding-left: 0; padding-right: 0; }
                html.app-skin-dark .customers-nav-tabs .nav-item.border-top { border-top-color: rgba(255,255,255,0.10) !important; }
                .customers-nav-tabs .nav-item .nav-link {
                    border: none;
                    padding: 20px 30px;
                    color: var(--bs-body-color);
                    font-weight: 600;
                    border-radius: 0;
                    border-bottom: 3px solid transparent;
                    transition: all 0.3s ease;
                }
                .customers-nav-tabs .nav-item .nav-link.active {
                    color: var(--bs-primary);
                    border-bottom: 3px solid var(--bs-primary);
                    background-color: rgba(var(--bs-primary-rgb), 0.08);
                }
                html.app-skin-dark .customers-nav-tabs .nav-item .nav-link.active {
                    background-color: rgba(var(--bs-primary-rgb), 0.16);
                }
            `}</style>
            <div className="bg-white border-bottom px-0">
                <ul className="nav nav-tabs w-100 text-center customers-nav-tabs mb-0 nav-justified" role="tablist">
                    <li className="nav-item flex-fill border-top" role="presentation">
                        <button
                            type="button"
                            className={`nav-link ${activeTab === 'overview' ? 'active' : ''} text-uppercase fw-bold`}
                            style={{ fontSize: '11px', letterSpacing: '0.08em', padding: '16px' }}
                            onClick={() => setActiveTab('overview')}
                        >
                            Overview
                        </button>
                    </li>
                    <li className="nav-item flex-fill border-top" role="presentation">
                        <button
                            type="button"
                            className={`nav-link ${activeTab === 'cameras' ? 'active' : ''} text-uppercase fw-bold`}
                            style={{ fontSize: '11px', letterSpacing: '0.08em', padding: '16px' }}
                            onClick={() => setActiveTab('cameras')}
                        >
                            Cameras
                        </button>
                    </li>
                </ul>
            </div>
            {activeTab === 'cameras' && (
                <AdminProjectCamerasTab projectId={id} projectStatus={project?.status} projectSiteId={project?.site_id} />
            )}
            <div className="main-content project-info-premium" style={{ display: activeTab === 'overview' ? '' : 'none' }}>
                <div className="tab-pane fade active show" id="overviewTab">
                    <div className="row">
                        <div className="col-lg-12">
                            <div className="card stretch stretch-full">
                                <div className="card-body task-header d-md-flex align-items-center justify-content-between py-3">
                                    <div className="me-4">
                                        {project && (
                                            <>
                                                <h4 className="mb-2 fw-bold d-flex align-items-center gap-3 project-info-title">
                                                    <span className="text-truncate-1-line">{project.name || 'Project'}</span>
                                                    <span className={`${statusMeta.badge} fs-11 fw-bold text-uppercase`}>
                                                        {statusMeta.label}
                                                    </span>
                                                </h4>
                                                <div className="d-flex align-items-center">
                                                    <div className="img-group lh-0 justify-content-start">
                                                        <ImageGroup
                                                            data={activeMembers.map(m => ({
                                                                id: m.user_id,
                                                                user_name: m.full_name,
                                                                user_img: m.avatar_url || DEFAULT_AVATAR,
                                                            }))}
                                                            avatarSize='avatar-md'
                                                            avatarImageStyle="cam-logo-circle"
                                                            avatarStyle="cam-logo-circle"
                                                        />
                                                        <span className="d-none d-sm-flex">
                                                            <span className="fs-12 fw-semibold text-muted ms-3 text-truncate-1-line project-info-members">
                                                                {activeMembers.length} members
                                                            </span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="col-xl-8">
                            <div className="card stretch stretch-full">
                                <div className="card-body project-info-details-grid">
                                    <div className="d-flex align-items-center justify-content-between mb-2">
                                        <div className="form-label fs-10 fw-bold text-muted text-uppercase project-info-label d-inline-flex align-items-center gap-2 mb-0">
                                            <span className="cam-icon-wrap"><FiActivity size={13} strokeWidth={2} /></span>
                                            Progress
                                        </div>
                                        <span className={`fs-12 fw-semibold ${progressTextClass}`}>{progressPct}%</span>
                                    </div>
                                    <div className="d-flex align-items-center gap-2 mb-4">
                                        <div className="progress flex-grow-1 ht-3" style={{ minWidth: '80px' }}>
                                            <div
                                                className={`progress-bar ${progressColorClass}`}
                                                role="progressbar"
                                                style={{ width: `${progressPct}%` }}
                                                aria-valuenow={progressPct}
                                                aria-valuemin={0}
                                                aria-valuemax={100}
                                            />
                                        </div>
                                    </div>
                                    <div className="row">
                                        {project && (
                                            <>
                                                <div className="col-md-6 mb-4">
                                                    <DetailLabel Icon={FiBriefcase}>Project</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value">{project.name || 'N/A'}</p>
                                                </div>
                                                <div className="col-md-6 mb-4">
                                                    <DetailLabel Icon={FiActivity}>Status</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value">{statusMeta.label || 'N/A'}</p>
                                                </div>
                                                <div className="col-md-6 mb-4">
                                                    <DetailLabel Icon={FiMapPin}>Location</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value">{project.location || 'N/A'}</p>
                                                </div>
                                                <div className="col-md-6 mb-4">
                                                    <DetailLabel Icon={FiUser}>Client Name</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value">{project.client_name || 'N/A'}</p>
                                                </div>
                                                <div className="col-md-6 mb-4">
                                                    <DetailLabel Icon={FiCalendar}>Start Date</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value">{formatDate(project.start_date)}</p>
                                                </div>
                                                <div className="col-md-6 mb-4">
                                                    <DetailLabel Icon={FiCalendar}>End Date</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value">{formatDate(project.end_date)}</p>
                                                </div>
                                                <div className="col-md-12">
                                                    <DetailLabel Icon={FiFileText}>Description</DetailLabel>
                                                    <p className="mb-0 fs-13 fw-normal text-muted project-info-value project-info-description">
                                                        {project.description || 'No description provided'}
                                                    </p>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="col-xl-4">
                            {project && (
                                <div className="row g-3 mb-3">
                                    {statCards.map(({ key, icon, value, label, color }) => (
                                        <div key={key} className="col-6">
                                            <div className={`card bg-${color} border-${color} text-white overflow-hidden h-100`}>
                                                <div className="card-body">
                                                    <i className="fs-20">{icon}</i>
                                                    <h5 className="fs-4 text-reset mt-4 mb-1">{value}</h5>
                                                    <div className="fs-12 text-reset fw-normal">{label}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="card">
                                <div className="card-header">
                                    <div>
                                        <h5 className="mb-0">Task Activity</h5>
                                        <span className="fs-12 text-muted">Last 7 days</span>
                                    </div>
                                </div>
                                <ReactApexChart
                                    options={chartOptions}
                                    series={chartOptions?.series}
                                    type='area'
                                    height={230}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default AdminProjectsView
