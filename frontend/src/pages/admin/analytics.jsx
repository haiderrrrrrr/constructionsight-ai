import React, { useEffect, useState, useCallback } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { FiLayers, FiCheckCircle, FiCamera, FiUsers } from 'react-icons/fi'
import { BsArrowLeft, BsArrowRight, BsDot } from 'react-icons/bs'
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    FunnelChart as ReFunnelChart, Funnel, LabelList,
} from 'recharts'
import { PieChart } from '@mui/x-charts/PieChart'
import { Gauge, gaugeClasses } from '@mui/x-charts/Gauge'
import { SparkLineChart } from '@mui/x-charts/SparkLineChart'
import { chartsTooltipClasses } from '@mui/x-charts/ChartsTooltip'
import Stack from '@mui/material/Stack'
import Box from '@mui/material/Box'
import getIcon from '@/utils/getIcon'
import CardHeader from '@/components/shared/CardHeader'
import CardLoader from '@/components/shared/CardLoader'
import useCardTitleActions from '@/hooks/useCardTitleActions'
import PageLoader from '@/components/shared/PageLoader'
import { apiGet } from '@/utils/api'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const EVENT_LABELS = {
    // Project
    project_created:              'Project Created',
    project_edited:               'Project Edited',
    project_archived:             'Project Archived',
    project_unarchived:           'Project Restored',
    project_completed:            'Project Completed',
    project_uncompleted:          'Project Uncompleted',
    project_deleted:              'Project Deleted',
    pm_invited:                   'PM Invited',
    // Invitation
    invitation_accepted:          'Invite Accepted',
    invitation_rejected:          'Invite Rejected',
    invitation_resent_by_admin:   'Invite Resent',
    invitation_cancelled_by_admin:'Invite Cancelled',
    // Camera
    camera_created:               'Camera Added',
    camera_updated:               'Camera Updated',
    camera_credentials_updated:   'Credentials Updated',
    camera_verified:              'Camera Verified',
    camera_verify_started:        'Verify Started',
    camera_archived:              'Camera Archived',
    camera_unarchived:            'Camera Restored',
    camera_deleted:               'Camera Deleted',
    camera_logo_deleted:          'Logo Deleted',
    camera_zone_polygon_added:    'Zone Added',
    camera_zone_polygon_removed:  'Zone Removed',
    camera_assigned:              'Camera Assigned',
    camera_unassigned:            'Camera Unassigned',
    ai_started:                   'AI Started',
    ai_stopped:                   'AI Stopped',
    scheduler_config_updated:     'Scheduler Updated',
    ml_config_updated:            'ML Config Updated',
    // User
    user_approval_toggled:        'Approval Toggled',
    user_activation_toggled:      'Activation Toggled',
    user_role_changed:            'Role Changed',
    user_force_logout:            'Force Logout',
    // Report
    report_exported_manual:       'Report Exported',
    report_resent:                'Report Resent',
    report_triggered_manual:      'Report Triggered',
    report_deleted:               'Report Deleted',
    report_generated:             'Report Generated',
    report_email_partial_failure: 'Email Partial Fail',
    // BIM
    bim_model_uploaded:           'BIM Uploaded',
    bim_model_deleted:            'BIM Deleted',
}

const CATEGORY_COLOR = {
    project:    'primary',
    camera:     'success',
    zone:       'success',
    invitation: 'info',
    user:       'warning',
    report:     'secondary',
    system:     'danger',
    bim:        'info',
}

const prettifyEvent = (s) =>
    String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const getPagerItems = (pageCount, current) => {
    if (pageCount <= 1) return [1]
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
    const items = new Set([1, 2, pageCount - 1, pageCount, current - 1, current, current + 1])
    const nums  = Array.from(items).filter(n => n >= 1 && n <= pageCount).sort((a, b) => a - b)
    const out = []
    for (let i = 0; i < nums.length; i++) {
        const n = nums[i], prev = nums[i - 1]
        if (i > 0 && n - prev > 1) out.push('dots')
        out.push(n)
    }
    return out
}

const useDark = () => {
    const [isDark, setIsDark] = useState(
        () => document.documentElement.classList.contains('app-skin-dark')
    )
    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(
            () => setIsDark(el.classList.contains('app-skin-dark'))
        )
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])
    return isDark
}

// ─── Row 1: KPI Cards ────────────────────────────────────────────────────────

const KPICards = ({ stats, loading }) => {
    const items = [
        { icon: <FiLayers size={24} />,      number: loading ? '—' : (stats?.counts?.total_projects ?? 0), title: 'Total Projects',      color: 'primary' },
        { icon: <FiCheckCircle size={24} />, number: loading ? '—' : (stats?.counts?.active ?? 0),         title: 'Active Projects',     color: 'success' },
        { icon: <FiCamera size={24} />,      number: loading ? '—' : (stats?.counts?.total_cameras ?? 0),  title: 'Registered Cameras',  color: 'info'    },
        { icon: <FiUsers size={24} />,       number: loading ? '—' : (stats?.counts?.total_users ?? 0),    title: 'Registered Users',    color: 'warning' },
    ]
    return (
        <>
            {items.map(({ icon, number, title, color }, i) => (
                <div key={i} className="col-xxl-3 col-md-6">
                    <div className={`card bg-${color} border-${color} text-white overflow-hidden`}>
                        <div className="card-body">
                            <div className="fs-24">{icon}</div>
                            <h5 className="fs-4 text-reset mt-4 mb-1">{number}</h5>
                            <div className="fs-12 text-reset fw-normal">{title}</div>
                        </div>
                    </div>
                </div>
            ))}
        </>
    )
}

// ─── Row 2: Secondary Stat Cards ─────────────────────────────────────────────

const SecondaryCards = ({ items }) => (
    <>
        {items.map(({ color, count, icon, title }, i) => (
            <div key={i} className="col-xxl-3 col-md-6 customer-header-card">
                <div className="card stretch stretch-full">
                    <div className="card-body">
                        <div className="d-flex align-items-center justify-content-between">
                            <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                                <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                    {React.cloneElement(
                                        getIcon(icon) || getIcon('feather-alert-circle'),
                                        { size: 17, color: 'white', stroke: 'white' }
                                    )}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <span className="text-truncate-1-line fw-bold d-block">{title}</span>
                                    <span className="fs-24 fw-bolder d-block text-truncate-1-line">{count}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        ))}
    </>
)

// ─── Row 3a: Activity Trend (col-6) ──────────────────────────────────────────

const ActivityTrendCard = ({ stats, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); onRefresh?.() }
    const last7 = stats?.last_7_days
    const chartData = (last7?.labels ?? []).map((label, i) => ({
        name:   label,
        logins: last7.logins?.[i]      ?? 0,
        events: last7.events?.[i]      ?? 0,
        fails:  last7.login_fails?.[i] ?? 0,
    }))
    const totalLogins = (last7?.logins      ?? []).reduce((a, b) => a + b, 0)
    const totalFails  = (last7?.login_fails ?? []).reduce((a, b) => a + b, 0)
    const totalEvents = (last7?.events      ?? []).reduce((a, b) => a + b, 0)

    return (
        <div className="col-xxl-6">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="System Activity — Last 7 Days" refresh={refresh} expanded={handleExpand} />
                <div className="card-body custom-card-action">
                    {loading ? (
                        <PageLoader minHeight={240} />
                    ) : chartData.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-muted" style={{ minHeight: 240 }}>
                            <span className="fw-semibold mb-1">No data available</span>
                            <span className="fs-12">No activity recorded yet</span>
                        </div>
                    ) : (
                        <div className="admin-trend-chart">
                            <div className="d-flex justify-content-center mb-3">
                                <div className="d-flex gap-2 flex-wrap justify-content-center">
                                    <div className="rounded px-3 py-2 text-center bg-soft-primary">
                                        <div className="fs-16 fw-bold text-primary">{totalLogins}</div>
                                        <div className="fs-10 text-primary text-uppercase">Total Logins</div>
                                    </div>
                                    <div className="rounded px-3 py-2 text-center bg-soft-danger">
                                        <div className="fs-16 fw-bold text-danger">{totalFails}</div>
                                        <div className="fs-10 text-danger text-uppercase">Failed Logins</div>
                                    </div>
                                    <div className="rounded px-3 py-2 text-center bg-soft-info">
                                        <div className="fs-16 fw-bold text-info">{totalEvents}</div>
                                        <div className="fs-10 text-info text-uppercase">Total Events</div>
                                    </div>
                                </div>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 1 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--bs-border-color)" strokeOpacity={0.65} />
                                    <XAxis
                                        dataKey="name"
                                        stroke="var(--bs-border-color)"
                                        tick={{ fill: 'var(--bs-secondary-color)', fontSize: 11 }}
                                        axisLine={{ stroke: 'var(--bs-border-color)' }}
                                        tickLine={false}
                                        height={30}
                                    />
                                    <YAxis
                                        stroke="var(--bs-border-color)"
                                        tick={{ fill: 'var(--bs-secondary-color)', fontSize: 11 }}
                                        axisLine={{ stroke: 'var(--bs-border-color)' }}
                                        tickLine={false}
                                        allowDecimals={false}
                                        width={42}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bs-body-bg)',
                                            border: '1px solid var(--bs-border-color)',
                                            borderRadius: '6px',
                                            color: 'var(--bs-body-color)',
                                            fontSize: 12,
                                        }}
                                        labelStyle={{ color: 'var(--bs-body-color)', fontWeight: 600 }}
                                        cursor={{ stroke: 'var(--bs-border-color)', strokeWidth: 1, strokeDasharray: '4 3' }}
                                    />
                                    <Area type="monotone" dataKey="logins" name="Logins"       stroke="#445cf6" strokeWidth={2.5} fill="#445cf6" fillOpacity={0.15} dot={{ r: 3, fill: '#445cf6' }} activeDot={{ r: 6 }} isAnimationActive />
                                    <Area type="monotone" dataKey="events" name="Total Events" stroke="#28a745" strokeWidth={2}   fill="#28a745" fillOpacity={0.10} dot={{ r: 3, fill: '#28a745' }} activeDot={{ r: 5 }} isAnimationActive />
                                    <Area type="monotone" dataKey="fails"  name="Failed Logins" stroke="#dc3545" strokeWidth={2}  fill="#dc3545" fillOpacity={0.08} dot={{ r: 3, fill: '#dc3545' }} activeDot={{ r: 5 }} isAnimationActive />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ─── Row 3b: Project Status Pie (col-3) ──────────────────────────────────────

const ProjectStatusPieCard = ({ stats, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); onRefresh?.() }
    const counts = stats?.counts
    const pieData = [
        { id: 0, label: 'Active',   value: counts?.active   ?? 0, color: '#28a745' },
        { id: 1, label: 'Draft',    value: counts?.draft    ?? 0, color: '#5b73e8' },
        { id: 2, label: 'Setup',    value: counts?.setup    ?? 0, color: '#ff9f43' },
        { id: 3, label: 'Archived', value: counts?.archived ?? 0, color: '#6c757d' },
    ].filter(d => d.value > 0)
    const total = counts
        ? (counts.active + counts.draft + counts.setup + counts.archived)
        : 0

    return (
        <div className="col-xxl-3 col-sm-6">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Project Status" refresh={refresh} expanded={handleExpand} />
                <div className="card-body py-3 custom-card-action d-flex flex-column align-items-center">
                    {loading ? (
                        <PageLoader minHeight={220} />
                    ) : total === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                            <span className="fw-semibold d-block mb-1">No projects yet</span>
                            <span className="fs-12">Create a project to see breakdown</span>
                        </div>
                    ) : (
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                            <PieChart
                                width={300}
                                height={320}
                                series={[{
                                    data: pieData,
                                    innerRadius: 60,
                                    arcLabel: () => '',
                                    arcLabelMinAngle: 999,
                                    valueFormatter: (v) => {
                                        const val = typeof v === 'number' ? v : (v && typeof v === 'object' && 'value' in v ? v.value : v)
                                        return typeof val === 'number' ? val.toLocaleString() : String(val ?? '')
                                    },
                                }]}
                                skipAnimation={false}
                                slotProps={{
                                    pieArc: { stroke: 'transparent', strokeWidth: 0 },
                                    tooltip: {
                                        trigger: 'item',
                                        sx: {
                                            '& .MuiChartsTooltip-paper': { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' },
                                            '& .MuiChartsTooltip-table *': { color: 'var(--bs-body-color)' },
                                            'html.app-skin-dark & .MuiChartsTooltip-paper': { backgroundColor: 'rgba(10,18,32,0.96)', borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.92)' },
                                            'html.app-skin-dark & .MuiChartsTooltip-table *': { color: 'rgba(255,255,255,0.86)' },
                                        },
                                    },
                                    legend: {
                                        direction: 'horizontal',
                                        position: { vertical: 'top', horizontal: 'center' },
                                        sx: {
                                            '& .MuiChartsLegend-label': { color: 'var(--bs-body-color)', fill: 'var(--bs-body-color)', fontSize: 12, fontWeight: 600 },
                                            '& .MuiChartsLegend-mark': { rx: 3, ry: 3 },
                                            'html.app-skin-dark & .MuiChartsLegend-label': { color: 'rgba(255,255,255,0.80)', fill: 'rgba(255,255,255,0.80)' },
                                        },
                                    },
                                }}
                                sx={{
                                    '& .MuiPieChart-focusIndicator': { stroke: 'transparent' },
                                    '& .MuiPieChart-arc': { stroke: 'transparent' },
                                }}
                            />
                        </div>
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ─── Row 3c: Login Activity Funnel (col-3) ───────────────────────────────────

const LoginFunnelCard = ({ stats, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); onRefresh?.() }
    const last7      = stats?.last_7_days
    const totalLogins = (last7?.logins      ?? []).reduce((a, b) => a + b, 0)
    const totalFails  = (last7?.login_fails ?? []).reduce((a, b) => a + b, 0)
    const totalEvents = (last7?.events      ?? []).reduce((a, b) => a + b, 0)
    const hasData     = totalEvents > 0

    const funnelData = [
        { name: 'TOTAL EVENTS', value: 200, display: totalEvents, fill: '#5b73e8' },
        { name: 'LOGINS',       value: 160, display: totalLogins, fill: '#6c5ce7' },
        { name: 'FAILED',       value: 80,  display: totalFails,  fill: '#dc3545' },
    ]

    return (
        <div className="col-xxl-3 col-sm-6">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Login Activity (7 Days)" refresh={refresh} expanded={handleExpand} />
                <div className="card-body py-3 custom-card-action">
                    {loading ? (
                        <PageLoader minHeight={220} />
                    ) : !hasData ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                            <span className="fw-semibold d-block mb-1">No data available</span>
                            <span className="fs-12">No events in the last 7 days</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40, paddingBottom: 40 }}>
                            <div style={{ width: 340, height: 320 }}>
                                <ResponsiveContainer width={340} height={320}>
                                    <ReFunnelChart>
                                        <Tooltip
                                            formatter={(value, name, p) => [
                                                Number(p?.payload?.display ?? 0).toLocaleString(),
                                                p?.payload?.name || '',
                                            ]}
                                            contentStyle={{
                                                backgroundColor: 'var(--bs-body-bg)',
                                                border: '1px solid var(--bs-border-color)',
                                                borderRadius: 6,
                                                color: 'var(--bs-body-color)',
                                            }}
                                            labelStyle={{ color: 'var(--bs-body-color)' }}
                                        />
                                        <Funnel
                                            dataKey="value"
                                            data={funnelData}
                                            stroke="transparent"
                                            strokeWidth={0}
                                            isAnimationActive
                                            animationDuration={900}
                                            lastShapeType="rectangle"
                                        >
                                            <LabelList dataKey="display" position="inside" fill="white" fontSize={15} fontWeight={500} />
                                        </Funnel>
                                    </ReFunnelChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ─── Row 4a: Weekly Login Sparkline ──────────────────────────────────────────

const WeeklyLoginSparkCard = ({ stats, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); onRefresh?.() }
    const isDark        = useDark()
    const weeklyLogins  = stats?.weekly_activity?.logins ?? Array(7).fill(0)
    const isEmpty       = weeklyLogins.every(v => v === 0)

    return (
        <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
            <CardHeader title="Weekly Login Pattern" refresh={refresh} expanded={handleExpand} />
            <div className="card-body p-0 custom-card-action" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {loading ? (
                    <PageLoader minHeight={200} />
                ) : isEmpty ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ flex: 1, minHeight: 220, marginBottom: '1rem' }}>
                        <span className="fw-semibold d-block mb-1">No data available</span>
                        <span className="fs-12">No logins in the last 28 days</span>
                    </div>
                ) : (
                    <Stack direction="column" sx={{ width: '100%', flex: 1, justifyContent: 'space-between', p: 2 }}>
                        <Box sx={{ width: '100%', flex: 1 }}>
                            <SparkLineChart
                                plotType="bar"
                                data={weeklyLogins}
                                height={140}
                                showHighlight
                                showTooltip
                                color="#5b73e8"
                                slotProps={{
                                    tooltip: {
                                        sx: {
                                            [`& .${chartsTooltipClasses.paper}`]: { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' },
                                            [`& .${chartsTooltipClasses.table} *`]: { color: 'var(--bs-body-color)' },
                                            [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: { backgroundColor: 'rgba(10,18,32,0.96)', borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.92)' },
                                            [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: { color: 'rgba(255,255,255,0.86)' },
                                        },
                                    },
                                }}
                                sx={{
                                    width: '100%',
                                    '& .MuiChartsAxis-tickLabel': { fill: isDark ? 'rgba(255,255,255,0.72)' : 'var(--bs-secondary-color)', fontSize: 12 },
                                    '& .MuiChartsAxis-line': { stroke: isDark ? 'rgba(255,255,255,0.14)' : 'var(--bs-border-color)' },
                                    '& .MuiChartsAxis-tick': { stroke: isDark ? 'rgba(255,255,255,0.14)' : 'var(--bs-border-color)' },
                                }}
                            />
                        </Box>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: 8,
                            fontSize: 12,
                            color: isDark ? 'rgba(255,255,255,0.72)' : 'var(--bs-secondary-color)',
                        }}>
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                <span key={d}>{d}</span>
                            ))}
                        </div>
                    </Stack>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ─── Row 4b: Camera Online Rate Gauge ────────────────────────────────────────

const CameraHealthGaugeCard = ({ stats, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); onRefresh?.() }
    const isDark   = useDark()
    const total    = stats?.counts?.total_cameras  ?? 0
    const online   = stats?.counts?.online_cameras ?? 0
    const rate     = total > 0 ? Math.round((online / total) * 100) : 0
    const hasData  = total > 0

    const statusColor = rate >= 80 ? '#28a745' : rate >= 50 ? '#ffc107' : '#dc3545'
    const statusBadge = rate >= 80 ? 'bg-soft-success text-success' : rate >= 50 ? 'bg-soft-warning text-warning' : 'bg-soft-danger text-danger'
    const statusLabel = rate >= 80 ? 'Healthy' : rate >= 50 ? 'Degraded' : 'Critical'
    const textColor   = isDark ? 'rgba(255,255,255,0.92)' : 'var(--bs-heading-color)'

    return (
        <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
            <CardHeader title="Camera Online Rate" refresh={refresh} expanded={handleExpand} />
            <div className="card-body py-3 custom-card-action">
                {loading ? (
                    <PageLoader minHeight={180} />
                ) : !hasData ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No cameras registered</span>
                        <span className="fs-12">Add cameras to see health rate</span>
                    </div>
                ) : (
                    <div className="d-flex flex-column align-items-center gap-3">
                        <Gauge
                            value={rate}
                            startAngle={-110}
                            endAngle={110}
                            sx={{
                                color: textColor,
                                [`& .${gaugeClasses.valueArc}`]: { fill: statusColor },
                                [`& .${gaugeClasses.referenceArc}`]: { fill: 'rgba(128,128,128,0.1)' },
                                [`& .${gaugeClasses.valueText}`]: { fontSize: 42, fontWeight: 700, transform: 'translate(0px, 0px)', fill: textColor },
                                [`& .${gaugeClasses.valueText} tspan`]: { fill: textColor },
                            }}
                            text={() => `${rate}%`}
                        />
                        <span className={`badge ${statusBadge} fs-12 fw-bold text-uppercase`}>{statusLabel}</span>
                        <span className="fs-12 text-muted">{online} of {total} online</span>
                    </div>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ─── Row 4c: User Approval Rate Gauge ────────────────────────────────────────

const UserApprovalGaugeCard = ({ stats, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); onRefresh?.() }
    const isDark    = useDark()
    const total     = stats?.counts?.total_users    ?? 0
    const approved  = stats?.counts?.approved_users ?? 0
    const rate      = total > 0 ? Math.round((approved / total) * 100) : 0
    const hasData   = total > 0

    const statusColor = rate >= 80 ? '#28a745' : rate >= 50 ? '#ffc107' : '#dc3545'
    const statusBadge = rate >= 80 ? 'bg-soft-success text-success' : rate >= 50 ? 'bg-soft-warning text-warning' : 'bg-soft-danger text-danger'
    const statusLabel = rate >= 80 ? 'Excellent' : rate >= 50 ? 'Moderate' : 'Low'

    return (
        <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
            <CardHeader title="User Approval Rate" refresh={refresh} expanded={handleExpand} />
            <div className="card-body py-3 custom-card-action">
                {loading ? (
                    <PageLoader minHeight={180} />
                ) : !hasData ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No users registered</span>
                        <span className="fs-12">Invite users to see approval rate</span>
                    </div>
                ) : (
                    <div className="d-flex flex-column align-items-center gap-3">
                        <Gauge
                            value={rate}
                            startAngle={-110}
                            endAngle={110}
                            sx={{
                                color: isDark ? 'rgba(255,255,255,0.92)' : 'var(--bs-heading-color)',
                                [`& .${gaugeClasses.valueArc}`]: { fill: statusColor },
                                [`& .${gaugeClasses.referenceArc}`]: { fill: 'rgba(128,128,128,0.1)' },
                                [`& .${gaugeClasses.valueText}`]: { fontSize: 42, fontWeight: 700, transform: 'translate(0px, 0px)', fill: statusColor },
                                [`& .${gaugeClasses.valueText} tspan`]: { fill: statusColor },
                            }}
                            text={() => `${rate}%`}
                        />
                        <span className={`badge ${statusBadge} fs-12 fw-bold text-uppercase`}>{statusLabel}</span>
                        <span className="fs-12 text-muted">{approved} of {total} approved</span>
                    </div>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ─── Row 5: Audit Log Table (paginated, all time) ────────────────────────────

const PER_PAGE = 30

const RecentEventsTable = () => {
    const [page, setPage] = useState(1)

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'dashboard', 'events', page],
        queryFn:  () => apiGet(`/admin/projects/dashboard/events?page=${page}&per_page=${PER_PAGE}`),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
        refetchOnWindowFocus: 'always',
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    })

    const items      = data?.items ?? []
    const total      = data?.total ?? 0
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
    const canPrev    = page > 1
    const canNext    = page < totalPages
    const pagerItems = getPagerItems(totalPages, page)

    return (
        <div className="card stretch stretch-full">
            <div className="card-header">
                <div>
                    <h5 className="mb-0">Audit Log</h5>
                    <span className="fs-12 text-muted">Complete record of all platform actions</span>
                </div>
            </div>

            <div className="card-body p-0 admin-events-body d-flex flex-column">
                {items.length === 0 && isLoading ? (
                    <div className="text-center py-5 text-muted">Loading events…</div>
                ) : items.length === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted fs-13" style={{ flex: 1, minHeight: 220 }}>
                        <i className="feather-activity fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                        <span className="fw-semibold d-block mb-1">No records available</span>
                        <span className="fs-12">No audit entries recorded yet</span>
                    </div>
                ) : (
                    <div className="table-responsive admin-events-responsive">
                        <table className="table table-hover mb-0 align-middle w-100">
                            <thead>
                                <tr className="border-b">
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em', width: '25%' }}>Category</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em', width: '30%' }}>Action</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em', width: '25%' }}>Actor</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em', width: '20%' }}>Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((e, i) => {
                                    const label    = EVENT_LABELS[e.event_type] || prettifyEvent(e.event_type)
                                    const category = e.target_type || 'system'
                                    const catLabel = category.charAt(0).toUpperCase() + category.slice(1)
                                    const time     = e.created_at
                                        ? new Date(e.created_at).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                                        : '—'
                                    return (
                                        <tr key={e.id ?? i}>
                                            <td>
                                                <span className="badge bg-soft-success text-success fs-11 fw-semibold text-uppercase">{catLabel}</span>
                                            </td>
                                            <td>
                                                <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase">{label}</span>
                                            </td>
                                            <td>
                                                {e.actor_name
                                                    ? <span className="badge bg-soft-info text-info fs-11 fw-semibold">{e.actor_name}</span>
                                                    : <span className="text-muted fs-11">—</span>
                                                }
                                            </td>
                                            <td style={{ whiteSpace: 'nowrap', paddingRight: 15 }}>
                                                <span className="proj-meta d-inline-flex align-items-center gap-1">
                                                    <i className="feather-clock fs-11 opacity-75" />
                                                    <span className="proj-meta-text">{time}</span>
                                                </span>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {totalPages > 1 && (
                    <div className="px-3 py-3 border-top">
                        <div className="row gy-2">
                            <div className="col-sm-12 p-0">
                                <div className="dataTables_paginate paging_simple_numbers">
                                    <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style justify-content-md-end justify-content-center">
                                        <li className={!canPrev ? 'opacity-50 pe-none' : ''}>
                                            <a href="#" onClick={(e) => { e.preventDefault(); if (canPrev) setPage(p => p - 1) }} aria-label="Previous page">
                                                <BsArrowLeft size={16} />
                                            </a>
                                        </li>
                                        {pagerItems.map((item, idx) =>
                                            item === 'dots' ? (
                                                <li key={`dots-${idx}`}>
                                                    <a href="#" onClick={e => e.preventDefault()} aria-hidden="true">
                                                        <BsDot size={16} />
                                                    </a>
                                                </li>
                                            ) : (
                                                <li key={`p-${item}`}>
                                                    <a
                                                        href="#"
                                                        className={item === page ? 'active' : ''}
                                                        onClick={(e) => { e.preventDefault(); setPage(Number(item)) }}
                                                        aria-current={item === page ? 'page' : undefined}
                                                    >
                                                        {item}
                                                    </a>
                                                </li>
                                            )
                                        )}
                                        <li className={!canNext ? 'opacity-50 pe-none' : ''}>
                                            <a href="#" onClick={(e) => { e.preventDefault(); if (canNext) setPage(p => p + 1) }} aria-label="Next page">
                                                <BsArrowRight size={16} />
                                            </a>
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .admin-events-body { transition: none !important; }
                .admin-events-responsive {
                    transition: none !important;
                    overflow-x: auto !important;
                    overflow-y: visible !important;
                    -webkit-overflow-scrolling: touch;
                }
                .admin-events-responsive th:first-child,
                .admin-events-responsive td:first-child { padding-left: 15px !important; }
                .admin-events-responsive th:last-child,
                .admin-events-responsive td:last-child  { padding-right: 15px !important; text-align: right; }
            `}</style>
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const AdminAnalytics = () => {
    const queryClient = useQueryClient()

    const { data: stats, isFetching } = useQuery({
        queryKey: ['admin', 'dashboard', 'stats'],
        queryFn:  () => apiGet('/admin/projects/dashboard/stats'),
        staleTime: 30_000,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
    })

    const loading  = isFetching && !stats
    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard', 'stats'] })
    }, [queryClient])

    const counts = stats?.counts

    return (
        <>
            <PageHeader />

            <div className="main-content">

                <div className="row g-3 mb-4">
                    <KPICards stats={stats} loading={loading} />
                </div>

                <div className="row g-3 mb-4">
                    <SecondaryCards items={[
                        {
                            icon:  'feather-video',
                            title: 'Online Cameras',
                            count: loading ? '—' : String(counts?.online_cameras ?? 0),
                            color: 'info',
                        },
                        {
                            icon:  'feather-edit-3',
                            title: 'Draft Projects',
                            count: loading ? '—' : String(counts?.draft ?? 0),
                            color: 'primary',
                        },
                        {
                            icon:  'feather-user-check',
                            title: 'Pending Approval',
                            count: loading ? '—' : String((counts?.total_users ?? 0) - (counts?.approved_users ?? 0)),
                            color: 'warning',
                        },
                        {
                            icon:  'feather-archive',
                            title: 'Archived Projects',
                            count: loading ? '—' : String(counts?.archived ?? 0),
                            color: 'danger',
                        },
                    ]} />
                </div>

                <div className="row g-3 mb-4">
                    <ActivityTrendCard    stats={stats} loading={loading} onRefresh={invalidate} />
                    <ProjectStatusPieCard stats={stats} loading={loading} onRefresh={invalidate} />
                    <LoginFunnelCard      stats={stats} loading={loading} onRefresh={invalidate} />
                </div>

                <div className="row g-3 mb-4">
                    <div className="col-xxl-4 col-sm-6">
                        <WeeklyLoginSparkCard    stats={stats} loading={loading} onRefresh={invalidate} />
                    </div>
                    <div className="col-xxl-4 col-sm-6">
                        <CameraHealthGaugeCard   stats={stats} loading={loading} onRefresh={invalidate} />
                    </div>
                    <div className="col-xxl-4 col-sm-6">
                        <UserApprovalGaugeCard   stats={stats} loading={loading} onRefresh={invalidate} />
                    </div>
                </div>

                <div className="row g-3 mb-4">
                    <div className="col-12">
                        <RecentEventsTable />
                    </div>
                </div>

            </div>

            <style>{`
                html.app-skin-dark .admin-trend-chart .recharts-cartesian-axis-tick-value { fill: rgba(255,255,255,0.72) !important; }
                html.app-skin-dark .admin-trend-chart .recharts-cartesian-grid line       { stroke: rgba(255,255,255,0.10) !important; stroke-opacity: 0.85 !important; }
                html.app-skin-dark .admin-trend-chart .recharts-cartesian-axis-line       { stroke: rgba(255,255,255,0.14) !important; }
                html.app-skin-dark .admin-trend-chart .recharts-default-tooltip           { background: rgba(10,18,32,0.96) !important; border-color: rgba(255,255,255,0.12) !important; color: rgba(255,255,255,0.92) !important; }
                html.app-skin-dark .admin-trend-chart .recharts-default-tooltip *         { color: rgba(255,255,255,0.86) !important; }
                html.app-skin-dark .recharts-tooltip-wrapper .recharts-default-tooltip    { background: rgba(10,18,32,0.96) !important; border-color: rgba(255,255,255,0.12) !important; }
                html.app-skin-dark .recharts-tooltip-wrapper .recharts-default-tooltip *  { color: rgba(255,255,255,0.86) !important; }

                html.app-skin-dark .customer-header-card .card-body { color: rgba(255,255,255,0.86) !important; }
                html.app-skin-dark .customer-header-card .card-body .fw-bold,
                html.app-skin-dark .customer-header-card .card-body .fw-bolder { color: rgba(255,255,255,0.92) !important; }
            `}</style>
        </>
    )
}

export default AdminAnalytics
