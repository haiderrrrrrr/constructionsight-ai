/**
 * LiveAlertsHub — manages the combined alerts drawer for all three features.
 * Renders nothing visible itself; the drawer is opened by dispatching `cs:open-alerts-drawer`
 * (e.g. from the header bell icon). Handles clear-all across PPE / Workforce / Activity.
 */
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { getCurrentUserId } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'

const SECTIONS = [
    {
        key:       (id) => `ppe-alerts-${getCurrentUserId()}-${id}`,
        label:     'PPE Alerts',
        icon:      'feather-alert-circle',
        color:     '#dc3545',
        getNavUrl: (_a, projectId) => `/projects/${projectId}/reports/ppe`,
    },
    {
        key:       (id) => `wf-alerts-${getCurrentUserId()}-${id}`,
        label:     'Workforce Insights',
        icon:      'feather-users',
        color:     '#ffc107',
        getNavUrl: (a, projectId) => a.camera_id
            ? `/projects/${projectId}/reports/workforce?camera=${a.camera_id}`
            : `/projects/${projectId}/reports/workforce`,
    },
    {
        key:       (id) => `act-alerts-${getCurrentUserId()}-${id}`,
        label:     'Activity Alerts',
        icon:      'feather-activity',
        color:     '#ffc107',
        getNavUrl: (a, projectId) => a.camera_id
            ? `/projects/${projectId}/reports/activity?camera=${a.camera_id}`
            : `/projects/${projectId}/reports/activity`,
    },
    {
        key:       (id) => `eq-alerts-${getCurrentUserId()}-${id}`,
        label:     'Equipment Alerts',
        icon:      'feather-tool',
        color:     '#fd7e14',
        getNavUrl: (a, projectId) => a.camera_id
            ? `/projects/${projectId}/reports/equipment?camera=${a.camera_id}`
            : `/projects/${projectId}/reports/equipment`,
    },
]

const ALERT_LABELS = {
    no_helmet:              { short: 'No Helmet',         color: '#ffc107' },
    no_vest:                { short: 'No Vest',           color: '#ffc107' },
    both_missing:           { short: 'No Helmet & Vest',  color: '#dc3545' },
    understaffed:           { short: 'Zone Understaffed', color: '#ffc107' },
    idle_ratio_high:        { short: 'High Idle Ratio',   color: '#ffc107' },
    sudden_drop:            { short: 'Worker Drop',       color: '#dc3545' },
    overload:               { short: 'Zone Overload',     color: '#dc3545' },
    zone_idle:              { short: 'Zone Idle',         color: '#ffc107' },
    activity_drop:          { short: 'Activity Drop',     color: '#dc3545' },
    low_activity_sustained: { short: 'Low Activity',      color: '#ffc107' },
    repeated_inactivity:    { short: 'Repeated Inact.',   color: '#ffc107' },
    idle_waste:             { short: 'Idle Waste',        color: '#fd7e14' },
    active_no_workers:      { short: 'Active–No Workers', color: '#dc3545' },
    ghost_equipment:        { short: 'Ghost Equipment',   color: '#dc3545' },
    overuse:                { short: 'Equipment Overuse', color: '#dc3545' },
    cross_zone_conflict:    { short: 'Cross-Zone Conflict', color: '#dc3545' },
}

function readAlerts(storageKey) {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
}

// ── Combined drawer ───────────────────────────────────────────────────────────
function CombinedDrawer({ projectId, onClose, onClearAll }) {
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && document.documentElement.classList.contains('app-skin-dark')
    )
    const [sections, setSections] = useState([])

    const reloadSections = () => {
        setSections(SECTIONS.map(s => ({ ...s, alerts: readAlerts(s.key(projectId)) })).filter(s => s.alerts.length > 0))
    }

    useEffect(() => {
        reloadSections()
        const el  = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Live refresh while drawer is open
    useEffect(() => {
        const events = ['ppe:alerts-updated', 'wf:alerts-updated', 'act:alerts-updated', 'eq:alerts-updated', 'storage']
        events.forEach(e => window.addEventListener(e, reloadSections))
        return () => events.forEach(e => window.removeEventListener(e, reloadSections))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { setTimeout(() => setOpen(true), 20) }, [])

    const close = () => { setOpen(false); setTimeout(onClose, 300) }

    const dismissAlert = (sectionKey, alertId) => {
        const updated = readAlerts(sectionKey).filter(a => a._id !== alertId)
        localStorage.setItem(sectionKey, JSON.stringify(updated))
        reloadSections()
        window.dispatchEvent(new CustomEvent(
            sectionKey.startsWith('ppe') ? 'ppe:alerts-updated'
            : sectionKey.startsWith('wf') ? 'wf:alerts-updated'
            : sectionKey.startsWith('eq') ? 'eq:alerts-updated'
            : 'act:alerts-updated'
        ))
    }

    const drawerBg     = isDark ? 'rgba(15,23,42,0.96)' : 'var(--bs-body-bg)'
    const drawerText   = isDark ? 'rgba(255,255,255,0.90)' : 'var(--bs-body-color)'
    const drawerBorder = isDark ? 'rgba(255,255,255,0.10)' : 'var(--bs-border-color)'
    const drawerMuted  = isDark ? 'rgba(255,255,255,0.55)' : 'var(--bs-secondary-color)'

    const totalCount = sections.reduce((acc, s) => acc + s.alerts.length, 0)

    return createPortal(
        <>
            <style>{`
                .cs-alerts-drawer-header .cs-alerts-title { font-size: 14px; font-weight: 700; line-height: 1; }
                .cs-alerts-drawer-header .cs-alerts-count {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 18px;
                    height: 18px;
                    padding: 0 6px;
                    border-radius: 999px;
                    font-size: 10px;
                    font-weight: 800;
                    background: var(--bs-danger);
                    color: #fff;
                    line-height: 1;
                }
                .cs-alerts-drawer-header .cs-alerts-clear {
                    text-transform: uppercase;
                    letter-spacing: 0.4px;
                    font-weight: 700;
                }
                .cs-alerts-section-count {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 18px;
                    height: 18px;
                    padding: 0 6px;
                    border-radius: 999px;
                    font-size: 10px;
                    font-weight: 800;
                    background: rgba(100,116,139,0.18);
                    color: rgba(100,116,139,0.9);
                }
                html.app-skin-dark .cs-alerts-section-count {
                    background: rgba(148,163,184,0.18);
                    color: rgba(226,232,240,0.85);
                }
                .cs-alert-row { position: relative; }
                .cs-alert-row-dismiss {
                    position: absolute;
                    top: 5px;
                    right: 7px;
                    width: 12px;
                    height: 12px;
                    border-radius: 10px;
                    opacity: 0.55;
                    transition: none;
                    padding: 0;
                }
                .cs-alert-row-dismiss,
                .cs-alert-row-dismiss:hover,
                .cs-alert-row-dismiss:focus { opacity: 0.55; background-color: transparent; box-shadow: none; }
            `}</style>

            <div onClick={(e) => { e.stopPropagation(); close() }} style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)',
                zIndex: 99998, opacity: open ? 1 : 0, transition: 'opacity 0.3s',
                pointerEvents: open ? 'auto' : 'none',
            }} />

            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: 320,
                zIndex: 99999, boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column',
                transform: open ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 0.3s cubic-bezier(0.22,1,0.36,1)',
                background: drawerBg, color: drawerText,
                borderLeft: `1px solid ${drawerBorder}`,
            }}>
                {/* Header */}
                <div className="cs-alerts-drawer-header" style={{ padding: '14px 16px', borderBottom: `1px solid ${drawerBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="feather-bell" style={{ color: 'var(--bs-danger)', fontSize: 16 }} />
                        <span className="cs-alerts-title">Live Alerts</span>
                        {totalCount > 0 && (
                            <span className="cs-alerts-count">
                                {totalCount > 99 ? '99+' : totalCount}
                            </span>
                        )}
                    </div>
                    {totalCount > 0 && (
                        <button type="button" className="btn btn-danger btn-sm d-inline-flex align-items-center gap-1 cs-alerts-clear"
                            onClick={() => { onClearAll(); close() }}>
                            <i className="feather-trash-2" style={{ fontSize: 14 }} />
                            <span>Clear all</span>
                        </button>
                    )}
                </div>

                {/* Sections */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {sections.length === 0 && (
                        <div style={{ textAlign: 'center', color: drawerMuted, fontSize: 13, marginTop: 40 }}>
                            No alerts
                        </div>
                    )}

                    {sections.map((section) => (
                        <div key={section.label}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <i className={section.icon} style={{ color: section.color, fontSize: 13 }} />
                                <span style={{ fontSize: 11, fontWeight: 700, color: section.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {section.label}
                                </span>
                                <span className="badge fs-11 fw-bold text-uppercase" style={{ background: section.color + '22', color: section.color }}>
                                    {section.alerts.length > 99 ? '99+' : section.alerts.length}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                {[...section.alerts].reverse().map((a, i) => {
                                    const typeKey    = a.incident_type ?? a.alert_type ?? ''
                                    const alertLabel = ALERT_LABELS[typeKey] ?? { short: 'Alert', color: '#ffc107' }
                                    const bgLight    = alertLabel.color === '#dc3545' ? '#fdf0ef' : '#fff8e6'
                                    const time       = a.timestamp ? new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
                                    const line2Primary   = a.camera_name ?? a.zone_name ?? ''
                                    const line2Secondary = a.camera_name && a.zone_name ? a.zone_name : null
                                    const line3          = a.person_id || a.message || ''
                                    const sectionKey = section.key(projectId)

                                    return (
                                        <div key={a._id ?? i}
                                            className="cs-alert-row"
                                            onClick={() => {
                                                navigate(section.getNavUrl(a, projectId))
                                                dismissAlert(sectionKey, a._id)
                                                close()
                                            }}
                                            style={{
                                                background: isDark ? 'rgba(15,23,42,0.72)' : bgLight,
                                                border: `1px solid ${alertLabel.color}44`,
                                                borderLeft: `3px solid ${alertLabel.color}`,
                                                borderRadius: 7, padding: '7px 10px', cursor: 'pointer',
                                                transition: 'all 0.2s', paddingRight: 28,
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = isDark ? 'rgba(15,23,42,0.88)' : `${alertLabel.color}11`}
                                            onMouseLeave={(e) => e.currentTarget.style.background = isDark ? 'rgba(15,23,42,0.72)' : bgLight}
                                        >
                                            <div style={{ fontSize: 10, fontWeight: 700, color: alertLabel.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                {alertLabel.short}
                                            </div>
                                            {line2Primary && (
                                                <div style={{ fontSize: 11, fontWeight: 600, color: drawerText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {line2Primary}
                                                    {line2Secondary ? <span style={{ color: drawerMuted, fontWeight: 400 }}> · {line2Secondary}</span> : null}
                                                </div>
                                            )}
                                            {(line3 || time) && (
                                                <div style={{ fontSize: 10, color: drawerMuted, marginTop: 1 }}>
                                                    {line3}{line3 && time ? ' · ' : ''}{time}
                                                </div>
                                            )}
                                            <button
                                                type="button"
                                                className={`btn-close cs-alert-row-dismiss ${isDark ? 'btn-close-white' : ''}`}
                                                onClick={(e) => { e.stopPropagation(); dismissAlert(sectionKey, a._id) }}
                                                aria-label="Dismiss"
                                                title="Dismiss"
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </>,
        document.body
    )
}

// ── Hub ───────────────────────────────────────────────────────────────────────
export default function LiveAlertsHub({ projectId }) {
    const [drawerOpen, setDrawerOpen] = useState(false)

    useEffect(() => {
        const handle = () => setDrawerOpen(true)
        window.addEventListener('cs:open-alerts-drawer', handle)
        return () => window.removeEventListener('cs:open-alerts-drawer', handle)
    }, [])

    const clearAll = () => {
        SECTIONS.forEach(s => localStorage.removeItem(s.key(projectId)))
        broadcastRefresh('cs:alerts-clear-all')
    }

    if (!drawerOpen) return null

    return (
        <CombinedDrawer
            projectId={projectId}
            onClose={() => setDrawerOpen(false)}
            onClearAll={clearAll}
        />
    )
}
