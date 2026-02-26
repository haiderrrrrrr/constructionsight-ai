/**
 * workforce-analytics.jsx — Workforce Analytics page
 *
 * Live project workforce dashboard:
 *  - Project selector in PageHeader (global route only)
 *  - WorkforceDashboard (all charts, KPI cards, trend, alerts)
 *  - WorkforceLiveAlerts (floating toast portal)
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import PageLoader from '@/components/shared/PageLoader'
import { QK } from '@/utils/queryKeys'
import { FiUsers } from 'react-icons/fi'
import { apiGet, API_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import PageHeaderDate from '@/components/shared/pageHeader/PageHeaderDate'
import WorkforceDashboard from '@/components/projectWorkspace/WorkforceDashboard'
import WorkforceLiveAlertToasts from '@/components/projectWorkspace/WorkforceLiveAlertToasts'
import LiveAlertsHub from '@/components/projectWorkspace/LiveAlertsHub'


const ALLOWED_ROLES = ['project_manager', 'site_supervisor', 'safety_officer']

const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const endOfDay   = (d = new Date()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x }

export default function WorkforceAnalytics() {
    const { projectId: urlProjectId } = useParams()
    const isProjectScoped = !!urlProjectId

    const [projects,        setProjects]        = useState([])
    const [projectsLoading, setProjectsLoading] = useState(!isProjectScoped)
    const [selectedProject, setSelectedProject] = useState(
        isProjectScoped ? { id: parseInt(urlProjectId) } : null
    )

    // Default filter: Live (same as PPE dashboard)
    const [dateFilter, setDateFilter] = useState(() => ({
        preset: 'live',
        from:   startOfDay(),
        to:     endOfDay(),
    }))

    const [exporting, setExporting] = useState(false)

    const isLive = dateFilter.preset === 'live'

    // Shared with WorkforceDashboard via React Query cache — no extra network request.
    const pid = selectedProject?.id
    const { data: wfStatusPage } = useQuery({
        queryKey: QK.wfStatus(pid),
        queryFn: () => apiGet(`/projects/${pid}/cameras/features`).catch(() => null),
        staleTime: 30_000,
        enabled: !!pid,
    })
    const featureActive = useMemo(() => {
        const cams = wfStatusPage?.cameras ?? (Array.isArray(wfStatusPage) ? wfStatusPage : [])
        return cams.some(c => c?.features?.workforce_enabled === true)
    }, [wfStatusPage])

    const wfServerLiveStart = useMemo(() => (
        wfStatusPage?.workforce_live_session_start ??
        wfStatusPage?.live_session_start ??
        null
    ), [wfStatusPage])

    const handleExport = async () => {
        if (exporting || !selectedProject) return
        if (isLive && featureActive && !wfServerLiveStart) {
            topTostError('Workforce live session start is not available yet. Please wait a moment and try again.')
            return
        }
        setExporting(true)
        try {
            const token = window.sessionStorage.getItem('access_token')
            const exportFrom = isLive ? new Date(wfServerLiveStart) : dateFilter.from
            const exportTo   = isLive ? new Date()           : dateFilter.to
            const label = isLive
                ? `live_${new Date().toISOString().slice(0, 10)}`
                : dateFilter.preset && dateFilter.preset !== 'custom'
                    ? dateFilter.preset.replace(/_/g, '_')
                    : `${dateFilter.from.toISOString().slice(0, 10)}_to_${dateFilter.to.toISOString().slice(0, 10)}`
            const res = await fetch(`${API_BASE}/projects/${selectedProject.id}/reports/export`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include',
                body: JSON.stringify({
                    start_date:  exportFrom.toISOString(),
                    end_date:    exportTo.toISOString(),
                    report_type: 'workforce',
                }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err?.detail || 'Report generation failed.')
            }
            const blob = await res.blob()
            const url  = window.URL.createObjectURL(blob)
            const a    = document.createElement('a')
            a.href     = url
            a.download = `Workforce_Analytics_Report_${label}.pdf`
            document.body.appendChild(a); a.click(); document.body.removeChild(a)
            window.URL.revokeObjectURL(url)
            window.dispatchEvent(new Event('cs:report-status-changed'))
            topTostError('Workforce Analytics Report downloaded successfully.', 'success')
        } catch (err) {
            if (err?.name !== 'AbortError') topTostError(err.message || 'Failed to generate report.')
        } finally {
            setExporting(false)
        }
    }

    useEffect(() => {
        if (isProjectScoped) return
        setProjectsLoading(true)
        apiGet('/projects/my')
            .then(data => {
                const list    = Array.isArray(data) ? data : (data?.projects || [])
                const allowed = list.filter(p =>
                    ALLOWED_ROLES.includes(p.my_role) && p.status === 'active'
                )
                setProjects(allowed)
                if (allowed.length > 0) setSelectedProject(allowed[0])
            })
            .catch(() => topTostError('Failed to load projects.'))
            .finally(() => setProjectsLoading(false))
    }, [isProjectScoped])

    function handleProjectChange(projectId) {
        const proj = projects.find(p => p.id === parseInt(projectId))
        if (proj) setSelectedProject(proj)
    }

    if (!isProjectScoped && projectsLoading) return <PageLoader minHeight="60vh" />

    if (!isProjectScoped && projects.length === 0) {
        return (
            <>
                <PageHeader />
                <div className="main-content">
                    <div className="card stretch stretch-full">
                        <div className="card-body d-flex flex-column align-items-center justify-content-center py-5 text-muted gap-3">
                            <FiUsers size={40} className="opacity-25" />
                            <div className="text-center">
                                <div className="fw-semibold mb-1">No Accessible Projects</div>
                                <div className="fs-12">
                                    Workforce Analytics is available to Project Managers, Site Supervisors, and Safety Officers on active projects.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            <PageHeader projectCrumbsKey={isProjectScoped ? "reports" : undefined} projectCrumbsLeaf={isProjectScoped ? "workforce" : undefined}>
                <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                    {!isProjectScoped && (
                        <select
                            className="form-select form-select-sm"
                            style={{ minWidth: 200, fontSize: 13 }}
                            value={selectedProject?.id || ''}
                            onChange={e => handleProjectChange(e.target.value)}
                        >
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    )}
                    <PageHeaderDate
                        range={{ startDate: dateFilter.from, endDate: dateFilter.to }}
                        onApplyRange={({ startDate, endDate }) => setDateFilter({
                            preset: 'custom',
                            from: startOfDay(new Date(startDate)),
                            to:   endOfDay(new Date(endDate)),
                        })}
                        onExport={handleExport}
                        exporting={exporting}
                        exportDisabled={isLive && featureActive === false}
                        exportDisabledTitle="Enable Workforce Analytics on at least one camera to generate reports"
                        liveMode={isLive}
                        onLiveSelect={() => {
                            setDateFilter({ preset: 'live', from: startOfDay(), to: endOfDay() })
                        }}
                        showLiveDot={true}
                        liveDotPulse={isLive && featureActive}
                        hidePrefixWhenLive={true}
                    />
                </div>
            </PageHeader>

            <div className="main-content">
                {selectedProject && (
                    <WorkforceDashboard
                        projectId={selectedProject.id}
                        dateFilter={dateFilter}
                    />
                )}
            </div>

            {!isProjectScoped && selectedProject && (
                <>
                    <LiveAlertsHub projectId={selectedProject.id} />
                    <WorkforceLiveAlertToasts projectId={selectedProject.id} />
                </>
            )}

        </>
    )
}
