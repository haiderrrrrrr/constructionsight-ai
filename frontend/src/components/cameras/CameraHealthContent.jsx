import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import {
    FiActivity, FiAlertCircle, FiCheckCircle,
    FiClock, FiEye, FiMapPin, FiMonitor, FiRefreshCw, FiWifiOff, FiZap,
} from 'react-icons/fi'
import * as XLSX from 'xlsx'
import Table from '@/components/shared/table/Table'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { apiGet, apiPost, apiPatch, apiDelete, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png'

const HEALTH_CONFIG = {
    healthy:     { color: 'bg-soft-success text-success', label: 'Healthy',     icon: <FiCheckCircle size={13} /> },
    degraded:    { color: 'bg-soft-warning text-warning', label: 'Degraded Performance',    icon: <FiAlertCircle size={13} /> },
    offline:     { color: 'bg-soft-danger  text-danger',  label: 'Offline',     icon: <FiWifiOff size={13} />     },
    maintenance: { color: 'bg-soft-info    text-info',    label: 'Maintenance', icon: <FiActivity size={13} />    },
}
const NO_HEALTH = { color: 'bg-gray-200 text-muted', label: 'No Data', icon: <FiActivity size={13} /> }
const getHealthCfg = (s) => HEALTH_CONFIG[s?.toLowerCase()] || NO_HEALTH

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtRelative = (iso) => {
    if (!iso) return null
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (diff < 60)  return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
}

const fmtCountdown = (iso) => {
    if (!iso) return null
    const diff = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000))
    if (diff <= 0) return 'any moment'
    const m = Math.floor(diff / 60)
    const s = diff % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// ── Scheduler status bar ───────────────────────────────────────────────────────
const INTERVAL_OPTIONS = [1, 5, 10, 15, 30, 60]

const ToggleSwitch = ({ checked, onChange, disabled }) => (
    <label className={`cs-fc-toggle ${disabled ? 'cs-fc-toggle-disabled' : ''}`}>
        <input
            className="cs-fc-toggle-input"
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
        />
        <span className="cs-fc-toggle-ui" />
    </label>
)

const SchedulerBar = ({ status, onToggle, onIntervalChange, onTriggerNow, loading }) => {
    const [countdown, setCountdown] = useState('')

    const isRunning  = status?.is_running  ?? false
    const enabled    = status?.enabled     ?? true
    const interval   = status?.interval_minutes ?? 5
    const lastRunAt  = status?.last_run_at
    const summary    = status?.last_summary

    // Compute next_run_at client-side when not provided by server
    const nextRunAt = useMemo(() => {
        if (status?.next_run_at) return status.next_run_at
        if (lastRunAt && interval) {
            return new Date(new Date(lastRunAt).getTime() + interval * 60 * 1000).toISOString()
        }
        return null
    }, [status?.next_run_at, lastRunAt, interval])

    const nextRunAtRef = useRef(nextRunAt)
    useEffect(() => { nextRunAtRef.current = nextRunAt }, [nextRunAt])

    useEffect(() => {
        if (!enabled) { setCountdown(''); return }
        const tick = () => {
            if (!nextRunAtRef.current) { setCountdown(''); return }
            setCountdown(fmtCountdown(nextRunAtRef.current))
        }
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [enabled])

    return (
        <div className="card border mb-3 cs-health-scheduler">
            <style>{`
                .cs-health-scheduler { overflow: visible; position: relative; z-index: 50; }
                .cs-health-scheduler { border-color: rgba(var(--bs-primary-rgb), 0.18) !important; }
                .cs-health-scheduler { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(var(--bs-primary-rgb), 0.05) 55%, rgba(var(--bs-info-rgb), 0.10) 100%); }
                html.app-skin-dark .cs-health-scheduler { border-color: rgba(255,255,255,0.10) !important; }
                html.app-skin-dark .cs-health-scheduler { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.22) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.18) 100%); }
                .cs-health-scheduler { color: var(--bs-body-color); }
                html.app-skin-dark .cs-health-scheduler { color: rgba(255,255,255,0.92); }
                .cs-health-scheduler .cs-sched-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
                .cs-health-scheduler .cs-sched-title { font-weight: 800; font-size: 14px; letter-spacing: 0.2px; color: var(--bs-heading-color); }
                html.app-skin-dark .cs-health-scheduler .cs-sched-title { color: rgba(255,255,255,0.96); }
                .cs-health-scheduler .cs-sched-sub { font-size: 12px; color: var(--bs-secondary-color); }
                html.app-skin-dark .cs-health-scheduler .cs-sched-sub { color: rgba(255,255,255,0.74); }
                .cs-health-scheduler .cs-sched-icon {
                    width: 36px; height: 36px; border-radius: 12px;
                    display: inline-flex; align-items: center; justify-content: center;
                    background: rgba(var(--bs-primary-rgb), 0.18); color: var(--bs-primary);
                    box-shadow: 0 10px 22px rgba(0,0,0,0.10);
                }
                html.app-skin-dark .cs-health-scheduler .cs-sched-icon { background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.92); box-shadow: none; }
                .cs-health-scheduler .text-muted { color: var(--bs-secondary-color) !important; }
                html.app-skin-dark .cs-health-scheduler .text-muted { color: rgba(255,255,255,0.70) !important; }
                .cs-health-scheduler .form-select { background-color: rgba(255,255,255,0.85); }
                .cs-health-scheduler .form-select { border-color: rgba(var(--bs-primary-rgb), 0.22); border-radius: 10px; height: 30px; padding-top: 2px; padding-bottom: 2px; }
                .cs-health-scheduler .form-select:focus { box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.18); border-color: rgba(var(--bs-primary-rgb), 0.34); }
                html.app-skin-dark .cs-health-scheduler .form-select { background-color: rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.16); color: rgba(255,255,255,0.92); }
                html.app-skin-dark .cs-health-scheduler .form-select:focus { box-shadow: 0 0 0 .2rem rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.26); }
                html.app-skin-dark .cs-health-scheduler .form-select option { color: rgba(255,255,255,0.92); background: #0b1220; }
                .cs-health-scheduler .form-check-input { border-color: rgba(var(--bs-primary-rgb), 0.35); }
                .cs-health-scheduler .form-check-input { box-shadow: none !important; }
                .cs-health-scheduler .form-check-input:focus { box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.18) !important; }
                html.app-skin-dark .cs-health-scheduler .form-check-input { border-color: rgba(255,255,255,0.22); background-color: rgba(0,0,0,0.20); }
                html.app-skin-dark .cs-health-scheduler .form-check-input:checked { background-color: var(--bs-primary); border-color: var(--bs-primary); }
                .cs-health-scheduler .btn { box-shadow: 0 8px 18px rgba(0,0,0,0.10); }
                html.app-skin-dark .cs-health-scheduler .btn { box-shadow: none; }
                .cs-health-scheduler .cs-sched-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 10px;
                    border-radius: 999px;
                    border: 1px solid rgba(var(--bs-primary-rgb), 0.16);
                    background: rgba(var(--bs-primary-rgb), 0.06);
                    backdrop-filter: blur(6px);
                }
                html.app-skin-dark .cs-health-scheduler .cs-sched-chip {
                    border-color: rgba(255,255,255,0.10);
                    background: rgba(255,255,255,0.06);
                }
                .cs-health-scheduler .cs-sched-sum svg { color: currentColor !important; }
                .cs-health-scheduler .cs-sched-sum svg * { stroke: currentColor !important; fill: none !important; }
                .cs-health-scheduler .dropdown-menu { z-index: 2000; }
                .cs-health-scheduler { --cs-sched-count-size: 14px; }
                .cs-health-scheduler .cs-sched-count { font-size: var(--cs-sched-count-size); line-height: 1; }

                @media (max-width: 575px) {
                    .cs-health-scheduler .cs-sched-sub { display: none; }
                    .cs-health-scheduler .cs-sched-body { flex-direction: column; align-items: center !important; gap: 8px !important; }
                    .cs-health-scheduler .cs-sched-btn-wrap { margin-left: auto !important; margin-top: 10px; }
                    .cs-health-scheduler .cs-sched-timing { display: none !important; }
                    .cs-health-scheduler .cs-sched-sum { display: none !important; }
                }

                .cs-health-scheduler .cs-fc-toggle { position: relative; display: inline-flex; align-items: center; }
                .cs-health-scheduler .cs-fc-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
                .cs-health-scheduler .cs-fc-toggle-ui {
                    width: 46px;
                    height: 24px;
                    border-radius: 999px;
                    background: linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.06));
                    border: 1px solid rgba(0,0,0,0.14);
                    box-shadow: 0 10px 20px rgba(0,0,0,0.10);
                    position: relative;
                    transition: all 180ms ease;
                    cursor: pointer;
                    display: inline-block;
                }
                .cs-health-scheduler .cs-fc-toggle-ui::before {
                    content: '';
                    position: absolute;
                    top: 3px;
                    left: 3px;
                    width: 18px;
                    height: 18px;
                    border-radius: 999px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.82));
                    box-shadow: 0 8px 16px rgba(0,0,0,0.18);
                    transition: all 180ms ease;
                }
                .cs-health-scheduler .cs-fc-toggle-input:checked + .cs-fc-toggle-ui {
                    background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 1) 0%, rgba(var(--bs-info-rgb), 0.85) 100%);
                    border-color: rgba(var(--bs-primary-rgb), 0.45);
                    box-shadow: 0 12px 24px rgba(var(--bs-primary-rgb), 0.22);
                }
                .cs-health-scheduler .cs-fc-toggle-input:checked + .cs-fc-toggle-ui::before {
                    left: 25px;
                    background: linear-gradient(180deg, rgba(255,255,255,1), rgba(255,255,255,0.86));
                }
                .cs-health-scheduler .cs-fc-toggle-input:focus + .cs-fc-toggle-ui {
                    outline: none;
                    box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.18), 0 12px 24px rgba(0,0,0,0.10);
                }
                .cs-health-scheduler .cs-fc-toggle-disabled .cs-fc-toggle-ui { cursor: not-allowed; opacity: 0.6; box-shadow: none; }
                html.app-skin-dark .cs-health-scheduler .cs-fc-toggle-ui {
                    background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06));
                    border-color: rgba(255,255,255,0.14);
                    box-shadow: none;
                }
                html.app-skin-dark .cs-health-scheduler .cs-fc-toggle-ui::before {
                    background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.74));
                    box-shadow: 0 10px 22px rgba(0,0,0,0.35);
                }
                html.app-skin-dark .cs-health-scheduler .cs-fc-toggle-input:checked + .cs-fc-toggle-ui { box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.16); }
            `}</style>
            <div className="card-body py-3 px-3">
                <div className="cs-sched-head">
                    <div className="d-flex align-items-center gap-2">
                        <span className="cs-sched-icon"><FiActivity size={16} /></span>
                        <div>
                            <div className="cs-sched-title">Health Check Scheduler</div>
                            <div className="cs-sched-sub">Automatically monitor camera health and run checks on demand</div>
                        </div>
                    </div>
                    <span className={`badge ${isRunning ? 'bg-soft-warning text-warning' : enabled ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                        {isRunning ? 'RUNNING' : enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                </div>
                <div className="d-flex flex-wrap align-items-center gap-3 cs-sched-body">

                    {/* Row 1: Controls — toggle + interval stay together on mobile */}
                    <div className="d-flex align-items-center gap-2">
                        {/* Auto-check toggle */}
                        <div className="d-flex align-items-center gap-2 cs-sched-chip">
                            <span className="fw-semibold fs-12">Auto-check</span>
                            <ToggleSwitch checked={enabled} onChange={e => onToggle(e.target.checked)} disabled={isRunning} />
                            <span className={`badge ${enabled ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                                {enabled ? 'ON' : 'OFF'}
                            </span>
                        </div>

                        {/* Interval picker */}
                        <div className="d-flex align-items-center gap-1 cs-sched-chip">
                            <span className="text-muted fs-12">Every</span>
                            <SelectDropdown
                                value={interval}
                                options={INTERVAL_OPTIONS.map(m => ({
                                    value: String(m),
                                    label: m < 60 ? `${m} min` : '1 hr',
                                }))}
                                onChange={(v) => onIntervalChange(Number(v))}
                                disabled={isRunning}
                                fullWidth={false}
                                menuMatchTriggerWidth={true}
                                align="center"
                                centerLabel={true}
                                centerItems={true}
                                showCaret={false}
                                direction="down"
                                buttonStyle={{ width: 92, height: 24, paddingTop: 0, paddingBottom: 0, fontSize: '0.8rem' }}
                                enableScroll={false}
                                itemClassName="text-center py-2"
                            />
                        </div>
                    </div>

                    {/* Row 2: Timing info — last checked + countdown stay together on mobile */}
                    <div className="d-flex align-items-center gap-2 flex-wrap cs-sched-timing">
                        {/* Last run */}
                        <div className="d-flex align-items-center gap-1 cs-sched-chip fs-12">
                            <FiClock size={12} className="opacity-75" />
                            {isRunning
                                ? <><span className="spinner-border spinner-border-sm me-1" style={{ width: 10, height: 10 }} /><span>Running…</span></>
                                : lastRunAt
                                    ? <><span className="text-muted">Last checked:</span><span className="fw-semibold ms-1">{fmtRelative(lastRunAt)}</span></>
                                    : <span className="text-muted">Not run yet</span>
                            }
                        </div>

                        {/* Next run countdown */}
                        {enabled && !isRunning && countdown && (
                            <div className="d-flex align-items-center gap-1 cs-sched-chip fs-12">
                                <FiZap size={12} className="opacity-75" />
                                <span className="text-muted">Next check in:</span>
                                <span className="fw-semibold">{countdown}</span>
                            </div>
                        )}
                    </div>

                    {/* Last summary badges */}
                    {summary && !isRunning && (
                        <div className="d-flex align-items-center gap-1 flex-wrap cs-sched-sum">
                            {summary.healthy  > 0 && (
                                <span className="badge bg-soft-success text-success d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.healthy}</span><FiCheckCircle size={14} />
                                </span>
                            )}
                            {summary.degraded > 0 && (
                                <span className="badge bg-soft-warning text-warning d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.degraded}</span><FiAlertCircle size={14} />
                                </span>
                            )}
                            {summary.offline  > 0 && (
                                <span className="badge bg-soft-danger text-danger d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.offline}</span><FiWifiOff size={14} />
                                </span>
                            )}
                            {summary.maintenance > 0 && (
                                <span className="badge bg-soft-info text-info d-inline-flex align-items-center gap-1 fs-12 py-1 px-2">
                                    <span className="fw-bold cs-sched-count">{summary.maintenance}</span><FiActivity size={14} />
                                </span>
                            )}
                            {summary.errors   > 0 && <span className="badge bg-soft-secondary text-muted">{summary.errors} err</span>}
                            {summary.skipped  > 0 && <span className="badge bg-soft-secondary text-muted">{summary.skipped} skip</span>}
                        </div>
                    )}

                    {/* Action button — right-aligned on desktop, full-width on mobile */}
                    <div className="ms-auto d-flex align-items-center gap-2 cs-sched-btn-wrap">
                        <button
                            className="btn btn-sm btn-success d-flex align-items-center gap-1"
                            onClick={onTriggerNow}
                            disabled={isRunning || loading}
                            title="Run auto-check cycle immediately"
                        >
                            {isRunning
                                ? <><span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} /> Running…</>
                                : loading
                                    ? <><span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} /> Updating…</>
                                    : <><FiZap size={12} /> TRIGGER HEALTH CHECK</>
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Main component ─────────────────────────────────────────────────────────────
const CameraHealthContent = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const [rows, setRows]             = useState([])
    const [loading, setLoading]       = useState(true)
    const [checkingId, setCheckingId] = useState(null)
    const [confirm, setConfirm]       = useState(null)
    const [acting, setActing]         = useState(false)
    const [total, setTotal]           = useState(0)
    const [schedulerStatus, setSchedulerStatus] = useState(null)
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    // Track prev is_running to detect when a cycle just finished
    const prevRunningRef = useRef(false)
    const prevLastRunAtRef = useRef(null)
    const seenStatusRef = useRef(false)
    const shortPollIdRef = useRef(null)
    const manualCycleToastRef = useRef(false)

    // ── Load health table ──────────────────────────────────────────────────────
    const load = () => {
        setLoading(true)
        apiGet('/admin/cameras/health')
            .then(data => {
                const nextRows = Array.isArray(data?.rows) ? data.rows : []
                const nextTotal = Number(data?.total ?? nextRows.length ?? 0)
                setRows(nextRows)
                setTotal(nextTotal)

                const norm = (v) => String(v || '').toLowerCase()
                const by = (key) => nextRows.filter(r => norm(r.health_status) === key).length
                broadcastRefresh('cs:cameras-health-stats', {
                    total: nextTotal,
                    healthy: by('healthy'),
                    degraded: by('degraded'),
                    offline: by('offline'),
                    maintenance: by('maintenance'),
                })
            })
            .catch(() => topTostError('Failed to load health data.'))
            .finally(() => setLoading(false))
    }

    // ── Scheduler status polling (every 10 s) ──────────────────────────────────
    const fetchSchedulerStatus = () => {
        apiGet('/admin/cameras/scheduler/status')
            .then(data => {
                setSchedulerStatus(data)
                const lastRunAt = data?.last_run_at
                const completedByFlag = prevRunningRef.current && !data.is_running
                const completedByTimestamp = (
                    seenStatusRef.current &&
                    prevLastRunAtRef.current &&
                    lastRunAt &&
                    lastRunAt !== prevLastRunAtRef.current
                )

                if ((completedByFlag || completedByTimestamp) && seenStatusRef.current) {
                    load()
                    const s = data.last_summary
                    if (s) {
                        const hasIssues = (s.offline ?? 0) > 0 || (s.degraded ?? 0) > 0
                        const msg = `Auto-check done: ${s.healthy ?? 0} healthy, ${s.degraded ?? 0} degraded, ${s.offline ?? 0} offline`
                        if (hasIssues) {
                            topTostError(msg)
                        } else if (manualCycleToastRef.current) {
                            topTost(msg)
                        }
                    }
                    manualCycleToastRef.current = false
                }
                prevRunningRef.current = !!data.is_running
                if (lastRunAt) prevLastRunAtRef.current = lastRunAt
                seenStatusRef.current = true
            })
            .catch(() => {}) // silent — scheduler status is non-critical
    }

    useEffect(() => {
        load()
        fetchSchedulerStatus()
        const id = setInterval(fetchSchedulerStatus, 5_000)
        // Reload when cameras are added/archived/verified from another tab
        window.addEventListener('cs:cameras-stats-refresh', load)
        const unsubBroadcast = onBroadcast('cs:cameras-stats-refresh', load)
        return () => {
            clearInterval(id)
            if (shortPollIdRef.current) {
                clearInterval(shortPollIdRef.current)
                shortPollIdRef.current = null
            }
            window.removeEventListener('cs:cameras-stats-refresh', load)
            unsubBroadcast()
        }
    }, [])

    // ── Scheduler controls ─────────────────────────────────────────────────────
    const [schedOperating, setSchedOperating] = useState(false)

    const handleToggle = async (enabled) => {
        setSchedOperating(true)
        try {
            const data = await apiPatch('/admin/cameras/scheduler/config', { enabled })
            setSchedulerStatus(data)
            topTost(enabled ? 'Auto health checks enabled.' : 'Auto health checks disabled.')
        } catch {
            topTostError('Failed to update scheduler.')
        } finally {
            setSchedOperating(false)
        }
    }

    const handleIntervalChange = async (interval_minutes) => {
        setSchedOperating(true)
        try {
            const data = await apiPatch('/admin/cameras/scheduler/config', { interval_minutes })
            setSchedulerStatus(data)
            topTost(`Auto-check interval set to ${interval_minutes} min.`)
        } catch {
            topTostError('Failed to update interval.')
        } finally {
            setSchedOperating(false)
        }
    }

    const handleTriggerNow = async () => {
        try {
            await apiPost('/admin/cameras/scheduler/trigger', {})
            topTost('Health-check cycle triggered — results will update shortly.')
            manualCycleToastRef.current = true
            fetchSchedulerStatus()
            if (shortPollIdRef.current) {
                clearInterval(shortPollIdRef.current)
                shortPollIdRef.current = null
            }
            const startLastRunAt = prevLastRunAtRef.current
            let attempts = 0
            shortPollIdRef.current = setInterval(() => {
                attempts += 1
                fetchSchedulerStatus()
                const cur = prevLastRunAtRef.current
                if ((startLastRunAt && cur && cur !== startLastRunAt) || (!startLastRunAt && cur)) {
                    clearInterval(shortPollIdRef.current)
                    shortPollIdRef.current = null
                } else if (attempts >= 20) {
                    clearInterval(shortPollIdRef.current)
                    shortPollIdRef.current = null
                }
            }, 1_000)
        } catch (err) {
            if (err?.status === 409 || /already running/i.test(err?.message)) {
                topTostError('A health-check cycle is already running.')
            } else {
                topTostError(parseApiError(err, 'Failed to trigger health check'))
            }
        }
    }

    // ── Individual camera health check ─────────────────────────────────────────
    const handleHealthCheck = async (cameraId, cameraName) => {
        setCheckingId(cameraId)
        try {
            await apiPost(`/admin/cameras/${cameraId}/health-check`, {})
            topTost(`Health check done for "${cameraName}".`)
            load()
        } catch (err) {
            if (err?.status === 409 || /already in progress/i.test(err?.message)) {
                topTostError(`"${cameraName}" is already being checked by auto-scheduler — try again shortly.`)
            } else {
                topTostError(parseApiError(err, `Health check failed for "${cameraName}"`))
            }
        } finally {
            setCheckingId(null)
        }
    }

    // ── Confirm modals ─────────────────────────────────────────────────────────
    const closeConfirm = () => { if (!acting) setConfirm(null) }
    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try {
            await confirm.onConfirm()
            // Note: dialog closing is now handled inside individual onConfirm handlers
        } catch (err) {
            // Error handling is now done inside individual onConfirm handlers
            console.error('Confirm action error:', err)
        } finally {
            setActing(false)
        }
    }

    const askArchive = (row) => setConfirm({
        variant: 'archive',
        title: 'Archive Camera',
        message: `"${row.camera_name}" will be archived and hidden from active use. You can restore it later`,
        onConfirm: async () => {
            try {
                await apiPost(`/admin/cameras/${row.camera_id}/archive`, {})
                topTost(`"${row.camera_name}" archived successfully.`)
                load()
                setConfirm(null)  // ← Close dialog after success
            } catch (err) {
                topTostError(parseApiError(err, `Failed to archive "${row.camera_name}"`))
            }
        },
    })

    const askDelete = (row) => setConfirm({
        variant: 'delete',
        title: 'Delete Camera',
        message: `Permanently delete "${row.camera_name}"? This will also remove verification records, health logs, and zone polygons. This action cannot be undone`,
        onConfirm: async () => {
            try {
                await apiDelete(`/admin/cameras/${row.camera_id}`)
                topTost(`"${row.camera_name}" deleted successfully.`)
                load()
                setConfirm(null)  // ← Close dialog after success
            } catch (err) {
                topTostError(parseApiError(err, `Failed to delete "${row.camera_name}"`))
            }
        },
    })

    // ── Table columns ──────────────────────────────────────────────────────────
    const rowsWithDerived = useMemo(() => {
        return (rows || []).map(r => {
            const cfg = getHealthCfg(r.health_status)
            const label = cfg?.label || 'No Data'
            return {
                ...r,
                health_status_label: label,
                health_status_label_short: label.replace('Degraded Performance', 'Degraded'),
            }
        })
    }, [rows])

    const columns = [
        {
            accessorKey: 'camera_name',
            header: () => 'Camera',
            cell: (info) => {
                const row = info.row.original
                const logoSrc = row.logo_url || DEFAULT_CAMERA_LOGO
                return (
                    <Link to={`/admin/cameras/${row.camera_id}/verify`} className="hstack gap-3 text-decoration-none">
                        <div className="flex-shrink-0 cam-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={logoSrc} alt={row.camera_name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
                        </div>
                        <div>
                            <span className="fw-semibold d-block text-truncate-1-line">{row.camera_name || 'Not set'}</span>
                            {row.serial_number && <small className="fs-12 fw-normal text-muted">S/N: {row.serial_number}</small>}
                        </div>
                    </Link>
                )
            },
        },
        {
            accessorKey: 'site_name',
            header: () => 'Site Location',
            cell: (info) => {
                const name = info.getValue()
                return name
                    ? (
                        <span className="cam-meta">
                            <FiMapPin size={12} className="opacity-75" />
                            <span className="cam-meta-text text-truncate-1-line" style={{ maxWidth: 220 }}>{name}</span>
                        </span>
                    )
                    : <span className="text-muted">—</span>
            },
            meta: { className: 'cam-health-col-site' },
        },
        {
            accessorKey: 'health_status',
            header: () => 'Health Status',
            cell: (info) => {
                const cfg = getHealthCfg(info.getValue())
                const icon = cfg.icon ? React.cloneElement(cfg.icon, { className: 'cam-health-icon' }) : null
                return (
                    <div className={`badge d-inline-flex align-items-center gap-1 fs-11 fw-bold text-uppercase cam-health-badge ${cfg.color}`}>
                        {icon}{cfg.label}
                    </div>
                )
            },
        },
        {
            accessorKey: 'latency_ms',
            header: () => 'Latency',
            cell: (info) => {
                const row = info.row.original
                const hs = String(row?.health_status || '').toLowerCase()
                if (!hs || hs === 'offline') return <span className="text-muted fs-12">—</span>
                const v = info.getValue()
                if (v == null) return <span className="text-muted fs-12">—</span>
                const ms = Number(v)
                return (
                    <span className="badge bg-primary text-white fs-12 cam-meta cam-metric-badge">
                        <FiZap size={12} />
                        <span className="cam-meta-text">{`${ms.toFixed(0)} ms`}</span>
                    </span>
                )
            },
        },
        {
            accessorKey: 'fps_detected',
            header: () => 'FPS',
            cell: (info) => {
                const row = info.row.original
                const hs = String(row?.health_status || '').toLowerCase()
                if (!hs || hs === 'offline') return <span className="text-muted fs-12">—</span>
                const v = info.getValue()
                if (v == null) return <span className="text-muted fs-12">—</span>
                const fps = Number(v)
                return (
                    <span className="badge bg-warning text-white fs-12 cam-meta cam-metric-badge">
                        <FiActivity size={12} />
                        <span className="cam-meta-text">{`${fps} fps`}</span>
                    </span>
                )
            },
        },
        {
            accessorKey: 'resolution_detected',
            header: () => 'Resolution',
            cell: (info) => {
                const row = info.row.original
                const hs = String(row?.health_status || '').toLowerCase()
                if (!hs || hs === 'offline') return <span className="text-muted fs-12">—</span>
                const v = info.getValue()
                return v
                    ? (
                        <span className="cam-meta">
                            <FiMonitor size={12} className="opacity-75" />
                            <span className="cam-meta-text">{v}</span>
                        </span>
                    )
                    : <span className="text-muted fs-12">—</span>
            },
            meta: { className: 'cam-health-col-resolution' },
        },
        {
            accessorKey: 'checked_at',
            header: () => 'Last Health Check',
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="cam-meta" title={new Date(v).toLocaleString()}>
                            <FiClock size={12} className="opacity-75" />
                            <span className="cam-meta-text">{fmtRelative(v)}</span>
                        </span>
                    )
                    : <span className="text-muted fs-12">—</span>
            },
            meta: { headerClassName: 'cam-health-col-lastchecked', className: 'cam-health-col-lastchecked' },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            cell: (info) => {
                const row = info.row.original
                const isChecking = checkingId === row.camera_id
                const busyAll    = schedulerStatus?.is_running ?? false
                return (
                    <div className="hstack gap-2 justify-content-end">
                        <Link to={`/admin/cameras/${row.camera_id}/verify`} className="avatar-text avatar-md" title="View">
                            <FiEye />
                        </Link>
                        <button
                            className="avatar-text avatar-md border-0 bg-transparent"
                            title={busyAll ? 'Auto-check running — wait for it to finish' : 'Run health check'}
                            onClick={() => handleHealthCheck(row.camera_id, row.camera_name)}
                            disabled={isChecking || busyAll}
                        >
                            {isChecking
                                ? <span className="spinner-border spinner-border-sm" style={{ width: 14, height: 14 }} />
                                : <FiRefreshCw size={14} />}
                        </button>
                    </div>
                )
            },
            enableSorting: false,
            meta: { headerClassName: 'text-end cam-health-col-actions', className: 'text-end cam-health-col-actions', headerAlign: 'end' },
        },
    ]

    const filteredRows = useMemo(() => {
        const norm = (v) => String(v || '').toLowerCase()
        if (!activeFilter || activeFilter === 'all') return rowsWithDerived
        if (activeFilter === 'no data' || activeFilter === 'no_data') {
            return rowsWithDerived.filter(r => !r.health_status)
        }
        return rowsWithDerived.filter(r => norm(r.health_status) === activeFilter)
    }, [rowsWithDerived, activeFilter])

    const filteredRowsExportRef = useRef([])
    const activeFilterExportRef = useRef('all')
    filteredRowsExportRef.current = filteredRows
    activeFilterExportRef.current = activeFilter

    const exportFile = (data, activeFilterRef, format) => {
        const fmtDateTime = (v) => {
            if (!v) return ''
            try {
                return new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Karachi',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                }).format(new Date(v))
            } catch {
                return String(v)
            }
        }

        const filterLabel = (() => {
            const map = {
                all: 'All Cameras',
                healthy: 'Healthy',
                degraded: 'Degraded',
                offline: 'Offline',
                maintenance: 'Maintenance',
            }
            return map[String(activeFilterRef || 'all')] || 'All Cameras'
        })()

        const headers = ['Camera', 'Site', 'Health Status', 'Latency (ms)', 'FPS', 'Resolution', 'Last Checked']
        const toRow = (r) => [
            r.camera_name || '',
            r.site_name || '',
            (getHealthCfg(r.health_status)?.label || 'No Data').replace('Degraded Performance', 'Degraded'),
            (r.latency_ms ?? '') === '' ? '' : String(r.latency_ms ?? ''),
            (r.fps_detected ?? '') === '' ? '' : String(r.fps_detected ?? ''),
            r.resolution_detected || '',
            fmtDateTime(r.checked_at),
        ]

        const triggerDownload = (blob, filename) => {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            a.click()
            URL.revokeObjectURL(url)
        }

        const pkDateStamp = (d = new Date()) => {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Karachi',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(d)
            const get = (type) => parts.find(p => p.type === type)?.value
            return `${get('year')}-${get('month')}-${get('day')}`
        }
        const pkDateTimeLabel = (d = new Date()) =>
            new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Karachi',
                dateStyle: 'long',
                timeStyle: 'short',
            }).format(d) + ' PKT'

        const today = pkDateStamp()
        const kind = String(format || 'csv').toLowerCase()

        if (kind === 'pdf') {
            const token = window.sessionStorage.getItem('access_token')
            fetch(`${API_BASE}/admin/cameras/health/export/pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
            })
                .then(res => {
                    if (!res.ok) throw new Error('PDF generation failed')
                    return res.blob()
                })
                .then(blob => triggerDownload(blob, `Camera_Health_Export_${today}.pdf`))
                .catch(() => topTostError('Failed to generate PDF export.'))
            return
        }

        if (kind === 'print') {
            const token = window.sessionStorage.getItem('access_token')
            fetch(`${API_BASE}/admin/cameras/health/export/pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
            })
                .then(res => {
                    if (!res.ok) throw new Error('PDF generation failed')
                    return res.blob()
                })
                .then(blob => {
                    const url = URL.createObjectURL(blob)
                    window.open(url, '_blank')
                    setTimeout(() => URL.revokeObjectURL(url), 60000)
                })
                .catch(() => topTostError('Failed to generate print PDF.'))
            return
        }

        if (kind === 'csv') {
            const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
            const genTs = pkDateTimeLabel()
            const meta = [
                ['ConstructionSight AI — Camera Health Report'],
                [`Filter:,${filterLabel}`],
                [`Generated:,${genTs}`],
                [`Total Records:,${data.length}`],
                [],
                headers.map(esc).join(','),
                ...data.map(r => toRow(r).map(esc).join(',')),
            ]
            triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Camera_Health_Export_${today}.csv`)
            return
        }

        if (kind === 'xml') {
            const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            const genTs = pkDateTimeLabel()
            const nodes = data.map(r => {
                const rr = toRow(r)
                return [
                    `  <camera>`,
                    `    <name>${esc(rr[0])}</name>`,
                    `    <site>${esc(rr[1])}</site>`,
                    `    <health_status>${esc(rr[2])}</health_status>`,
                    `    <latency_ms>${esc(rr[3])}</latency_ms>`,
                    `    <fps>${esc(rr[4])}</fps>`,
                    `    <resolution>${esc(rr[5])}</resolution>`,
                    `    <last_checked>${esc(rr[6])}</last_checked>`,
                    `  </camera>`,
                ].join('\n')
            }).join('\n')
            const xml = [
                `<?xml version="1.0" encoding="UTF-8"?>`,
                `<report>`,
                `  <metadata>`,
                `    <title>ConstructionSight AI — Camera Health Report</title>`,
                `    <filter>${esc(filterLabel)}</filter>`,
                `    <generated_at>${genTs}</generated_at>`,
                `    <total_records>${data.length}</total_records>`,
                `    <exported_by>Administrator</exported_by>`,
                `  </metadata>`,
                `  <cameras>`,
                nodes,
                `  </cameras>`,
                `</report>`,
            ].join('\n')
            triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Camera_Health_Export_${today}.xml`)
            return
        }

        if (kind === 'text') {
            const genTs = pkDateTimeLabel()
            const allRows = data.map(r => toRow(r))
            const colWidths = headers.map((h, i) =>
                Math.min(40, Math.max(h.length, ...allRows.map(rr => String(rr[i] ?? '').length)))
            )
            const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
            const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
            const rowLine = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
            const reportWidth = sep.length
            const center = (s) => { const p = Math.max(0, Math.floor((reportWidth - s.length) / 2)); return ' '.repeat(p) + s }
            const lines = [
                '='.repeat(reportWidth),
                center('CONSTRUCTIONSIGHT AI'),
                center('Camera Health Report'),
                center(`Filter: ${filterLabel}`),
                center(`Generated: ${genTs}`),
                center(`Total Records: ${data.length}`),
                '='.repeat(reportWidth),
                '',
                sep,
                rowLine(headers),
                sep,
                ...allRows.map(r => rowLine(r)),
                sep,
                '',
                `Report generated by ConstructionSight AI. CONFIDENTIAL — authorised personnel only.`,
            ]
            triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `Camera_Health_Export_${today}.txt`)
            return
        }

        if (kind === 'excel') {
            const genTs = pkDateTimeLabel()
            const wb = XLSX.utils.book_new()
            const sheetData = [
                ['ConstructionSight AI — Camera Health Report'],
                [`Filter: ${filterLabel}`],
                [`Generated: ${genTs}`],
                [`Total Records: ${data.length}`],
                [],
                headers,
                ...data.map(r => toRow(r)),
            ]
            const ws = XLSX.utils.aoa_to_sheet(sheetData)
            ws['!cols'] = [
                { wch: 26 },
                { wch: 22 },
                { wch: 16 },
                { wch: 12 },
                { wch: 10 },
                { wch: 16 },
                { wch: 18 },
            ]
            ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }]

            const NAVY = '1e3a5f'
            const BLUE = '3b5bdb'
            const WHITE = 'ffffff'
            const LIGHT = 'f1f5f9'
            const ALT = 'f8fafc'

            const titleCell = ws['A1']
            if (titleCell) {
                titleCell.s = {
                    font: { bold: true, sz: 14, color: { rgb: WHITE } },
                    fill: { fgColor: { rgb: NAVY } },
                    alignment: { horizontal: 'center', vertical: 'center' },
                }
            }

            ;['A2', 'A3', 'A4'].forEach(addr => {
                const cell = ws[addr]
                if (cell) cell.s = {
                    font: { italic: true, sz: 10, color: { rgb: '374151' } },
                    fill: { fgColor: { rgb: LIGHT } },
                }
            })

            headers.forEach((_, ci) => {
                const addr = XLSX.utils.encode_cell({ r: 5, c: ci })
                const cell = ws[addr]
                if (cell) cell.s = {
                    font: { bold: true, sz: 10, color: { rgb: WHITE } },
                    fill: { fgColor: { rgb: NAVY } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                    border: {
                        bottom: { style: 'thin', color: { rgb: BLUE } },
                        right: { style: 'thin', color: { rgb: BLUE } },
                    },
                }
            })

            const HEALTH_COLORS = {
                healthy: { bg: 'dcfce7', fg: '15803d' },
                degraded: { bg: 'fef3c7', fg: 'b45309' },
                offline: { bg: 'fee2e2', fg: 'b91c1c' },
                maintenance: { bg: 'e0f2fe', fg: '0369a1' },
                no_data: { bg: 'f1f5f9', fg: '6b7280' },
            }

            data.forEach((r, ri) => {
                const rowBg = ri % 2 === 0 ? WHITE : ALT
                headers.forEach((_, ci) => {
                    const addr = XLSX.utils.encode_cell({ r: ri + 6, c: ci })
                    const cell = ws[addr]
                    if (!cell) return
                    const isHealthCol = ci === 2
                    const key = String(r.health_status || '').toLowerCase() || 'no_data'
                    const sc = isHealthCol ? (HEALTH_COLORS[key] || HEALTH_COLORS.no_data) : null
                    cell.s = {
                        font: { sz: 9, bold: isHealthCol, color: { rgb: sc ? sc.fg : '111827' } },
                        fill: { fgColor: { rgb: sc ? sc.bg : rowBg } },
                        alignment: { vertical: 'center', wrapText: false },
                        border: {
                            bottom: { style: 'hair', color: { rgb: 'd1d5db' } },
                            right: { style: 'hair', color: { rgb: 'd1d5db' } },
                        },
                    }
                })
            })

            ws['!rows'] = [
                { hpt: 28 },
                { hpt: 16 },
                { hpt: 16 },
                { hpt: 16 },
                { hpt: 6 },
                { hpt: 20 },
                ...data.map(() => ({ hpt: 16 })),
            ]

            XLSX.utils.book_append_sheet(wb, ws, 'Health')
            const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
            triggerDownload(
                new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                `Camera_Health_Export_${today}.xlsx`
            )
        }
    }

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail?.page && e.detail.page !== 'health') return
            exportFile(filteredRowsExportRef.current, activeFilterExportRef.current, e?.detail?.format)
        }
        window.addEventListener('cs:cameras-export', handler)
        return () => window.removeEventListener('cs:cameras-export', handler)
    }, [])

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="col-12">
            {loading ? (
                <PageLoader minHeight="60vh" />
            ) : (
                <>
                    <SchedulerBar
                        status={schedulerStatus}
                        onToggle={handleToggle}
                        onIntervalChange={handleIntervalChange}
                        onTriggerNow={handleTriggerNow}
                        loading={schedOperating}
                    />
                    <Table
                        data={filteredRows}
                        columns={columns}
                        searchKeys={['camera_name', 'serial_number', 'site_name', 'health_status', 'health_status_label', 'health_status_label_short', 'latency_ms', 'fps_detected', 'resolution_detected', 'checked_at']}
                        disableDefaultSorting={true}
                        tableId="camerasHealthList"
                    />
                </>
            )}
            <style>{`
                .cam-logo-circle { background: var(--bs-secondary-bg); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }
                .cam-health-badge { color: inherit; }
                .cam-health-badge .cam-health-icon { color: currentColor !important; }
                .cam-health-badge .cam-health-icon * { stroke: currentColor !important; fill: none !important; }
                html.app-skin-dark .cam-health-badge.text-success { color: var(--bs-success) !important; }
                html.app-skin-dark .cam-health-badge.text-warning { color: var(--bs-warning) !important; }
                html.app-skin-dark .cam-health-badge.text-danger { color: var(--bs-danger) !important; }
                html.app-skin-dark .cam-health-badge.text-info { color: var(--bs-info) !important; }
                html.app-skin-dark .cam-health-badge.text-muted { color: var(--bs-secondary-color) !important; }
                .cam-health-col-lastchecked { padding-right: 18px !important; }
                .cam-health-col-lastchecked { width: 170px; white-space: nowrap; }
                .cam-health-col-actions { width: 110px; min-width: 110px; white-space: nowrap; }
                .cam-health-col-site { width: 240px; }
                .cam-health-col-resolution { width: 160px; }
                .cam-meta { display: inline-flex; align-items: center; gap: 4px; }
                .cam-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                .cam-meta-text { min-width: 0; }
                .cam-metric-badge svg { color: currentColor !important; }
                .cam-metric-badge svg * { stroke: currentColor !important; fill: none !important; }
            `}</style>

            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant}
                title={confirm?.title}
                message={confirm?.message}
                loading={acting}
                onClose={closeConfirm}
                onConfirm={runConfirm}
            />
        </div>
    )
}

export default CameraHealthContent
