/**
 * EquipmentDashboard.jsx
 *
 * Enterprise equipment analytics dashboard — project-level view, workforce-parity design.
 * Everything is aggregated across ALL cameras. No per-zone filtering of cards or charts.
 *
 * Rows:
 *   1 — Four KPI cards (Equipment On-Site / Avg Utilization / Idle Ratio / Open Alerts)
 *   2 — Four secondary cards (Peak Equipment / Avg Active Duration / Misuse Events / Underutilized)
 *   3 — Equipment Efficiency Score (treemap) | Zone Radar (all-zones aggregate)
 *   4 — Zone Utilization Scatter | Insight Resolution Funnel
 *   5 — Activity Trend chart
 *   6 — Zone Status Overview table (per-zone, filter-scoped)
 *   7 — Equipment Alerts Table
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
import EquipmentAlertsTable from './EquipmentAlertsTable'
import useEquipmentStream from '@/hooks/useEquipmentStream'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'
import { patchAlertInCache } from '@/utils/equipmentCacheUtils'

// ── helpers ───────────────────────────────────────────────────────────────────
const fmt      = n => (n == null ? '—' : n)
const fmtDuration = secs => {
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

const EQ_EMPTY_CARD_H = 220
const EQ_EMPTY_TREND_H = 240
const EQ_EMPTY_TABLE_H = 200

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

// ── Equipment Efficiency Score (D3 Treemap) ───────────────────────────────────
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
                .eq-eff-treemap .eq-eff-rect { transition: filter .3s, opacity .3s; opacity: 1; filter: saturate(100%); }
                .eq-eff-treemap:hover .eq-eff-rect { opacity: .42; filter: saturate(60%); }
                .eq-eff-treemap .eq-eff-rect:hover { opacity: 1; filter: saturate(100%); }
                .eq-eff-tip { position: absolute; z-index: 6; pointer-events: none; width: ${tooltipWidth}px;
                    padding: 8px 10px; background: var(--bs-body-bg); border: 1px solid var(--bs-border-color);
                    color: var(--bs-body-color); border-radius: 6px; box-shadow: 0 10px 30px rgba(2,6,23,.18); }
                .eq-eff-tip-title { font-size: 12px; font-weight: 500; color: var(--bs-body-color); }
                .eq-eff-tip-sub   { margin-top: 2px; font-size: 11px; color: var(--bs-secondary-color); }
                html.app-skin-dark .eq-eff-tip { background: rgba(10,18,32,.96); border-color: rgba(255,255,255,.12); color: rgba(255,255,255,.92); box-shadow: 0 12px 40px rgba(0,0,0,.55); }
                html.app-skin-dark .eq-eff-tip-title { color: rgba(255,255,255,.92); }
                html.app-skin-dark .eq-eff-tip-sub   { color: rgba(255,255,255,.72); }
            `}</style>
            {tip && tipPos && (
                <div className="eq-eff-tip" style={{ left: tipPos.x, top: tipPos.y }}>
                    <div className="eq-eff-tip-title">{tip.name}</div>
                    <div className="eq-eff-tip-sub">{tip.pct}% · weight {tip.weight}</div>
                </div>
            )}
            <svg
                width="100%" height={height}
                className="eq-eff-treemap"
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
                            className="eq-eff-rect"
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

function EquipmentEfficiencyScore({ activeEquipment, totalEquipment, expectedEquipment, misflagCount, crossZoneConflicts, hasData, loading }) {
    const isDark = useDark()
    if (loading) return (
        <PageLoader minHeight={180} />
    )
    if (!hasData) return (
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )
    const exp          = expectedEquipment || 1
    const staffingComp = Math.min(100, Math.round((activeEquipment / exp) * 100))
    const activeRate   = totalEquipment > 0 ? Math.round((activeEquipment / totalEquipment) * 100) : 0
    const alertFree    = Math.max(0, 100 - Math.min(100, (misflagCount || 0) * 5))
    const congFree     = crossZoneConflicts === 0 ? 100 : Math.max(0, 100 - crossZoneConflicts * 25)
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
function EquipmentZoneRadarChart({ allResolved, settingsData, loading, isLive, perCameraData, height = 320 }) {
    const isDark = useDark()

    const exp = settingsData?.expected_equipment_count || 1

    let util, staffing, usageScore

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
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
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
                const avgUtil   = rows.reduce((s, r) => s + (r.utilization_score ?? 0), 0) / rows.length
                const avgActive = rows.reduce((s, r) => s + (r.active_count ?? 0), 0) / rows.length
                const avgDur    = rows.reduce((s, r) => s + (r.avg_active_duration ?? 0), 0) / rows.length
                return {
                    key: z.key,
                    avgActive,
                    util:       Math.round(avgUtil),
                    activeRatio: Math.min(100, Math.round((avgActive / exp) * 100)),
                    usageScore:  Math.min(100, Math.round((avgDur / 28800) * 100)),
                }
            })
            .sort((a, b) => (b.avgActive ?? 0) - (a.avgActive ?? 0))

        const MAX = 8
        const top = ranked.slice(0, MAX)
        const rest = ranked.slice(MAX)
        const list = rest.length === 0 ? top : (() => {
            const avgUtil  = rest.reduce((s, r) => s + (r.util ?? 0), 0) / rest.length
            const avgA     = rest.reduce((s, r) => s + (r.avgActive ?? 0), 0) / rest.length
            const avgAR    = rest.reduce((s, r) => s + (r.activeRatio ?? 0), 0) / rest.length
            const avgUS    = rest.reduce((s, r) => s + (r.usageScore ?? 0), 0) / rest.length
            return [
                ...top,
                { key: 'Other Zones', avgActive: avgA, util: Math.round(avgUtil), activeRatio: Math.round(avgAR), usageScore: Math.round(avgUS) },
            ]
        })()

        const liveSeries = list.map((z, i) => ({
            id: `zone-${z.key}`,
            label: formatZoneLabel(z.key),
            data: [z.util, z.activeRatio, z.usageScore],
            color: palette[i % palette.length],
            fillArea: true,
        }))

        util       = Math.round(allResolved.reduce((s, v) => s + (v.utilization_score ?? 0), 0) / allResolved.length)
        const avgA = allResolved.reduce((s, v) => s + (v.active_count ?? 0), 0) / allResolved.length
        staffing   = Math.min(100, Math.round((avgA / exp) * 100))
        const avgDur = allResolved.reduce((s, v) => s + (v.avg_active_duration ?? 0), 0) / allResolved.length
        usageScore = Math.min(100, Math.round((avgDur / 28800) * 100))

        const series = liveSeries.length > 0 ? liveSeries : [{ id: 'zone-perf', label: 'All Zones', data: [util, staffing, usageScore], color: '#ffc762', fillArea: true }]
        const radar  = { metrics: ['Utilization', 'Active Ratio', 'Usage Score'], labelGap: 14 }
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
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
        if (perCameraData.length === 0) return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
        util       = Math.round(perCameraData.reduce((s, r) => s + (r.avg_utilization ?? 0), 0) / perCameraData.length)
        const avgA = perCameraData.reduce((s, r) => s + (r.avg_equipment ?? 0), 0) / perCameraData.length
        staffing   = Math.min(100, Math.round((avgA / exp) * 100))
        const avgDur = perCameraData.reduce((s, r) => s + (r.avg_active_duration ?? 0), 0) / perCameraData.length
        usageScore = Math.min(100, Math.round((avgDur / 28800) * 100))
    }

    const filterZoneSeries = !isLive ? (() => {
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
                const avgA    = rows.reduce((s, r) => s + (r.avg_equipment ?? 0), 0) / rows.length
                const avgDur  = rows.reduce((s, r) => s + (r.avg_active_duration ?? 0), 0) / rows.length
                return {
                    key: z.key,
                    avgActive: avgA,
                    util:       Math.round(avgUtil),
                    activeRatio: Math.min(100, Math.round((avgA / exp) * 100)),
                    usageScore:  Math.min(100, Math.round((avgDur / 28800) * 100)),
                }
            })
            .sort((a, b) => (b.avgActive ?? 0) - (a.avgActive ?? 0))

        const MAX = 8
        const top = ranked.slice(0, MAX)
        const rest = ranked.slice(MAX)
        const list = rest.length === 0 ? top : (() => {
            const avgUtil = rest.reduce((s, r) => s + (r.util ?? 0), 0) / rest.length
            const avgA    = rest.reduce((s, r) => s + (r.avgActive ?? 0), 0) / rest.length
            const avgAR   = rest.reduce((s, r) => s + (r.activeRatio ?? 0), 0) / rest.length
            const avgUS   = rest.reduce((s, r) => s + (r.usageScore ?? 0), 0) / rest.length
            return [
                ...top,
                { key: 'Other Zones', avgActive: avgA, util: Math.round(avgUtil), activeRatio: Math.round(avgAR), usageScore: Math.round(avgUS) },
            ]
        })()

        return list.map((z, i) => ({
            id: `zone-${z.key}`,
            label: formatZoneLabel(z.key),
            data: [z.util, z.activeRatio, z.usageScore],
            color: palette[i % palette.length],
            fillArea: true,
        }))
    })() : null

    const series = filterZoneSeries && filterZoneSeries.length > 0
        ? filterZoneSeries
        : [{ id: 'zone-perf', label: 'All Zones', data: [util, staffing, usageScore], color: '#ffc762', fillArea: true }]
    const radar  = { metrics: ['Utilization', 'Active Ratio', 'Usage Score'], labelGap: 14 }

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
function EquipmentUtilScatter({ perCameraData, loading, isLive, allResolved }) {
    const isDark = useDark()

    const points = useMemo(() => {
        if (isLive) {
            return (allResolved || []).map((row, i) => {
                const x = (row.avg_active_duration ?? 0) / 60
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
            const x = (row.avg_active_duration ?? 0) / 60
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
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )
    if (points.length === 0) return (
        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
            <span className="fw-semibold d-block mb-1">No data available</span>
            <span className="fs-12">No data to display for the current view</span>
        </div>
    )

    const rawMax   = Math.max(...points.map(p => p.x))
    const maxDur   = Math.ceil(rawMax * 1.15) || 10
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
                valueFormatter: v => v ? `${v.label} · ~${v.x}m active · ~${v.y}% util` : '',
            }]}
            xAxis={[{
                min: 0, max: maxDur, label: 'Avg Active Duration (min)', height: 45,
                labelStyle: { fill: tickCol, fontSize: 12, fontWeight: 600, transform: 'translateY(6px)' },
                colorMap: { type: 'continuous', min: 0, max: maxDur, color: ['#22c55e', '#f59e0b'] },
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
function EquipmentResolutionFunnel({ summary, loading }) {
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
                <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_CARD_H }}>
                    <span className="fw-semibold d-block mb-1">No records available</span>
                    <span className="fs-12">No results for the current selection</span>
                </div>
            ) : (
                <div className="eq-resolution-funnel" style={{ display: 'flex', justifyContent: 'center', paddingTop: 40, paddingBottom: 40 }}>
                    <style>{`
                        html.app-skin-dark .eq-resolution-funnel .recharts-default-tooltip { background: rgba(10,18,32,.96) !important; border-color: rgba(255,255,255,.12) !important; color: rgba(255,255,255,.92) !important; }
                        html.app-skin-dark .eq-resolution-funnel .recharts-default-tooltip * { color: rgba(255,255,255,.86) !important; }
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

// ── Equipment Trend Chart ──────────────────────────────────────────────────────
function EquipmentTrendChart({ trendPoints, loading, isLive, dateFrom, dateTo }) {
    const isDark = useDark()

    if (loading && trendPoints.length === 0) {
        return (
            <PageLoader minHeight={EQ_EMPTY_TREND_H} />
        )
    }
    if (trendPoints.length === 0) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_TREND_H }}>
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

    const eqCounts  = trendPoints.map(d => d.equipment ?? 0)
    const maxEq     = eqCounts.length > 0 ? Math.max(...eqCounts) : 0
    const avgEq     = eqCounts.length > 0 ? Math.round(eqCounts.reduce((a, b) => a + b, 0) / eqCounts.length) : 0
    const utilVals  = trendPoints.map(d => d.util ?? 0)
    const avgUtil   = utilVals.length > 0 ? Math.round(utilVals.reduce((a, b) => a + b, 0) / utilVals.length) : 0

    const eqYMax = Math.max(5, Math.ceil((maxEq * 1.2) / 5) * 5)

    const CustomDot = ({ cx, cy, payload, dataKey }) => {
        if (!payload || !cx || !cy) return null
        const isPeak = dataKey === 'equipment' && payload.equipment === maxEq && maxEq > 0
        const color  = dataKey === 'equipment' ? '#f59e0b' : dataKey === 'util' ? '#445cf6' : '#dc2626'
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
        <div className="eq-trend-chart">
            <div className="d-flex justify-content-center gap-3 mb-2">
                {[['#f59e0b', 'Avg Equipment Count'], ['#445cf6', 'Utilization %'], ['#dc2626', 'Idle Ratio %']].map(([color, label]) => (
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
                        yAxisId="equipment"
                        orientation="left"
                        domain={[0, eqYMax]}
                        ticks={Array.from({ length: 6 }, (_, i) => Math.round(i * eqYMax / 5))}
                        stroke={axisCol}
                        tick={{ fill: tickCol, fontSize: 12 }}
                        axisLine={{ stroke: axisCol }}
                        tickLine={false}
                        allowDecimals={false}
                        tickMargin={8}
                        width={52}
                        label={<CenteredYAxisLabel side="left" value="Avg Equipment Count" />}
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
                        label={<CenteredYAxisLabel side="right" value="Utilization & Idle Ratio %" />}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', borderRadius: 6, color: 'var(--bs-body-color)', fontSize: 12 }}
                        labelStyle={{ color: 'var(--bs-body-color)', fontWeight: 600 }}
                        cursor={{ stroke: axisCol, strokeWidth: 1, strokeDasharray: '4 3' }}
                        labelFormatter={fmtTick}
                        formatter={(value, name) => {
                            if (name === 'equipment')  return [value, 'Equipment']
                            if (name === 'util')       return [`${value}%`, 'Utilization']
                            if (name === 'idle_ratio') return [`${value}%`, 'Idle Ratio']
                            return [value, name]
                        }}
                    />
                    <Area yAxisId="equipment" type="monotone" dataKey="equipment"  stroke="#f59e0b" strokeWidth={2.5} fill="#f59e0b" fillOpacity={0.14} dot={<CustomDot dataKey="equipment" />}   activeDot={{ r: 7 }} isAnimationActive />
                    <Area yAxisId="pct"       type="monotone" dataKey="util"       stroke="#445cf6" strokeWidth={2.5} fill="#445cf6" fillOpacity={0.10} dot={<CustomDot dataKey="util" />}       activeDot={{ r: 7 }} isAnimationActive />
                    <Area yAxisId="pct"       type="monotone" dataKey="idle_ratio" stroke="#dc2626" strokeWidth={2}   fill="#dc2626" fillOpacity={0.07} dot={<CustomDot dataKey="idle_ratio" />} activeDot={{ r: 6 }} isAnimationActive />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}

// ── Equipment Zone Table ──────────────────────────────────────────────────────
function EquipmentZoneTable({ camList, isLive, loading }) {
    if (loading && camList.length === 0) {
        return (
            <div className="px-3 py-4 d-flex gap-2">
                {[1, 2, 3].map(i => (
                    <div key={i} style={{ height: 48, flex: 1, borderRadius: 6, background: 'rgba(100,116,139,.12)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                ))}
            </div>
        )
    }
    const liveHasAnyValues = isLive
        ? camList.some(r =>
            r?.latest_active_count != null ||
            r?.active_count != null ||
            r?.idle_count != null ||
            r?.latest_utilization != null ||
            r?.latest_zone_status != null ||
            r?.avg_active_duration != null ||
            r?.open_alerts != null
        )
        : true

    if (camList.length === 0 || (isLive && !liveHasAnyValues)) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_TABLE_H }}>
                <span className="fw-semibold d-block mb-1">No data available</span>
                <span className="fs-12">No data to display for the current view</span>
            </div>
        )
    }

    const statusBadge = status => {
        const s = (status || '').toUpperCase()
        if (s === 'UNDERUTILIZED') return <span className="badge bg-soft-warning text-warning fw-semibold" style={{ fontSize: 11 }}>UNDERUTILIZED</span>
        if (s === 'OVERLOADED' || s === 'OVERLOAD') return <span className="badge bg-soft-danger text-danger fw-semibold" style={{ fontSize: 11 }}>OVERLOADED</span>
        if (s === 'BALANCED') return <span className="badge bg-soft-success text-success fw-semibold" style={{ fontSize: 11 }}>BALANCED</span>
        return <span className="text-muted fs-12">—</span>
    }

    return (
        <div className="table-responsive pm-table-wrap eq-zone-compare">
            <table className="table table-hover mb-0 align-middle">
                <colgroup>
                    {isLive ? (
                        <>
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '18%' }} />
                            <col style={{ width: '12%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '14%' }} />
                            <col style={{ width: '8%' }} />
                            <col style={{ width: '8%' }} />
                        </>
                    ) : (
                        <>
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '22%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '14%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '10%' }} />
                        </>
                    )}
                </colgroup>
                <thead>
                    <tr className="border-b">
                        <th scope="row" className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone</th>
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Camera</th>
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>{isLive ? 'Equipment On-Site' : 'Avg Equipment'}</th>
                        {isLive ? (
                            <>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Active Equipment</th>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Idle Equipment</th>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Utilization</th>
                            </>
                        ) : (
                            <>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Utilization</th>
                                <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Idle Ratio</th>
                            </>
                        )}
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Avg Active Duration</th>
                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Active Insights</th>
                        <th className="fs-11 text-uppercase text-end" style={{ letterSpacing: '0.06em' }}>Zone Status</th>
                    </tr>
                </thead>
                <tbody>
                    {(() => {
                        const visible = isLive ? camList : camList.filter(c => !c._noData)
                        if (visible.length === 0 && camList.length > 0) {
                            return (
                                <tr>
                                    <td colSpan={isLive ? 9 : 8} className="text-center text-muted">
                                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: EQ_EMPTY_TABLE_H }}>
                                            <span className="fw-semibold d-block mb-1">No data available</span>
                                            <span className="fs-12">No data to display for the current view</span>
                                        </div>
                                    </td>
                                </tr>
                            )
                        }
                        return visible.map(c => {
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

                        const activeLive  = c.latest_active_count ?? null
                        const activeCount = c.active_count ?? null
                        const idleCount   = c.idle_count ?? null

                        const avgEquipment = c._avgEquipment  ?? null
                        const avgUtil      = c._avgUtil       ?? null
                        const avgIdleRatio = c._avgIdleRatio  ?? null

                        const utilPct    = c.latest_utilization != null ? Math.round(c.latest_utilization) : null
                        const duration   = c.avg_active_duration ? fmtDuration(c.avg_active_duration) : '—'
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
                                            {activeLive ?? '—'}
                                        </span>
                                    ) : (
                                        <span className="badge bg-soft-primary text-primary fs-11">
                                            {avgEquipment ?? '—'}
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
                                    {duration !== '—' ? (
                                        <span className="badge bg-soft-info text-info fs-11">{duration}</span>
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
                    })
                    })()}
                </tbody>
            </table>

            <style>{`
                .pm-table-wrap { border-radius: 0.5rem; overflow: hidden; }
                .pm-table-wrap .table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
                .pm-table-wrap .table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
                .pm-table-wrap .table td { vertical-align: middle; }
                .eq-zone-compare .table { width: 100%; table-layout: fixed; }
                .eq-zone-compare .table > :not(caption) > * > * { padding: 0.75rem 0.85rem !important; }
                .eq-zone-compare .table thead th { font-size: 10px !important; line-height: 1; }
                .eq-zone-compare th:first-child,
                .eq-zone-compare td:first-child { padding-left: 15px !important; }
                .eq-zone-compare th:last-child,
                .eq-zone-compare td:last-child { padding-right: 15px !important; }
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
        </div>
    )
}

// ── Date helpers ──────────────────────────────────────────────────────────────
const buildQS = (from, to) => {
    const params = `?date_from=${encodeURIComponent(toISO(from))}&date_to=${encodeURIComponent(toISO(to))}`
    return { params, from, to }
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function EquipmentDashboard({ projectId, dateFilter }) {
    const queryClient = useQueryClient()

    const isLive = dateFilter?.preset === 'live'

    // Live SSE metrics keyed by camera_id
    const [liveStats, setLiveStats] = useState({})
    const liveRef = useRef(liveStats)
    liveRef.current = liveStats

    // Session peak equipment (live mode — tracks max across all cameras)
    const [livePeakEquipment, setLivePeakEquipment] = useState(0)
    useEffect(() => { if (isLive) setLivePeakEquipment(0) }, [isLive])

    const wasLiveRef = useRef(isLive)
    useEffect(() => {
        if (isLive && !wasLiveRef.current) {
            ;['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'alerts'].forEach(k =>
                queryClient.removeQueries({ queryKey: ['equipment', k, projectId] })
            )
            setTrendPoints([])
            setLiveStats({})
            setLivePeakEquipment(0)
        }
        wasLiveRef.current = isLive
    }, [isLive, projectId, queryClient])

    // Trend state
    const [trendPoints, setTrendPoints] = useState([])
    const [trendLoad,   setTrendLoad]   = useState(true)

    // ── Feature-toggle gate ────────────────────────────────────────────────
    const liveStatusPolling = isLive
    const { data: eqStatus = null } = useQuery({
        queryKey: QK.eqStatus(projectId),
        queryFn: () => apiGet(`/projects/${projectId}/cameras/features`).catch(() => null),
        staleTime: Infinity,
        refetchOnMount: liveStatusPolling ? 'always' : true,
        refetchOnWindowFocus: liveStatusPolling ? 'always' : false,
        refetchInterval: liveStatusPolling ? 8000 : false,
        refetchIntervalInBackground: liveStatusPolling,
        enabled: !!projectId,
    })

    const featureActive = useMemo(() => {
        if (!eqStatus?.cameras) return null
        return eqStatus.cameras.some(c => c?.features?.equipment_enabled === true)
    }, [eqStatus])

    const eqServerLiveStart = useMemo(() => {
        return eqStatus?.equipment_live_session_start ?? eqStatus?.live_session_start ?? null
    }, [eqStatus])

    const liveFrom = useMemo(() => {
        if (!isLive) return null
        if (!eqServerLiveStart) return null
        const d = new Date(eqServerLiveStart)
        if (isNaN(d.getTime())) return null
        return d
    }, [isLive, eqServerLiveStart])

    const qs = useMemo(() => {
        if (isLive && liveFrom) return buildQS(liveFrom, new Date())
        return buildQS(dateFilter?.from, dateFilter?.to)
    }, [isLive, liveFrom, dateFilter?.from, dateFilter?.to])

    const prevAnyActiveRef = useRef(null)
    useEffect(() => {
        if (!isLive) return
        if (!eqStatus?.cameras) return

        const anyActive = eqStatus.cameras.some(c => c?.features?.equipment_enabled === true)
        const prevAnyActive = prevAnyActiveRef.current
        prevAnyActiveRef.current = anyActive

        if (prevAnyActive == null || prevAnyActive === anyActive) return

        const EQ_DATA_KEYS = ['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'heatmap', 'alerts']

        if (anyActive === false) {
            EQ_DATA_KEYS.forEach(k => {
                queryClient.setQueriesData({ queryKey: ['equipment', k] }, null)
                queryClient.removeQueries({ queryKey: ['equipment', k, projectId] })
            })
            setLiveStats({})
            setTrendPoints([])
            setTrendLoad(false)
            setLivePeakEquipment(0)
            return
        }

        EQ_DATA_KEYS.forEach(k => {
            queryClient.setQueriesData({ queryKey: ['equipment', k] }, undefined)
            queryClient.removeQueries({ queryKey: ['equipment', k, projectId] })
        })
        setLiveStats({})
        setTrendPoints([])
        setTrendLoad(true)
        setLivePeakEquipment(0)
        queryClient.invalidateQueries({ queryKey: ['equipment'] })
    }, [isLive, eqStatus, projectId, queryClient])

    const getLiveParams = useCallback((endpoint) => {
        if (isLive) {
            if (!liveFrom) return `/projects/${projectId}/equipment/${endpoint}${qs.params}`
            const from = liveFrom
            const p = `?date_from=${encodeURIComponent(toISO(from))}&date_to=${encodeURIComponent(toISO(new Date()))}`
            return `/projects/${projectId}/equipment/${endpoint}${p}`
        }
        return `/projects/${projectId}/equipment/${endpoint}${qs.params}`
    }, [isLive, projectId, qs.params, liveFrom])

    const dataEnabled = !isLive || (featureActive === true && !!liveFrom)

    // ── React Query hooks ──────────────────────────────────────────────────
    const { data: summary = null, isLoading: sumLoad } = useQuery({
        queryKey: QK.eqSummary(projectId, qs.from, qs.to),
        queryFn: () => apiGet(getLiveParams('summary')).catch(() => null),
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId && dataEnabled,
    })

    const { data: camerasData = [], isLoading: camLoad } = useQuery({
        queryKey: QK.eqCameras(projectId, isLive ? null : qs.from, isLive ? null : qs.to),
        queryFn: () => {
            if (isLive) return apiGet(`/projects/${projectId}/equipment/cameras`).catch(() => [])
            return apiGet(`/projects/${projectId}/equipment/cameras${qs.params}`).catch(() => [])
        },
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId,
    })

    const { data: settingsData = null } = useQuery({
        queryKey: QK.eqSettings(projectId),
        queryFn: async () => {
            const rows = await apiGet(`/projects/${projectId}/equipment/settings`).catch(() => null)
            if (!rows) return null
            return Array.isArray(rows) ? (rows.find(r => r.camera_id === null) || rows[0] || null) : rows
        },
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId,
    })

    const { data: perCameraData = [], isLoading: heatLoad } = useQuery({
        queryKey: QK.eqScatter(projectId, null, qs.from, qs.to),
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

    useEffect(() => {
        if (!isLive) return
        if (!eqServerLiveStart) return
        queryClient.invalidateQueries({ queryKey: ['equipment'] })
    }, [isLive, eqServerLiveStart, queryClient])

    // ── Trend ──────────────────────────────────────────────────────────────
    const { data: trendQueryData, isLoading: trendQueryLoad } = useQuery({
        queryKey: QK.eqTrend(projectId, qs.from, qs.to),
        queryFn: () =>
            apiGet(`/projects/${projectId}/equipment/trend?date_from=${toISO(qs.from)}&date_to=${toISO(qs.to)}`)
                .then(rows => rows.map(r => ({
                    ts:         r.recorded_at || null,
                    equipment:  r.avg_equipment   ?? 0,
                    util:       r.avg_utilization ?? 0,
                    idle_ratio: r.idle_ratio       ?? 0,
                })))
                .catch(() => []),
        staleTime: 30_000,
        refetchInterval: isLive ? false : 30_000,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: 'always',
        enabled: !!projectId && dataEnabled && !isLive,
    })

    const { data: liveTrendSeed, isLoading: liveTrendLoading } = useQuery({
        queryKey: QK.eqTrendLive(projectId),
        queryFn: () => {
            if (!liveFrom) return []
            const now  = new Date()
            const from = liveFrom
            return apiGet(`/projects/${projectId}/equipment/trend?date_from=${toISO(from)}&date_to=${toISO(now)}`)
                .then(rows => rows.map(r => ({
                    ts:         r.recorded_at || null,
                    equipment:  r.avg_equipment   ?? 0,
                    util:       r.avg_utilization ?? 0,
                    idle_ratio: r.idle_ratio       ?? 0,
                })))
                .catch(() => [])
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
        enabled: !!projectId && isLive && dataEnabled,
    })

    useEffect(() => {
        if (!isLive || !dataEnabled) return
        if (liveTrendLoading) { setTrendLoad(true); return }
        if (liveTrendSeed !== undefined) {
            setTrendPoints(prev => {
                const seedArr = liveTrendSeed ?? []
                if (seedArr.length === 0) return prev
                const seedLastTs = seedArr[seedArr.length - 1].ts
                const newerSsePts = seedLastTs ? prev.filter(p => p.ts > seedLastTs) : []
                return [...seedArr, ...newerSsePts]
            })
            setTrendLoad(false)
        }
    }, [isLive, dataEnabled, liveTrendSeed, liveTrendLoading])

    useEffect(() => {
        if (!isLive && trendQueryData) {
            setTrendPoints(trendQueryData)
            setTrendLoad(false)
        }
    }, [isLive, trendQueryData])

    useEffect(() => {
        if (!dataEnabled) { setTrendPoints([]); setTrendLoad(false) }
    }, [dataEnabled])

    useEffect(() => {
        if (featureActive === null) return
        if (isLive && featureActive === false) {
            ;['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'heatmap', 'alerts'].forEach(k =>
                queryClient.removeQueries({ queryKey: ['equipment', k, projectId] })
            )
            setLiveStats({})
            setTrendPoints([])
        }
    }, [featureActive, isLive, projectId, queryClient])

    useEffect(() => {
        const h = () => queryClient.invalidateQueries({ queryKey: QK.eqSettings(projectId) })
        window.addEventListener('eq:settings-updated', h)
        return () => window.removeEventListener('eq:settings-updated', h)
    }, [projectId, queryClient])

    const enabledCameraIds = useMemo(() => new Set(
        (eqStatus?.cameras ?? [])
            .filter(c => c?.features?.equipment_enabled === true)
            .map(c => c.camera_id)
    ), [eqStatus])

    // ── SSE handler ────────────────────────────────────────────────────────
    useEquipmentStream(projectId, queryClient, {
        onConnect: useCallback(() => {}, []),
        onDisconnect: useCallback(() => {}, []),

        onStatsUpdate: useCallback((data) => {
            const cam_id = data.camera_id
            setLiveStats(prev => {
                const next = { ...prev, [cam_id]: data }
                const activeStats = Object.values(next)
                if (isLive && activeStats.length > 0) {
                    const siteTotal = activeStats.reduce((s, v) => s + (v.active_count || 0), 0)
                    setLivePeakEquipment(peak => Math.max(peak, siteTotal))
                    setTrendPoints(pts => {
                        const idleTotal = activeStats.reduce((s, v) => s + (v.idle_count || 0), 0)
                        const totalAll  = activeStats.reduce((s, v) => s + (v.total_count || 0), 0)
                        const idleRatio = totalAll > 0 ? Math.round(idleTotal / totalAll * 100) : 0
                        const avgUtil   = Math.round(
                            activeStats.reduce((s, v) => s + (v.utilization_score || 0), 0) / activeStats.length
                        )
                        const ts = data.timestamp || new Date().toISOString()
                        return [...pts, {
                            ts,
                            equipment:  siteTotal,
                            util:       avgUtil,
                            idle_ratio: idleRatio,
                        }].slice(-60)
                    })
                }
                return next
            })
        }, [isLive]),

        onAlert: useCallback(() => {
            queryClient.invalidateQueries({ queryKey: ['equipment', 'trend',   projectId] })
            queryClient.invalidateQueries({ queryKey: ['equipment', 'scatter', projectId] })
            queryClient.invalidateQueries({ queryKey: ['equipment', 'cameras', projectId] })
        }, [queryClient, projectId]),

        onAlertUpdated: useCallback(() => {
            queryClient.invalidateQueries({ queryKey: ['equipment', 'summary', projectId] })
            queryClient.invalidateQueries({ queryKey: ['equipment', 'cameras', projectId] })
        }, [queryClient, projectId]),

        onFeatureChanged: useCallback(({ anyActive }) => {
            if (anyActive === false) {
                setLiveStats({})
                setTrendPoints([])
            }
        }, []),
    })

    useEffect(() => {
        return onBroadcast('eq:feature-changed', ({ anyActive, live_session_start } = {}) => {
            if (anyActive === false) {
                setLiveStats({})
                setTrendPoints([])
                setTrendLoad(false)
                setLivePeakEquipment(0)
                ;['summary', 'cameras', 'scatter', 'trend', 'trend-live', 'heatmap', 'alerts'].forEach(k =>
                    queryClient.removeQueries({ queryKey: ['equipment', k, projectId] })
                )
            } else {
                queryClient.invalidateQueries({ queryKey: ['equipment'] })
            }
        })
    }, [projectId, queryClient])

    useEffect(() => {
        return onBroadcast('eq:alert-updated', ({ projectId: pid, ...data } = {}) => {
            if (String(pid) !== String(projectId)) return
            patchAlertInCache(queryClient, projectId, data)
            queryClient.invalidateQueries({ queryKey: ['equipment', 'summary', projectId] })
            queryClient.invalidateQueries({ queryKey: ['equipment', 'cameras', projectId] })
        })
    }, [projectId, queryClient])

    useEffect(() => {
        return onBroadcast('eq:new-alert', ({ projectId: pid } = {}) => {
            if (String(pid) === String(projectId)) {
                queryClient.invalidateQueries({ queryKey: ['equipment', 'summary', projectId] })
                queryClient.invalidateQueries({ queryKey: ['equipment', 'alerts',  projectId] })
                queryClient.invalidateQueries({ queryKey: ['equipment', 'cameras', projectId] })
            }
        })
    }, [projectId, queryClient])

    // ── Derived data ───────────────────────────────────────────────────────
    const hasLiveSSE = Object.keys(liveStats).length > 0
    const liveEmptyState = isLive && featureActive === false
    const uiSummary = liveEmptyState ? null : summary
    const uiSumLoad = liveEmptyState ? false : sumLoad

    const snapshotStats = useMemo(() => {
        const snap = {}
        camerasData.forEach(c => {
            snap[c.camera_id] = {
                camera_id:            c.camera_id,
                zone_name:            c.zone_name,
                active_count:         c.active_count ?? 0,
                idle_count:           c.idle_count ?? 0,
                total_count:          c.total_count ?? 0,
                utilization_score:    c.latest_utilization ?? 0,
                zone_status:          c.latest_zone_status ?? 'BALANCED',
                misuse_flags:         c.misuse_flags ?? [],
                avg_active_duration:  c.avg_active_duration ?? 0,
                cross_zone_conflicts: c.cross_zone_conflicts ?? 0,
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

    const allResolved = isLive && featureActive !== false
        ? camerasData
            .filter(c => enabledCameraIds.has(c.camera_id))
            .map(c => resolveStats(c.camera_id))
            .filter(Boolean)
        : []

    const hasData = isLive
        ? (!liveEmptyState && featureActive === true && allResolved.length > 0)
        : (!!uiSummary && ((uiSummary.total_equipment_today ?? 0) > 0 || (uiSummary.peak_equipment_count ?? 0) > 0 || (uiSummary.avg_utilization ?? 0) > 0))

    const effEmptyState = !uiSumLoad && !hasData

    const zonePerfEmptyState = isLive
        ? allResolved.length === 0
        : perCameraData.length === 0

    const zoneUtilEmptyState = (() => {
        if (isLive) {
            if (allResolved.length === 0) return true
            return allResolved.every(row => ((row?.avg_active_duration ?? 0) === 0 && (row?.utilization_score ?? 0) === 0))
        }
        if (perCameraData.length === 0) return true
        return perCameraData.every(row => ((row?.avg_active_duration ?? 0) === 0 && (row?.avg_utilization ?? 0) === 0))
    })()

    const resolutionEmptyState = !uiSumLoad && ((uiSummary?.open_alerts ?? 0) + (uiSummary?.acknowledged_alerts ?? 0) + (uiSummary?.resolved_alerts ?? 0) === 0)
    const trendHasMeaningfulData = trendPoints.some(p =>
        (p?.equipment ?? 0) > 0 ||
        (p?.util ?? 0) > 0 ||
        (p?.idle_ratio ?? 0) > 0
    )
    const trendEmptyState = !trendHasMeaningfulData

    // Project-level aggregated KPI values (live)
    const aggEquipment = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.active_count || 0), 0)
        : null

    const aggIdle = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.idle_count || 0), 0)
        : null

    const aggTotal = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.total_count || 0), 0)
        : null

    const aggUtil = allResolved.length > 0
        ? Math.round(allResolved.reduce((s, v) => s + (v.utilization_score || 0), 0) / allResolved.length)
        : null

    const aggIdleRatio = allResolved.length > 0 && (aggTotal ?? 0) > 0
        ? Math.round((aggIdle ?? 0) / aggTotal * 100)
        : null

    const aggActiveDuration = allResolved.length > 0
        ? allResolved.reduce((s, v) => s + (v.avg_active_duration || 0), 0) / allResolved.length
        : null

    const aggMisuse = isLive
        ? allResolved.reduce((s, v) => s + (v.misuse_flags?.length || 0), 0)
        : (summary?.misuse_events ?? null)

    const aggCrossZone = isLive
        ? allResolved.filter(v => (v.cross_zone_conflicts ?? 0) > 0).length
        : null

    const expectedEq = settingsData?.expected_equipment_count ?? null

    const avgOccupancy = useMemo(() => {
        const rows = perCameraData.filter(r => r.avg_equipment != null)
        if (!rows.length) return summary?.total_equipment_today ?? 0
        return Math.round(rows.reduce((s, r) => s + r.avg_equipment, 0) / rows.length)
    }, [perCameraData, summary])

    const underutilized = expectedEq != null
        ? isLive
            ? Math.max(0, expectedEq - (aggEquipment ?? uiSummary?.total_equipment_today ?? 0))
            : Math.max(0, expectedEq - avgOccupancy)
        : null

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
                            _noData:              false,
                            latest_active_count:  null,
                            active_count:         null,
                            idle_count:           null,
                            latest_utilization:   null,
                            latest_zone_status:   null,
                            avg_active_duration:  null,
                            open_alerts:          null,
                        }
                    }
                    return {
                        ...c,
                        _noData:              false,
                        latest_active_count:  r.active_count,
                        active_count:         r.active_count,
                        idle_count:           r.idle_count,
                        latest_utilization:   r.utilization_score,
                        latest_zone_status:   r.zone_status,
                        avg_active_duration:  r.avg_active_duration,
                    }
                })
        }
        const byCamera = {}
        perCameraData.forEach(row => {
            if (!byCamera[row.camera_id]) byCamera[row.camera_id] = []
            byCamera[row.camera_id].push(row)
        })
        const STATUS_PRIORITY = { OVERLOADED: 3, OVERLOAD: 3, UNDERUTILIZED: 2, BALANCED: 1 }
        return camerasData.map(c => {
            const rows = byCamera[c.camera_id] || []
            if (rows.length === 0) return { ...c, _noData: true }
            const avgEquipment = rows.reduce((s, r) => s + (r.avg_equipment    ?? 0), 0) / rows.length
            const avgUtil      = rows.reduce((s, r) => s + (r.avg_utilization  ?? 0), 0) / rows.length
            const avgDuration  = rows.reduce((s, r) => s + (r.avg_active_duration ?? 0), 0) / rows.length
            const avgIdleRatio = rows.reduce((s, r) => s + (r.avg_idle_ratio    ?? 0), 0) / rows.length
            const worstStatus = rows.reduce((worst, r) => {
                const p = STATUS_PRIORITY[(r.zone_status || '').toUpperCase()] ?? 0
                return p > (STATUS_PRIORITY[(worst || '').toUpperCase()] ?? 0) ? r.zone_status : worst
            }, 'BALANCED')
            return {
                ...c,
                _noData:              false,
                _avgEquipment:        Math.round(avgEquipment),
                _avgUtil:             avgUtil,
                _avgIdleRatio:        avgIdleRatio,
                latest_zone_status:   worstStatus,
                avg_active_duration:  avgDuration,
            }
        })
    }, [isLive, featureActive, enabledCameraIds, camerasData, perCameraData]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Row 1: KPI cards ──────────────────────────────────────────────────
    const statisticsData = [
        {
            icon:   'feather-truck',
            number: isLive
                ? (aggEquipment != null
                    ? fmt(aggEquipment)
                    : (uiSummary?.total_equipment_today != null ? fmt(uiSummary.total_equipment_today) : (hasLiveSSE ? '0' : '—')))
                : (uiSumLoad ? '—' : uiSummary?.total_equipment_today != null ? fmt(uiSummary.total_equipment_today) : '—'),
            title: isLive ? 'Equipment On-Site' : 'Peak Occupancy',
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
            title: 'Idle Ratio',
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

    const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ['equipment'] })

    const trendDateFrom = isLive ? (liveFrom ?? qs.from) : qs.from
    const trendDateTo   = isLive ? new Date() : qs.to

    return (
        <div className="row g-3">
            <style>{`
                .eq-trend-chart .recharts-cartesian-grid line { stroke: rgba(15,23,42,.10) !important; stroke-opacity: 0.65 !important; stroke-width: 1 !important; stroke-dasharray: 3 3 !important; }
                html.app-skin-dark .eq-trend-chart .recharts-cartesian-axis-tick-value { fill: rgba(255,255,255,.72) !important; }
                html.app-skin-dark .eq-trend-chart .recharts-cartesian-grid line { stroke: rgba(255,255,255,.10) !important; stroke-opacity: 0.85 !important; stroke-width: 1 !important; stroke-dasharray: 3 3 !important; }
                html.app-skin-dark .eq-trend-chart .recharts-cartesian-axis-line { stroke: rgba(255,255,255,.14) !important; }
                html.app-skin-dark .eq-trend-chart .recharts-default-tooltip { background: rgba(10,18,32,.96) !important; border-color: rgba(255,255,255,.12) !important; color: rgba(255,255,255,.92) !important; }
                html.app-skin-dark .eq-trend-chart .recharts-default-tooltip * { color: rgba(255,255,255,.86) !important; }
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
                    icon:  'feather-truck',
                    title: 'Peak Equipment Count',
                    count: isLive
                        ? (livePeakEquipment > 0
                            ? fmt(livePeakEquipment)
                            : (uiSummary?.peak_equipment_count != null
                                ? fmt(uiSummary.peak_equipment_count)
                                : (aggEquipment != null ? fmt(aggEquipment) : '—')))
                        : (uiSumLoad ? '—' : fmt(uiSummary?.peak_equipment_count)),
                    color: 'primary',
                },
                {
                    icon:  'feather-clock',
                    title: 'Avg Active Duration',
                    count: isLive
                        ? (aggActiveDuration != null ? fmtDuration(aggActiveDuration) : (uiSummary?.avg_active_duration != null ? fmtDuration(uiSummary.avg_active_duration) : '—'))
                        : fmtDuration(uiSummary?.avg_active_duration),
                    color: 'info',
                },
                {
                    icon:  'feather-alert-triangle',
                    title: 'Misuse Events',
                    count: aggMisuse != null ? String(aggMisuse) : '—',
                    color: 'danger',
                },
                {
                    icon:  'feather-crosshair',
                    title: 'Underutilized Equipment',
                    count: underutilized == null ? '—' : String(underutilized),
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
                    <CardHeader title="Equipment Efficiency" refresh={() => { effActions.handleRefresh(); invalidateAll() }} expanded={effActions.handleExpand} />
                    <div className="card-body d-flex flex-column align-items-center justify-content-center" style={{ paddingTop: 20, paddingBottom: 20 }}>
                        <EquipmentEfficiencyScore
                            activeEquipment={isLive
                                ? (aggEquipment ?? 0)
                                : avgOccupancy}
                            totalEquipment={isLive
                                ? (aggTotal ?? 0)
                                : avgOccupancy}
                            expectedEquipment={expectedEq ?? 1}
                            misflagCount={aggMisuse ?? 0}
                            crossZoneConflicts={aggCrossZone ?? 0}
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
                        <EquipmentZoneRadarChart
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

            {/* ── Row 4: Scatter + Resolution Funnel ───────────────────── */}
            <div className="col-xl-8 col-md-12">
                <div className={`card stretch stretch-full ${zoneUtilEmptyState ? '' : 'h-100'} ${zoneEffActions.isExpanded ? 'card-expand' : ''} ${zoneEffActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader title="Zone Utilization" refresh={() => { zoneEffActions.handleRefresh(); invalidateAll() }} expanded={zoneEffActions.handleExpand} />
                    <div className="card-body p-0 custom-card-action d-flex flex-column justify-content-center">
                        <EquipmentUtilScatter perCameraData={perCameraData} loading={isLive ? (camLoad && !hasLiveSSE) : heatLoad} isLive={isLive} allResolved={allResolved} />
                    </div>
                    <CardLoader refreshKey={zoneEffActions.refreshKey} />
                </div>
            </div>

            <div className="col-xl-4 col-md-12">
                <div className={`card stretch stretch-full ${resolutionEmptyState ? '' : 'h-100'} ${coverageActions.isExpanded ? 'card-expand' : ''} ${coverageActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader title="Insight Resolution Status" refresh={() => { coverageActions.handleRefresh(); invalidateAll() }} expanded={coverageActions.handleExpand} />
                    <EquipmentResolutionFunnel summary={uiSummary} loading={uiSumLoad} />
                    <CardLoader refreshKey={coverageActions.refreshKey} />
                </div>
            </div>

            {/* ── Row 5: Equipment Trend ────────────────────────────────── */}
            <div className="col-12">
                <div className={`card stretch stretch-full ${trendActions.isExpanded ? 'card-expand' : ''} ${trendActions.refreshKey ? 'card-loading' : ''}`}>
                    <CardHeader
                        title="Equipment Activity Trend"
                        refresh={() => {
                            trendActions.handleRefresh()
                            if (isLive) {
                                queryClient.invalidateQueries({ queryKey: QK.eqTrendLive(projectId) })
                            } else {
                                queryClient.invalidateQueries({ queryKey: ['equipment', 'trend', projectId] })
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
                        <EquipmentTrendChart
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

            {/* ── Row 6: Zone Status Overview ──────────────────────────── */}
            <div className="col-12">
                <div className="card stretch stretch-full">
                    <div className="card-header">
                        <div>
                            <h5 className="mb-0">Zone Equipment Overview</h5>
                            <span className="fs-12 text-muted">Aggregated equipment performance metrics by zone for the selected period</span>
                        </div>
                    </div>
                    <EquipmentZoneTable camList={camList} isLive={isLive} loading={isLive ? camLoad : (camLoad || heatLoad)} />
                </div>
            </div>

            {/* ── Row 7: Alerts Table ───────────────────────────────────── */}
            <div className="col-12">
                <EquipmentAlertsTable
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
