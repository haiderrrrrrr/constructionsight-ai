/**
 * RiskDashboard.jsx — Enterprise Risk Analytics Dashboard
 * Scheduler-driven: timer-based analysis. No live SSE. Data refreshes on trigger or page load.
 *
 * Layout:
 *  0 — Scheduler bar
 *  1 — Weather card (col-12 full row, all OWM fields)
 *  2 — 4 primary KPI cards (PPE pattern: bg-{color})
 *  3 — 4 secondary metric cards (PPE second-row avatar pattern)
 *  4 — Risk Trend (AreaChart, PPE pattern) + Risk Composition (PieChart donut)
 *  5 — 3 Gauge cards: PPE Detection Score / Workforce Analytics Score / Activity Monitoring Score
 *  6 — Zone Risk Scatter (Workforce style) + Zone Radar (Workforce style)
 *  7 — Zone Breakdown Table (all zones, inline Why column)
 *  8 — Combined Alert Resolution Funnel
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import PageLoader from '@/components/shared/PageLoader'
import { QK } from '@/utils/queryKeys'
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip as ReTooltip, ResponsiveContainer,
} from 'recharts'
import { PieChart } from '@mui/x-charts/PieChart'
import { Gauge, gaugeClasses } from '@mui/x-charts/Gauge'
import { ScatterChart as MuiScatterChart } from '@mui/x-charts/ScatterChart'
import { RadarChart } from '@mui/x-charts/RadarChart'
import { chartsTooltipClasses } from '@mui/x-charts/ChartsTooltip'
import { FiShield, FiAlertTriangle, FiZap, FiSun, FiWind, FiDroplet, FiEye, FiThermometer, FiBell, FiLayers, FiCheckCircle, FiCloudRain, FiCloud, FiAlignLeft, FiAlertCircle } from 'react-icons/fi'
import { IoWaterOutline, IoSpeedometerOutline, IoNavigateOutline } from 'react-icons/io5'
import getIcon from '@/utils/getIcon'
import CardHeader from '@/components/shared/CardHeader'
import CardLoader from '@/components/shared/CardLoader'
import useCardTitleActions from '@/hooks/useCardTitleActions'
import { apiGet, apiPatch, apiPost } from '@/utils/api'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { onBroadcast } from '@/utils/broadcast'
import RiskLiveAlertToasts from './RiskLiveAlertToasts'
import { SelectDropdown } from '@/components/shared/Dropdown'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtRelative = (iso) => {
    if (!iso) return null
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
}
const fmtCountdown = (iso) => {
    if (!iso) return null
    const diff = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000))
    if (diff <= 0) return 'any moment'
    const m = Math.floor(diff / 60), s = diff % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const RISK_COLOR = (v) => v > 70 ? 'danger' : v > 40 ? 'warning' : 'success'
const RISK_LEVEL_BADGE = {
    critical: 'bg-soft-danger text-danger',
    high:     'bg-soft-warning text-warning',
    moderate: 'bg-soft-info text-info',
    low:      'bg-soft-success text-success',
}
const RISK_PILL_COLOR = {
    critical: 'danger',
    high:     'warning',
    moderate: 'info',
    low:      'success',
}
const WEATHER_ICON = {
    '01': 'feather-sun', '02': 'feather-cloud', '03': 'feather-cloud',
    '04': 'feather-cloud', '09': 'feather-cloud-rain', '10': 'feather-cloud-drizzle',
    '11': 'feather-cloud-lightning', '13': 'feather-wind', '50': 'feather-eye-off',
}
const weatherIcon = (code) => WEATHER_ICON[code?.slice(0, 2)] ?? 'feather-thermometer'

const INTERVAL_OPTIONS_SEC = [15, 30, 60, 120, 300, 600]

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

// ── "Why" builder from factors_json ──────────────────────────────────────────
const buildWhy = (factors) => {
    if (!factors || factors.length === 0) return '—'
    return [...factors]
        .sort((a, b) => (b.contribution ?? 0) - (a.contribution ?? 0))
        .slice(0, 2)
        .map(f => f.factor)
        .join(' · ')
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
const ToggleSwitch = ({ checked, onChange, disabled }) => (
    <label className={`cs-risk-toggle ${disabled ? 'cs-risk-toggle-disabled' : ''}`}>
        <input className="cs-risk-toggle-input" type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
        <span className="cs-risk-toggle-ui" />
    </label>
)

// ── Row 0 — Scheduler bar ─────────────────────────────────────────────────────
function RiskSchedulerBar({ status, onToggle, onIntervalChange, onTriggerNow, loading, liveZoneCount = 0 }) {
    const [countdown, setCountdown] = useState('')
    const isRunning = status?.is_running ?? false
    const enabled   = status?.enabled     ?? true
    const interval  = status?.interval_seconds ?? 30
    const lastRunAt = status?.last_run_at
    const summary   = status?.last_summary
    const hasZones  = liveZoneCount > 0
    const hasIssues = (summary?.critical_zones ?? 0) > 0 || (summary?.high_risk_zones ?? 0) > 0

    const nextRunAt = useMemo(() => {
        if (status?.next_run_at) return status.next_run_at
        if (lastRunAt && interval) return new Date(new Date(lastRunAt).getTime() + interval * 1000).toISOString()
        return null
    }, [status?.next_run_at, lastRunAt, interval])

    const nextRunAtRef = useRef(nextRunAt)
    useEffect(() => { nextRunAtRef.current = nextRunAt }, [nextRunAt])

    useEffect(() => {
        if (!enabled) { setCountdown(''); return }
        const tick = () => { if (!nextRunAtRef.current) { setCountdown(''); return } setCountdown(fmtCountdown(nextRunAtRef.current)) }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [enabled])

    return (
        <div className="card border mb-3 cs-risk-scheduler">
            <style>{`
                .cs-risk-scheduler { overflow: visible; position: relative; z-index: 50; border-color: rgba(var(--bs-primary-rgb), 0.18) !important; background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(var(--bs-primary-rgb), 0.05) 55%, rgba(var(--bs-info-rgb), 0.10) 100%); color: var(--bs-body-color); }
                html.app-skin-dark .cs-risk-scheduler { border-color: rgba(255,255,255,0.10) !important; background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.22) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.18) 100%); color: rgba(255,255,255,0.92); }
                .cs-risk-scheduler .cs-sched-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
                .cs-risk-scheduler .cs-sched-title { font-weight: 800; font-size: 14px; letter-spacing: 0.2px; color: var(--bs-heading-color); }
                html.app-skin-dark .cs-risk-scheduler .cs-sched-title { color: rgba(255,255,255,0.96); }
                .cs-risk-scheduler .cs-sched-sub { font-size: 12px; color: var(--bs-secondary-color); }
                html.app-skin-dark .cs-risk-scheduler .cs-sched-sub { color: rgba(255,255,255,0.74); }
                .cs-risk-scheduler .cs-sched-icon { width: 36px; height: 36px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: rgba(var(--bs-primary-rgb), 0.18); color: var(--bs-primary); box-shadow: 0 10px 22px rgba(0,0,0,0.10); }
                html.app-skin-dark .cs-risk-scheduler .cs-sched-icon { background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.92); box-shadow: none; }
                .cs-risk-scheduler .text-muted { color: var(--bs-secondary-color) !important; }
                html.app-skin-dark .cs-risk-scheduler .text-muted { color: rgba(255,255,255,0.70) !important; }
                .cs-risk-scheduler .form-select { background-color: rgba(255,255,255,0.85); border-color: rgba(var(--bs-primary-rgb), 0.22); border-radius: 10px; height: 30px; padding-top: 2px; padding-bottom: 2px; }
                html.app-skin-dark .cs-risk-scheduler .form-select { background-color: rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.16); color: rgba(255,255,255,0.92); }
                html.app-skin-dark .cs-risk-scheduler .form-select option { color: rgba(255,255,255,0.92); background: #0b1220; }
                .cs-risk-scheduler .btn { box-shadow: 0 8px 18px rgba(0,0,0,0.10); }
                html.app-skin-dark .cs-risk-scheduler .btn { box-shadow: none; }
                .cs-risk-scheduler .cs-sched-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(var(--bs-primary-rgb), 0.16); background: rgba(var(--bs-primary-rgb), 0.06); backdrop-filter: blur(6px); }
                html.app-skin-dark .cs-risk-scheduler .cs-sched-chip { border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); }
                .cs-risk-scheduler .cs-sched-sum svg { color: currentColor !important; }
                .cs-risk-scheduler .cs-sched-sum svg * { stroke: currentColor !important; fill: none !important; }
                .cs-risk-scheduler { --cs-sched-count-size: 14px; }
                .cs-risk-scheduler .cs-sched-count { font-size: var(--cs-sched-count-size); line-height: 1; }

                @media (max-width: 575px) {
                    .cs-risk-scheduler .cs-sched-sub { display: none; }
                    .cs-risk-scheduler .cs-sched-body { flex-direction: column; align-items: center !important; gap: 8px !important; }
                    .cs-risk-scheduler .cs-sched-timing { display: none !important; }
                    .cs-risk-scheduler .cs-sched-sum { display: none !important; }
                    .cs-risk-scheduler .cs-sched-btn-wrap { margin-left: auto !important; margin-top: 10px; }
                }
                .cs-risk-toggle { position: relative; display: inline-flex; align-items: center; }
                .cs-risk-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
                .cs-risk-toggle-ui { width: 46px; height: 24px; border-radius: 999px; background: linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.06)); border: 1px solid rgba(0,0,0,0.14); box-shadow: 0 10px 20px rgba(0,0,0,0.10); position: relative; transition: all 180ms ease; cursor: pointer; display: inline-block; }
                .cs-risk-toggle-ui::before { content: ''; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 999px; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.82)); box-shadow: 0 8px 16px rgba(0,0,0,0.18); transition: all 180ms ease; }
                .cs-risk-toggle-input:checked + .cs-risk-toggle-ui { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 1) 0%, rgba(var(--bs-info-rgb), 0.85) 100%); border-color: rgba(var(--bs-primary-rgb), 0.45); box-shadow: 0 12px 24px rgba(var(--bs-primary-rgb), 0.22); }
                .cs-risk-toggle-input:checked + .cs-risk-toggle-ui::before { left: 25px; }
                .cs-risk-toggle-disabled .cs-risk-toggle-ui { cursor: not-allowed; opacity: 0.6; }
                html.app-skin-dark .cs-risk-toggle-ui { background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06)); border-color: rgba(255,255,255,0.14); }
                html.app-skin-dark .cs-risk-toggle-input:checked + .cs-risk-toggle-ui { box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.16); }
                @keyframes risk-pulse { 0% { box-shadow: 0 0 0 0 rgba(40,167,69,0.5); } 70% { box-shadow: 0 0 0 5px rgba(40,167,69,0); } 100% { box-shadow: 0 0 0 0 rgba(40,167,69,0); } }
                html.app-skin-dark .risk-trend-chart .recharts-cartesian-axis-tick-value { fill: rgba(255,255,255,0.72) !important; }
                html.app-skin-dark .risk-trend-chart .recharts-cartesian-grid line { stroke: rgba(255,255,255,0.10) !important; stroke-opacity: 0.85 !important; }
                html.app-skin-dark .risk-trend-chart .recharts-default-tooltip { background: rgba(10,18,32,0.96) !important; border-color: rgba(255,255,255,0.12) !important; color: rgba(255,255,255,0.92) !important; }
                html.app-skin-dark .risk-trend-chart .recharts-default-tooltip * { color: rgba(255,255,255,0.86) !important; }
                html.app-skin-dark .recharts-tooltip-wrapper .recharts-default-tooltip { background: rgba(10,18,32,0.96) !important; border-color: rgba(255,255,255,0.12) !important; }
                html.app-skin-dark .recharts-tooltip-wrapper .recharts-default-tooltip * { color: rgba(255,255,255,0.86) !important; }
                .MuiChartsLegend-label { color: var(--bs-body-color) !important; fill: var(--bs-body-color) !important; }
                html.app-skin-dark .MuiChartsLegend-label { color: rgba(255,255,255,0.80) !important; fill: rgba(255,255,255,0.80) !important; }
                .risk-zone-table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
                .risk-zone-table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
                .risk-zone-table td { vertical-align: middle; }
                .pm-pill { display: inline-flex; align-items: center; padding: 0.45rem 0.65rem; border-radius: var(--bs-border-radius); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1; }
                .pm-pill-danger  { background: rgba(var(--bs-danger-rgb), 1);  border: 0; color: #fff; }
                .pm-pill-warning { background: rgba(var(--bs-warning-rgb), 1); border: 0; color: #fff; }
                .pm-pill-info    { background: rgba(var(--bs-info-rgb), 1);    border: 0; color: #fff; }
                .pm-pill-success { background: rgba(var(--bs-success-rgb), 1); border: 0; color: #fff; }
            `}</style>
            <div className="card-body py-3 px-3">
                <div className="cs-sched-head">
                    <div className="d-flex align-items-center gap-2">
                        <span className="cs-sched-icon"><FiShield size={16} /></span>
                        <div>
                            <div className="cs-sched-title">Risk Analysis Engine</div>
                            <div className="cs-sched-sub">Zone risk assessment based on PPE, workforce and activity metrics</div>
                        </div>
                    </div>
                    <span className={`badge ${isRunning ? 'bg-soft-warning text-warning' : enabled ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                        {isRunning ? 'RUNNING' : enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                </div>
                <div className="d-flex flex-wrap align-items-center gap-3 cs-sched-body">

                    {/* Row 1: Controls */}
                    <div className="d-flex align-items-center gap-2">
                        <div className="d-flex align-items-center gap-2 cs-sched-chip">
                            <span className="fw-semibold fs-12">Auto-analysis</span>
                            <ToggleSwitch checked={enabled} onChange={e => onToggle(e.target.checked)} disabled={isRunning} />
                            <span className={`badge ${enabled ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>{enabled ? 'ON' : 'OFF'}</span>
                        </div>
                        <div className="d-flex align-items-center gap-1 cs-sched-chip">
                            <span className="text-muted fs-12">Every</span>
                            <SelectDropdown
                                value={String(interval)}
                                options={INTERVAL_OPTIONS_SEC.map(s => ({ value: String(s), label: s < 60 ? `${s}s` : `${s / 60} min` }))}
                                onChange={(v) => onIntervalChange(Number(v))}
                                disabled={isRunning}
                                fullWidth={false} menuMatchTriggerWidth={true} align="center" centerLabel={true} centerItems={true}
                                showCaret={false} direction="down" buttonStyle={{ width: 92, height: 24, paddingTop: 0, paddingBottom: 0, fontSize: '0.8rem' }} enableScroll={false} itemClassName="text-center py-2"
                            />
                        </div>
                    </div>

                    {/* Row 2: Timing info */}
                    <div className="d-flex align-items-center gap-2 flex-wrap cs-sched-timing">
                        <div className="d-flex align-items-center gap-1 cs-sched-chip fs-12">
                            <FiShield size={12} className="opacity-75" />
                            {isRunning
                                ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 10, height: 10 }} /><span>Running…</span></>
                                : lastRunAt
                                    ? <><span className="text-muted">Last checked:</span><span className="fw-semibold ms-1">{fmtRelative(lastRunAt)}</span></>
                                    : <span className="text-muted">Not run yet</span>
                            }
                        </div>
                        {enabled && !isRunning && countdown && (
                            <div className="d-flex align-items-center gap-1 cs-sched-chip fs-12">
                                <FiZap size={12} className="opacity-75" />
                                <span className="text-muted">Next check in:</span>
                                <span className="fw-semibold">{countdown}</span>
                            </div>
                        )}
                    </div>

                    {/* Summary badges */}
                    {summary && !isRunning && (
                        <div className="d-flex align-items-center gap-1 flex-wrap cs-sched-sum">
                            {hasZones && !hasIssues && (
                                <span className="badge bg-soft-success text-success d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{liveZoneCount}</span>
                                    <FiCheckCircle size={14} />
                                </span>
                            )}
                            {(summary.critical_zones ?? 0) > 0 && (
                                <span className="badge bg-soft-danger text-danger d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.critical_zones}</span>
                                    <FiAlertTriangle size={14} />
                                </span>
                            )}
                            {(summary.high_risk_zones ?? 0) > 0 && (
                                <span className="badge bg-soft-warning text-warning d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.high_risk_zones}</span>
                                    <FiAlertTriangle size={14} />
                                </span>
                            )}
                            {(summary.events_generated ?? 0) > 0 && (
                                <span className="badge bg-soft-info text-info d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.events_generated}</span>
                                    <FiZap size={14} />
                                </span>
                            )}
                        </div>
                    )}

                    {/* Action button */}
                    <div className="ms-auto d-flex align-items-center gap-2 cs-sched-btn-wrap">
                        <button className="btn btn-sm btn-success d-flex align-items-center gap-1" onClick={onTriggerNow} disabled={isRunning || loading}>
                            {isRunning
                                ? <><span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} /> Running…</>
                                : loading
                                    ? <><span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} /> Updating…</>
                                    : <><FiZap size={12} /> TRIGGER RISK ANALYSIS</>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Row 1 — Weather card (col-12 full row, premium) ───────────────────────────
function WeatherCard({ weather, loading }) {
    useDark()

    const fmtDayTime = (tsSec) => {
        try {
            const d = tsSec ? new Date(tsSec * 1000) : new Date()
            return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        } catch {
            return '—'
        }
    }
    const fmtAgo = (tsSec) => {
        if (!tsSec) return null
        const diffMin = Math.max(0, Math.round((Date.now() / 1000 - tsSec) / 60))
        if (diffMin <= 1) return 'just now'
        return `${diffMin} min ago`
    }

    if (loading) return (
        <div className="col-12">
            <div className="card">
                <div className="card-body">
                    <PageLoader minHeight={100} />
                </div>
            </div>
        </div>
    )

    if (!weather) return (
        <div className="col-12">
            <div className="card border cs-weather-widget">
                <style>{`
                    .cs-weather-widget { border-color: rgba(0,0,0,0.06) !important; }
                    html.app-skin-dark .cs-weather-widget { border-color: rgba(255,255,255,0.10) !important; }
                    .cs-weather-widget .cs-weather-card {
                        position: relative;
                        width: 100%;
                        padding: 26px 22px;
                        border-radius: 18px;
                        color: #3c4048;
                        background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
                        box-shadow: 0 14px 26px rgba(0,0,0,0.10);
                        overflow: hidden;
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-card {
                        color: rgba(255,255,255,0.92);
                        background: linear-gradient(135deg, rgba(56,189,248,0.22) 0%, rgba(244,114,182,0.18) 100%);
                        box-shadow: none;
                    }
                    .cs-weather-widget .cs-weather-temp {
                        font-size: 88px;
                        font-weight: 800;
                        line-height: 0.9;
                        letter-spacing: -1px;
                        margin: 0;
                        color: inherit;
                    }
                    @media (max-width: 575px) { .cs-weather-widget .cs-weather-temp { font-size: 68px; } }
                    .cs-weather-widget .cs-weather-city { font-size: 30px; font-weight: 700; margin: 0; line-height: 1.1; }
                    .cs-weather-widget .cs-weather-day { font-size: 13px; font-weight: 600; opacity: 0.85; margin: 0; }
                    .cs-weather-widget .cs-weather-desc {
                        display: inline-block;
                        background: rgba(255,255,255,0.86);
                        border-radius: 999px;
                        padding: 6px 12px;
                        color: #7f8487;
                        font-size: 12px;
                        font-weight: 700;
                        margin-top: 6px;
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-desc {
                        background: rgba(15,23,42,0.55);
                        color: rgba(255,255,255,0.78);
                    }
                    .cs-weather-widget .cs-weather-icon {
                        width: 92px;
                        height: 92px;
                        object-fit: contain;
                        filter: drop-shadow(0 10px 20px rgba(0,0,0,0.10));
                    }
                    @media (max-width: 575px) { .cs-weather-widget .cs-weather-icon { width: 74px; height: 74px; } }
                    .cs-weather-widget .cs-weather-icon-wrap {
                        width: 92px;
                        height: 92px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }
                    @media (max-width: 575px) { .cs-weather-widget .cs-weather-icon-wrap { width: 74px; height: 74px; } }
                    .cs-weather-widget .cs-weather-icon-wrap svg {
                        width: 64px;
                        height: 64px;
                        color: rgba(0,0,0,0.70);
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-icon-wrap svg {
                        color: rgba(255,255,255,0.90);
                    }
                    .cs-weather-widget .cs-weather-status {
                        margin-top: 16px;
                        border-radius: 14px;
                        background: transparent;
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-status {
                        background: transparent;
                    }
                    .cs-weather-widget .cs-status-item svg { width: 18px; height: 18px; opacity: 0.92; }
                    .cs-weather-widget .cs-status-item span { font-weight: 800; font-size: 12px; padding-left: 8px; color: inherit; }
                `}</style>
                <div className="card-body p-0">
                    <div className="cs-weather-card">
                        <div className="d-flex flex-row justify-content-center align-items-center flex-wrap">
                            <div className="p-2 text-center">
                                <h2 className="cs-weather-temp">—°</h2>
                            </div>
                            <div className="p-2 text-center">
                                <span className="cs-weather-icon-wrap" aria-label="Weather">
                                    <FiSun size={64} />
                                </span>
                            </div>
                            <div className="p-2 text-center text-sm-start" style={{ minWidth: 220 }}>
                                <h5 className="cs-weather-day">—</h5>
                                <h3 className="cs-weather-city">City Name</h3>
                                <span className="cs-weather-desc">Set project location to enable weather</span>
                            </div>
                        </div>
                        <div className="cs-weather-status d-flex flex-row justify-content-center align-items-center flex-wrap">
                            <div className="p-3 d-flex justify-content-center align-items-center cs-status-item">
                                <IoWaterOutline size={18} />
                                <span>—%</span>
                            </div>
                            <div className="p-3 d-flex justify-content-center align-items-center cs-status-item">
                                <IoSpeedometerOutline size={18} />
                                <span>— mB</span>
                            </div>
                            <div className="p-3 d-flex justify-content-center align-items-center cs-status-item">
                                <IoNavigateOutline size={18} />
                                <span>— km/h</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    const iconCode = weather.icon_code?.slice(0, 2)
    const ConditionIcon = iconCode === '01'
        ? FiSun
        : iconCode === '13'
            ? FiWind
            : iconCode === '50'
                ? FiEye
                : (iconCode === '09' || iconCode === '10')
                    ? FiDroplet
                    : (iconCode === '11')
                        ? FiZap
                        : FiThermometer

    return (
        <div className="col-12">
            <div className="card border mb-3 cs-weather-widget">
                <style>{`
                    .cs-weather-widget.card { background: transparent; border: 0 !important; }
                    .cs-weather-widget { border-color: rgba(0,0,0,0.06) !important; }
                    html.app-skin-dark .cs-weather-widget { border-color: rgba(255,255,255,0.10) !important; }
                    .cs-weather-widget .cs-weather-card {
                        position: relative;
                        width: 100%;
                        padding: 26px 22px;
                        border-radius: 18px;
                        color: #3c4048;
                        background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
                        box-shadow: 0 14px 26px rgba(0,0,0,0.10);
                        overflow: hidden;
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-card {
                        color: rgba(255,255,255,0.92);
                        background: linear-gradient(135deg, rgba(56,189,248,0.22) 0%, rgba(244,114,182,0.18) 100%);
                        box-shadow: none;
                    }
                    .cs-weather-widget .cs-weather-temp {
                        font-size: 88px;
                        font-weight: 800;
                        line-height: 0.9;
                        letter-spacing: -1px;
                        margin: 0;
                        color: inherit;
                    }
                    @media (max-width: 575px) { .cs-weather-widget .cs-weather-temp { font-size: 68px; } }
                    .cs-weather-widget .cs-weather-city { font-size: 30px; font-weight: 700; margin: 0; line-height: 1.1; }
                    .cs-weather-widget .cs-weather-day { font-size: 13px; font-weight: 600; opacity: 0.85; margin: 0; }
                    .cs-weather-widget .cs-weather-desc {
                        display: inline-block;
                        background: rgba(255,255,255,0.86);
                        border-radius: 999px;
                        padding: 6px 12px;
                        color: #7f8487;
                        font-size: 12px;
                        font-weight: 700;
                        margin-top: 6px;
                        max-width: 320px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-desc {
                        background: rgba(15,23,42,0.55);
                        color: rgba(255,255,255,0.78);
                    }
                    .cs-weather-widget .cs-weather-icon {
                        width: 92px;
                        height: 92px;
                        object-fit: contain;
                        filter: drop-shadow(0 10px 20px rgba(0,0,0,0.10));
                        display: block;
                    }
                    @media (max-width: 575px) { .cs-weather-widget .cs-weather-icon { width: 74px; height: 74px; } }
                    .cs-weather-widget .cs-weather-icon-wrap {
                        width: 92px;
                        height: 92px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }
                    @media (max-width: 575px) { .cs-weather-widget .cs-weather-icon-wrap { width: 74px; height: 74px; } }
                    .cs-weather-widget .cs-weather-icon-wrap svg {
                        width: 72px;
                        height: 72px;
                        color: rgba(0,0,0,0.72);
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-icon-wrap svg {
                        color: rgba(255,255,255,0.92);
                    }
                    .cs-weather-widget .cs-weather-status {
                        margin-top: 16px;
                        background: transparent;
                        gap: 26px;
                    }
                    html.app-skin-dark .cs-weather-widget .cs-weather-status {
                        background: transparent;
                    }
                    .cs-weather-widget .cs-status-item { padding: 0 !important; }
                    .cs-weather-widget .cs-status-item svg { width: 16px; height: 16px; opacity: 0.82; }
                    .cs-weather-widget .cs-status-item span { font-weight: 700; font-size: 11px; padding-left: 7px; color: inherit; }
                    .cs-weather-widget .cs-weather-updated {
                        position: absolute;
                        top: 12px;
                        right: 12px;
                        user-select: none;
                    }
                `}</style>
                <div className="card-body p-0">
                    <div className="cs-weather-card">
                        {weather.fetched_at && (
                            <span className="cs-weather-updated badge bg-soft-success text-success fs-11 fw-bold text-uppercase py-1 px-2">
                                Last checked: {fmtAgo(weather.fetched_at)}
                            </span>
                        )}
                        <div className="d-flex flex-row justify-content-center align-items-center flex-wrap">
                            <div className="p-2 text-center">
                                <h2 className="cs-weather-temp">
                                    {weather.temp_c != null ? `${Math.round(weather.temp_c)}°` : '—°'}
                                </h2>
                            </div>
                            <div className="p-2 text-center">
                                <span className="cs-weather-icon-wrap" aria-label={weather.condition || 'Weather'}>
                                    <ConditionIcon />
                                </span>
                            </div>
                            <div className="p-2 text-center text-sm-start" style={{ minWidth: 220 }}>
                                <h5 className="cs-weather-day">{fmtDayTime(weather.fetched_at)}</h5>
                                <h3 className="cs-weather-city">{weather.city || '—'}</h3>
                                <span className="cs-weather-desc">{weather.description || weather.condition || '—'}</span>
                            </div>
                        </div>

                        <div className="cs-weather-status d-flex flex-row justify-content-center align-items-center flex-wrap">
                            <div className="d-flex justify-content-center align-items-center cs-status-item">
                                <IoWaterOutline />
                                <span>{weather.humidity != null ? `${Math.round(weather.humidity)}%` : '—%'}</span>
                            </div>
                            <div className="d-flex justify-content-center align-items-center cs-status-item">
                                <IoSpeedometerOutline />
                                <span>{weather.pressure_hpa != null ? `${Math.round(weather.pressure_hpa)} mB` : '— mB'}</span>
                            </div>
                            <div className="d-flex justify-content-center align-items-center cs-status-item">
                                <IoNavigateOutline />
                                <span>{weather.wind_mps != null ? `${Math.round(weather.wind_mps * 3.6)} km/h` : '— km/h'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Row 2 — Primary KPI Cards (exact PPE pattern) ─────────────────────────────
function getFreshnessSummaryFromZones(zones) {
    const rows = (zones ?? []).map(z => {
        const factors = z?.factors ?? []
        const f = factors.find(x => (x?.factor === 'Data freshness') || (String(x?.factor ?? '').toLowerCase().includes('freshness') && x?.source === 'meta'))
        const detail = String(f?.detail ?? '')

        const confMatch = detail.match(/confidence=([0-9.]+)/i)
        const wfMatch = detail.match(/wf_age_min=([0-9.]+|—)/i)
        const actMatch = detail.match(/act_age_min=([0-9.]+|—)/i)

        const confidence = confMatch ? Number(confMatch[1]) : null
        const wfAgeMin = wfMatch && wfMatch[1] !== '—' ? Number(wfMatch[1]) : null
        const actAgeMin = actMatch && actMatch[1] !== '—' ? Number(actMatch[1]) : null

        return { zoneName: z?.zone_name, confidence, wfAgeMin, actAgeMin }
    }).filter(r => r.confidence != null)

    if (rows.length === 0) return null

    const avg = rows.reduce((a, r) => a + (r.confidence ?? 0), 0) / rows.length
    const minRow = rows.reduce((best, r) => (best == null || (r.confidence ?? 0) < (best.confidence ?? 0) ? r : best), null)

    return {
        avgConfidence: Math.round(avg),
        minConfidence: minRow?.confidence != null ? Math.round(minRow.confidence) : null,
        minZoneName: minRow?.zoneName ?? null,
        minWfAgeMin: minRow?.wfAgeMin ?? null,
        minActAgeMin: minRow?.actAgeMin ?? null,
    }
}

function RiskKPICards({ summary, loading }) {
    const zones = summary?.zones ?? []
    const overallP95 = Math.round(summary?.overall_risk_p95 ?? summary?.overall_risk ?? 0)
    const riskLevel = summary?.risk_level ?? 'low'
    const overallColor = riskLevel === 'critical' ? 'danger' : riskLevel === 'high' ? 'warning' : riskLevel === 'moderate' ? 'info' : 'success'
    const highZones = zones.filter(z => z.risk_level === 'high' || z.risk_level === 'critical').length
    const openAlerts = summary?.open_alerts ?? (summary?.active_signals?.length ?? 0)
    const compoundZones = zones.filter(z => z.compound_risk_flag).length

    const statisticsData = [
        { icon: <FiShield size={24} />,        number: loading ? '—' : `${overallP95}`, title: 'Risk Score',           color: overallColor },
        { icon: <FiAlertTriangle size={24} />, number: loading ? '—' : highZones,       title: 'High-Risk Zones',      color: 'danger' },
        { icon: <FiBell size={24} />,          number: loading ? '—' : openAlerts,      title: 'Open Alerts',          color: 'warning' },
        { icon: <FiLayers size={24} />,        number: loading ? '—' : compoundZones,   title: 'Composite Risk Zones', color: 'primary' },
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

// ── Row 3 — Secondary Metric Cards (exact PPE second-row pattern) ─────────────
function RiskSecondaryCards({ summary, loading }) {
    const zones = summary?.zones ?? []
    const avgSafety       = zones.length ? Math.round(zones.reduce((a, z) => a + (z.safety_risk ?? 0), 0) / zones.length) : 0
    const avgProductivity = zones.length ? Math.round(zones.reduce((a, z) => a + (z.productivity_risk ?? 0), 0) / zones.length) : 0
    const avgDelay        = zones.length ? Math.round(zones.reduce((a, z) => a + (z.delay_risk ?? 0), 0) / zones.length) : 0
    const w = summary?.weather
    const weatherRisk = Math.min(100, Math.round(
        Math.min((w?.rain_1h ?? 0) * 8, 15) +
        ((w?.wind_mps ?? 0) > 10 ? 8 : 0) +
        ((w?.visibility_m ?? 10000) < 3000 ? 10 : 0) +
        Math.min((w?.snow_1h ?? 0) * 8, 15) +
        ((w?.temp_c ?? 20) >= 38 ? 15 : 0) +
        ((w?.temp_c ?? 20) <= 0 ? 10 : 0)
    ))

    const bd = summary?.open_alerts_breakdown ?? {}
    const openPpe = bd.ppe ?? 0
    const openWf  = bd.workforce ?? 0
    const openAct = bd.activity ?? 0

    const items = [
        { icon: 'feather-shield',     title: 'PPE Risk',       count: loading ? '—' : `${avgSafety}/100`,       color: 'primary', openCount: openPpe },
        { icon: 'feather-users',      title: 'Workforce Risk', count: loading ? '—' : `${avgProductivity}/100`, color: 'warning', openCount: openWf },
        { icon: 'feather-activity',   title: 'Activity Risk',  count: loading ? '—' : `${avgDelay}/100`,        color: 'danger',  openCount: openAct },
        { icon: 'feather-cloud-rain', title: 'Weather Risk',   count: loading ? '—' : `${weatherRisk}/100`,     color: 'info',    openCount: null },
    ]

    return (
        <>
            {items.map(({ icon, title, count, color, openCount }, index) => (
                <div key={index} className="col-xxl-3 col-md-6 customer-header-card">
                    <div className="card stretch stretch-full">
                        <div className="card-body">
                            <div className="d-flex align-items-center justify-content-between">
                                <div className="d-flex align-items-center gap-3" style={{ minWidth: 0 }}>
                                    <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                        {React.cloneElement(getIcon(icon) || getIcon('feather-alert-circle'), { size: 17 })}
                                    </div>
                                    <a href="#" className="fw-bold d-block text-reset text-decoration-none" style={{ minWidth: 0 }} onClick={e => e.preventDefault()}>
                                        <span className="text-truncate-1-line">{title}</span>
                                        <span className="fs-24 fw-bolder d-block text-truncate-1-line">{count}</span>
                                        {!loading && openCount !== null && (
                                            <span className="fs-12 text-muted fw-normal d-block">
                                                {openCount.toLocaleString()} open incident{openCount !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </>
    )
}

// ── Row 4 — Risk Trend (exact AreaChart from PPE) ─────────────────────────────
function RiskTrendChart({ trendData, loading, onRefresh }) {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); if (onRefresh) onRefresh() }

    if (loading && !trendData?.length) return (
        <div className="col-xl-8">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Risk Trend" refresh={refresh} expanded={handleExpand} />
                <div className="card-body custom-card-action">
                    <PageLoader minHeight={240} />
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )

    const chartData = (trendData ?? []).map(d => ({
        name: d.recorded_at ? new Date(d.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        ppe_detection: Math.round(d.safety_risk ?? 0),
        workforce_analytics: Math.round(d.productivity_risk ?? 0),
        activity_monitoring: Math.round(d.delay_risk ?? 0),
    }))

    return (
        <div className="col-xl-8" style={{ marginTop: 10, marginLeft: 0 }}>
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Risk Trend" refresh={refresh} expanded={handleExpand} />
                <div className="card-body custom-card-action" style={{ paddingTop: 22 }}>
                    <div className="risk-trend-chart" style={{ marginLeft: -10, marginTop: 8 }}>
                        {chartData.length === 0 ? (
                            <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                                <i className="feather-trending-up fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                                <span className="fw-semibold d-block mb-1">No Trend Data Available</span>
                                <span className="fs-12">Trigger the scheduler to generate risk trend data</span>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={380}>
                                <AreaChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 22 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--bs-border-color)" strokeOpacity={0.65} />
                                    <XAxis dataKey="name" stroke="var(--bs-border-color)" tick={{ fill: 'var(--bs-secondary-color)', fontSize: 11 }} axisLine={{ stroke: 'var(--bs-border-color)' }} tickLine={false} interval={Math.max(0, Math.ceil(chartData.length / 8) - 1)} height={30} />
                                    <YAxis stroke="var(--bs-border-color)" tick={{ fill: 'var(--bs-secondary-color)', fontSize: 11 }} axisLine={{ stroke: 'var(--bs-border-color)' }} tickLine={false} allowDecimals={false} domain={[0, 100]} width={42} />
                                    <ReTooltip
                                        contentStyle={{ backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', borderRadius: '6px', color: 'var(--bs-body-color)', fontSize: 12 }}
                                        labelStyle={{ color: 'var(--bs-body-color)', fontWeight: 600 }}
                                        cursor={{ stroke: 'var(--bs-border-color)', strokeWidth: 1, strokeDasharray: '4 3' }}
                                    />
                                    <Area type="monotone" dataKey="ppe_detection" name="PPE Detection Risk" stroke="#445cf6" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" fill="#445cf6" fillOpacity={0.18} dot={false} activeDot={{ r: 6 }} isAnimationActive />
                                    <Area type="monotone" dataKey="workforce_analytics" name="Workforce Analytics Risk" stroke="#f59e0b" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" fill="#f59e0b" fillOpacity={0.18} dot={false} activeDot={{ r: 6 }} isAnimationActive />
                                    <Area type="monotone" dataKey="activity_monitoring" name="Activity Monitoring Risk" stroke="#dc3545" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" fill="#dc3545" fillOpacity={0.18} dot={false} activeDot={{ r: 6 }} isAnimationActive />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── Row 4 — Risk Composition Donut (exact PPE PieChart) ───────────────────────
function RiskCompositionDonut({ summary, loading, onRefresh }) {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); if (onRefresh) onRefresh() }
    const zones = summary?.zones ?? []

    const avgSafety = zones.length ? zones.reduce((a, z) => a + (z.safety_risk ?? 0), 0) / zones.length : 0
    const avgProd   = zones.length ? zones.reduce((a, z) => a + (z.productivity_risk ?? 0), 0) / zones.length : 0
    const avgDelay  = zones.length ? zones.reduce((a, z) => a + (z.delay_risk ?? 0), 0) / zones.length : 0

    const pieData = [
        { id: 0, label: 'PPE Detection',        value: Math.max(1, Math.round(avgSafety * 0.35)),   color: '#445cf6' },
        { id: 1, label: 'Workforce Analytics',  value: Math.max(1, Math.round(avgProd * 0.25)),     color: '#f59e0b' },
        { id: 2, label: 'Activity Monitoring',  value: Math.max(1, Math.round(avgDelay * 0.40)),    color: '#dc3545' },
    ]

    return (
        <div className="col-xl-4" style={{ marginTop: 10, marginLeft: 0 }}>
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Risk Composition" refresh={refresh} expanded={handleExpand} />
                <div className="card-body py-3 custom-card-action d-flex flex-column align-items-center" style={{ paddingTop: 48 }}>
                    {loading ? (
                        <PageLoader minHeight={220} />
                    ) : zones.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                            <i className="feather-pie-chart fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                            <span className="fw-semibold d-block mb-1">No Composition Data Available</span>
                            <span className="fs-12">Risk breakdown will populate after the first analysis cycle</span>
                        </div>
                    ) : (
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                            <PieChart
                                width={300}
                                height={359}
                                series={[{ data: pieData, innerRadius: 60, arcLabel: () => '', arcLabelMinAngle: 999, valueFormatter: (v) => { const val = typeof v === 'number' ? v : (v && typeof v === 'object' && 'value' in v ? v.value : v); return typeof val === 'number' ? val.toLocaleString() : String(val ?? '') } }]}
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
                                sx={{ '& .MuiPieChart-arcLabel': { fill: 'var(--bs-body-color)', fontWeight: 800, fontSize: 12 }, '& .MuiPieChart-focusIndicator': { stroke: 'transparent' }, '& .MuiPieChart-arc': { stroke: 'transparent' } }}
                            />
                        </div>
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── Row 5 — Gauge card (exact PPE DailySafetyScoreCard pattern) ───────────────
function RiskScoreGauge({ title, score, loading, hasData, onRefresh }) {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); if (onRefresh) onRefresh() }
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('app-skin-dark'))
    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    const getStatusColor = (s) => s >= 60 ? '#28a745' : s >= 40 ? '#ffc107' : '#dc3545'
    const getStatusBadge = (s) => s >= 60 ? 'bg-soft-success text-success' : s >= 40 ? 'bg-soft-warning text-warning' : 'bg-soft-danger text-danger'
    const getStatusLabel = (s) => s >= 60 ? 'Healthy' : s >= 40 ? 'At Risk' : 'Critical'

    const statusColor = getStatusColor(score)
    const statusBadge = getStatusBadge(score)
    const statusLabel = getStatusLabel(score)
    const valueTextColor = isDark ? 'rgba(255,255,255,0.92)' : 'var(--bs-heading-color)'

    return (
        <div className="col-xxl-4 col-md-6">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title={title} refresh={refresh} expanded={handleExpand} />
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
                                    [`& .${gaugeClasses.valueText}`]: { fontSize: 42, fontWeight: 700, transform: 'translate(0px, 0px)', fill: valueTextColor },
                                    [`& .${gaugeClasses.valueText} tspan`]: { fill: valueTextColor },
                                }}
                                text={() => `${score}`}
                            />
                            <span className={`badge ${statusBadge} fs-12 fw-bold text-uppercase`}>{statusLabel}</span>
                        </div>
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── Row 6 — Zone Risk Scatter (exact Workforce DwellUtilScatter style) ────────
function ZoneRiskScatter({ zones, loading, onRefresh }) {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); if (onRefresh) onRefresh() }
    const isDark = useDark()

    const points = useMemo(() => (zones ?? []).map((z, i) => ({
        id: i,
        x: Math.round(z.safety_risk ?? 0),
        y: Math.round(z.productivity_risk ?? 0),
        z: (z.safety_risk ?? 0) + (z.productivity_risk ?? 0),
        label: z.zone_name || `Zone ${i + 1}`,
    })).filter(p => p.x > 0 || p.y > 0), [zones])

    const axisCol = isDark ? 'rgba(255,255,255,.14)' : 'var(--bs-border-color)'
    const tickCol = isDark ? 'rgba(255,255,255,.72)' : 'var(--bs-secondary-color)'
    const gridCol = isDark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.10)'
    const minZ = Math.min(...(points.map(p => p.z).length ? points.map(p => p.z) : [0]))
    const maxZ = Math.max(...(points.map(p => p.z).length ? points.map(p => p.z) : [100]))

    return (
        <div className="col-xl-8">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Zone Risk Scatter" refresh={refresh} expanded={handleExpand} />
                <div className="card-body custom-card-action">
                    {loading && !points.length ? (
                        <PageLoader minHeight={220} />
                    ) : points.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                            <i className="feather-maximize-2 fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                            <span className="fw-semibold d-block mb-1">No Zone Data Available</span>
                            <span className="fs-12">Trigger the scheduler to generate zone risk analysis</span>
                        </div>
                    ) : (
                        <MuiScatterChart
                            height={380}
                            voronoiMaxRadius={8}
                            grid={{ horizontal: true, vertical: true }}
                            series={[{ data: points, valueFormatter: v => v ? `${v.label} · PPE: ${v.x} · Workforce: ${v.y}` : '' }]}
                            xAxis={[{ min: 0, max: 100, label: 'PPE Detection Risk', height: 45, labelStyle: { fill: tickCol, fontSize: 12, fontWeight: 600, transform: 'translateY(6px)' }, colorMap: { type: 'continuous', min: 0, max: 100, color: ['#22c55e', '#dc3545'] } }]}
                            yAxis={[{ min: 0, max: 100, label: 'Workforce Analytics Risk', width: 52, labelStyle: { fill: tickCol, fontSize: 12, fontWeight: 600, angle: -90 }, tickInterval: [0, 25, 50, 75, 100], colorMap: { type: 'continuous', min: 0, max: 100, color: ['#22c55e', '#dc3545'] } }]}
                            zAxis={[{ colorMap: { type: 'continuous', min: minZ, max: maxZ, color: ['#22c55e', '#dc3545'] } }]}
                            slotProps={{
                                legend: { hidden: true },
                                tooltip: { trigger: 'item', sx: { [`& .${chartsTooltipClasses.paper}`]: { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' }, [`& .${chartsTooltipClasses.table} *`]: { color: 'var(--bs-body-color)' }, [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: { backgroundColor: 'rgba(10,18,32,.96)', borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.92)' }, [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: { color: 'rgba(255,255,255,.86)' } } },
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
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── Row 6 — Zone Radar (exact Workforce ZoneRadarChart style) ─────────────────
function ZoneRadarChart({ zones, loading, onRefresh }) {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); if (onRefresh) onRefresh() }
    const isDark = useDark()
    const axisColor = isDark ? 'rgba(255,255,255,.14)' : 'var(--bs-border-color)'
    const gridColor = isDark ? 'rgba(255,255,255,.22)' : 'var(--bs-border-color)'
    const tickColor = isDark ? '#bcbec3' : '#585c5f'
    const palette   = ['#ffc762', '#445cf6', '#22c55e', '#dc3545', '#a855f7', '#06b6d4', '#f97316', '#84cc16']

    const sorted = useMemo(() => [...(zones ?? [])].sort((a, b) => (b.overall_risk ?? 0) - (a.overall_risk ?? 0)).slice(0, 8), [zones])

    const series = useMemo(() => sorted.map((z, i) => ({
        id: `zone-${z.zone_name || i}`,
        label: z.zone_name || `Zone ${i + 1}`,
        data: [
            Math.round(z.safety_risk ?? 0),
            Math.round(z.productivity_risk ?? 0),
            Math.round(z.delay_risk ?? 0),
        ],
        color: palette[i % palette.length],
        fillArea: true,
    })), [sorted])

    return (
        <div className="col-xl-4">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <CardHeader title="Zone Performance Radar" refresh={refresh} expanded={handleExpand} />
                <div className="card-body custom-card-action">
                    {loading && !sorted.length ? (
                        <PageLoader minHeight={220} />
                    ) : sorted.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ minHeight: 220 }}>
                            <i className="feather-target fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                            <span className="fw-semibold d-block mb-1">No Zone Data Available</span>
                            <span className="fs-12">Trigger the scheduler to generate zone analysis</span>
                        </div>
                    ) : (
                        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                            <div style={{ width: '100%', maxWidth: 560 }}>
                                <RadarChart
                                    height={320}
                                    series={series}
                                    radar={{ metrics: ['PPE Detection', 'Workforce Analytics', 'Activity Monitoring'], labelGap: 14 }}
                                    stripeColor={i => i % 2 === 0 ? 'none' : (isDark ? 'rgba(255,255,255,.22)' : 'rgba(15,23,42,.10)')}
                                    margin={{ top: 44, right: 18, bottom: 18, left: 18 }}
                                    slotProps={{
                                        tooltip: { trigger: 'item', sx: { [`& .${chartsTooltipClasses.paper}`]: { backgroundColor: 'var(--bs-body-bg)', border: '1px solid var(--bs-border-color)', color: 'var(--bs-body-color)' }, [`& .${chartsTooltipClasses.table} *`]: { color: 'var(--bs-body-color)' }, [`html.app-skin-dark & .${chartsTooltipClasses.paper}`]: { backgroundColor: 'rgba(10,18,32,.96)', borderColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.92)' }, [`html.app-skin-dark & .${chartsTooltipClasses.table} *`]: { color: 'rgba(255,255,255,.86)' } } },
                                        legend: { direction: 'horizontal', position: { vertical: 'top', horizontal: 'center' }, sx: { '& .MuiChartsLegend-label': { color: tickColor, fill: tickColor, fontSize: 12, fontWeight: 600 }, '& .MuiChartsLegend-mark': { rx: 3, ry: 3 } } },
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
                    )}
                </div>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── Row 7 — Zone Breakdown Table (PPE Advanced Violation Summary style) ────────
function ZoneBreakdownTable({ zones, loading, onRefresh }) {
    const { refreshKey, isExpanded, handleRefresh, handleExpand } = useCardTitleActions()
    const refresh = () => { handleRefresh(); if (onRefresh) onRefresh() }

    const sorted = useMemo(() => [...(zones ?? [])].sort((a, b) => (b.overall_risk ?? 0) - (a.overall_risk ?? 0)), [zones])

    const scoreBadge = (v) => {
        const c = v > 70 ? 'danger' : v > 40 ? 'warning' : 'success'
        return <span className={`badge bg-soft-${c} text-${c} fs-11`}>{Math.round(v)}</span>
    }

    return (
        <div className="col-12">
            <div className={`card stretch stretch-full ${isExpanded ? 'card-expand' : ''} ${refreshKey ? 'card-loading' : ''}`}>
                <div className="card-header">
                    <div>
                        <h5 className="mb-0">Zone Risk Breakdown</h5>
                        <span className="fs-12 text-muted">Comprehensive record of safety violations across monitored zones</span>
                    </div>
                </div>
                <div className="card-body p-0 ppe-incidents-body d-flex flex-column">
                    {loading && !sorted.length ? (
                        <div className="text-center py-5 text-muted">Loading incidents…</div>
                    ) : sorted.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted fs-13" style={{ flex: 1, minHeight: 220 }}>
                            <i className="feather-grid fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                            <span className="fw-semibold d-block mb-1">No Zone Data Available</span>
                            <span className="fs-12">Trigger the scheduler to generate analysis for all project zones</span>
                        </div>
                    ) : (
                        <div className="table-responsive ppe-incidents-responsive">
                            <table className="table table-hover mb-0 align-middle risk-zone-table">
                                <thead>
                                    <tr className="border-b">
                                        <th className="fs-11 text-uppercase ps-4" style={{ letterSpacing: '0.06em' }}>Zone</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>PPE Detection</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Workforce Analytics</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Activity Monitoring</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Open Incidents</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Weather Impact</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em', width: '28%' }}>Details</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Risk Score</th>
                                        <th className="fs-11 text-uppercase text-end" style={{ letterSpacing: '0.06em' }}>Risk Level</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.map((z, i) => {
                                        const rain = z.weather_rain ?? z.rain ?? 0
                                        const condition = z.weather_condition ?? z.condition ?? '—'
                                        const why = buildWhy(z.factors ?? z.factors_json)

                                        const fixedBadge = (v, color) => (
                                            <span className={`badge bg-soft-${color} text-${color} fs-11 fw-bold text-uppercase`}>
                                                {Math.round(v)}
                                            </span>
                                        )

                                        const riskColor = (v) => (v >= 70 ? 'danger' : v >= 40 ? 'warning' : 'success')
                                        const riskScoreBadge = (v) => fixedBadge(v, riskColor(v))

                                        return (
                                            <tr key={z.camera_id ?? i}>
                                                <td className="ps-4">
                                                    {z.zone_name ? (
                                                        <span className="pm-pill pm-pill-warning" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {z.zone_name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted fs-11">—</span>
                                                    )}
                                                </td>
                                                <td>{fixedBadge(z.safety_risk ?? 0, 'danger')}</td>
                                                <td>{fixedBadge(z.productivity_risk ?? 0, 'warning')}</td>
                                                <td>{fixedBadge(z.delay_risk ?? 0, 'info')}</td>
                                                <td>
                                                    {(() => {
                                                        const total = z.open_incidents ?? 0
                                                        if (total === 0) return <span className="text-muted fs-11">—</span>
                                                        return (
                                                            <span className={`badge bg-soft-${total > 5 ? 'danger' : 'warning'} text-${total > 5 ? 'danger' : 'warning'} fs-11`}>
                                                                {total.toLocaleString()} open
                                                            </span>
                                                        )
                                                    })()}
                                                </td>
                                                <td>
                                                    <span className="proj-meta d-inline-flex align-items-center gap-1">
                                                        {condition.toLowerCase().includes('rain') ? (
                                                            <FiCloudRain size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                        ) : condition.toLowerCase().includes('cloud') ? (
                                                            <FiCloud size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                        ) : (
                                                            <FiSun size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                        )}
                                                        <span className="proj-meta-text text-truncate-1-line text-capitalize" style={{ maxWidth: 120 }}>
                                                            {condition}
                                                        </span>
                                                    </span>
                                                    {rain > 0 && (
                                                        <span className="badge bg-soft-info text-info fs-10 ms-1 text-uppercase">{Number(rain).toFixed(1)}mm</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className="proj-meta d-inline-flex align-items-center gap-1" title={why}>
                                                        <FiAlertCircle size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                        <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: '100%' }}>
                                                            {why}
                                                        </span>
                                                    </span>
                                                </td>
                                                <td>
                                                    {riskScoreBadge(z.overall_risk ?? 0)}
                                                </td>
                                                <td className="text-end">
                                                    {(() => {
                                                        const v = z.overall_risk ?? 0
                                                        const c = riskColor(v)
                                                        const label =
                                                            z.risk_level
                                                            ?? (v >= 70 ? 'high' : v >= 40 ? 'medium' : 'low')
                                                        return (
                                                            <span className={`badge bg-soft-${c} text-${c} fs-11 fw-bold text-uppercase`}>
                                                                {label}
                                                            </span>
                                                        )
                                                    })()}
                                                    {z.compound_risk_flag && (
                                                        <span className="badge bg-soft-danger text-danger fs-10 ms-1 text-uppercase">⚡ COMPOUND</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                <style>{`
                    .ppe-incidents-body {
                        transition: none !important;
                    }
                    .ppe-incidents-responsive {
                        transition: none !important;
                        overflow-x: auto !important;
                        overflow-y: visible !important;
                        -webkit-overflow-scrolling: touch;
                    }
                    .ppe-incidents-responsive table,
                    .ppe-incidents-responsive tbody {
                        transition: none !important;
                    }
                    .ppe-incidents-responsive th:first-child,
                    .ppe-incidents-responsive td:first-child {
                        padding-left: 15px !important;
                    }
                    .ppe-incidents-responsive th:last-child,
                    .ppe-incidents-responsive td:last-child {
                        padding-right: 15px !important;
                        text-align: right;
                        white-space: nowrap;
                    }
                `}</style>
                <CardLoader refreshKey={refreshKey} />
            </div>
        </div>
    )
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
import React from 'react'

export default function RiskDashboard({ projectId }) {
    const queryClient = useQueryClient()
    const [schedLoading, setSchedLoading] = useState(false)
    const prevRunningRef       = useRef(false)
    const prevLastRunAtRef     = useRef(null)
    const seenStatusRef        = useRef(false)
    const manualCycleToastRef  = useRef(false)
    const schedStatusRef       = useRef(null)
    const autoToastLastAtRef   = useRef(0)
    const autoToastLastKeyRef  = useRef('')

    // ── Queries ────────────────────────────────────────────────────────────────
    const { data: summary, isLoading: summaryLoading } = useQuery({
        queryKey: QK.riskSummary(projectId),
        queryFn: () => apiGet(`/projects/${projectId}/risk/summary`),
        staleTime: Infinity,
        enabled: !!projectId,
    })

    const { data: trendData, isLoading: trendLoading } = useQuery({
        queryKey: QK.riskTrend(projectId, 'full'),
        queryFn: () => apiGet(`/projects/${projectId}/risk/trend?from_start=true`),
        staleTime: Infinity,
        enabled: !!projectId,
    })

    const { data: schedStatus, isLoading: schedStatusLoading, refetch: refetchSched } = useQuery({
        queryKey: QK.riskSchedulerStatus(projectId),
        queryFn: () => apiGet(`/projects/${projectId}/risk/scheduler/status`).catch(() => null),
        staleTime: 5_000,
        refetchInterval: (query) => (query.state.data?.is_running ? 2000 : 10_000),
        enabled: !!projectId,
    })

    // ── Scheduler-completed side effect: invalidate data queries ───────────────
    useEffect(() => {
        if (!schedStatus) return
        schedStatusRef.current = schedStatus
        const lastRunAt = schedStatus?.last_run_at
        const completedByFlag = prevRunningRef.current && !schedStatus?.is_running
        const completedByTimestamp = seenStatusRef.current && prevLastRunAtRef.current && lastRunAt && lastRunAt !== prevLastRunAtRef.current

        if ((completedByFlag || completedByTimestamp) && seenStatusRef.current) {
            queryClient.invalidateQueries({ queryKey: QK.riskSummary(projectId) })
            queryClient.invalidateQueries({ queryKey: QK.riskTrend(projectId, 2) })
            const s = schedStatus?.last_summary
            if (s) {
                const hasIssues = (s.critical_zones ?? 0) > 0 || (s.high_risk_zones ?? 0) > 0
                const msg = `Risk analysis done: ${s.total_zones ?? 0} zones, ${s.critical_zones ?? 0} critical, ${s.high_risk_zones ?? 0} high`
                if (hasIssues) topTostError(msg)
                else if (manualCycleToastRef.current) topTost(msg)
            }
            manualCycleToastRef.current = false
        }

        prevRunningRef.current = !!schedStatus?.is_running
        if (lastRunAt) prevLastRunAtRef.current = lastRunAt
        seenStatusRef.current = true
    }, [schedStatus, projectId, queryClient])

    // ── Cross-tab sync ─────────────────────────────────────────────────────────
    useEffect(() => {
        return onBroadcast('risk:invalidate', ({ projectId: pid, timestamp, zones, critical_zones, high_risk_zones, overall_risk_p95, overall_risk } = {}) => {
            if (String(pid) !== String(projectId)) return
            queryClient.invalidateQueries({ queryKey: QK.riskSummary(projectId) })
            queryClient.invalidateQueries({ queryKey: QK.riskTrend(projectId, 2) })

            if (!timestamp) return
            if (manualCycleToastRef.current) return

            const enabled = schedStatusRef.current?.enabled ?? true
            if (!enabled) return

            const now = Date.now()
            const score = Math.round((overall_risk_p95 ?? overall_risk ?? 0) || 0)
            const zc = Number.isFinite(zones) ? zones : Number(zones)
            const cz = Number.isFinite(critical_zones) ? critical_zones : Number(critical_zones)
            const hz = Number.isFinite(high_risk_zones) ? high_risk_zones : Number(high_risk_zones)

            const key = `${timestamp}|${score}|${zc}|${cz}|${hz}`
            if (key === autoToastLastKeyRef.current && (now - autoToastLastAtRef.current) < 10_000) return
            if ((now - autoToastLastAtRef.current) < 60_000 && !(cz > 0 || hz > 0)) return

            autoToastLastAtRef.current = now
            autoToastLastKeyRef.current = key

            const when = (() => {
                try { return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
                catch { return '' }
            })()
            const interval = schedStatusRef.current?.interval_seconds ?? null
            const intervalLabel = interval
                ? (interval < 60 ? `${interval}s` : `${Math.round(interval / 60)} min`)
                : null

            const msg = `Auto risk cycle completed · Zones ${zc || 0} · Critical ${cz || 0} · High ${hz || 0}${when ? ` · ${when}` : ''}${intervalLabel ? ` · Interval ${intervalLabel}` : ''}`
            if (cz > 0 || hz > 0) topTostError(msg, 'warning')
            else topTost(msg)
        })
    }, [projectId, queryClient])

    // ── Scheduler actions ──────────────────────────────────────────────────────
    const handleToggle = useCallback(async (enabled) => {
        setSchedLoading(true)
        try {
            const st = await apiPatch(`/projects/${projectId}/risk/scheduler/config`, { enabled })
            refetchSched()
            if (!enabled) {
                topTost('Risk Scheduler paused · Auto-analysis disabled')
            } else {
                const iv = st?.interval_seconds
                const ivLabel = iv ? (iv < 60 ? `${iv}s` : `${Math.round(iv / 60)} min`) : null
                const next = st?.next_run_at ? new Date(st.next_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
                topTost(`Scheduler ${st?.enabled ? 'enabled' : 'disabled'}${ivLabel ? ` · ${ivLabel}` : ''}`)
            }
        } catch (err) { topTostError(parseApiError(err, 'Failed to update scheduler.')) }
        finally { setSchedLoading(false) }
    }, [projectId, refetchSched])

    const handleIntervalChange = useCallback(async (interval_seconds) => {
        setSchedLoading(true)
        try {
            const st = await apiPatch(`/projects/${projectId}/risk/scheduler/config`, { interval_seconds })
            refetchSched()
            const iv = st?.interval_seconds ?? interval_seconds
            const label = iv < 60 ? `${iv}s` : `${Math.round(iv / 60)} min`
            const next = st?.next_run_at ? new Date(st.next_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
            topTost(`Interval set to ${label}${next ? ` · next ${next}` : ''}`)
        } catch (err) { topTostError(parseApiError(err, 'Failed to update interval.')) }
        finally { setSchedLoading(false) }
    }, [projectId, refetchSched])

    const handleTriggerNow = useCallback(async () => {
        setSchedLoading(true)
        try {
            await apiPost(`/projects/${projectId}/risk/scheduler/trigger`, {})
            manualCycleToastRef.current = true
            refetchSched()
            topTost('Risk analysis triggered — updating shortly.')
        } catch (err) {
            if (String(err?.message || '').includes('409')) topTostError('A risk analysis cycle is already running.')
            else topTostError(parseApiError(err, 'Failed to trigger risk analysis'))
        }
        finally { setSchedLoading(false) }
    }, [projectId, refetchSched])

    const invalidateAll = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: QK.riskSummary(projectId) })
        queryClient.invalidateQueries({ queryKey: QK.riskTrend(projectId, 2) })
    }, [projectId, queryClient])

    const zones   = summary?.zones ?? []
    const weather = summary?.weather

    // Zone score averages for gauges
    const avgSafety = zones.length ? Math.round(zones.reduce((a, z) => a + (z.safety_risk ?? 0), 0) / zones.length) : 0
    const avgProd   = zones.length ? Math.round(zones.reduce((a, z) => a + (z.productivity_risk ?? 0), 0) / zones.length) : 0
    const avgDelay  = zones.length ? Math.round(zones.reduce((a, z) => a + (z.delay_risk ?? 0), 0) / zones.length) : 0

    const hasZoneData = zones.length > 0

    return (
        <>
            <RiskLiveAlertToasts projectId={projectId} />
            <div className="row g-3">

                {/* Row 0 — Scheduler bar */}
                <div className="col-12">
                    <RiskSchedulerBar
                        status={schedStatus}
                        onToggle={handleToggle}
                        onIntervalChange={handleIntervalChange}
                        onTriggerNow={handleTriggerNow}
                        loading={schedLoading || schedStatusLoading}
                        liveZoneCount={zones.length}
                    />
                </div>

                {/* Row 1 — Weather (full row) */}
                <WeatherCard weather={weather} loading={summaryLoading} />

                {/* Row 2 — Primary KPI cards */}
                <RiskKPICards summary={summary} loading={summaryLoading} />

                {/* Row 3 — Secondary metric cards */}
                <RiskSecondaryCards summary={summary} loading={summaryLoading} />

                {/* Row 4 — 3 Score cards (moved above graphs) */}
                <RiskScoreGauge title="PPE Score" score={Math.max(0, 100 - avgSafety)} loading={summaryLoading} hasData={hasZoneData} onRefresh={invalidateAll} />
                <RiskScoreGauge title="Workforce Score" score={Math.max(0, 100 - avgProd)} loading={summaryLoading} hasData={hasZoneData} onRefresh={invalidateAll} />
                <RiskScoreGauge title="Activity Score" score={Math.max(0, 100 - avgDelay)} loading={summaryLoading} hasData={hasZoneData} onRefresh={invalidateAll} />

                {/* Row 5 — Risk Trend + Risk Composition */}
                <RiskTrendChart trendData={trendData} loading={trendLoading} onRefresh={invalidateAll} />
                <RiskCompositionDonut summary={summary} loading={summaryLoading} onRefresh={invalidateAll} />

                {/* Row 6 — Scatter + Radar */}
                <ZoneRiskScatter zones={zones} loading={summaryLoading} onRefresh={invalidateAll} />
                <ZoneRadarChart zones={zones} loading={summaryLoading} onRefresh={invalidateAll} />

                {/* Row 7 — Zone Breakdown Table */}
                <ZoneBreakdownTable zones={zones} loading={summaryLoading} onRefresh={invalidateAll} />

            </div>
        </>
    )
}
