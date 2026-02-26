/**
 * WorkforceDashboard.jsx
 *
 * Enterprise workforce analytics dashboard — project-level view, PPE-parity design.
 * Everything is aggregated across ALL cameras. No per-zone filtering of cards or charts.
 *
 * Rows:
 *   1 — Four KPI cards (Workers / Avg Utilization / Idle Rate / Open Alerts)
 *   2 — Four secondary cards (Peak Workers / Avg Dwell / Congestion / Staffing Gap)
 *   3 — Workforce Efficiency Score (treemap) | Zone Radar (all-zones aggregate)
 *   4 — Zone Utilization Scatter | Insight Resolution Funnel
 *   5 — Activity Trend chart
 *   6 — Zone Status Overview table (per-zone, filter-scoped)
 *   7 — Workforce Alerts Table
 */
import { useState, useEffect, useCallback, useRef, useMemo, cloneElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageLoader from '@/components/shared/PageLoader'
import { QK } from '@/utils/queryKeys'
import {
    Tooltip, ResponsiveContainer, FunnelChart as ReFunnelChart, Funnel, LabelList,
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { ScatterChart as MuiScatterChart } from '@mui/x-charts/ScatterChart'
import { RadarChart } from '@mui/x-charts/RadarChart'
import { chartsTooltipClasses } from '@mui/x-charts/ChartsTooltip'
import getIcon from '@/utils/getIcon'
import CardHeader from '@/components/shared/CardHeader'
import CardLoader from '@/components/shared/CardLoader'
import useCardTitleActions from '@/hooks/useCardTitleActions'
import WorkforceAlertsTable from './WorkforceAlertsTable'
import useWorkforceStream from '@/hooks/useWorkforceStream'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'
import { patchAlertInCache } from '@/utils/workforceCacheUtils'

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt      = n => (n == null ? '—' : n)
const fmtDwell = secs => {
    if (!secs) return '—'
    if (secs < 60) return `${Math.round(secs)}s`
    const m = Math.floor(secs / 60), s = Math.round(secs % 60)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
}
const fmtTime = iso => {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
const toISO = d => (d ? d.toISOString() : '')

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ icon, title, subtitle, minHeight = 180 }) {
    return (
        <div
            className="d-flex flex-column align-items-center justify-content-center text-center text-muted fs-13"
            style={{ minHeight }}
        >
            <i className={`${icon} fs-28 d-block mb-2`} style={{ opacity: 0.4 }} />
            <span className="fw-semibold d-block mb-1">{title}</span>
            <span className="fs-12">{subtitle}</span>
        </div>
    )
}

const WF_EMPTY_CARD_H = 220
const WF_EMPTY_TREND_H = 240
const WF_EMPTY_TABLE_H = 200

// ── Dark-mode observer ────────────────────────────────────────────────────────
function useDark() {
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('app-skin-dark'))
    useEffect(() => {
        const el  = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])
    return isDark
}

// ── Workforce Efficiency Score (D3 Treemap) ───────────────────────────────────
function EfficiencyTreemap({ components, height = 220 }) {
    const isDark        = useDark()
    const tooltipWidth  = 190
    const tooltipPad    = 10
    const tooltipOffset = 12
    const wrapRef       = useRef(null)
    const [tip, setTip] = useState(null)

    const byName = {}
    ;(components || []).forEach(c => { byName[c.name] = c })

    const viewW = 900, viewH = 220
    const outer = 6, gap = 6
    const availW  = viewW - (outer * 2) - (gap * 2)
    const availH  = viewH - (outer * 2)
    const colLeft = Math.round(availW * 0.34)
    const colMid  = Math.round(availW * 0.33)
    const colRight = availW - colLeft - colMid
    const xLeft   = outer
    const xMid    = xLeft + colLeft + gap
    const xRight  = xMid + colMid + gap
    const yTop    = outer
    const halfH   = Math.round((availH - gap) / 2)
    const yMid    = yTop + halfH + gap
    const botH    = availH - halfH - gap

    const tiles = [
        { key: 'Staffing',   x: xLeft,  y: yTop, w: colLeft,  h: availH },
        { key: 'Activity',   x: xMid,   y: yTop, w: colMid,   h: halfH  },
        { key: 'Alert-Free', x: xMid,   y: yMid, w: colMid,   h: botH   },
        { key: 'Stability',  x: xRight, y: yTop, w: colRight, h: availH },
    ].map(t => {
        const d = byName[t.key] || { name: t.key, pct: 0, weight: '—', color: '#6689c6' }
        return { ...t, data: d }
    })

    const tipPos = (() => {
        if (!tip) return null
        const wrapW = wrapRef.current?.clientWidth ?? 0
        const x = Math.max(tooltipPad, Math.min(tip.x + tooltipOffset, wrapW - tooltipWidth - tooltipPad))
        const y = Math.max(tooltipPad, Math.min(tip.y + tooltipOffset, height - 72 - tooltipPad))
        return { x, y }
    })()

    return (
        <div ref={wrapRef} style={{ width: '100%', height, position: 'relative' }}>
            <style>{`
                .wf-eff-treemap .wf-eff-rect { transition: filter .3s, opacity .3s; opacity: 1; filter: saturate(100%); }
                .wf-eff-treemap:hover .wf-eff-rect { opacity: .42; filter: saturate(60%); }
                .wf-eff-treemap .wf-eff-rect:hover { opacity: 1; filter: saturate(100%); }
                .wf-eff-tip { position: absolute; z-index: 6; pointer-events: none; width: ${tooltipWidth}px;
                    padding: 8px 10px; background: var(--bs-body-bg); border: 1px solid var(--bs-border-color);
                    color: var(--bs-body-color); border-radius: 6px; box-shadow: 0 10px 30px rgba(2,6,23,.18); }
                .wf-eff-tip-title { font-size: 12px; font-weight: 500; color: var(--bs-body-color); }
                .wf-eff-tip-sub   { margin-top: 2px; font-size: 11px; color: var(--bs-secondary-color); }
                html.app-skin-dark .wf-eff-tip { background: rgba(10,18,32,.96); border-color: rgba(255,255,255,.12); color: rgba(255,255,255,.92); box-shadow: 0 12px 40px rgba(0,0,0,.55); }
                html.app-skin-dark .wf-eff-tip-title { color: rgba(255,255,255,.92); }
                html.app-skin-dark .wf-eff-tip-sub   { color: rgba(255,255,255,.72); }
            `}</style>
            {tip && tipPos && (
                <div className="wf-eff-tip" style={{ left: tipPos.x, top: tipPos.y }}>
                    <div className="wf-eff-tip-title">{tip.name}</div>
                    <div className="wf-eff-tip-sub">{tip.pct}% · weight {tip.weight}</div>
                </div>
            )}
            <svg
                width="100%" height={height}
                className="wf-eff-treemap"
                style={{ borderRadius: 0, overflow: 'hidden', display: 'block' }}
                viewBox={`0 0 ${viewW} ${viewH}`}
                preserveAspectRatio="none"
            >
                {tiles.map(t => {
                    const showName = t.w > 110 && t.h > 40
                    const showPct  = t.w > 90  && t.h > 30
                    const cx = t.x + t.w / 2
                    const cy = t.y + t.h / 2
                    return (
                        <g
                            key={t.key}
                            className="wf-eff-rect"
                            onMouseEnter={e => {
                                const r = wrapRef.current?.getBoundingClientRect()
                                if (!r) return
                                setTip({ name: t.data.name, pct: t.data.pct, weight: t.data.weight, x: e.clientX - r.left, y: e.clientY - r.top })
                            }}
                            onMouseMove={e => {
                                const r = wrapRef.current?.getBoundingClientRect()
                                if (!r) return
                                setTip(prev => prev ? ({ ...prev, x: e.clientX - r.left, y: e.clientY - r.top }) : prev)
                            }}
                            onMouseLeave={() => setTip(null)}
                        >
                            <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={0} ry={0}
                                fill={t.data.color} opacity={0.88}
                                stroke={isDark ? 'rgba(255,255,255,.16)' : 'rgba(15,23,42,.12)'}
                                strokeWidth={1.4}
                            />
                            {(showName || showPct) && (
                                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                                    fill="rgba(255,255,255,.96)" style={{ pointerEvents: 'none' }}>
                                    {showName && <tspan x={cx} dy={showPct ? -8 : 0} fontSize={12} fontWeight={500} letterSpacing={0.2}>{t.data.name}</tspan>}
                                    {showPct  && <tspan x={cx} dy={showName ? 18 : 0} fontSize={16} fontWeight={600}>{t.data.pct}%</tspan>}
                                </text>
                            )}
                        </g>
                    )
                })}
            </svg>
        </div>
    )
}

function WorkforceEfficiencyScore({ currentWorkers, activeWorkers, totalWorkers, requiredWorkers, understaffedAlertsToday, idleAlertsToday, congestionEvents, hasData, loading }) {
    const isDark = useDark()
    if (loading) return <PageLoader minHeight={180} />
    if (!hasData) return (
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )
    const req          = requiredWorkers || 1
    const staffingComp = Math.min(100, Math.round((currentWorkers / req) * 100))
    const activeRate   = totalWorkers > 0 ? Math.round((activeWorkers / totalWorkers) * 100) : 0
    const alertsToday  = (understaffedAlertsToday || 0) + (idleAlertsToday || 0)
    const alertFree    = Math.max(0, 100 - Math.min(100, alertsToday * 5))
    const congFree     = congestionEvents === 0 ? 100 : Math.max(0, 100 - congestionEvents * 25)
    const score        = Math.round(staffingComp * 0.40 + activeRate * 0.30 + alertFree * 0.20 + congFree * 0.10)
    const scoreColor   = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'
    const label        = score >= 70 ? 'EXCELLENT' : score >= 40 ? 'ADEQUATE' : 'CRITICAL'
    const tone         = score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
    const unitColor    = isDark ? 'rgba(226,232,240,.75)' : 'var(--bs-secondary-color)'

    const tileValue = (pct, weight) => Math.round((weight * 0.55) + (Math.max(0, Math.min(100, pct)) * 0.45))
    const components = [
        { name: 'Staffing',   pct: staffingComp, color: '#6366f1', weight: '40%', value: tileValue(staffingComp, 40) },
        { name: 'Activity',   pct: activeRate,   color: '#22c55e', weight: '30%', value: tileValue(activeRate,   30) },
        { name: 'Alert-Free', pct: alertFree,    color: '#f59e0b', weight: '20%', value: tileValue(alertFree,    20) },
        { name: 'Stability',  pct: congFree,     color: '#ef4444', weight: '10%', value: tileValue(congFree,     10) },
    ]

    return (
        <div className="d-flex flex-column align-items-stretch w-100" style={{ gap: 10 }}>
            <div className="d-flex flex-column align-items-center justify-content-center" style={{ gap: 6 }}>
                <div className="d-flex align-items-end justify-content-center" style={{ gap: 8 }}>
                    <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: scoreColor }}>
                        {score}
                        <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color: unitColor, marginLeft: 6 }}>/ 100</span>
                    </div>
                </div>
                <span className={`badge bg-soft-${tone} text-${tone} fs-11 fw-bold text-uppercase`} style={{ letterSpacing: 0.8 }}>
                    {label}
                </span>
            </div>
            <div style={{ width: '100%', alignSelf: 'stretch', minHeight: 220 }}>
                <EfficiencyTreemap components={components} height={220} />
            </div>
        </div>
    )
}

// ── Zone Radar Chart — always project-level aggregate ─────────────────────────
function ZoneRadarChart({ allResolved, settingsData, loading, isLive, perCameraData, height = 320 }) {
    const isDark = useDark()

    const req = settingsData?.required_workers || 1

    let util, staffing, dwellSecs

    const palette = ['#ffc762', '#445cf6', '#22c55e', '#dc3545', '#a855f7', '#06b6d4', '#f97316', '#84cc16']
    const formatZoneLabel = (raw) => {
        const s = String(raw || '').trim()
        if (!s) return 'Unassigned'
        if (/^zone\s/i.test(s)) return s
        if (/^[A-Za-z]$/.test(s)) return `Zone ${s.toUpperCase()}`
        return s
    }

    if (isLive) {
        if (allResolved.length === 0) return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )

        const byZone = new Map()
        allResolved.forEach(r => {
            const key = String(r.zone_name || '').trim() || 'Unassigned'
            const entry = byZone.get(key) || { key, rows: [] }
            entry.rows.push(r)
            byZone.set(key, entry)
        })

        const ranked = Array.from(byZone.values())
            .map(z => {
                const rows = z.rows
                const avgUtil = rows.reduce((s, r) => s + (r.utilization_score ?? 0), 0) / rows.length
                const avgW    = rows.reduce((s, r) => s + (r.current_worker_count ?? 0), 0) / rows.length
                const avgD    = rows.reduce((s, r) => s + (r.avg_dwell_seconds ?? 0), 0) / rows.length
                return {
                    key: z.key,
                    avgWorkers: avgW,
                    util: Math.round(avgUtil),
                    staffing: Math.min(100, Math.round((avgW / req) * 100)),
                    dwell: Math.min(100, Math.round((avgD / 1800) * 100)),
                }
            })
            .sort((a, b) => (b.avgWorkers ?? 0) - (a.avgWorkers ?? 0))

        const MAX = 8
        const top = ranked.slice(0, MAX)
        const rest = ranked.slice(MAX)
        const list = rest.length === 0 ? top : (() => {
            const avgUtil = rest.reduce((s, r) => s + (r.util ?? 0), 0) / rest.length
            const avgW    = rest.reduce((s, r) => s + (r.avgWorkers ?? 0), 0) / rest.length
            const avgStaff = rest.reduce((s, r) => s + (r.staffing ?? 0), 0) / rest.length
            const avgDwell = rest.reduce((s, r) => s + (r.dwell ?? 0), 0) / rest.length
            return [
                ...top,
                { key: 'Other Zones', avgWorkers: avgW, util: Math.round(avgUtil), staffing: Math.round(avgStaff), dwell: Math.round(avgDwell) },
            ]
        })()

        const liveSeries = list.map((z, i) => ({
            id: `zone-${z.key}`,
            label: formatZoneLabel(z.key),
            data: [z.util, z.staffing, z.dwell],
            color: palette[i % palette.length],
            fillArea: true,
        }))

        util      = Math.round(allResolved.reduce((s, v) => s + (v.utilization_score ?? 0), 0) / allResolved.length)
        const avgW = allResolved.reduce((s, v) => s + (v.current_worker_count ?? 0), 0) / allResolved.length
        staffing  = Math.min(100, Math.round((avgW / req) * 100))
        dwellSecs = allResolved.reduce((s, v) => s + (v.avg_dwell_seconds ?? 0), 0) / allResolved.length

        const dwell  = Math.min(100, Math.round((dwellSecs / 1800) * 100))
        const series = liveSeries.length > 0 ? liveSeries : [{ id: 'zone-perf', label: 'All Zones', data: [util, staffing, dwell], color: '#ffc762', fillArea: true }]
        const radar  = { metrics: ['Utilization', 'Staffing', 'Dwell Score'], labelGap: 14 }
        const axisColor = isDark ? 'rgba(255,255,255,.14)' : 'var(--bs-border-color)'
        const gridColor = isDark ? 'rgba(255,255,255,.22)' : 'var(--bs-border-color)'
        const tickColor = isDark ? '#bcbec3' : '#585c5f'

        return (
            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '100%', maxWidth: 560 }}>
                    <RadarChart
                        height={height}
                        series={series}
                        radar={radar}
                        stripeColor={i => i % 2 === 0 ? 'none' : (isDark ? 'rgba(255,255,255,.22)' : 'rgba(15,23,42,.10)')}
                        margin={{ top: 44, right: 18, bottom: 18, left: 18 }}
                        slotProps={{
                            tooltip: {
                                trigger: 'item',
                                sx: {
                                    [`& .${chartsTooltipClasses.paper}`]: { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' },
                                    [`& .${chartsTooltipClasses.table} *`]: { color: 'var(--bs-body-color)' },
                                    [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: { backgroundColor: 'rgba(10,18,32,.96)', borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.92)' },
                                    [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: { color: 'rgba(255,255,255,.86)' },
                                },
                            },
                            legend: {
                                direction: 'horizontal',
                                position: { vertical: 'top', horizontal: 'middle' },
                                sx: { '& .MuiChartsLegend-label': { color: tickColor, fill: tickColor, fontSize: 12, fontWeight: 600 }, '& .MuiChartsLegend-mark': { rx: 3, ry: 3 } },
                            },
                        }}
                        sx={{
                            width: '100%',
                            '& .MuiRadarChart-gridRadial, & .MuiRadarChart-gridDivider': { stroke: gridColor, strokeOpacity: isDark ? 0.7 : 1, strokeWidth: isDark ? 1.2 : 1.05 },
                            '& .MuiRadarChart-gridStripe': { fillOpacity: isDark ? 0.10 : 0.08 },
                            '& .MuiRadarChart-axisLine': { stroke: axisColor, strokeOpacity: isDark ? 0.7 : 1 },
                            '& .MuiRadarChart-axisLabel': { fill: tickColor, fontSize: 12, fontWeight: 600 },
                            '& .MuiRadarChart-seriesArea': { strokeWidth: 2, fillOpacity: isDark ? 0.22 : 0.16 },
                            '& .MuiRadarChart-seriesMark': { r: 3.5 },
                            '& .MuiChartsSurface-root text': { fill: `${tickColor} !important`, fontWeight: 600 },
                            '& .MuiChartsSurface-root tspan': { fill: `${tickColor} !important`, fontWeight: 600 },
                        }}
                    />
                </div>
            </div>
        )
    } else {
        if (loading && perCameraData.length === 0) return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
        if (perCameraData.length === 0) return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
        util      = Math.round(perCameraData.reduce((s, r) => s + (r.avg_utilization ?? 0), 0) / perCameraData.length)
        const avgW = perCameraData.reduce((s, r) => s + (r.avg_workers ?? 0), 0) / perCameraData.length
        staffing  = Math.min(100, Math.round((avgW / req) * 100))
        dwellSecs = perCameraData.reduce((s, r) => s + (r.avg_dwell ?? r.avg_dwell_seconds ?? 0), 0) / perCameraData.length
    }

    const dwell  = Math.min(100, Math.round((dwellSecs / 1800) * 100))
    const zoneSeries = !isLive ? (() => {
        const byZone = new Map()
        perCameraData.forEach(r => {
            const key = String(r.zone_name || '').trim() || 'Unassigned'
            const entry = byZone.get(key) || { key, rows: [] }
            entry.rows.push(r)
            byZone.set(key, entry)
        })
        const ranked = Array.from(byZone.values())
            .map(z => {
                const rows = z.rows
                const avgUtil = rows.reduce((s, r) => s + (r.avg_utilization ?? 0), 0) / rows.length
                const avgW    = rows.reduce((s, r) => s + (r.avg_workers ?? 0), 0) / rows.length
                const avgD    = rows.reduce((s, r) => s + (r.avg_dwell ?? r.avg_dwell_seconds ?? 0), 0) / rows.length
                return {
                    key: z.key,
                    avgWorkers: avgW,
                    util: Math.round(avgUtil),
                    staffing: Math.min(100, Math.round((avgW / req) * 100)),
                    dwell: Math.min(100, Math.round((avgD / 1800) * 100)),
                }
            })
            .sort((a, b) => (b.avgWorkers ?? 0) - (a.avgWorkers ?? 0))

        const MAX = 8
        const top = ranked.slice(0, MAX)
        const rest = ranked.slice(MAX)
        const list = rest.length === 0 ? top : (() => {
            const avgUtil = rest.reduce((s, r) => s + (r.util ?? 0), 0) / rest.length
            const avgW    = rest.reduce((s, r) => s + (r.avgWorkers ?? 0), 0) / rest.length
            const avgStaff = rest.reduce((s, r) => s + (r.staffing ?? 0), 0) / rest.length
            const avgDwell = rest.reduce((s, r) => s + (r.dwell ?? 0), 0) / rest.length
            return [
                ...top,
                { key: 'Other Zones', avgWorkers: avgW, util: Math.round(avgUtil), staffing: Math.round(avgStaff), dwell: Math.round(avgDwell) },
            ]
        })()

        return list.map((z, i) => ({
            id: `zone-${z.key}`,
            label: formatZoneLabel(z.key),
            data: [z.util, z.staffing, z.dwell],
            color: palette[i % palette.length],
            fillArea: true,
        }))
    })() : null

    const series = zoneSeries && zoneSeries.length > 0
        ? zoneSeries
        : [{ id: 'zone-perf', label: 'All Zones', data: [util, staffing, dwell], color: '#ffc762', fillArea: true }]
    const radar  = { metrics: ['Utilization', 'Staffing', 'Dwell Score'], labelGap: 14 }

    const axisColor = isDark ? 'rgba(255,255,255,.14)' : 'var(--bs-border-color)'
    const gridColor = isDark ? 'rgba(255,255,255,.22)' : 'var(--bs-border-color)'
    const tickColor = isDark ? '#bcbec3' : '#585c5f'

    return (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: 560 }}>
                <RadarChart
                    height={height}
                    series={series}
                    radar={radar}
                    stripeColor={i => i % 2 === 0 ? 'none' : (isDark ? 'rgba(255,255,255,.22)' : 'rgba(15,23,42,.10)')}
                    margin={{ top: 44, right: 18, bottom: 18, left: 18 }}
                    slotProps={{
                        tooltip: {
                            trigger: 'item',
                            sx: {
                                [`& .${chartsTooltipClasses.paper}`]: { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' },
                                [`& .${chartsTooltipClasses.table} *`]: { color: 'var(--bs-body-color)' },
                                [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: { backgroundColor: 'rgba(10,18,32,.96)', borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.92)' },
                                [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: { color: 'rgba(255,255,255,.86)' },
                            },
                        },
                        legend: {
                            direction: 'horizontal',
                            position: { vertical: 'top', horizontal: 'middle' },
                            sx: { '& .MuiChartsLegend-label': { color: tickColor, fill: tickColor, fontSize: 12, fontWeight: 600 }, '& .MuiChartsLegend-mark': { rx: 3, ry: 3 } },
                        },
                    }}
                    sx={{
                        width: '100%',
                        '& .MuiRadarChart-gridRadial, & .MuiRadarChart-gridDivider': { stroke: gridColor, strokeOpacity: isDark ? 0.7 : 1, strokeWidth: isDark ? 1.2 : 1.05 },
                        '& .MuiRadarChart-gridStripe': { fillOpacity: isDark ? 0.10 : 0.08 },
                        '& .MuiRadarChart-axisLine': { stroke: axisColor, strokeOpacity: isDark ? 0.7 : 1 },
                        '& .MuiRadarChart-axisLabel': { fill: tickColor, fontSize: 12, fontWeight: 600 },
                        '& .MuiRadarChart-seriesArea': { strokeWidth: 2, fillOpacity: isDark ? 0.22 : 0.16 },
                        '& .MuiRadarChart-seriesMark': { r: 3.5 },
                        '& .MuiChartsSurface-root text': { fill: `${tickColor} !important`, fontWeight: 600 },
                        '& .MuiChartsSurface-root tspan': { fill: `${tickColor} !important`, fontWeight: 600 },
                    }}
                />
            </div>
        </div>
    )
}

// ── Zone Utilization Scatter — all zones plotted, zone label in tooltip ────────
function DwellUtilScatter({ perCameraData, loading, isLive, allResolved }) {
    const isDark = useDark()

    const points = useMemo(() => {
        if (isLive) {
            return (allResolved || []).map((row, i) => {
                const x = (row.avg_dwell_seconds ?? 0) / 60
                const y = row.utilization_score ?? 0
                const zone = String(row.zone_name || '').trim()
                const label = zone ? (/^zone\s/i.test(zone) ? zone : /^[A-Za-z]$/.test(zone) ? `Zone ${zone.toUpperCase()}` : zone) : 'Unassigned'
                return {
                    id:    i,
                    x:     +x.toFixed(2),
                    y:     +y.toFixed(1),
                    z:     x + y,
                    label,
                }
            }).filter(p => p.x > 0 || p.y > 0)
        }

        return (perCameraData || []).map((row, i) => {
            const x = (row.avg_dwell ?? 0) / 60
            const y = row.avg_utilization ?? 0
            return {
                id:    i,
                x:     +x.toFixed(2),
                y:     +y.toFixed(1),
                z:     x + y,
                label: row.zone_name || `Camera ${row.camera_id}`,
            }
        }).filter(p => p.x > 0 || p.y > 0)
    }, [perCameraData, isLive, allResolved])

    if (loading && points.length === 0) return (
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )
    if (points.length === 0) return (
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )

    const rawMax   = Math.max(...points.map(p => p.x))
    const maxDwell = Math.ceil(rawMax * 1.15) || 10
    const minZ     = Math.min(...points.map(p => p.z))
    const maxZ     = Math.max(...points.map(p => p.z))
    const axisCol  = isDark ? 'rgba(255,255,255,.14)' : 'var(--bs-border-color)'
    const tickCol  = isDark ? 'rgba(255,255,255,.72)' : 'var(--bs-secondary-color)'
    const gridCol  = isDark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)'

    return (
        <MuiScatterChart
            height={380}
            voronoiMaxRadius={8}
            grid={{ horizontal: true, vertical: true }}
            series={[{
                data: points,
                valueFormatter: v => v ? `${v.label} · ~${v.x}m dwell · ~${v.y}% util` : '',
            }]}
            xAxis={[{
                min: 0, max: maxDwell, label: 'Avg Dwell Time', height: 45,
                labelStyle: { fill: tickCol, fontSize: 12, fontWeight: 600, transform: 'translateY(6px)' },
                colorMap: { type: 'continuous', min: 0, max: maxDwell, color: ['#22c55e', '#f59e0b'] },
            }]}
            yAxis={[{
                min: 0, max: 100, label: 'Utilization %', width: 52,
                labelStyle: { fill: tickCol, fontSize: 12, fontWeight: 600, angle: -90 },
                tickInterval: [0, 25, 50, 75, 100],
                colorMap: { type: 'continuous', min: 0, max: 100, color: ['#22c55e', '#f59e0b'] },
            }]}
            zAxis={[{ colorMap: { type: 'continuous', min: minZ, max: maxZ, color: ['#22c55e', '#f59e0b'] } }]}
            slotProps={{
                legend: { hidden: true },
                tooltip: {
                    trigger: 'item',
                    sx: {
                        [`& .${chartsTooltipClasses.paper}`]: { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' },
                        [`& .${chartsTooltipClasses.table} *`]: { color: 'var(--bs-body-color)' },
                        [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: { backgroundColor: 'rgba(10,18,32,.96)', borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.92)' },
                        [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: { color: 'rgba(255,255,255,.86)' },
                    },
                },
            }}
            sx={{
                '& .MuiChartsGrid-line, & .MuiChartsGrid-horizontalLine, & .MuiChartsGrid-verticalLine': { stroke: `${gridCol} !important`, strokeOpacity: isDark ? 0.85 : 0.65, strokeDasharray: '3 3' },
                '& .MuiChartsAxis-tickLabel': { fill: `${tickCol} !important`, fontSize: 12 },
                '& .MuiChartsAxis-label':     { fill: `${tickCol} !important`, fontSize: 12 },
                '& .MuiChartsAxis-line':      { stroke: `${axisCol} !important` },
                '& .MuiChartsAxis-tick':      { stroke: `${axisCol} !important` },
                '& .MuiScatterElement-root':  { stroke: 'none !important' },
                '& .MuiChartsLegend-root':    { display: 'none' },
            }}
            margin={{ top: 16, right: 30, bottom: 36, left: 20 }}
        />
    )
}

// ── Insight Resolution Funnel ─────────────────────────────────────────────────
function WorkforceResolutionFunnel({ summary, loading }) {
    const open  = summary?.open_alerts         ?? 0
    const ack   = summary?.acknowledged_alerts ?? 0
    const res   = summary?.resolved_alerts     ?? 0
    const total = open + ack + res

    const funnelData = [
        { name: 'OPEN',         value: 200, display: open, fill: '#5b73e8' },
        { name: 'ACKNOWLEDGED', value: 180, display: ack,  fill: '#6c5ce7' },
        { name: 'RESOLVED',     value: 90,  display: res,  fill: '#2dd4bf' },
    ]

    return (
        <div className="card-body py-3 custom-card-action">
            {loading ? (
                <PageLoader minHeight={180} />
            ) : total === 0 ? (
                <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_CARD_H }}>
                    <span className="fw-semibold d-block mb-1">No records available</span>
                    <span className="fs-12">No results for the current selection</span>
                </div>
            ) : (
                <div className="wf-resolution-funnel" style={{ display: 'flex', justifyContent: 'center', paddingTop: 40, paddingBottom: 40 }}>
                    <style>{`
                        html.app-skin-dark .wf-resolution-funnel .recharts-default-tooltip { background: rgba(10,18,32,.96) !important; border-color: rgba(255,255,255,.12) !important; color: rgba(255,255,255,.92) !important; }
                        html.app-skin-dark .wf-resolution-funnel .recharts-default-tooltip * { color: rgba(255,255,255,.86) !important; }
                    `}</style>
                    <div style={{ width: 340, height: 320 }}>
                        <ResponsiveContainer width={340} height={320}>
                            <ReFunnelChart>
                                <Tooltip
                                    formatter={(_v, _n, p) => [Number(p?.payload?.display ?? 0).toLocaleString(), p?.payload?.name || '']}
                                    contentStyle={{ backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', borderRadius: 6, color: 'var(--bs-body-color)' }}
                                    labelStyle={{ color: 'var(--bs-body-color)' }}
                                />
                                <Funnel dataKey="value" data={funnelData} stroke="transparent" strokeWidth={0} isAnimationActive animationDuration={900} lastShapeType="rectangle">
                                    <LabelList dataKey="display" position="inside" fill="white" fontSize={15} fontWeight={500} />
                                </Funnel>
                            </ReFunnelChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── Activity Trend Chart ──────────────────────────────────────────────────────
function ActivityTrendChart({ trendPoints, loading, isLive, dateFrom, dateTo }) {
    const isDark = useDark()

    if (loading && trendPoints.length === 0) {
        return (
            <PageLoader minHeight={WF_EMPTY_TREND_H} />
        )
    }
    if (trendPoints.length === 0) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_TREND_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
    }

    const spanDays = dateFrom && dateTo
        ? (new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24)
        : isLive ? 0 : 1
    const isMultiDay = spanDays > 1.5

    const fmtTick = (v) => {
        if (!v) return '—'
        const d = new Date(v)
        if (isNaN(d.getTime())) return String(v)
        if (isMultiDay) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        return d.toLocaleTimeString([], isLive
            ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
            : { hour: '2-digit', minute: '2-digit' }
        )
    }

    const workerCounts = trendPoints.map(d => d.workers ?? 0)
    const maxWorkers   = workerCounts.length > 0 ? Math.max(...workerCounts) : 0
    const avgWorkers   = workerCounts.length > 0 ? Math.round(workerCounts.reduce((a, b) => a + b, 0) / workerCounts.length) : 0
    const utilVals     = trendPoints.map(d => d.util ?? 0)
    const avgUtil      = utilVals.length > 0 ? Math.round(utilVals.reduce((a, b) => a + b, 0) / utilVals.length) : 0

    const workerYMax = Math.max(5, Math.ceil((maxWorkers * 1.2) / 5) * 5)

    const CustomDot = ({ cx, cy, payload, dataKey }) => {
        if (!payload || !cx || !cy) return null
        const isPeak = dataKey === 'workers' && payload.workers === maxWorkers && maxWorkers > 0
        const color  = dataKey === 'workers' ? '#f59e0b' : dataKey === 'util' ? '#445cf6' : '#dc2626'
        return (
            <>
                {isPeak && <circle cx={cx} cy={cy} r={10} fill="none" stroke={color} strokeWidth="1.5" opacity="0.3" />}
                <circle cx={cx} cy={cy} r={isPeak ? 6 : 4} fill={color} />
            </>
        )
    }

    const axisCol = isDark ? 'rgba(255,255,255,.14)' : 'var(--bs-border-color)'
    const tickCol = isDark ? 'rgba(255,255,255,.72)' : 'var(--bs-secondary-color)'
    const gridCol = isDark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)'

    const CenteredYAxisLabel = ({ viewBox, value, side }) => {
        const { x, y, width, height } = viewBox || {}
        if (x == null || y == null || width == null || height == null) return null
        const cx = side === 'right' ? (x + width + 28) : (x + 0)
        const cy = y + height / 2
        const angle = side === 'right' ? 90 : -90
        return (
            <text
                x={cx}
                y={cy}
                fill={tickCol}
                fontSize={12}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${angle} ${cx} ${cy})`}
            >
                {value}
            </text>
        )
    }

    return (
        <div className="wf-trend-chart">
            <div className="d-flex justify-content-center gap-3 mb-2">
                {[['#f59e0b', 'Avg Worker Count'], ['#445cf6', 'Utilization %'], ['#dc2626', 'Idle Rate %']].map(([color, label]) => (
                    <div key={label} className="d-flex align-items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: tickCol }}>
                        <span style={{ width: 12, height: 3, background: color, borderRadius: 2, display: 'inline-block' }} />
                        {label}
                    </div>
                ))}
            </div>
            <ResponsiveContainer width="100%" height={440}>
                <AreaChart data={trendPoints} margin={{ top: 8, right: 96, left: 8, bottom: 36 }}>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridCol}
                        strokeOpacity={isDark ? 0.85 : 0.65}
                        vertical
                        horizontal
                    />
                    <XAxis
                        dataKey="ts"
                        stroke={axisCol}
                        tick={{ fill: tickCol, fontSize: 12 }}
                        axisLine={{ stroke: axisCol }}
                        tickLine={false}
                        tickMargin={10}
                        height={45}
                        interval={isMultiDay ? 0 : Math.max(0, Math.ceil(trendPoints.length / 8) - 1)}
                        angle={0}
                        textAnchor="middle"
                        tickFormatter={fmtTick}
                    />
                    <YAxis
                        yAxisId="workers"
                        orientation="left"
                        domain={[0, workerYMax]}
                        ticks={Array.from({ length: 6 }, (_, i) => Math.round(i * workerYMax / 5))}
                        stroke={axisCol}
                        tick={{ fill: tickCol, fontSize: 12 }}
                        axisLine={{ stroke: axisCol }}
                        tickLine={false}
                        allowDecimals={false}
                        tickMargin={8}
                        width={52}
                        label={<CenteredYAxisLabel side="left" value="Avg Worker Count" />}
                    />
                    <YAxis
                        yAxisId="pct"
                        orientation="right"
                        domain={[0, 100]}
                        stroke={axisCol}
                        tick={{ fill: tickCol, fontSize: 12 }}
                        axisLine={{ stroke: axisCol }}
                        tickLine={false}
                        allowDecimals={false}
                        tickMargin={8}
                        width={52}
                        tickFormatter={v => `${v}%`}
                        label={<CenteredYAxisLabel side="right" value="Utilization & Idle Rate %" />}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', borderRadius: 6, color: 'var(--bs-body-color)', fontSize: 12 }}
                        labelStyle={{ color: 'var(--bs-body-color)', fontWeight: 600 }}
                        cursor={{ stroke: axisCol, strokeWidth: 1, strokeDasharray: '4 3' }}
                        labelFormatter={fmtTick}
                        formatter={(value, name) => {
                            if (name === 'workers')    return [value, 'Workers']
                            if (name === 'util')       return [`${value}%`, 'Utilization']
                            if (name === 'idle_ratio') return [`${value}%`, 'Idle Rate']
                            return [value, name]
                        }}
                    />
                    <Area yAxisId="workers" type="monotone" dataKey="workers"    stroke="#f59e0b" strokeWidth={2.5} fill="#f59e0b" fillOpacity={0.14} dot={<CustomDot dataKey="workers" />}    activeDot={{ r: 7 }} isAnimationActive />
                    <Area yAxisId="pct"     type="monotone" dataKey="util"       stroke="#445cf6" strokeWidth={2.5} fill="#445cf6" fillOpacity={0.10} dot={<CustomDot dataKey="util" />}       activeDot={{ r: 7 }} isAnimationActive />
                    <Area yAxisId="pct"     type="monotone" dataKey="idle_ratio" stroke="#dc2626" strokeWidth={2}   fill="#dc2626" fillOpacity={0.07} dot={<CustomDot dataKey="idle_ratio" />} activeDot={{ r: 6 }} isAnimationActive />
                </AreaChart>
            </ResponsiveContainer>

        </div>
    )
}

// ── Zone Comparison Table ─────────────────────────────────────────────────────
// Live mode:   real-time SSE values per zone
// Filter mode: period-aggregated values from perCameraData (date-range scoped)
//              zones with no snapshots in the period show "—" across all cells
function ZoneComparisonTable({ camList, isLive, loading }) {
    if (loading && camList.length === 0) {
        return (
            <PageLoader minHeight={WF_EMPTY_TABLE_H} />
        )
    }
    const liveHasAnyValues = isLive
        ? camList.some(r =>
            r?.latest_worker_count != null ||
            r?.active_count != null ||
            r?.idle_count != null ||
            r?.latest_utilization != null ||
            r?.latest_zone_status != null ||
            r?.avg_dwell_seconds != null ||
            r?.open_alerts != null
        )
        : true

    const visible = isLive ? camList : camList.filter(c => !c._noData)

    if (camList.length === 0 || (isLive && !liveHasAnyValues) || (!isLive && visible.length === 0)) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: WF_EMPTY_TABLE_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
    }

    const statusBadge = status => {
        const s = (status || '').toUpperCase()
        if (s === 'UNDERSTAFFED') return <span className="badge bg-soft-warning text-warning fw-semibold" style={{ fontSize: 11 }}>UNDERSTAFFED</span>
        if (s === 'OVERLOADED' || s === 'OVERLOAD') return <span className="badge bg-soft-danger text-danger fw-semibold" style={{ fontSize: 11 }}>OVERLOADED</span>
        if (s === 'BALANCED') return <span className="badge bg-soft-success text-success fw-semibold" style={{ fontSize: 11 }}>BALANCED</span>
        return <span className="text-muted fs-12">—</span>
    }

    return (
        <div className="table-responsive pm-table-wrap wf-zone-compare">
            <table className="table table-hover mb-0 align-middle">
                <colgroup>
                    {isLive ? (
                        <>
                            <col style={{ width: '12%' }} />
                            <col style={{ width: '16%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '9%' }} />
                            <col style={{ width: '9%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '12%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '12%' }} />
                        </>
                    ) : (
                        <>
                            <col style={{ width: '12%' }} />
                            <col style={{ width: '18%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '13%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '13%' }} />
                        </>
                    )}
                </colgroup>
                <thead>
                    <tr className="border-b">
                        <th scope="row" className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone</th>
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Camera</th>
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>{isLive ? 'Workers On-Site' : 'Avg Workers'}</th>
                        {isLive ? (
                            <>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Active Workers</th>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Idle Workers</th>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Utilization</th>
                            </>
                        ) : (
                            <>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Utilization</th>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Idle Rate</th>
                            </>
                        )}
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Avg Dwell Time</th>
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Active Insights</th>
                        <th className="fs-11 text-uppercase text-end" style={{ letterSpacing: '0.06em' }}>Zone Status</th>
                    </tr>
                </thead>
                <tbody>
                    {visible.map(c => {
                        const noData = c._noData === true
                        const cameraName = c.camera_name || '—'
                        const zoneName = c.zone_name || null

                        if (noData) {
                            return (
                                <tr key={c.camera_id} style={{ opacity: 0.55 }}>
                                    <td>
                                        {zoneName ? (
                                            <span className="pm-pill pm-pill-warning" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {zoneName}
                                            </span>
                                        ) : (
                                            <span className="text-muted fs-11">—</span>
                                        )}
                                    </td>
                                    <td>
                                        <span
                                            className="badge bg-soft-success text-success fs-11 fw-semibold"
                                            style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        >
                                            {cameraName}
                                        </span>
                                    </td>
                                    <td className="text-center" colSpan={isLive ? 7 : 6}>
                                        <span className="badge bg-soft-secondary text-secondary fw-semibold px-3 py-2" style={{ fontSize: 11, letterSpacing: '0.04em' }}>
                                            No activity recorded in this period
                                        </span>
                                    </td>
                                </tr>
                            )
                        }

                        const workersLive = c.latest_worker_count ?? null
                        const activeCount = c.active_count ?? null
                        const idleCount   = c.idle_count ?? null

                        const avgWorkers   = c._avgWorkers   ?? null
                        const avgUtil      = c._avgUtil      ?? null
                        const avgIdleRatio = c._avgIdleRatio ?? null

                        const utilPct = c.latest_utilization != null ? Math.round(c.latest_utilization) : null
                        const dwell = c.avg_dwell_seconds ? fmtDwell(c.avg_dwell_seconds) : '—'
                        const zoneStatus = c.latest_zone_status || null

                        return (
                            <tr key={c.camera_id}>
                                <td>
                                    {zoneName ? (
                                        <span className="pm-pill pm-pill-warning" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {zoneName}
                                        </span>
                                    ) : (
                                        <span className="text-muted fs-11">—</span>
                                    )}
                                </td>
                                <td>
                                    <span
                                        className="badge bg-soft-success text-success fs-11 fw-semibold"
                                        style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    >
                                        {cameraName}
                                    </span>
                                </td>
                                <td>
                                    {isLive ? (
                                        <span className="badge bg-soft-primary text-primary fs-11">
                                            {workersLive ?? '—'}
                                        </span>
                                    ) : (
                                        <span className="badge bg-soft-primary text-primary fs-11">
                                            {avgWorkers ?? '—'}
                                        </span>
                                    )}
                                </td>
                                {isLive ? (
                                    <>
                                        <td>
                                            {activeCount != null ? (
                                                <span className="badge bg-soft-success text-success fs-11">
                                                    {activeCount}
                                                </span>
                                            ) : (
                                                <span className="text-muted fs-11">—</span>
                                            )}
                                        </td>
                                        <td>
                                            {idleCount != null ? (
                                                <span className="badge bg-soft-warning text-warning fs-11">
                                                    {idleCount}
                                                </span>
                                            ) : (
                                                <span className="text-muted fs-11">—</span>
                                            )}
                                        </td>
                                        <td>
                                            {utilPct != null ? (
                                                <span className="badge bg-soft-info text-info fs-11">
                                                    {utilPct}%
                                                </span>
                                            ) : (
                                                <span className="text-muted fs-11">—</span>
                                            )}
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td>
                                            {avgUtil != null ? (
                                                <span className="badge bg-soft-info text-info fs-11">
                                                    {Math.round(avgUtil)}%
                                                </span>
                                            ) : (
                                                <span className="text-muted fs-11">—</span>
                                            )}
                                        </td>
                                        <td>
                                            {avgIdleRatio != null ? (
                                                <span className="badge bg-soft-warning text-warning fs-11">
                                                    {Math.round(avgIdleRatio)}%
                                                </span>
                                            ) : (
                                                <span className="text-muted fs-11">—</span>
                                            )}
                                        </td>
                                    </>
                                )}
                                <td>
                                    {dwell !== '—' ? (
                                        <span className="badge bg-soft-info text-info fs-11">{dwell}</span>
                                    ) : (
                                        <span className="text-muted fs-11">—</span>
                                    )}
                                </td>
                                <td>
                                    {(c.open_alerts ?? 0) > 0 ? (
                                        <span className="badge bg-soft-danger text-danger fs-11">{c.open_alerts}</span>
                                    ) : (
                                        <span className="badge bg-soft-secondary text-secondary fs-11">0</span>
                                    )}
                                </td>
                                <td className="text-end">{statusBadge(zoneStatus)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>

            <style>{`
                .pm-table-wrap { border-radius: 0.5rem; overflow: hidden; }
                .pm-table-wrap .table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
                .pm-table-wrap .table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
                .pm-table-wrap .table td { vertical-align: middle; }
                .wf-zone-compare .table > :not(caption) > * > * { padding: 0.75rem 0.85rem !important; }
                .wf-zone-compare .table thead th {
                    font-size: 10px !important;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    line-height: 1;
                }
                .wf-zone-compare th:first-child,
                .wf-zone-compare td:first-child {
                    padding-left: 15px !important;
                }
                .wf-zone-compare th:last-child,
                .wf-zone-compare td:last-child {
                    padding-right: 15px !important;
                }
                .pm-pill {
                    display: inline-flex;
                    align-items: center;
                    padding: 0.45rem 0.65rem;
                    border-radius: var(--bs-border-radius);
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    line-height: 1;
                }
                .pm-pill-warning {
                    background: rgba(var(--bs-warning-rgb), 1);
                    border: 0;
                    color: #fff;
                }
            `}</style>

            {/* removed per request */}
        </div>
    )
}

// ── Date helpers ──────────────────────────────────────────────────────────────
const buildQS = (from, to) => {
    const params = `?date_from=${encodeURIComponent(toISO(from))}&date_to=${encodeURIComponent(toISO(to))}`
    return { params, from, to }
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function WorkforceDashboard({ projectId, dateFilter }) {
    const queryClient = useQueryClient()

    const isLive = dateFilter?.preset === 'live'

    // Live SSE metrics keyed by camera_id
    const [liveStats, setLiveStats] = useState({})
    const liveRef = useRef(liveStats)
    liveRef.current = liveStats

    // Session peak workers (live mode — tracks max across all cameras)
    const [livePeakWorkers, setLivePeakWorkers] = useState(0)
    useEffect(() => { if (isLive) setLivePeakWorkers(0) }, [isLive])

    // When the user switches TO live mode (false → true), wipe stale cached live data
    // so every live session starts fresh — same behaviour as PPE dashboard.
    // wasLiveRef is initialised to the current isLive value so this does NOT fire on
    // page refresh (where the page mounts already in live mode).
    const wasLiveRef = useRef(isLive)
    useEffect(() => {
        if (isLive && !wasLiveRef.current) {
            ;['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'alerts'].forEach(k =>
                queryClient.removeQueries({ queryKey: ['workforce', k, projectId] })
            )
            setTrendPoints([])
            setLiveStats({})
            setLivePeakWorkers(0)
        }
        wasLiveRef.current = isLive
    }, [isLive, projectId, queryClient])

    // Trend state
    const [trendPoints, setTrendPoints] = useState([])
    const [trendLoad,   setTrendLoad]   = useState(true)

    // ── Feature-toggle gate ────────────────────────────────────────────────
    const liveStatusPolling = isLive
    const { data: wfStatus = null } = useQuery({
        queryKey: QK.wfStatus(projectId),
        queryFn: () => apiGet(`/projects/${projectId}/cameras/features`).catch(() => null),
        staleTime: Infinity,
        refetchOnMount: liveStatusPolling ? 'always' : true,
        refetchOnWindowFocus: liveStatusPolling ? 'always' : false,
        refetchInterval: liveStatusPolling ? 8000 : false,
        refetchIntervalInBackground: liveStatusPolling,
        enabled: !!projectId,
    })

    const featureActive = useMemo(() => {
        if (!wfStatus?.cameras) return null
        return wfStatus.cameras.some(c => c?.features?.workforce_enabled === true)
    }, [wfStatus])

    const wfServerLiveStart = useMemo(() => {
        return wfStatus?.workforce_live_session_start ?? wfStatus?.live_session_start ?? null
    }, [wfStatus])

    const liveFrom = useMemo(() => {
        if (!isLive) return null
        if (!wfServerLiveStart) return null
        const d = new Date(wfServerLiveStart)
        if (isNaN(d.getTime())) return null
        return d
    }, [isLive, wfServerLiveStart])

    const qs = useMemo(() => {
        if (isLive && liveFrom) return buildQS(liveFrom, new Date())
        return buildQS(dateFilter?.from, dateFilter?.to)
    }, [isLive, liveFrom, dateFilter?.from, dateFilter?.to])

    const prevAnyActiveRef = useRef(null)
    useEffect(() => {
        if (!isLive) return
        if (!wfStatus?.cameras) return

        const anyActive = wfStatus.cameras.some(c => c?.features?.workforce_enabled === true)
        const prevAnyActive = prevAnyActiveRef.current
        prevAnyActiveRef.current = anyActive

        if (prevAnyActive == null || prevAnyActive === anyActive) return

        const WF_DATA_KEYS = ['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'heatmap', 'alerts']

        if (anyActive === false) {
            WF_DATA_KEYS.forEach(k => {
                queryClient.setQueriesData({ queryKey: ['workforce', k] }, null)
                queryClient.removeQueries({ queryKey: ['workforce', k, projectId] })
            })

            setLiveStats({})
            setTrendPoints([])
            setTrendLoad(false)
            setLivePeakWorkers(0)
            return
        }

        WF_DATA_KEYS.forEach(k => {
            queryClient.setQueriesData({ queryKey: ['workforce', k] }, undefined)
            queryClient.removeQueries({ queryKey: ['workforce', k, projectId] })
        })

        setLiveStats({})
        setTrendPoints([])
        setTrendLoad(true)
        setLivePeakWorkers(0)

        queryClient.invalidateQueries({ queryKey: ['workforce'] })
    }, [isLive, wfStatus, projectId, queryClient])

    // In live mode always compute fresh params at queryFn execution time (same fix as PPE).
    const getLiveParams = useCallback((endpoint) => {
        if (isLive) {
            if (!liveFrom) return `/projects/${projectId}/workforce/${endpoint}${qs.params}`
            const from = liveFrom
            const p = `?date_from=${encodeURIComponent(toISO(from))}&date_to=${encodeURIComponent(toISO(new Date()))}`
            return `/projects/${projectId}/workforce/${endpoint}${p}`
        }
        return `/projects/${projectId}/workforce/${endpoint}${qs.params}`
    }, [isLive, projectId, qs.params, liveFrom])

    const dataEnabled = !isLive || (featureActive === true && !!liveFrom)


    // ── React Query hooks — all project-level, no camera_id filter ─────────
    const { data: summary = null, isLoading: sumLoad } = useQuery({
        queryKey: QK.wfSummary(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('summary')).catch(() => null),
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId && dataEnabled,
    })

    const { data: camerasData = [], isLoading: camLoad } = useQuery({
        queryKey: QK.wfCameras(projectId, isLive ? null : qs.from, isLive ? null : qs.to),
        queryFn: () => {
            if (isLive) return apiGet(`/projects/${projectId}/workforce/cameras`).catch(() => [])
            return apiGet(`/projects/${projectId}/workforce/cameras${qs.params}`).catch(() => [])
        },
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId,
    })

    const { data: settingsData = null } = useQuery({
        queryKey: QK.wfSettings(projectId),
        queryFn: async () => {
            const rows = await apiGet(`/projects/${projectId}/workforce/settings`).catch(() => null)
            if (!rows) return null
            return Array.isArray(rows) ? (rows.find(r => r.camera_id === null) || rows[0] || null) : rows
        },
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId,
    })

    // perCameraData — all cameras, no camera_id filter — drives Scatter, Radar, avgOccupancy
    const { data: perCameraData = [], isLoading: heatLoad } = useQuery({
        queryKey: QK.wfScatter(projectId, null, qs.from, qs.to),
        queryFn: () => {
            const url = getLiveParams('trend')
            const sep = url.includes('?') ? '&' : '?'
            return apiGet(`${url}${sep}granularity=hourly&per_camera=true`).catch(() => [])
        },
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId && dataEnabled && !isLive,
    })

    const summaryRef = useRef(summary)
    useEffect(() => { summaryRef.current = summary }, [summary])

    // When live_session_start becomes available (feature enabled), force a refetch so every card
    // uses the correct live window without needing a manual refresh.
    useEffect(() => {
        if (!isLive) return
        if (!wfServerLiveStart) return
        queryClient.invalidateQueries({ queryKey: ['workforce'] })
    }, [isLive, wfServerLiveStart, queryClient])

    // ── Trend — React Query for historical modes; local SSE accumulation for live ──
    const spanDays = qs.from && qs.to ? (new Date(qs.to) - new Date(qs.from)) / (1000 * 60 * 60 * 24) : 1
    const isMultiDay = spanDays > 1.5

    const { data: trendQueryData, isLoading: trendQueryLoad } = useQuery({
        queryKey: QK.wfTrend(projectId, qs.from, qs.to),
        queryFn: () =>
            apiGet(`/projects/${projectId}/workforce/trend?date_from=${toISO(qs.from)}&date_to=${toISO(qs.to)}`)
                .then(rows => rows.map(r => ({
                    ts: r.recorded_at || null,
                    workers:    r.avg_workers    ?? 0,
                    util:       r.avg_utilization ?? 0,
                    idle_ratio: r.idle_ratio      ?? 0,
                })))
                .catch(() => []),
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId && dataEnabled && !isLive,
    })

    // Live trend (polling) — keep charts consistent across tabs even if SSE is throttled.
    const { data: liveTrendSeed, isLoading: liveTrendLoading } = useQuery({
        queryKey: QK.wfTrendLive(projectId),
        queryFn: () => {
            if (!liveFrom) return []
            const now  = new Date()
            const from = liveFrom
            return apiGet(`/projects/${projectId}/workforce/trend?date_from=${toISO(from)}&date_to=${toISO(now)}`)
                .then(rows => rows.map(r => ({
                    ts:         r.recorded_at || null,
                    workers:    r.avg_workers    ?? 0,
                    util:       r.avg_utilization ?? 0,
                    idle_ratio: r.idle_ratio      ?? 0,
                })))
                .catch(() => [])
        },
        staleTime: 0,
        refetchOnWindowFocus: 'always',
        refetchInterval: 10_000,
        refetchIntervalInBackground: true,
        enabled: !!projectId && isLive && dataEnabled,
    })

    useEffect(() => {
        if (!isLive || !dataEnabled) return
        if (liveTrendLoading) { setTrendLoad(true); return }
        if (liveTrendSeed !== undefined) {
            setTrendPoints(liveTrendSeed ?? [])
            setTrendLoad(false)
        }
    }, [isLive, dataEnabled, liveTrendSeed, liveTrendLoading])

    // When switching to a historical filter, populate trendPoints from React Query data.
    useEffect(() => {
        if (!isLive && trendQueryData) {
            setTrendPoints(trendQueryData)
            setTrendLoad(false)
        }
    }, [isLive, trendQueryData])

    // When feature is off or filter changes to non-live, clear local live accumulation.
    useEffect(() => {
        if (!dataEnabled) { setTrendPoints([]); setTrendLoad(false) }
    }, [dataEnabled])

    // Bug 12: on page refresh in live mode with feature OFF, wfStatus loads after queries fire.
    // Disable gate alone won't clear already-fetched data — explicitly wipe caches once settled.
    useEffect(() => {
        if (featureActive === null) return
        if (isLive && featureActive === false) {
            ;['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'heatmap', 'alerts'].forEach(k =>
                queryClient.removeQueries({ queryKey: ['workforce', k, projectId] })
            )
            setLiveStats({})
            setTrendPoints([])
        }
    }, [featureActive, isLive, projectId, queryClient])

    useEffect(() => {
        const h = () => queryClient.invalidateQueries({ queryKey: QK.wfSettings(projectId) })
        window.addEventListener('wf:settings-updated', h)
        return () => window.removeEventListener('wf:settings-updated', h)
    }, [projectId, queryClient])

    // Must be defined before useWorkforceStream so onStatsUpdate can close over it.
    const enabledCameraIds = useMemo(() => new Set(
        (wfStatus?.cameras ?? [])
            .filter(c => c?.features?.workforce_enabled === true)
            .map(c => c.camera_id)
    ), [wfStatus])

    // ── SSE handler ────────────────────────────────────────────────────────
    useWorkforceStream(projectId, queryClient, {
        onConnect: useCallback(() => {}, []),

        onDisconnect: useCallback(() => {}, []),

        onStatsUpdate: useCallback((data) => {
            const cam_id = data.camera_id
            setLiveStats(prev => {
                const next = { ...prev, [cam_id]: data }
                // Use all cameras the backend sent stats for — the backend only pushes
                // workforce_stats_update for enabled cameras, so no client-side filter is needed.
                // Filtering by enabledCameraIds caused a race: the Set is empty until wfStatus
                // loads, so early SSE ticks were silently dropped and the trend never started.
                const activeStats = Object.values(next)
                if (isLive && activeStats.length > 0) {
                    const siteTotal = activeStats.reduce((s, v) => s + (v.current_worker_count || 0), 0)
                    setLivePeakWorkers(peak => Math.max(peak, siteTotal))
                }
                return next
            })
        }, [isLive]),

        onAlert: useCallback(() => {
            queryClient.invalidateQueries({ queryKey: ['workforce', 'trend',    projectId] })
            queryClient.invalidateQueries({ queryKey: ['workforce', 'scatter',  projectId] })
            queryClient.invalidateQueries({ queryKey: ['workforce', 'cameras',  projectId] })
        }, [queryClient, projectId]),
        onAlertUpdated: useCallback(() => {
            queryClient.invalidateQueries({ queryKey: ['workforce', 'summary',  projectId] })
            queryClient.invalidateQueries({ queryKey: ['workforce', 'cameras',  projectId] })
        }, [queryClient, projectId]),

        onFeatureChanged: useCallback(({ anyActive }) => {
            if (anyActive === false) {
                setLiveStats({})
                setTrendPoints([])
            }
        }, []),
    })

    useEffect(() => {
        return onBroadcast('wf:feature-changed', ({ anyActive, live_session_start } = {}) => {
            if (anyActive === false) {
                setLiveStats({})
                setTrendPoints([])
                setTrendLoad(false)
                setLivePeakWorkers(0)
                ;['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'heatmap', 'alerts'].forEach(k =>
                    queryClient.removeQueries({ queryKey: ['workforce', k, projectId] })
                )
            } else {
                queryClient.invalidateQueries({ queryKey: ['workforce'] })
            }
        })
    }, [projectId, queryClient])

    useEffect(() => {
        return onBroadcast('wf:alert-updated', ({ projectId: pid, ...data } = {}) => {
            if (String(pid) !== String(projectId)) return
            patchAlertInCache(queryClient, projectId, data)
            queryClient.invalidateQueries({ queryKey: ['workforce', 'summary', projectId] })
            queryClient.invalidateQueries({ queryKey: ['workforce', 'cameras', projectId] })
        })
    }, [projectId, queryClient])

    useEffect(() => {
        return onBroadcast('wf:new-alert', ({ projectId: pid } = {}) => {
            if (String(pid) === String(projectId)) {
                queryClient.invalidateQueries({ queryKey: ['workforce', 'summary', projectId] })
                queryClient.invalidateQueries({ queryKey: ['workforce', 'alerts',  projectId] })
                queryClient.invalidateQueries({ queryKey: ['workforce', 'cameras', projectId] })
            }
        })
    }, [projectId, queryClient])

    // ── Derived data — all project-level ──────────────────────────────────
    const hasLiveSSE = Object.keys(liveStats).length > 0
    const liveEmptyState = isLive && featureActive === false
    const uiSummary = liveEmptyState ? null : summary
    const uiSumLoad = liveEmptyState ? false : sumLoad

    // Snapshot stats from camerasData (for SSE merge)
    const snapshotStats = useMemo(() => {
        const snap = {}
        camerasData.forEach(c => {
            snap[c.camera_id] = {
                camera_id:            c.camera_id,
                zone_name:            c.zone_name,
                current_worker_count: c.latest_worker_count ?? 0,
                active_count:         c.active_count ?? 0,
                idle_count:           c.idle_count ?? 0,
                utilization_score:    c.latest_utilization ?? 0,
                zone_status:          c.latest_zone_status ?? 'BALANCED',
                congestion_flag:      c.congestion_flag ?? false,
                avg_dwell_seconds:    c.avg_dwell_seconds ?? 0,
                open_alerts:          c.open_alerts ?? 0,
                sparkline:            c.sparkline ?? [],
                last_snapshot_at:     c.last_snapshot_at ?? null,
            }
        })
        return snap
    }, [camerasData])

    const resolveStats = camId => {
        const live = liveStats[camId]
        if (live) {
            const snap = snapshotStats[camId]
            return snap
                ? { ...snap, ...live, open_alerts: snap.open_alerts }
                : live
        }
        if (!isLive) return snapshotStats[camId] || null

        const snap = snapshotStats[camId]
        if (!snap) return null
        const ts = snap.last_snapshot_at ? new Date(snap.last_snapshot_at) : null
        if (!ts || isNaN(ts.getTime())) return null
        if (!liveFrom) return null
        if (ts < liveFrom) return null
        return snap
    }

    // All resolved — only workforce-enabled cameras.
    // camerasData includes ALL project cameras; without filtering, disabled cameras
    // contribute stale snapshot counts to aggWorkers and cause overcounting.
    const allResolved = isLive && featureActive !== false
        ? camerasData
            .filter(c => enabledCameraIds.has(c.camera_id))
            .map(c => resolveStats(c.camera_id))
            .filter(Boolean)
        : []

    const hasData = isLive
        ? (!liveEmptyState && featureActive === true && allResolved.length > 0)
        : (!!uiSummary && ((uiSummary.total_workers_today ?? 0) > 0 || (uiSummary.peak_worker_count ?? 0) > 0 || (uiSummary.avg_utilization ?? 0) > 0))

    const effEmptyState = !uiSumLoad && !hasData

    const zonePerfEmptyState = isLive
        ? allResolved.length === 0
        : perCameraData.length === 0

    const zoneUtilEmptyState = (() => {
        if (isLive) {
            if (allResolved.length === 0) return true
            return allResolved.every(row => ((row?.avg_dwell_seconds ?? 0) === 0 && (row?.utilization_score ?? 0) === 0))
        }
        if (perCameraData.length === 0) return true
        return perCameraData.every(row => ((row?.avg_dwell ?? 0) === 0 && (row?.avg_utilization ?? 0) === 0))
    })()

    const resolutionEmptyState = !uiSumLoad && ((uiSummary?.open_alerts ?? 0) + (uiSummary?.acknowledged_alerts ?? 0) + (uiSummary?.resolved_alerts ?? 0) === 0)
    const trendHasMeaningfulData = trendPoints.some(p =>
        (p?.workers ?? 0) > 0 ||
        (p?.util ?? 0) > 0 ||
        (p?.idle_ratio ?? 0) > 0
    )
    const trendEmptyState = !trendHasMeaningfulData

    // Project-level aggregated KPI values (live)
    const aggWorkers = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.current_worker_count || 0), 0)
        : null

    const aggActive = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.active_count || 0), 0)
        : null

    const aggIdle = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.idle_count || 0), 0)
        : null

    const aggUtil = allResolved.length > 0
        ? Math.round(allResolved.reduce((s, v) => s + (v.utilization_score || 0), 0) / allResolved.length)
        : null

    // Idle ratio: idle / total workers across all zones
    const aggIdleRatio = allResolved.length > 0 && (aggWorkers ?? 0) > 0
        ? Math.round((aggIdle ?? 0) / aggWorkers * 100)
        : null

    // Avg dwell across all zones (live)
    const aggDwell = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.avg_dwell_seconds || 0), 0) / allResolved.length
        : null

    // Congestion count — zones currently congested (live)
    const aggCongestion = isLive
        ? allResolved.filter(v => v.congestion_flag).length
        : (summary?.congestion_events ?? null)

    // Required workers (project-level settings)
    const requiredW = settingsData?.required_workers ?? null

    // Average occupancy from trend data (for filter Staffing Gap + Efficiency Score)
    const avgOccupancy = useMemo(() => {
        const rows = perCameraData.filter(r => r.avg_workers != null)
        if (!rows.length) return summary?.total_workers_today ?? 0
        return Math.round(rows.reduce((s, r) => s + r.avg_workers, 0) / rows.length)
    }, [perCameraData, summary])

    // Staffing gap
    const staffingGap = requiredW != null
        ? isLive
            ? Math.max(0, requiredW - (aggWorkers ?? uiSummary?.total_workers_today ?? 0))
            : Math.max(0, requiredW - avgOccupancy)
        : null

    // camList for zone comparison table
    // Live: merge SSE real-time values (workers, active, idle, util, status, dwell)
    // Filter: aggregate perCameraData rows per camera (period-scoped)
    //         zones with no snapshots in the period get _noData=true → show "—"
    const camList = useMemo(() => {
        if (isLive) {
            if (featureActive === false) return []
            return camerasData
                .filter(c => enabledCameraIds.has(c.camera_id))
                .map(c => {
                    const r = resolveStats(c.camera_id)
                    if (!r) {
                        return {
                            ...c,
                            _noData:             false,
                            latest_worker_count: null,
                            active_count:        null,
                            idle_count:          null,
                            latest_utilization:  null,
                            latest_zone_status:  null,
                            avg_dwell_seconds:   null,
                            open_alerts:         null,
                        }
                    }
                    return {
                        ...c,
                        _noData:             false,
                        latest_worker_count: r.current_worker_count,
                        active_count:        r.active_count,
                        idle_count:          r.idle_count,
                        latest_utilization:  r.utilization_score,
                        latest_zone_status:  r.zone_status,
                        avg_dwell_seconds:   r.avg_dwell_seconds,
                    }
                })
        }
        // Filter: group perCameraData by camera_id and aggregate
        const byCamera = {}
        perCameraData.forEach(row => {
            if (!byCamera[row.camera_id]) byCamera[row.camera_id] = []
            byCamera[row.camera_id].push(row)
        })
        const STATUS_PRIORITY = { OVERLOADED: 3, OVERLOAD: 3, UNDERSTAFFED: 2, BALANCED: 1 }
        return camerasData.map(c => {
            const rows = byCamera[c.camera_id] || []
            if (rows.length === 0) return { ...c, _noData: true }
            const avgWorkers   = rows.reduce((s, r) => s + (r.avg_workers    ?? 0), 0) / rows.length
            const avgUtil      = rows.reduce((s, r) => s + (r.avg_utilization ?? 0), 0) / rows.length
            const avgDwell     = rows.reduce((s, r) => s + (r.avg_dwell      ?? 0), 0) / rows.length
            const avgIdleRatio = rows.reduce((s, r) => s + (r.avg_idle_ratio  ?? 0), 0) / rows.length
            const worstStatus = rows.reduce((worst, r) => {
                const p = STATUS_PRIORITY[(r.zone_status || '').toUpperCase()] ?? 0
                return p > (STATUS_PRIORITY[(worst || '').toUpperCase()] ?? 0) ? r.zone_status : worst
            }, 'BALANCED')
            return {
                ...c,
                _noData:             false,
                _avgWorkers:         Math.round(avgWorkers),
                _avgUtil:            avgUtil,
                _avgIdleRatio:       avgIdleRatio,
                latest_zone_status:  worstStatus,
                avg_dwell_seconds:   avgDwell,
            }
        })
    }, [isLive, featureActive, enabledCameraIds, camerasData, perCameraData]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Row 1: KPI cards ──────────────────────────────────────────────────
    const statisticsData = [
        {
            icon:   'feather-users',
            number: isLive
                ? (aggWorkers != null
                    ? fmt(aggWorkers)
                    : (uiSummary?.total_workers_today != null ? fmt(uiSummary.total_workers_today) : (hasLiveSSE ? '0' : '—')))
                : (uiSumLoad ? '—' : uiSummary?.total_workers_today != null ? fmt(uiSummary.total_workers_today) : '—'),
            title: 'Workers On-Site',
            color: 'primary',
        },
        {
            icon:   'feather-activity',
            number: isLive
                ? (aggUtil != null
                    ? `${aggUtil}%`
                    : (uiSummary?.avg_utilization != null ? `${Math.round(uiSummary.avg_utilization)}%` : '—'))
                : (uiSumLoad ? '—' : uiSummary?.avg_utilization != null ? `${Math.round(uiSummary.avg_utilization)}%` : '—'),
            title: 'Avg Utilization',
            color: 'success',
        },
        {
            icon:   'feather-clock',
            number: isLive
                ? (aggIdleRatio != null
                    ? `${aggIdleRatio}%`
                    : (uiSummary?.avg_idle_ratio != null ? `${Math.round(uiSummary.avg_idle_ratio)}%` : '—'))
                : (uiSumLoad ? '—' : uiSummary?.avg_idle_ratio != null ? `${Math.round(uiSummary.avg_idle_ratio)}%` : '—'),
            title: 'Idle Rate',
            color: 'warning',
        },
        {
            icon:   'feather-bell',
            number: uiSumLoad ? '—' : fmt(uiSummary?.open_alerts_total),
            title:  'Active Insights',
            color:  'info',
        },
    ]

    // ── Card title action hooks ────────────────────────────────────────────
    const effActions      = useCardTitleActions()
    const zonePerfActions = useCardTitleActions()
    const zoneEffActions  = useCardTitleActions()
    const coverageActions = useCardTitleActions()
    const trendActions    = useCardTitleActions()

    const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ['workforce'] })

    const trendDateFrom = isLive ? (liveFrom ?? qs.from) : qs.from
    const trendDateTo   = isLive ? new Date() : qs.to

    return (
        <div className="row g-3">
            <style>{`
                .wf-trend-chart .recharts-cartesian-grid line { stroke: rgba(15,23,42,.10) !important; stroke-opacity: 0.65 !important; stroke-width: 1 !important; stroke-dasharray: 3 3 !important; }
                html.app-skin-dark .wf-trend-chart .recharts-cartesian-axis-tick-value { fill: rgba(255,255,255,.72) !important; }
                html.app-skin-dark .wf-trend-chart .recharts-cartesian-grid line { stroke: rgba(255,255,255,.10) !important; stroke-opacity: 0.85 !important; stroke-width: 1 !important; stroke-dasharray: 3 3 !important; }
                html.app-skin-dark .wf-trend-chart .recharts-cartesian-axis-line { stroke: rgba(255,255,255,.14) !important; }
                html.app-skin-dark .wf-trend-chart .recharts-default-tooltip { background: rgba(10,18,32,.96) !important; border-color: rgba(255,255,255,.12) !important; color: rgba(255,255,255,.92) !important; }
                html.app-skin-dark .wf-trend-chart .recharts-default-tooltip * { color: rgba(255,255,255,.86) !important; }
            `}</style>

            {/* ── Row 1: KPI Cards ─────────────────────────────────────── */}
            {statisticsData.map(({ icon, number, title, color }, index) => (
                <div key={index} className="col-xxl-3 col-md-6">
                    <div className={`card bg-${color} border-${color} text-white overflow-hidden`}>
                        <div className="card-body">
                            <i className="fs-20">{getIcon(icon)}</i>
                            <h5 className="fs-4 text-reset mt-4 mb-1">{number}</h5>
                            <div className="fs-12 text-reset fw-normal">{title}</div>
                        </div>
                    </div>
                </div>
            ))}

            {/* ── Row 2: Secondary Metric Cards ────────────────────────── */}
            {[
                {
                    icon:  'feather-users',
                    title: 'Peak Workers',
                    count: isLive
                        ? (livePeakWorkers > 0
                            ? fmt(livePeakWorkers)
                            : (uiSummary?.peak_worker_count != null
                                ? fmt(uiSummary.peak_worker_count)
                                : (aggWorkers != null ? fmt(aggWorkers) : '—')))
                        : (uiSumLoad ? '—' : fmt(uiSummary?.peak_worker_count)),
                    color: 'primary',
                },
                {
                    icon:  'feather-clock',
                    title: 'Avg Dwell Time',
                    count: isLive
                        ? (aggDwell != null ? fmtDwell(aggDwell) : (uiSummary?.avg_dwell_seconds != null ? fmtDwell(uiSummary.avg_dwell_seconds) : '—'))
                        : fmtDwell(uiSummary?.avg_dwell_seconds),
                    color: 'info',
                },
                {
                    icon:  'feather-alert-triangle',
                    title: 'Congestion Events',
                    count: aggCongestion != null ? String(aggCongestion) : '—',
                    color: 'danger',
                },
                {
                    icon:  'feather-crosshair',
                    title: 'Staffing Gap',
                    count: staffingGap == null ? '—' : String(staffingGap),
                    color: 'warning',
                },
            ].map(({ color, count, icon, title }, index) => (
                <div key={index} className="col-xxl-3 col-md-6 customer-header-card">
                    <div className="card stretch stretch-full">
                        <div className="card-body">
                            <div className="d-flex align-items-center justify-content-between">
                                <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                                    <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                        {getIcon(icon) ? cloneElement(getIcon(icon), { size: 17 }) : null}
                                    </div>
                                    <a href="#" className="fw-bold d-block text-reset text-decoration-none" style={{ minWidth: 0 }} onClick={e => e.preventDefault()}>
                                        <span className="text-truncate-1-line">{title}</span>
                                        <span className="fs-24 fw-bolder d-block text-truncate-1-line">{count}</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}

            {/* ── Row 3: Efficiency Score + Zone Radar ─────────────────── */}
            <div className="col-xl-8 col-md-12">
                <div className={`card stretch stretch-full ${effEmptyState ? '' : 'h-100'} ${effActions.isExpanded ? 'card-expand' : ''} ${effActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader title="Workforce Efficiency" refresh={() => { effActions.handleRefresh(); invalidateAll() }} expanded={effActions.handleExpand} />
                    <div className="card-body d-flex flex-column align-items-center justify-content-center" style={{ paddingTop: 20, paddingBottom: 20 }}>
                        <WorkforceEfficiencyScore
                            currentWorkers={isLive
                                ? (aggWorkers ?? 0)
                                : avgOccupancy}
                            activeWorkers={isLive
                                ? (aggActive ?? 0)
                                : (() => {
                                    const util = uiSummary?.avg_utilization != null ? Math.round(uiSummary.avg_utilization) : 0
                                    return Math.round(avgOccupancy * (util / 100))
                                })()}
                            totalWorkers={isLive
                                ? (aggWorkers ?? 0)
                                : avgOccupancy}
                            requiredWorkers={requiredW ?? 1}
                            understaffedAlertsToday={uiSummary?.understaffed_alerts_today ?? 0}
                            idleAlertsToday={uiSummary?.idle_alerts_today ?? 0}
                            congestionEvents={aggCongestion ?? 0}
                            hasData={hasData}
                            loading={!isLive && uiSumLoad}
                        />
                    </div>
                    <CardLoader refreshKey={effActions.refreshKey} />
                </div>
            </div>

            <div className="col-xl-4 col-md-6">
                <div className={`card stretch stretch-full ${zonePerfEmptyState ? '' : 'h-100'} ${zonePerfActions.isExpanded ? 'card-expand' : ''} ${zonePerfActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader title="Zone Performance" refresh={() => { zonePerfActions.handleRefresh(); invalidateAll() }} expanded={zonePerfActions.handleExpand} />
                    <div
                        className="card-body custom-card-action d-flex flex-column justify-content-center"
                        style={zonePerfEmptyState
                            ? { paddingTop: 20, paddingBottom: 20, paddingLeft: 0, paddingRight: 0 }
                            : { paddingTop: 40, paddingBottom: 20, paddingLeft: 0, paddingRight: 0 }}
                    >
                        <ZoneRadarChart
                            allResolved={allResolved}
                            settingsData={settingsData}
                            loading={camLoad && !hasLiveSSE}
                            isLive={isLive}
                            perCameraData={perCameraData}
                            height={380}
                        />
                    </div>
                    <CardLoader refreshKey={zonePerfActions.refreshKey} />
                </div>
            </div>

            {/* ── Row 5: Scatter + Resolution Funnel ───────────────────── */}
            <div className="col-xl-8 col-md-12">
                <div className={`card stretch stretch-full ${zoneUtilEmptyState ? '' : 'h-100'} ${zoneEffActions.isExpanded ? 'card-expand' : ''} ${zoneEffActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader title="Zone Utilization" refresh={() => { zoneEffActions.handleRefresh(); invalidateAll() }} expanded={zoneEffActions.handleExpand} />
                    <div className="card-body p-0 custom-card-action d-flex flex-column justify-content-center">
                        <DwellUtilScatter perCameraData={perCameraData} loading={isLive ? (camLoad && !hasLiveSSE) : heatLoad} isLive={isLive} allResolved={allResolved} />
                    </div>
                    <CardLoader refreshKey={zoneEffActions.refreshKey} />
                </div>
            </div>

            <div className="col-xl-4 col-md-12">
                <div className={`card stretch stretch-full ${resolutionEmptyState ? '' : 'h-100'} ${coverageActions.isExpanded ? 'card-expand' : ''} ${coverageActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader title="Insight Resolution Status" refresh={() => { coverageActions.handleRefresh(); invalidateAll() }} expanded={coverageActions.handleExpand} />
                    <WorkforceResolutionFunnel summary={uiSummary} loading={uiSumLoad} />
                    <CardLoader refreshKey={coverageActions.refreshKey} />
                </div>
            </div>

            {/* ── Row 6: Activity Trend ─────────────────────────────────── */}
            <div className="col-12">
                <div className={`card stretch stretch-full ${trendActions.isExpanded ? 'card-expand' : ''} ${trendActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader
                        title="Activity Trend"
                        refresh={() => {
                            trendActions.handleRefresh()
                            if (isLive) {
                                queryClient.invalidateQueries({ queryKey: QK.wfTrendLive(projectId) })
                            } else {
                                queryClient.invalidateQueries({ queryKey: ['workforce', 'trend', projectId] })
                            }
                        }}
                        expanded={trendActions.handleExpand}
                    />
                    <div
                        className={trendEmptyState
                            ? "card-body p-0 custom-card-action d-flex flex-column justify-content-center"
                            : "card-body custom-card-action"}
                        style={trendEmptyState
                            ? undefined
                            : { paddingTop: 35, paddingBottom: 2, paddingLeft: 42, paddingRight: 0 }}
                    >
                        <ActivityTrendChart
                            trendPoints={trendHasMeaningfulData ? trendPoints : []}
                            loading={trendLoad}
                            isLive={isLive}
                            dateFrom={trendDateFrom}
                            dateTo={trendDateTo}
                        />
                    </div>
                    <CardLoader refreshKey={trendActions.refreshKey} />
                </div>
            </div>

            {/* ── Row 7: Zone Status Overview ──────────────────────────── */}
            <div className="col-12">
                <div className="card stretch stretch-full">
                    <div className="card-header">
                        <div>
                            <h5 className="mb-0">Zone Performance Overview</h5>
                            <span className="fs-12 text-muted">Aggregated workforce performance metrics by zone</span>
                        </div>
                    </div>
                    <ZoneComparisonTable camList={camList} isLive={isLive} loading={isLive ? camLoad : (camLoad || heatLoad)} />
                </div>
            </div>

            {/* ── Row 8: Alerts Table ───────────────────────────────────── */}
            <div className="col-12">
                <WorkforceAlertsTable
                    projectId={projectId}
                    dateFrom={toISO(isLive ? (liveFrom ?? qs.from) : qs.from) || null}
                    dateTo={isLive ? null : (toISO(qs.to) || null)}
                    liveMode={isLive}
                    disabled={isLive && featureActive === false}
                    cameras={camerasData}
                />
            </div>
        </div>
    )
}
