import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { QK } from '@/utils/queryKeys'
import { FiAlertTriangle } from 'react-icons/fi'
import { BiSolidHardHat } from 'react-icons/bi'
import { GiArmorVest } from 'react-icons/gi'
import { MdDangerous } from 'react-icons/md'
import ReactApexChart from 'react-apexcharts'
import { earningsExpensesChartOption } from '@/utils/chartsLogic/earningsExpensesChartOption'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, FunnelChart as ReFunnelChart, Funnel, LabelList } from 'recharts'
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
import { apiGet, API_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import PPEZoneBreakdown from './PPEZoneBreakdown'
import PPEIncidentsTable from './PPEIncidentsTable'
import usePPEStream from '@/hooks/usePPEStream'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { patchIncidentInCache } from '@/utils/ppeCacheUtils'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import PageHeaderDate from '@/components/shared/pageHeader/PageHeaderDate'


// ── Constants ─────────────────────────────────────────────────────────────────
const INCIDENT_LABELS = {
    no_helmet:    { short: 'No Helmet',      color: 'warning' },
    no_vest:      { short: 'No Vest',        color: 'warning' },
    both_missing: { short: 'No Helmet/Vest', color: 'danger'  },
}

const complianceColor = r => r >= 90 ? 'success' : r >= 70 ? 'warning' : 'danger'

// ── PPE KPI Cards (100% styled from UserOverviewStatisticsThree) ──────────────
// Option 2: By PPE Type + Severity (Head > Body > Combined Overview)
const PPEKPICards = ({ summary, loading }) => {
    const statisticsData = [
        { icon: <FiAlertTriangle size={24} />, number: loading ? '—' : (summary?.violations_today ?? 0), title: 'Total Violations', color: 'primary' },
        { icon: <BiSolidHardHat size={24} />, number: loading ? '—' : (summary?.no_helmet_today ?? 0), title: 'Helmet Non-Compliance', color: 'warning' },
        { icon: <GiArmorVest size={24} />, number: loading ? '—' : (summary?.no_vest_today ?? 0), title: 'Vest Non-Compliance', color: 'success' },
        { icon: <MdDangerous size={24} />, number: loading ? '—' : (summary?.both_missing_today ?? 0), title: 'Critical Safety Violations', color: 'danger' }
    ]

    return (
        <>
            {statisticsData.map(({ icon, number, title, color }, index) => (
                <div key={index} className="col-xxl-3 col-md-6">
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

// ── Date helpers ──────────────────────────────────────────────────────────────
const startOfDay  = (d = new Date()) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const endOfDay    = (d = new Date()) => { const x = new Date(d); x.setHours(23,59,59,999); return x }
const addDays     = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const PRESETS = [
    {
        key: 'today', label: 'Today',
        range: () => ({ from: startOfDay(), to: endOfDay() }),
    },
    {
        key: 'this_week', label: 'This Week',
        range: () => {
            const d = new Date()
            return { from: startOfDay(addDays(d, -d.getDay())), to: endOfDay() }
        },
    },
    {
        key: 'this_month', label: 'This Month',
        range: () => {
            const d = new Date()
            return { from: startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)), to: endOfDay() }
        },
    },
    { key: 'custom', label: 'Custom Range', range: null },
]

const toISO = d => d ? d.toISOString() : ''


// ── Stat Card ─────────────────────────────────────────────────────────────────
const StatCard = ({ title, value, icon, iconBg, valueColor = 'dark' }) => (
    <div className="card stretch stretch-full">
        <div className="card-body">
            <div className="d-flex align-items-start justify-content-between">
                <div className="flex-fill">
                    <p className="text-muted fs-11 mb-1 text-uppercase fw-semibold" style={{ letterSpacing: '0.4px' }}>
                        {title}
                    </p>
                    <h3 className={`fw-bold text-${valueColor} mb-0`}>{value}</h3>
                </div>
                <span className={`avatar avatar-md bg-soft-${iconBg} rounded-3 ms-2 flex-shrink-0`}>
                    <i className={`${icon} fs-20 text-${iconBg}`} />
                </span>
            </div>
        </div>
    </div>
)

const PPESecondRowCards = ({ items }) => (
    <>
        {items.map(({ arrowIcon, color, count, icon, badgeText, title, badgeVariant }, index) => (
            <div key={index} className="col-xxl-3 col-md-6 customer-header-card">
                <div className="card stretch stretch-full">
                    <div className="card-body">
                        <div className="d-flex align-items-center justify-content-between">
                            <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                                <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                    {React.cloneElement(getIcon(icon) || getIcon('feather-alert-circle'), { size: 17 })}
                                </div>
                                <a
                                    href="#"
                                    className="fw-bold d-block text-reset text-decoration-none"
                                    style={{ minWidth: 0 }}
                                    onClick={(e) => e.preventDefault()}
                                >
                                    <span className="text-truncate-1-line">{title}</span>
                                    <span className="fs-24 fw-bolder d-block text-truncate-1-line">{count}</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        ))}
    </>
)

const ViolationsOverTimeCard = ({ data, loading, onRefresh, dateFrom, dateTo }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()

    const refresh = () => {
        handleRefresh()
        if (onRefresh) onRefresh()
    }

    return (
        <div className="col-xxl-6">
            <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
                <CardHeader title={"Safety Violations Trend"} refresh={refresh} expanded={handleExpand} />
                <div className="card-body custom-card-action">
                    <TrendChart data={data} loading={loading} dateFrom={dateFrom} dateTo={dateTo} />
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── PPE Violation Breakdown (MUI PieChart) ───────────────────────────────────────
const ViolationBreakdownCard = ({ summary, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => {
        handleRefresh()
        if (onRefresh) onRefresh()
    }
    const total    = summary?.violations_today   ?? 0
    const helmet   = summary?.no_helmet_today    ?? 0
    const vest     = summary?.no_vest_today      ?? 0
    const both     = summary?.both_missing_today ?? 0

    const pieData = [
        { id: 0, label: 'Helmet', value: helmet, color: '#ff9f43' },
        { id: 1, label: 'Vest', value: vest, color: '#28a745' },
        { id: 2, label: 'Critical', value: both, color: '#dc3545' },
    ].filter(d => d.value > 0)

    return (
        <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
            <CardHeader title={"PPE Violation Breakdown"} refresh={refresh} expanded={handleExpand} />
            <div className="card-body py-3 custom-card-action d-flex flex-column align-items-center">
                {loading ? (
                    <PageLoader minHeight={220} />
                ) : total === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No records available</span>
                        <span className="fs-12">No results for the current selection</span>
                    </div>
                ) : (
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                        <PieChart
                            width={300}
                            height={320}
                            series={[
                                {
                                    data: pieData,
                                    innerRadius: 60,
                                    arcLabel: () => '',
                                    arcLabelMinAngle: 999,
                                    valueFormatter: (v) => {
                                        const val = typeof v === 'number' ? v : (v && typeof v === 'object' && 'value' in v ? v.value : v)
                                        return typeof val === 'number' ? val.toLocaleString() : String(val ?? '')
                                    },
                                },
                            ]}
                            skipAnimation={false}
                            slotProps={{
                                pieArc: { stroke: 'transparent', strokeWidth: 0 },
                                tooltip: {
                                    trigger: 'item',
                                    sx: {
                                        '& .MuiChartsTooltip-paper': {
                                            backgroundColor: 'var(--bs-body-bg)',
                                            border: '1px solid var(--bs-border-color)',
                                            color: 'var(--bs-body-color)',
                                        },
                                        '& .MuiChartsTooltip-table *': {
                                            color: 'var(--bs-body-color)',
                                        },
                                        'html.app-skin-dark & .MuiChartsTooltip-paper': {
                                            backgroundColor: 'rgba(10,18,32,0.96)',
                                            borderColor: 'rgba(255,255,255,0.12)',
                                            color: 'rgba(255,255,255,0.92)',
                                        },
                                        'html.app-skin-dark & .MuiChartsTooltip-table *': {
                                            color: 'rgba(255,255,255,0.86)',
                                        },
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
                                '& .MuiPieChart-arcLabel': {
                                    fill: 'var(--bs-body-color)',
                                    fontWeight: 800,
                                    fontSize: 12,
                                },
                                '& .MuiPieChart-focusIndicator': {
                                    stroke: 'transparent',
                                },
                                '& .MuiPieChart-arc': {
                                    stroke: 'transparent',
                                },
                            }}
                        />
                    </div>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ── Incident Resolution ───────────────────────────────────────────────────────
const ResolutionCard = ({ summary, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => {
        handleRefresh()
        if (onRefresh) onRefresh()
    }
    const open  = summary?.open_incidents_in_range ?? 0
    const ack   = summary?.acknowledged_in_range ?? 0
    const res   = summary?.resolved_today      ?? 0
    const total = open + ack + res

    const funnelData = [
        { name: 'OPEN', value: 200, display: open, fill: '#5b73e8' },
        { name: 'ACKNOWLEDGED', value: 180, display: ack, fill: '#6c5ce7' },
        { name: 'RESOLVED', value: 90, display: res, fill: '#2dd4bf' },
    ]

    return (
        <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
            <CardHeader title={"Incident Resolution Overview"} refresh={refresh} expanded={handleExpand} />
            <div className="card-body py-3 custom-card-action">
                {loading ? (
                    <PageLoader minHeight={220} />
                ) : total === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No data available</span>
                        <span className="fs-12">No data to display for the current view</span>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '40px', paddingBottom: '40px' }}>
                        <div style={{ width: 340, height: 320 }}>
                            <ResponsiveContainer width={340} height={320}>
                                <ReFunnelChart>
                                    <Tooltip
                                        formatter={(value, name, p) => {
                                            const display = p?.payload?.display
                                            return [Number(display ?? 0).toLocaleString(), p?.payload?.name || '']
                                        }}
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
    )
}

// ── Trend Chart ───────────────────────────────────────────────────────────────
const TrendChart = ({ data, loading, dateFrom, dateTo }) => {
    if (loading) return <PageLoader minHeight={240} />
    if (!data || data.length === 0) return (
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )

    // Determine granularity based on selected date range
    const spanDays = dateFrom && dateTo
        ? (new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24)
        : 1
    const isMultiDay = spanDays > 1.5

    // Group hourly data into daily buckets when range spans multiple days
    const processedData = isMultiDay ? (() => {
        const byDay = {}
        data.forEach(d => {
            const day = new Date(d.hour).toISOString().slice(0, 10)
            byDay[day] = (byDay[day] || 0) + d.count
        })
        return Object.entries(byDay)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, count]) => ({ hour: day + 'T12:00:00Z', count }))
    })() : data

    const counts = processedData.map(d => d.count)
    const total  = counts.reduce((a, b) => a + b, 0)
    const avg    = Math.round(total / counts.length)
    const maxCount = Math.max(...counts)

    // Format data for recharts — time labels for single-day, date labels for multi-day
    const chartData = processedData.map(d => ({
        name: d.hour
            ? isMultiDay
                ? new Date(d.hour).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                : new Date(d.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
        count: d.count,
        isPeak: d.count === maxCount && maxCount > 0,
    }))

    // Custom dot renderer for peak highlighting
    const CustomDot = (props) => {
        const { cx, cy, payload } = props
        if (!payload) return null
        const isPeak = payload.isPeak
        const r = isPeak ? 6 : 4
        const color = isPeak ? '#dc3545' : '#5b73e8'
        return (
            <>
                {isPeak && (
                    <circle cx={cx} cy={cy} r={10} fill="none" stroke="#dc3545" strokeWidth="1.5" opacity="0.3" />
                )}
                <circle cx={cx} cy={cy} r={r} fill={color} />
            </>
        )
    }

    return (
        <div className="ppe-trend-chart">
            <div className="d-flex justify-content-center mb-3">
                <div className="d-flex gap-2 flex-wrap justify-content-center">
                    <div className="rounded px-3 py-2 text-center bg-soft-primary">
                        <div className="fs-16 fw-bold text-primary">{total}</div>
                        <div className="fs-10 text-primary text-uppercase">Total</div>
                    </div>
                    <div className="rounded px-3 py-2 text-center bg-soft-warning">
                        <div className="fs-16 fw-bold text-warning">{Math.max(...counts)}</div>
                        <div className="fs-10 text-warning text-uppercase">Peak slot</div>
                    </div>
                    <div className="rounded px-3 py-2 text-center bg-soft-info">
                        <div className="fs-16 fw-bold text-info">{avg}</div>
                        <div className="fs-10 text-info text-uppercase">Avg/slot</div>
                    </div>
                </div>
            </div>

            <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 1 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--bs-border-color)" strokeOpacity={0.65} />
                    <XAxis
                        dataKey="name"
                        stroke="var(--bs-border-color)"
                        tick={{ fill: 'var(--bs-secondary-color)', fontSize: 11 }}
                        axisLine={{ stroke: 'var(--bs-border-color)' }}
                        tickLine={false}
                        interval={isMultiDay ? 0 : Math.max(0, Math.ceil(chartData.length / 8) - 1)}
                        angle={0}
                        textAnchor="middle"
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
                        formatter={(value) => [value, 'Violations']}
                        labelStyle={{ color: 'var(--bs-body-color)', fontWeight: 600 }}
                        cursor={{ stroke: 'var(--bs-border-color)', strokeWidth: 1, strokeDasharray: '4 3' }}
                    />
                    <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#445cf6"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        fill="#445cf6"
                        fillOpacity={0.18}
                        dot={<CustomDot />}
                        activeDot={{ r: 8 }}
                        isAnimationActive={true}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}

// ── Severity Distribution (donut-style) ───────────────────────────────────────
const SeverityCard = ({ analytics, loading }) => {
    const high   = analytics?.severity_distribution?.high   ?? 0
    const medium = analytics?.severity_distribution?.medium ?? 0
    const low    = analytics?.severity_distribution?.low    ?? 0
    const total  = high + medium + low

    const rows = [
        { label: 'High',   count: high,   color: '#dc3545', bg: 'danger'   },
        { label: 'Medium', count: medium, color: '#ffc107', bg: 'warning'  },
        { label: 'Low',    count: low,    color: '#6c757d', bg: 'secondary'},
    ]

    // Simple SVG donut
    const size = 80, stroke = 14, r = (size - stroke) / 2
    const circ = 2 * Math.PI * r
    let offset = 0
    const slices = rows.map(row => {
        const pct = total > 0 ? row.count / total : 0
        const dash = pct * circ
        const s = { offset, dash, ...row }
        offset += dash
        return s
    })

    return (
        <div className="card stretch stretch-full">
            <div className="card-header py-2">
                <h6 className="card-title mb-0 fs-13 fw-semibold">Severity Distribution</h6>
            </div>
            <div className="card-body py-3">
                {loading ? (
                    <PageLoader minHeight={180} />
                ) : total === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted fs-13" style={{ minHeight: 220 }}>
                        <i className="feather-pie-chart fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                        <span className="fw-semibold d-block mb-1">No Severity Data Available</span>
                        <span className="fs-12">Incident severity breakdown will populate as events are recorded</span>
                    </div>
                ) : (
                    <div className="d-flex align-items-center gap-4">
                        {/* Donut */}
                        <div className="flex-shrink-0">
                            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                                <circle cx={size/2} cy={size/2} r={r}
                                    fill="none" stroke="#f0f0f0" strokeWidth={stroke} />
                                {slices.map((s, i) => s.count > 0 && (
                                    <circle key={i}
                                        cx={size/2} cy={size/2} r={r}
                                        fill="none"
                                        stroke={s.color}
                                        strokeWidth={stroke}
                                        strokeDasharray={`${s.dash} ${circ - s.dash}`}
                                        strokeDashoffset={-s.offset + circ / 4}
                                        style={{ transition: 'stroke-dasharray 0.4s' }}
                                    />
                                ))}
                                <text x={size/2} y={size/2 + 1} textAnchor="middle"
                                    dominantBaseline="middle" fontSize="13" fontWeight="700" fill="#333">
                                    {total}
                                </text>
                                <text x={size/2} y={size/2 + 14} textAnchor="middle"
                                    fontSize="8" fill="#999">total</text>
                            </svg>
                        </div>
                        {/* Legend */}
                        <div className="flex-fill d-flex flex-column gap-2">
                            {rows.map((row, i) => {
                                const pct = total > 0 ? Math.round(row.count / total * 100) : 0
                                return (
                                    <div key={i} className="d-flex justify-content-between align-items-center">
                                        <span className="d-flex align-items-center gap-2 fs-12">
                                            <span style={{
                                                width: 8, height: 8, borderRadius: 2,
                                                background: row.color, display: 'inline-block',
                                            }} />
                                            {row.label}
                                        </span>
                                        <div className="d-flex align-items-center gap-2">
                                            <span className="fs-11 text-muted">{pct}%</span>
                                            <span className={`badge bg-soft-${row.bg} text-${row.bg} fs-11`}>{row.count}</span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Peak Violation Period ───────────────────────────────────────────────────────
const PeakHourCard = ({ analytics, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => {
        handleRefresh()
        if (onRefresh) onRefresh()
    }
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('app-skin-dark'))
    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])
    const hourly = analytics?.hourly_distribution ?? []

    // Ensure all 24 hours are represented
    const fullHourlyData = Array.from({ length: 24 }, (_, h) => hourly[h] ?? 0)

    const fmtHour = h => {
        const period = h < 12 ? 'am' : 'pm'
        const display = h === 0 ? 12 : h > 12 ? h - 12 : h
        return `${display}${period}`
    }

    return (
        <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
            <CardHeader title={"Peak Violation Period"} refresh={refresh} expanded={handleExpand} />
            <div className="card-body p-0 custom-card-action" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {loading ? (
                    <PageLoader minHeight={200} />
                ) : fullHourlyData.every(h => h === 0) ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ flex: 1, minHeight: 220, marginBottom: '1rem' }}>
                        <span className="fw-semibold d-block mb-1">No data available</span>
                        <span className="fs-12">No data to display for the current view</span>
                    </div>
                ) : (
                    <Stack direction="column" sx={{ width: '100%', flex: 1, justifyContent: 'space-between', p: 2 }}>
                        <Box sx={{ width: '100%', flex: 1 }}>
                            <SparkLineChart
                                plotType="bar"
                                data={fullHourlyData}
                                height={140}
                                showHighlight={true}
                                showTooltip={true}
                                color="#5b73e8"
                                slotProps={{
                                    tooltip: {
                                        sx: {
                                            [`& .${chartsTooltipClasses.paper}`]: {
                                                backgroundColor: 'var(--bs-body-bg)',
                                                border: '1px solid var(--bs-border-color)',
                                                color: 'var(--bs-body-color)',
                                            },
                                            [`& .${chartsTooltipClasses.table} *`]: {
                                                color: 'var(--bs-body-color)',
                                            },
                                            [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: {
                                                backgroundColor: 'rgba(10,18,32,0.96)',
                                                borderColor: 'rgba(255,255,255,0.12)',
                                                color: 'rgba(255,255,255,0.92)',
                                            },
                                            [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: {
                                                color: 'rgba(255,255,255,0.86)',
                                            },
                                        },
                                    },
                                }}
                                sx={{
                                    width: '100%',
                                    height: '100%',
                                    '& .MuiChartsAxis-tickLabel': {
                                        fill: isDark ? 'rgba(255,255,255,0.72)' : 'var(--bs-secondary-color)',
                                        fontSize: 12,
                                    },
                                    '& .MuiChartsAxis-line': {
                                        stroke: isDark ? 'rgba(255,255,255,0.14)' : 'var(--bs-border-color)',
                                    },
                                    '& .MuiChartsAxis-tick': {
                                        stroke: isDark ? 'rgba(255,255,255,0.14)' : 'var(--bs-border-color)',
                                    },
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
                            {Array.from({ length: 24 }).map((_, h) => {
                                return h % 3 === 0 ? <span key={h}>{fmtHour(h)}</span> : <span key={h}></span>
                            })}
                        </div>
                    </Stack>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ── Avg Resolution Time ───────────────────────────────────────────────────────
const AvgResolutionCard = ({ summary, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => {
        handleRefresh()
        if (onRefresh) onRefresh()
    }
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('app-skin-dark'))
    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    // Resolution rate (within selected date range): Resolved / (Open + Acknowledged + Resolved) × 100
    const resolved = summary?.resolved_today ?? 0
    const acknowledged = summary?.acknowledged_in_range ?? 0
    const open = summary?.open_incidents_in_range ?? 0
    const total = resolved + acknowledged + open  // ALL incidents in range (open, acknowledged, resolved)

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0

    // Semantic color based on resolution rate
    const getStatusBadgeColor = (rate) => {
        if (rate >= 80) return 'bg-soft-success text-success' // Green - Excellent
        if (rate >= 50) return 'bg-soft-warning text-warning' // Yellow - Moderate
        return 'bg-soft-danger text-danger' // Red - Poor
    }

    const getStatusColor = (rate) => {
        if (rate >= 80) return '#28a745' // Green - Excellent
        if (rate >= 50) return '#ffc107' // Yellow - Moderate
        return '#dc3545' // Red - Poor
    }

    const getStatusLabel = (rate) => {
        if (rate >= 80) return 'Excellent'
        if (rate >= 50) return 'Moderate'
        return 'Poor'
    }

    const statusColor = getStatusColor(resolutionRate)
    const statusBadgeColor = getStatusBadgeColor(resolutionRate)
    const statusLabel = getStatusLabel(resolutionRate)
    const valueTextColor = isDark ? 'rgba(255,255,255,0.92)' : 'var(--bs-heading-color)'

    return (
        <div className={`card stretch stretch-full ${isExpanded ? "card-expand" : ""} ${refreshKey ? "card-loading" : ""}`}>
            <CardHeader title={"Average Incident Resolution Time"} refresh={refresh} expanded={handleExpand} />
            <div className="card-body py-3 custom-card-action">
                {loading ? (
                    <PageLoader minHeight={180} />
                ) : total === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No data available</span>
                        <span className="fs-12">No data to display for the current view</span>
                    </div>
                ) : (
                    <div className="d-flex flex-column align-items-center gap-3">
                        <Gauge
                            value={resolutionRate}
                            startAngle={-110}
                            endAngle={110}
                            sx={{
                                color: valueTextColor,
                                [`& .${gaugeClasses.valueArc}`]: {
                                    fill: statusColor,
                                },
                                [`& .${gaugeClasses.referenceArc}`]: {
                                    fill: 'rgba(128,128,128,0.1)',
                                },
                                [`& .${gaugeClasses.valueText}`]: {
                                    fontSize: 42,
                                    fontWeight: 700,
                                    transform: 'translate(0px, 0px)',
                                    fill: valueTextColor,
                                },
                                [`& .${gaugeClasses.valueText} tspan`]: {
                                    fill: valueTextColor,
                                },
                            }}
                            text={() => `${resolutionRate}%`}
                        />
                        <span className={`badge ${statusBadgeColor} fs-12 fw-bold text-uppercase`}>
                            {statusLabel}
                        </span>
                    </div>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ── Daily Safety Score ────────────────────────────────────────────────────────
const DailySafetyScoreCard = ({ analytics, summary, loading, onRefresh }) => {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => {
        handleRefresh()
        if (onRefresh) onRefresh()
    }
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('app-skin-dark'))
    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    const rawScoreNumber = analytics?.daily_safety_score == null ? null : Number(analytics.daily_safety_score)
    const hasDetections = summary != null && ((summary.workers_detected_today ?? 0) > 0 || (summary.violations_today ?? 0) > 0)
    const hasData = Number.isFinite(rawScoreNumber) && hasDetections
    const rawScore = hasData ? rawScoreNumber : 0
    // Normalise 0–10 score to 0–100 for the Gauge
    const score = Math.round(rawScore * 10)

    const getStatusColor   = (s) => s >= 80 ? '#28a745' : s >= 60 ? '#ffc107' : '#dc3545'
    const getStatusBadge   = (s) => s >= 80 ? 'bg-soft-success text-success' : s >= 60 ? 'bg-soft-warning text-warning' : 'bg-soft-danger text-danger'
    const getStatusLabel   = (s) => s >= 80 ? 'Optimal' : s >= 60 ? 'Acceptable' : 'Attention Required'

    const statusColor = getStatusColor(score)
    const statusBadge = getStatusBadge(score)
    const statusLabel = getStatusLabel(score)
    const valueTextColor = statusColor
    const scoreText = (() => {
        if (!hasData) return '—/10'
        const rounded1 = Math.round(rawScore * 10) / 10
        const isWhole = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9
        return isWhole ? `${Math.round(rounded1)}/10` : `${rounded1.toFixed(1)}/10`
    })()

    return (
        <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
            <CardHeader title="Safety Score" refresh={refresh} expanded={handleExpand} />
            <div className="card-body py-3 custom-card-action">
                {loading ? (
                    <PageLoader minHeight={180} />
                ) : !hasData ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                        <span className="fw-semibold d-block mb-1">No data available</span>
                        <span className="fs-12">No data to display for the current view</span>
                    </div>
                ) : (
                    <div className="d-flex flex-column align-items-center gap-3">
                        <Gauge
                            value={score}
                            startAngle={-110}
                            endAngle={110}
                            sx={{
                                color: isDark ? 'rgba(255,255,255,0.92)' : 'var(--bs-heading-color)',
                                [`& .${gaugeClasses.valueArc}`]: { fill: statusColor },
                                [`& .${gaugeClasses.referenceArc}`]: { fill: 'rgba(128,128,128,0.1)' },
                                [`& .${gaugeClasses.valueText}`]: {
                                    fontSize: 42,
                                    fontWeight: 700,
                                    transform: 'translate(0px, 0px)',
                                    fill: valueTextColor,
                                },
                                [`& .${gaugeClasses.valueText} tspan`]: { fill: valueTextColor },
                            }}
                            text={() => scoreText}
                        />
                        <span className={`badge ${statusBadge} fs-12 fw-bold text-uppercase`}>
                            {statusLabel}
                        </span>
                    </div>
                )}
            </div>
            <CardLoader refreshKey={refreshKey} />
        </div>
    )
}

// ── Live Alert Feed ───────────────────────────────────────────────────────────
const LiveAlertFeed = ({ alerts, connected }) => (
    <div className="card stretch stretch-full">
        <div className="card-header d-flex align-items-center justify-content-between py-2">
            <h6 className="card-title mb-0 fs-13 fw-semibold">Live Alert Feed</h6>
            <div className="d-flex align-items-center gap-2">
                <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: connected ? '#28a745' : '#aaa',
                    display: 'inline-block',
                    animation: connected ? 'ppe-pulse 2s infinite' : 'none',
                }} />
                <span className="fs-11 text-muted">{connected ? 'Live' : 'Connecting…'}</span>
                {alerts.length > 0 && (
                    <span className="badge bg-soft-danger text-danger fs-10">{alerts.length}</span>
                )}
            </div>
        </div>
        <div className="card-body p-0" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {alerts.length === 0 ? (
                <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted gap-2" style={{ minHeight: 220 }}>
                    <i className="feather-radio fs-28" />
                    <span className="fs-13">Waiting for live detections…</span>
                </div>
            ) : (
                <table className="table table-sm table-hover mb-0">
                    <thead className="table-light sticky-top">
                        <tr style={{ fontSize: 11 }}>
                            <th className="ps-3">Time</th>
                            <th>Camera</th>
                            <th>Zone</th>
                            <th>Person</th>
                            <th>Violation</th>
                        </tr>
                    </thead>
                    <tbody>
                        {alerts.map((a, i) => {
                            const badge = INCIDENT_LABELS[a.incident_type] ?? { short: a.incident_type, color: 'secondary' }
                            const time  = a.timestamp
                                ? new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                                : '—'
                            return (
                                <tr key={i} style={{ fontSize: 12 }}>
                                    <td className="text-muted ps-3" style={{ whiteSpace: 'nowrap' }}>{time}</td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{a.camera_name ?? '—'}</td>
                                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{a.zone_name ?? '—'}</td>
                                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{a.person_id ?? '—'}</td>
                                    <td>
                                        <span className={`badge bg-soft-${badge.color} text-${badge.color} fs-10`}>
                                            {badge.short}
                                        </span>
                                        {a.snapshot_url && (
                                            <a href={a.snapshot_url} target="_blank" rel="noreferrer" className="ms-2 fs-10 text-primary">snap</a>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}
        </div>
    </div>
)

// ── Main Dashboard ────────────────────────────────────────────────────────────
const PPESafetyDashboard = () => {
    const { projectId } = useParams()
    const queryClient = useQueryClient()
    const [projectName, setProjectName] = useState('')

    useEffect(() => {
        apiGet(`/projects/${projectId}`).then(p => setProjectName(p?.name || '')).catch(() => {})
    }, [projectId])

    // Default filter: Live
    const [dateFilter, setDateFilter] = useState(() => ({
        preset: 'live',
        from:   startOfDay(),
        to:     endOfDay(),
    }))

    const [exporting,        setExporting]        = useState(false)
    const [ppeActive,        setPpeActive]        = useState(false)
    const ppeActiveRef = useRef(false)
    useEffect(() => { ppeActiveRef.current = ppeActive }, [ppeActive])
    const [ppeStatusLoading, setPpeStatusLoading] = useState(false)
    const [liveAlerts,       setLiveAlerts]       = useState([])
    const [sseConnected,     setSseConnected]     = useState(false)

    // Tracks when Live mode was first activated — persists across filter switches AND page refreshes.
    const liveStorageKey = `ppe_live_start_${projectId}`
    const liveStartRef = useRef((() => {
        const saved = localStorage.getItem(`ppe_live_start_${projectId}`)
        if (saved) {
            const savedDate = new Date(saved)
            if (savedDate.toDateString() === new Date().toDateString()) return savedDate
            localStorage.removeItem(`ppe_live_start_${projectId}`)
        }
        return new Date()
    })())
    const dateFilterRef   = useRef(dateFilter)
    useEffect(() => { dateFilterRef.current = dateFilter }, [dateFilter])

    // Build query string helper
    const buildQS = (from, to) => {
        const qs = `?date_from=${encodeURIComponent(toISO(from))}&date_to=${encodeURIComponent(toISO(to))}`
        return { params: qs, from, to }
    }

    // Memoize query string — recomputes when preset OR date range changes.
    // In live mode, qs.from/qs.to are stable anchors (live's from/to don't change while
    // the user stays on the live tab). For historical presets all sharing preset='custom',
    // the from/to dependencies ensure qs updates when switching today → this_week etc.
    const qs = useMemo(() => {
        if (dateFilter.preset === 'live') {
            return buildQS(liveStartRef.current, new Date())
        }
        return buildQS(dateFilter.from, dateFilter.to)
    }, [dateFilter.preset, dateFilter.from, dateFilter.to]) // eslint-disable-line react-hooks/exhaustive-deps

    // In live mode always build fresh params so refetches include the latest violations.
    // Historical mode uses the stable memoized params from qs.
    const getLiveParams = useCallback((endpoint) => {
        if (dateFilter.preset === 'live') {
            const { params } = buildQS(liveStartRef.current, new Date())
            return `/projects/${projectId}/ppe/${endpoint}${params}`
        }
        return `/projects/${projectId}/ppe/${endpoint}${qs.params}`
    }, [dateFilter.preset, projectId, qs.params]) // eslint-disable-line react-hooks/exhaustive-deps

    // React Query hooks for all PPE data.
    // SSE drives all updates — no refetchInterval polling. placeholderData keeps the
    // last-fetched data on screen during filter / pagination changes (no skeleton blink).
    // staleTime: Infinity tells React Query the data is authoritative until the SSE
    // reducer (usePPEStream) explicitly invalidates / patches it.
    //
    // enabled: when feature is OFF in live mode, queries are disabled so removeQueries
    // (from usePPEStream on ppe_feature_changed) actually stays empty — without this
    // guard, the refetch fires immediately and the server returns historical incidents
    // that fall within the live date window, looking like the data "came back." For
    // historical filters (today/week/month/custom) the queries always run because the
    // user explicitly asked for that date range regardless of current feature state.
    const dataEnabled = ppeActive || dateFilter.preset !== 'live'

    const { data: summary, isFetching: summaryFetching } = useQuery({
        queryKey: QK.ppeSummary(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('summary')),
        staleTime: 30_000,
        refetchInterval: dateFilter.preset === 'live' ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: dataEnabled,
    })

    const { data: trend = [] } = useQuery({
        queryKey: QK.ppeTrend(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('trend')),
        staleTime: 30_000,
        refetchInterval: dateFilter.preset === 'live' ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: dataEnabled,
    })

    const { data: zones = [] } = useQuery({
        queryKey: QK.ppeZones(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('zones')),
        staleTime: 30_000,
        refetchInterval: dateFilter.preset === 'live' ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: dataEnabled,
    })

    const { data: cameras = [] } = useQuery({
        queryKey: QK.ppeCameras(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('cameras')),
        staleTime: 30_000,
        refetchInterval: dateFilter.preset === 'live' ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: dataEnabled,
    })

    const { data: analytics } = useQuery({
        queryKey: QK.ppeAnalytics(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('analytics')),
        staleTime: 30_000,
        refetchInterval: dateFilter.preset === 'live' ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: dataEnabled,
    })

    // ppeStatus is the only feature-state query. It's SSE-driven via ppe_feature_changed.
    // No polling: the enriched SSE payload (cameras[], any_camera_active, live_session_start)
    // is now authoritative. We still re-fetch on reconnect via onConnect handler below.
    const liveStatusPolling = dateFilter.preset === 'live'
    const { data: ppeStatusData, isFetching: statusFetching } = useQuery({
        queryKey: QK.ppeStatus(projectId),
        queryFn: () => apiGet(`/projects/${projectId}/cameras/features`),
        staleTime: Infinity,
        refetchOnWindowFocus: liveStatusPolling ? 'always' : false,
        refetchInterval: liveStatusPolling ? 8000 : false,
        refetchIntervalInBackground: liveStatusPolling,
    })

    // Only show loading state on first mount (no cached data). Background refetches
    // triggered by SSE invalidations keep showing old data silently — no flash or empty state.
    const loading = summaryFetching && !summary

    // Update PPE active state from status data
    const prevAnyActiveRef = useRef(null)
    useEffect(() => {
        if (!ppeStatusData) return
        const cams = Array.isArray(ppeStatusData) ? ppeStatusData : (ppeStatusData?.cameras ?? [])
        const anyActive = cams.some(c => c.features?.ppe_enabled === true)
        const serverStart = ppeStatusData?.live_session_start ? new Date(ppeStatusData.live_session_start) : null
        const prevAnyActive = prevAnyActiveRef.current
        prevAnyActiveRef.current = anyActive

        if (dateFilter.preset === 'live' && prevAnyActive != null && prevAnyActive !== anyActive) {
            if (anyActive === false) {
                setPpeActive(false)
                localStorage.removeItem(liveStorageKey)
                setLiveAlerts([])
                const WIPE_KEYS = [
                    ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                    ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                ]
                WIPE_KEYS.forEach(k => {
                    queryClient.setQueriesData({ queryKey: k }, null)
                    queryClient.removeQueries({ queryKey: k })
                })
                window.dispatchEvent(new Event('cs:alerts-clear-all'))
                return
            }

            if (anyActive === true) {
                setLiveAlerts([])
                const startTime = serverStart ?? new Date()
                liveStartRef.current = startTime
                localStorage.setItem(liveStorageKey, startTime.toISOString())
                const DATA_KEYS = [
                    ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                    ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                ]
                DATA_KEYS.forEach(k => {
                    queryClient.setQueriesData({ queryKey: k }, undefined)
                    queryClient.removeQueries({ queryKey: k })
                })
                setPpeActive(true)
                return
            }
        }

        setPpeActive(anyActive)
        if (anyActive) {
            const startTime = serverStart ?? liveStartRef.current
            liveStartRef.current = startTime
            localStorage.setItem(liveStorageKey, startTime.toISOString())
        } else {
            localStorage.removeItem(liveStorageKey)
        }
    }, [ppeStatusData, projectId, liveStorageKey, dateFilter.preset, queryClient])

    // Invalidate PPE queries when SSE sends new alerts or when filter changes
    const invalidatePpeQueries = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['ppe'] })
    }, [queryClient])

    // SSE hook now drives React Query cache directly
    usePPEStream(projectId, queryClient, {
        onFeatureChanged: ({ anyActive } = {}) => {
            // Direct state flip — zero async hops, instant on same tab
            if (anyActive === false) {
                setPpeActive(false)
                localStorage.removeItem(liveStorageKey)
                setLiveAlerts([])
                // setQueriesData(null) synchronously blanks each card in the same render frame before removeQueries
                const WIPE_KEYS = [
                    ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                    ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                ]
                WIPE_KEYS.forEach(k => {
                    queryClient.setQueriesData({ queryKey: k }, null)
                    queryClient.removeQueries({ queryKey: k })
                })
                broadcastRefresh('cs:alerts-clear-all', {})
            } else if (anyActive === true) {
                setLiveAlerts([])
                // Wipe stale status so fetchQuery below gets the server's live_session_start
                queryClient.removeQueries({ queryKey: QK.ppeStatus(projectId) })
                // Fetch server's authoritative session start BEFORE data queries fire
                let sessionStart = new Date()
                queryClient.fetchQuery({
                    queryKey: QK.ppeStatus(projectId),
                    queryFn: () => apiGet(`/projects/${projectId}/cameras/features`),
                    staleTime: 0,
                }).then(freshStatus => {
                    if (freshStatus?.live_session_start) {
                        sessionStart = new Date(freshStatus.live_session_start)
                    }
                    liveStartRef.current = sessionStart
                    localStorage.setItem(liveStorageKey, sessionStart.toISOString())
                    // Set undefined so cards show isLoading: true simultaneously, then remove stale data
                    const DATA_KEYS = [
                        ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                        ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                    ]
                    DATA_KEYS.forEach(k => {
                        queryClient.setQueriesData({ queryKey: k }, undefined)
                        queryClient.removeQueries({ queryKey: k })
                    })
                    setPpeActive(true)
                }).catch(() => {
                    // Fallback: use NOW if status fetch fails
                    liveStartRef.current = sessionStart
                    localStorage.setItem(liveStorageKey, sessionStart.toISOString())
                    const DATA_KEYS = [
                        ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                        ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                    ]
                    DATA_KEYS.forEach(k => {
                        queryClient.setQueriesData({ queryKey: k }, undefined)
                        queryClient.removeQueries({ queryKey: k })
                    })
                    setPpeActive(true)
                })
            }
            invalidatePpeQueries()
        },
        onConnect: () => {
            setSseConnected(true)
            // Re-fetch stale data when SSE reconnects
            invalidatePpeQueries()
        },
        onDisconnect: () => {
            setSseConnected(false)
            // Catch-up runs on next onConnect (above), which invalidates all PPE queries.
            // No interval polling — SSE is authoritative; reconnect-driven refetch closes the gap.
        },
        onAlert: (alertData) => {
            if (!ppeActiveRef.current) return
            // Add to live feed with timestamp
            setLiveAlerts(prev => [{
                ...alertData,
                timestamp: alertData.timestamp || new Date().toISOString(),
                id: `${alertData.camera_id}-${Date.now()}`
            }, ...prev].slice(0, 10)) // Keep last 10 alerts
            // Refresh all cards/charts so they reflect the new violation immediately
            invalidatePpeQueries()
        },
        onIncidentUpdated: (data) => {
            // Patch video_clip_url into the matching live feed entry when clip becomes available
            if (data.video_clip_url) {
                setLiveAlerts(prev => prev.map(a =>
                    a.incident_id === data.incident_id
                        ? { ...a, video_clip_url: data.video_clip_url }
                        : a
                ))
            }
        },
    })

    // Auto-clean alerts older than 5 minutes
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now()
            setLiveAlerts(prev => prev.filter(a => {
                const alertTime = new Date(a.timestamp).getTime()
                return now - alertTime < 5 * 60 * 1000
            }))
        }, 30_000) // Check every 30 seconds
        return () => clearInterval(timer)
    }, [])

    // Listen for cross-tab PPE invalidations
    useEffect(() => {
        return onBroadcast('ppe:invalidate', ({ projectId: pid }) => {
            if (String(pid) === String(projectId)) invalidatePpeQueries()
        })
    }, [projectId, invalidatePpeQueries])

    // Listen for cross-tab feature toggle — directly flip ppeActive + patch cache
    useEffect(() => {
        return onBroadcast('ppe:feature-changed', ({ projectId: pid, anyActive, camera_id, ppe_enabled }) => {
            if (String(pid) !== String(projectId)) return
            // Direct state flip for same-browser other tabs — same tick, no async hops
            if (anyActive === false) {
                setPpeActive(false)
                localStorage.removeItem(liveStorageKey)
                setLiveAlerts([])
                const WIPE_KEYS = [
                    ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                    ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                ]
                WIPE_KEYS.forEach(k => {
                    queryClient.setQueriesData({ queryKey: k }, null)
                    queryClient.removeQueries({ queryKey: k })
                })
                // local-only dispatch; broadcast already fired by the originating tab
                window.dispatchEvent(new Event('cs:alerts-clear-all'))
            } else if (anyActive === true) {
                setLiveAlerts([])
                queryClient.removeQueries({ queryKey: QK.ppeStatus(projectId) })
                let sessionStart = new Date()
                queryClient.fetchQuery({
                    queryKey: QK.ppeStatus(projectId),
                    queryFn: () => apiGet(`/projects/${projectId}/cameras/features`),
                    staleTime: 0,
                }).then(freshStatus => {
                    if (freshStatus?.live_session_start) {
                        sessionStart = new Date(freshStatus.live_session_start)
                    }
                    liveStartRef.current = sessionStart
                    localStorage.setItem(liveStorageKey, sessionStart.toISOString())
                    const DATA_KEYS = [
                        ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                        ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                    ]
                    DATA_KEYS.forEach(k => {
                        queryClient.setQueriesData({ queryKey: k }, undefined)
                        queryClient.removeQueries({ queryKey: k })
                    })
                    setPpeActive(true)
                }).catch(() => {
                    liveStartRef.current = sessionStart
                    localStorage.setItem(liveStorageKey, sessionStart.toISOString())
                    const DATA_KEYS = [
                        ['ppe', 'summary'], ['ppe', 'trend'], ['ppe', 'zones'],
                        ['ppe', 'cameras'], ['ppe', 'analytics'], ['ppe', 'incidents'],
                    ]
                    DATA_KEYS.forEach(k => {
                        queryClient.setQueriesData({ queryKey: k }, undefined)
                        queryClient.removeQueries({ queryKey: k })
                    })
                    setPpeActive(true)
                })
            }
            // Keep surgical cache patch so ppeStatusData stays consistent
            if (camera_id != null && ppe_enabled != null) {
                const statusKey = QK.ppeStatus(projectId)
                const cached = queryClient.getQueryData(statusKey)
                if (cached) {
                    const cams = Array.isArray(cached) ? cached : (cached.cameras ?? [])
                    const updatedCams = cams.map(c =>
                        c.camera_id === camera_id
                            ? { ...c, features: { ...c.features, ppe_enabled } }
                            : c
                    )
                    queryClient.setQueryData(statusKey, {
                        ...(Array.isArray(cached) ? {} : cached),
                        cameras: updatedCams,
                        live_session_start: updatedCams.some(c => c.features?.ppe_enabled) ? cached.live_session_start : null,
                    })
                }
            }
            invalidatePpeQueries()
        })
    }, [projectId, queryClient, invalidatePpeQueries, liveStorageKey])

    // Listen for cross-tab incident updates — surgical in-place patch, no scroll jump
    useEffect(() => {
        return onBroadcast('ppe:incident-updated', ({ projectId: pid, ...data }) => {
            if (String(pid) !== String(projectId)) return
            patchIncidentInCache(queryClient, projectId, data)
            // Status change affects open_incidents count in summary cards + zones table
            queryClient.invalidateQueries({ queryKey: ['ppe', 'summary', projectId] })
            queryClient.invalidateQueries({ queryKey: ['ppe', 'zones',   projectId] })
            if (data.video_clip_url) {
                setLiveAlerts(prev => prev.map(a =>
                    a.incident_id === data.incident_id
                        ? { ...a, video_clip_url: data.video_clip_url }
                        : a
                ))
            }
        })
    }, [projectId, queryClient])

    // Export: generate PDF for the currently active date filter and auto-download
    const handleExport = async () => {
        if (exporting) return
        const isLive = dateFilter.preset === 'live'
        if (isLive && !ppeActive) return  // button is disabled, guard anyway
        setExporting(true)
        try {
            const token = window.sessionStorage.getItem('access_token')
            const exportFrom = isLive ? liveStartRef.current : dateFilter.from
            const exportTo   = isLive ? new Date()          : dateFilter.to
            const body  = JSON.stringify({
                start_date: exportFrom.toISOString(),
                end_date:   exportTo.toISOString(),
                report_type: 'ppe',
            })
            const res = await fetch(`${API_BASE}/projects/${projectId}/reports/export`, {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                credentials: 'include',
                body,
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err?.detail || 'Report generation failed.')
            }
            const blob = await res.blob()
            const url  = window.URL.createObjectURL(blob)
            const a    = document.createElement('a')
            a.href     = url
            try {
                const preset = dateFilter?.preset
                const label  = preset === 'live'
                    ? `live_${new Date().toISOString().slice(0, 10)}`
                    : preset && preset !== 'custom'
                        ? preset.replace(/_/g, ' ')
                        : `${dateFilter.from.toLocaleDateString()} - ${dateFilter.to.toLocaleDateString()}`
                a.download = `PPE_Safety_Report_${label.replace(/\s+/g, '_')}.pdf`
            } catch {
                a.download = 'PPE_Safety_Report.pdf'
            }
            document.body.appendChild(a); a.click(); document.body.removeChild(a)
            window.URL.revokeObjectURL(url)
            window.dispatchEvent(new Event('cs:report-status-changed'))
            topTostError(`PPE Safety Report for ${projectName || `Project #${projectId}`} downloaded successfully.`, 'success')
        } catch (err) {
            console.error('[Export] error:', err)
            if (err?.name !== 'AbortError') {
                topTostError(err.message || 'Failed to generate report.')
            }
        } finally {
            setExporting(false)
        }
    }

    const rate   = summary != null ? (summary?.compliance_rate_today ?? 100) : null
    const cColor = complianceColor(rate ?? 0)

    // Adaptive trend: Compares current period vs previous period based on filter preset
    const getTrendByFilter = (trendData, filterPreset) => {
        if (!trendData || trendData.length === 0) return null

        const sumInRange = (from, to) => trendData
            .filter(d => {
                const date = new Date(d.hour)
                return date >= from && date <= to
            })
            .reduce((sum, d) => sum + d.count, 0)

        let currentStart, currentEnd, previousStart, previousEnd

        if (filterPreset === 'today') {
            const now = new Date()
            currentStart = startOfDay(now)
            currentEnd = endOfDay(now)
            // Compare with first inference day (earliest data point)
            const firstDate = trendData.length > 0 ? new Date(trendData[0].hour) : now
            previousStart = startOfDay(firstDate)
            previousEnd = endOfDay(firstDate)
        } else if (filterPreset === 'this_week') {
            const now = new Date()
            currentStart = startOfDay(addDays(now, -now.getDay()))
            currentEnd = endOfDay(now)
            previousStart = startOfDay(addDays(currentStart, -7))
            previousEnd = endOfDay(addDays(currentStart, -1))
        } else if (filterPreset === 'this_month') {
            const now = new Date()
            currentStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
            currentEnd = endOfDay(now)
            const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
            previousStart = startOfDay(prevMonthStart)
            previousEnd = endOfDay(prevMonthEnd)
        } else {
            // Custom range: compare first half vs second half
            return null
        }

        const current = sumInRange(currentStart, currentEnd)
        const previous = sumInRange(previousStart, previousEnd)

        // If no previous data, just show current count
        if (previous === 0) {
            return {
                value: current,
                direction: '↑',
                raw: current > 0 ? 100 : 0,
            }
        }

        const change = ((current - previous) / previous) * 100
        return {
            value: Math.abs(Math.round(change)),
            direction: change < 0 ? '↓' : '↑',
            raw: change,
        }
    }

    const dailyTrend = getTrendByFilter(trend, dateFilter.preset)
    const isLive         = dateFilter.preset === 'live'
    const liveEmptyState = isLive && !ppeActive

    return (
        <>
            <PageHeader projectCrumbsKey="reports" projectCrumbsLeaf="ppe">
                <PageHeaderDate
                    range={{ startDate: dateFilter.from, endDate: dateFilter.to }}
                    onApplyRange={({ startDate, endDate }) => setDateFilter({
                        preset: 'custom',
                        from: startOfDay(new Date(startDate)),
                        to: endOfDay(new Date(endDate)),
                    })}
                    onExport={handleExport}
                    exporting={exporting}
                    exportDisabled={liveEmptyState}
                    exportDisabledTitle="Enable PPE monitoring on at least one camera to generate reports"
                    liveMode={isLive}
                    onLiveSelect={() => {
                        setDateFilter({ preset: 'live', from: startOfDay(), to: endOfDay() })
                    }}
                    showLiveDot={true}
                    liveDotPulse={!liveEmptyState}
                    hidePrefixWhenLive={true}
                />
            </PageHeader>

            <div className="main-content">

            {/* ── Live + PPE inactive: full empty state ────────────────────────────── */}
            {liveEmptyState ? (
                <>
                {/* Empty state placeholders for all rows */}
                <div className="row g-3 mb-4"><PPEKPICards summary={null} loading={false} /></div>
                <div className="row g-3 mb-4">
                    <PPESecondRowCards items={[
                        { icon: 'feather-check-circle', title: 'PPE Compliance Rate', count: '—', color: 'success' },
                        { icon: 'feather-layers',       title: 'Highest Violation Zone', count: '—', color: 'warning' },
                        { icon: 'feather-alert-octagon', title: 'Critical Rate', count: '—', color: 'danger' },
                        { icon: 'feather-alert-triangle', title: 'Active Incidents', count: '—', color: 'primary' },
                    ]} />
                </div>
                <div className="row g-3 mb-4">
                    <ViolationsOverTimeCard data={[]} loading={false} onRefresh={() => {}} dateFrom={dateFilter.from} dateTo={dateFilter.to} />
                    <div className="col-xxl-3 col-sm-6"><ViolationBreakdownCard summary={null} loading={false} onRefresh={() => {}} /></div>
                    <div className="col-xxl-3 col-sm-6"><ResolutionCard summary={null} loading={false} onRefresh={() => {}} /></div>
                </div>
                <div className="row g-3 mb-4">
                    <div className="col-xxl-4 col-sm-6"><PeakHourCard analytics={null} loading={false} onRefresh={() => {}} /></div>
                    <div className="col-xxl-4 col-sm-6"><AvgResolutionCard summary={null} loading={false} onRefresh={() => {}} /></div>
                    <div className="col-xxl-4 col-sm-6"><DailySafetyScoreCard analytics={null} summary={null} loading={false} onRefresh={() => {}} /></div>
                </div>
                <div className="row g-3 mb-4"><div className="col-12"><PPEZoneBreakdown zones={[]} loading={false} /></div></div>
                <PPEIncidentsTable projectId={projectId} cameras={[]} onStatusChange={() => {}} dateFrom={null} dateTo={null} statusFilter={null} disabled />
                </>
            ) : (
            <>
            {/* ── Row 1: PPE KPI Cards (Colorful Premium Cards - 100% styled) ─────────────────────────── */}
            <div className="row g-3 mb-4">
                <PPEKPICards summary={summary} loading={loading} />
            </div>

            {/* ── Row 2: Key metrics ───────────────────────────────── */}
            <div className="row g-3 mb-4">
                <PPESecondRowCards
                    items={[
                        {
                            icon: 'feather-check-circle',
                            title: 'PPE Compliance Rate',
                            count: loading ? '—' : (rate != null ? `${rate}%` : '—'),
                            color: 'success',
                        },
                        (() => {
                            const maxZone = zones.length > 0 ? zones.reduce((a, b) => (a.violations_today ?? 0) > (b.violations_today ?? 0) ? a : b) : null
                            const zName = maxZone?.zone_name ? `Zone ${maxZone.zone_name}` : 'None'
                            return {
                                icon: 'feather-layers',
                                title: 'Highest Violation Zone',
                                count: loading ? '—' : zName,
                                color: 'warning',
                            }
                        })(),
                        (() => {
                            const total = summary?.violations_today ?? 0
                            const critical = summary?.both_missing_today ?? 0
                            const critRate = total > 0 ? `${Math.round((critical / total) * 100)}%` : '0%'
                            return {
                                icon: 'feather-alert-octagon',
                                title: 'Critical Rate',
                                count: loading ? '—' : critRate,
                                color: 'danger',
                            }
                        })(),
                        {
                            icon: 'feather-alert-triangle',
                            title: 'Active Incidents',
                            count: loading ? '—' : String(summary?.open_incidents ?? 0),
                            color: 'primary',
                        },
                    ]}
                />
            </div>

            {/* ── Row 3: Trend chart + Breakdown + Resolution ─────────────── */}
            <div className="row g-3 mb-4">
                <ViolationsOverTimeCard data={trend} loading={loading} onRefresh={() => invalidatePpeQueries()} dateFrom={dateFilter.from} dateTo={dateFilter.to} />
                <div className="col-xxl-3 col-sm-6">
                    <ViolationBreakdownCard summary={summary} loading={loading} onRefresh={() => invalidatePpeQueries()} />
                </div>
                <div className="col-xxl-3 col-sm-6">
                    <ResolutionCard summary={summary} loading={loading} onRefresh={() => invalidatePpeQueries()} />
                </div>
            </div>

            {/* ── Row 4: Peak Hour + Avg Resolution + Daily Score ─────────────── */}
            <div className="row g-3 mb-4">
                <div className="col-xxl-4 col-sm-6">
                    <PeakHourCard analytics={analytics} loading={loading} onRefresh={() => invalidatePpeQueries()} />
                </div>
                <div className="col-xxl-4 col-sm-6">
                    <AvgResolutionCard summary={summary} loading={loading} onRefresh={() => invalidatePpeQueries()} />
                </div>
                <div className="col-xxl-4 col-sm-6">
                    <DailySafetyScoreCard analytics={analytics} summary={summary} loading={loading} onRefresh={() => invalidatePpeQueries()} />
                </div>
            </div>

            {/* ── Row 5: Zone Breakdown ──────────────────────────────────── */}
            <div className="row g-3 mb-4">
                <div className="col-12">
                    <PPEZoneBreakdown zones={zones} loading={loading} />
                </div>
            </div>

            {/* ── Row 6: Incidents table ──────────────────────────────────── */}
            <PPEIncidentsTable
                projectId={projectId}
                cameras={cameras || []}
                onStatusChange={() => {
                    invalidatePpeQueries()
                    broadcastRefresh('ppe:invalidate', { projectId })
                }}
                dateFrom={toISO(dateFilter.preset === 'live' ? liveStartRef.current : dateFilter.from)}
                dateTo={dateFilter.preset === 'live' ? null : toISO(dateFilter.to)}
                statusFilter={null}
                liveMode={dateFilter.preset === 'live'}
            />

            <style>{`
                @keyframes ppe-pulse {
                    0%   { box-shadow: 0 0 0 0 rgba(40,167,69,0.5); }
                    70%  { box-shadow: 0 0 0 5px rgba(40,167,69,0); }
                    100% { box-shadow: 0 0 0 0 rgba(40,167,69,0); }
                }

                .ppe-donut { color: var(--bs-heading-color); }
                html.app-skin-dark .ppe-donut { color: rgba(255,255,255,0.92); }

                html.app-skin-dark .ppe-trend-chart .recharts-cartesian-axis-tick-value { fill: rgba(255,255,255,0.72) !important; }
                html.app-skin-dark .ppe-trend-chart .recharts-cartesian-grid line { stroke: rgba(255,255,255,0.10) !important; stroke-opacity: 0.85 !important; }
                html.app-skin-dark .ppe-trend-chart .recharts-cartesian-axis-line { stroke: rgba(255,255,255,0.14) !important; }

                html.app-skin-dark .ppe-trend-chart .recharts-default-tooltip {
                    background: rgba(10,18,32,0.96) !important;
                    border-color: rgba(255,255,255,0.12) !important;
                    color: rgba(255,255,255,0.92) !important;
                }
                html.app-skin-dark .ppe-trend-chart .recharts-default-tooltip * { color: rgba(255,255,255,0.86) !important; }

                .MuiChartsLegend-label { color: var(--bs-body-color) !important; fill: var(--bs-body-color) !important; }
                html.app-skin-dark .MuiChartsLegend-label { color: rgba(255,255,255,0.80) !important; fill: rgba(255,255,255,0.80) !important; }

                .ppe-funnel-label { fill: rgba(255,255,255,0.92); font-weight: 800; font-size: 13px; paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 2px; }
                html.app-skin-dark .recharts-tooltip-wrapper .recharts-default-tooltip {
                    background: rgba(10,18,32,0.96) !important;
                    border-color: rgba(255,255,255,0.12) !important;
                }
                html.app-skin-dark .recharts-tooltip-wrapper .recharts-default-tooltip * { color: rgba(255,255,255,0.86) !important; }

                @keyframes ppe-live-pulse {
                    0%   { box-shadow: 0 0 0 0 rgba(40,167,69,0.6); }
                    70%  { box-shadow: 0 0 0 5px rgba(40,167,69,0); }
                    100% { box-shadow: 0 0 0 0 rgba(40,167,69,0); }
                }

                .ppe-live-alert-feed {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    width: 360px;
                    max-height: 500px;
                    z-index: 1040;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    border-radius: 8px;
                }
                @media (max-width: 768px) {
                    .ppe-live-alert-feed {
                        width: calc(100vw - 48px);
                        right: 24px;
                        left: 24px;
                        max-height: 40vh;
                    }
                }
            `}</style>

            </>
            )}

            </div>

        </>
    )
}

export default PPESafetyDashboard
