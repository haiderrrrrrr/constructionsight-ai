import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FiCalendar, FiClock, FiMail, FiZap } from 'react-icons/fi'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { apiGet, apiPatch, apiPost } from '@/utils/api'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'

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
    const h = Math.floor(diff / 3600)
    const m = Math.floor((diff % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
}

const FREQUENCY_OPTIONS = [
    { value: 'daily',   label: 'Daily'   },
    { value: 'weekly',  label: 'Weekly'  },
    { value: 'monthly', label: 'Monthly' },
]

// ── Toggle switch (identical to CameraHealthContent) ──────────────────────────

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

// ── Main component ─────────────────────────────────────────────────────────────

const ReportSchedulerBar = ({ projectId, myRole }) => {
    const [status, setStatus]       = useState(null)
    const [operating, setOperating] = useState(false)
    const [triggering, setTriggering] = useState(false)
    const [countdown, setCountdown] = useState('')

    const isRunning  = status?.is_running    ?? false
    const enabled    = status?.enabled       ?? true
    const frequency  = status?.frequency     ?? 'weekly'
    const lastRunAt  = status?.last_run_at
    const summary    = status?.last_summary
    const nextSendAt = status?.next_send_at

    const nextSendAtRef = useRef(nextSendAt)
    useEffect(() => { nextSendAtRef.current = nextSendAt }, [nextSendAt])

    useEffect(() => {
        if (!enabled) { setCountdown(''); return }
        const tick = () => setCountdown(fmtCountdown(nextSendAtRef.current))
        tick()
        const id = setInterval(tick, 60_000)
        return () => clearInterval(id)
    }, [enabled, nextSendAt])

    const fetchStatus = () => {
        apiGet(`/projects/${projectId}/reports/scheduler/status`)
            .then(data => setStatus(data))
            .catch(() => {})
    }

    useEffect(() => {
        fetchStatus()
        const id = setInterval(fetchStatus, 30_000)
        return () => clearInterval(id)
    }, [projectId])

    const isPm = myRole === 'project_manager'

    const handleToggle = async (newEnabled) => {
        if (!isPm) return
        setOperating(true)
        try {
            const data = await apiPatch(`/projects/${projectId}/reports/scheduler/config`, { enabled: newEnabled })
            setStatus(data)
            topTost(newEnabled ? 'Automated reports enabled.' : 'Automated reports disabled.')
        } catch {
            topTostError('Failed to update scheduler.')
        } finally {
            setOperating(false)
        }
    }

    const handleFrequencyChange = async (newFreq) => {
        if (!isPm) return
        setOperating(true)
        try {
            const data = await apiPatch(`/projects/${projectId}/reports/scheduler/config`, { frequency: newFreq })
            setStatus(data)
            topTost(`Report frequency set to ${newFreq}.`)
        } catch {
            topTostError('Failed to update frequency.')
        } finally {
            setOperating(false)
        }
    }

    const handleTriggerNow = async () => {
        if (!isPm) return
        setTriggering(true)
        try {
            await apiPost(`/projects/${projectId}/reports/scheduler/trigger`, {})
            topTost('Reports are being generated. Check the delivery log in a few moments.')
            setTimeout(fetchStatus, 3000)
        } catch (err) {
            topTostError(err?.response?.data?.detail || 'Failed to trigger reports.')
        } finally {
            setTriggering(false)
        }
    }

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
                html.app-skin-dark .cs-health-scheduler .form-select { background-color: rgba(0,0,0,0.18); border-color: rgba(255,255,255,0.16); color: rgba(255,255,255,0.92); }
                html.app-skin-dark .cs-health-scheduler .form-select option { color: rgba(255,255,255,0.92); background: #0b1220; }
                .cs-health-scheduler .btn { box-shadow: 0 8px 18px rgba(0,0,0,0.10); }
                html.app-skin-dark .cs-health-scheduler .btn { box-shadow: none; }
                .cs-health-scheduler .cs-sched-chip {
                    display: inline-flex; align-items: center; gap: 8px;
                    padding: 6px 10px; border-radius: 999px;
                    border: 1px solid rgba(var(--bs-primary-rgb), 0.16);
                    background: rgba(var(--bs-primary-rgb), 0.06);
                    backdrop-filter: blur(6px);
                }
                html.app-skin-dark .cs-health-scheduler .cs-sched-chip {
                    border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.06);
                }
                .cs-health-scheduler .dropdown-menu { z-index: 2000; }
                @media (max-width: 575px) {
                    .cs-health-scheduler .cs-sched-sub { display: none; }
                    .cs-health-scheduler .cs-sched-body { flex-direction: column; align-items: center !important; gap: 8px !important; }
                    .cs-health-scheduler .cs-sched-btn-wrap { margin-left: auto !important; margin-top: 10px; }
                    .cs-health-scheduler .cs-sched-timing { display: none !important; }
                }
                .cs-health-scheduler .cs-fc-toggle { position: relative; display: inline-flex; align-items: center; }
                .cs-health-scheduler .cs-fc-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
                .cs-health-scheduler .cs-fc-toggle-ui {
                    width: 46px; height: 24px; border-radius: 999px;
                    background: linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.06));
                    border: 1px solid rgba(0,0,0,0.14); box-shadow: 0 10px 20px rgba(0,0,0,0.10);
                    position: relative; transition: all 180ms ease; cursor: pointer; display: inline-block;
                }
                .cs-health-scheduler .cs-fc-toggle-ui::before {
                    content: ''; position: absolute; top: 3px; left: 3px;
                    width: 18px; height: 18px; border-radius: 999px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.82));
                    box-shadow: 0 8px 16px rgba(0,0,0,0.18); transition: all 180ms ease;
                }
                .cs-health-scheduler .cs-fc-toggle-input:checked + .cs-fc-toggle-ui {
                    background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 1) 0%, rgba(var(--bs-info-rgb), 0.85) 100%);
                    border-color: rgba(var(--bs-primary-rgb), 0.45); box-shadow: 0 12px 24px rgba(var(--bs-primary-rgb), 0.22);
                }
                .cs-health-scheduler .cs-fc-toggle-input:checked + .cs-fc-toggle-ui::before {
                    left: 25px; background: linear-gradient(180deg, rgba(255,255,255,1), rgba(255,255,255,0.86));
                }
                .cs-health-scheduler .cs-fc-toggle-disabled .cs-fc-toggle-ui { cursor: not-allowed; opacity: 0.6; box-shadow: none; }
                html.app-skin-dark .cs-health-scheduler .cs-fc-toggle-ui {
                    background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06));
                    border-color: rgba(255,255,255,0.14); box-shadow: none;
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
                        <span className="cs-sched-icon"><FiMail size={16} /></span>
                        <div>
                            <div className="cs-sched-title">Automated Report Delivery</div>
                            <div className="cs-sched-sub">
                                PPE · Workforce · Activity · Risk — delivered to all project members at 06:00 PKT
                            </div>
                        </div>
                    </div>
                    <span className={`badge ${enabled ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                        {enabled ? 'SCHEDULED' : 'DISABLED'}
                    </span>
                </div>

                <div className="d-flex flex-wrap align-items-center gap-3 cs-sched-body">

                    {/* Toggle + frequency */}
                    <div className="d-flex align-items-center gap-2">
                        <div className="d-flex align-items-center gap-2 cs-sched-chip">
                            <span className="fw-semibold fs-12">Auto-send</span>
                            <ToggleSwitch
                                checked={enabled}
                                onChange={e => handleToggle(e.target.checked)}
                                disabled={!isPm || operating}
                            />
                            <span className={`badge ${enabled ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                                {enabled ? 'ON' : 'OFF'}
                            </span>
                        </div>

                        <div className="d-flex align-items-center gap-1 cs-sched-chip">
                            <span className="text-muted fs-12">Every</span>
                            <SelectDropdown
                                value={frequency}
                                options={FREQUENCY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                                onChange={handleFrequencyChange}
                                disabled={!isPm || operating}
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

                    {/* Timing info */}
                    <div className="d-flex align-items-center gap-2 flex-wrap cs-sched-timing">
                        <div className="d-flex align-items-center gap-1 cs-sched-chip fs-12">
                            <FiClock size={12} className="opacity-75" />
                            {lastRunAt
                                ? <><span className="text-muted">Last sent:</span><span className="fw-semibold ms-1">{fmtRelative(lastRunAt)}</span></>
                                : <span className="text-muted">Not sent yet</span>
                            }
                        </div>

                        {enabled && countdown && (
                            <div className="d-flex align-items-center gap-1 cs-sched-chip fs-12">
                                <FiCalendar size={12} className="opacity-75" />
                                <span className="text-muted">Next send in:</span>
                                <span className="fw-semibold">{countdown}</span>
                            </div>
                        )}
                    </div>

                    {/* Last summary */}
                    {summary && (
                        <div className="d-flex align-items-center gap-1 flex-wrap">
                            {summary.reports_queued > 0 && (
                                <span className="badge bg-soft-success text-success fs-12 py-1 px-2">
                                    {summary.reports_queued} sent
                                </span>
                            )}
                            {summary.errors > 0 && (
                                <span className="badge bg-soft-danger text-danger fs-12 py-1 px-2">
                                    {summary.errors} errors
                                </span>
                            )}
                        </div>
                    )}

                    {/* SEND NOW */}
                    {isPm && (
                        <div className="ms-auto d-flex align-items-center gap-2 cs-sched-btn-wrap">
                            <button
                                className="btn btn-sm btn-success d-flex align-items-center gap-1"
                                onClick={handleTriggerNow}
                                disabled={triggering || operating}
                                title="Generate and email all reports now (last 7 days)"
                            >
                                {triggering
                                    ? <><span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} /> Sending…</>
                                    : <><FiZap size={12} /> SEND NOW</>
                                }
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ReportSchedulerBar
