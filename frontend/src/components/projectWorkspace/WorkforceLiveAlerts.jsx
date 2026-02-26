import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import useWorkforceStream from '@/hooks/useWorkforceStream'

const ALERT_LABELS = {
    understaffed:    { short: 'Zone Understaffed',      color: 'warning', icon: 'feather-users'        },
    idle_ratio_high: { short: 'High Idle Ratio',        color: 'warning', icon: 'feather-clock'        },
    sudden_drop:     { short: 'Sudden Worker Drop',     color: 'danger',  icon: 'feather-trending-down' },
    overload:        { short: 'Zone Congestion',        color: 'danger',  icon: 'feather-alert-octagon' },
}
const DEFAULT_LABEL = { short: 'Workforce Alert', color: 'warning', icon: 'feather-alert-triangle' }

const COLOR_MAP = {
    warning: { accent: '#ffc107', bg: '#fff8e6' },
    danger:  { accent: '#dc3545', bg: '#fdf0ef' },
}
function getColors(color) { return COLOR_MAP[color] || COLOR_MAP.warning }

const AUTO_DISMISS_MS = 90_000
const MAX_VISIBLE     = 4

// ── Single floating toast ─────────────────────────────────────────────────────
function AlertToast({ alert, onDismiss }) {
    const [visible, setVisible] = useState(false)
    const [leaving, setLeaving] = useState(false)
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && document.documentElement.classList.contains('app-skin-dark')
    )
    const label = ALERT_LABELS[alert.alert_type] ?? DEFAULT_LABEL
    const { accent, bg } = getColors(label.color)

    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    const dismiss = useCallback(() => {
        setLeaving(true)
        setTimeout(onDismiss, 300)
    }, [onDismiss])

    useEffect(() => {
        const t1 = setTimeout(() => setVisible(true), 20)
        const t2 = setTimeout(dismiss, AUTO_DISMISS_MS)
        return () => { clearTimeout(t1); clearTimeout(t2) }
    }, [dismiss])

    const time = alert.timestamp
        ? new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : ''
    const primaryText   = isDark ? 'rgba(255,255,255,0.92)' : 'var(--bs-body-color)'
    const secondaryText = isDark ? 'rgba(255,255,255,0.64)' : 'var(--bs-secondary-color)'

    return (
        <div
            style={{
                background: isDark ? 'rgba(15,23,42,0.88)' : bg,
                border: `1px solid ${accent}44`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: 7,
                padding: '8px 10px',
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.11)',
                width: 264,
                position: 'relative',
                overflow: 'hidden',
                transform: visible && !leaving ? 'translateY(0) scale(1)' : leaving ? 'translateX(110%)' : 'translateY(36px) scale(0.97)',
                opacity: visible && !leaving ? 1 : 0,
                transition: leaving
                    ? 'transform 0.3s ease-in, opacity 0.3s ease-in'
                    : 'transform 0.36s cubic-bezier(0.22,1,0.36,1), opacity 0.22s ease',
                userSelect: 'none',
            }}
        >
            <i className={label.icon} style={{ color: accent, fontSize: 13, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label.short}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: primaryText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {alert.zone_name ?? '—'}
                </div>
                <div style={{ fontSize: 10, color: secondaryText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {alert.message ?? ''} · {time}
                </div>
            </div>
            <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: secondaryText, fontSize: 12 }}>
                <i className="feather-x" />
            </button>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: accent + '22' }}>
                <div style={{ height: '100%', background: accent, animation: `wf-timer ${AUTO_DISMISS_MS}ms linear forwards` }} />
            </div>
        </div>
    )
}

// ── Alert Drawer ──────────────────────────────────────────────────────────────
function AlertDrawer({ alerts, onClose, onClear }) {
    const [open, setOpen] = useState(false)
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && document.documentElement.classList.contains('app-skin-dark')
    )

    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    useEffect(() => { setTimeout(() => setOpen(true), 20) }, [])
    const close = () => { setOpen(false); setTimeout(onClose, 300) }

    const drawerBg     = isDark ? 'rgba(15,23,42,0.96)' : 'var(--bs-body-bg)'
    const drawerText   = isDark ? 'rgba(255,255,255,0.90)' : 'var(--bs-body-color)'
    const drawerBorder = isDark ? 'rgba(255,255,255,0.10)' : 'var(--bs-border-color)'
    const drawerMuted  = isDark ? 'rgba(255,255,255,0.64)' : 'var(--bs-secondary-color)'

    return (
        <>
            <div onClick={(e) => { e.stopPropagation(); close() }} style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 99998,
                opacity: open ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: open ? 'auto' : 'none',
            }} />
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, zIndex: 99999,
                boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column',
                transform: open ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 0.3s cubic-bezier(0.22,1,0.36,1)',
                background: drawerBg, color: drawerText, borderLeft: `1px solid ${drawerBorder}`,
            }}>
                <div style={{ padding: '14px 16px', borderBottom: `1px solid ${drawerBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="feather-users" style={{ color: '#ffc107', fontSize: 16 }} />
                        <span className="fw-semibold fs-14">Workforce Alerts</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {alerts.length > 0 && (
                            <button type="button" className="btn btn-danger btn-sm d-inline-flex align-items-center gap-1" onClick={() => { onClear(); close() }}>
                                <i className="feather-trash-2" style={{ fontSize: 14 }} />
                                Clear all
                            </button>
                        )}
                    </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {[...alerts].reverse().map((a, i) => {
                        const label = ALERT_LABELS[a.alert_type] ?? DEFAULT_LABEL
                        const { accent, bg } = getColors(label.color)
                        const time = a.timestamp ? new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
                        return (
                            <div key={a._id ?? i} style={{
                                background: isDark ? 'rgba(15,23,42,0.72)' : bg,
                                border: `1px solid ${accent}44`, borderLeft: `3px solid ${accent}`,
                                borderRadius: 7, padding: '7px 10px',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <i className={label.icon} style={{ color: accent, fontSize: 13, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label.short}</div>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: drawerText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {a.zone_name ?? '—'}
                                    </div>
                                    <div style={{ fontSize: 10, color: drawerMuted }}>{a.message ?? ''} · {time}</div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </>
    )
}

// ── Main component ────────────────────────────────────────────────────────────
export const openWorkforceAlertsDrawer = () => {
    window.dispatchEvent(new CustomEvent('wf:open-alerts-drawer'))
}

export default function WorkforceLiveAlerts({ projectId }) {
    const storageKey = `wf-alerts-${projectId}`
    const [alerts, setAlerts] = useState(() => {
        if (typeof window === 'undefined') return []
        try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
    })
    const [hidden, setHidden]         = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [hiddenIds, setHiddenIds]   = useState(new Set())
    const counterRef  = useRef(alerts.length > 0 ? Math.max(...alerts.map(a => a._id ?? 0)) : 0)
    const timerRefs   = useRef({})
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && document.documentElement.classList.contains('app-skin-dark')
    )

    useEffect(() => {
        const el = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    const hideId = useCallback(id => {
        clearTimeout(timerRefs.current[id])
        delete timerRefs.current[id]
        setHiddenIds(prev => new Set([...prev, id]))
    }, [])

    const onAlert = useCallback(data => {
        const id = ++counterRef.current
        const alert = { ...data, _id: id, createdAt: Date.now() }
        setAlerts(prev => {
            const updated = [...prev, alert]
            localStorage.setItem(storageKey, JSON.stringify(updated))
            return updated
        })
        timerRefs.current[id] = setTimeout(() => hideId(id), AUTO_DISMISS_MS)
    }, [storageKey, hideId])

    useWorkforceStream(projectId, { onAlert })

    useEffect(() => {
        alerts.forEach(a => {
            const remaining = AUTO_DISMISS_MS - (Date.now() - (a.createdAt || 0))
            if (remaining > 0 && !timerRefs.current[a._id]) {
                timerRefs.current[a._id] = setTimeout(() => hideId(a._id), remaining)
            }
        })
        return () => Object.values(timerRefs.current).forEach(clearTimeout)
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const handler = () => setDrawerOpen(true)
        window.addEventListener('wf:open-alerts-drawer', handler)
        return () => window.removeEventListener('wf:open-alerts-drawer', handler)
    }, [])

    const dismissAll = useCallback(() => {
        Object.values(timerRefs.current).forEach(clearTimeout)
        timerRefs.current = {}
        setAlerts([])
        setHiddenIds(new Set())
        localStorage.removeItem(storageKey)
    }, [storageKey])

    const visibleToasts = alerts.filter(a => !hiddenIds.has(a._id)).slice(-MAX_VISIBLE)
    if (!alerts.length) return null

    return createPortal(
        <>
            <style>{`@keyframes wf-timer { from { width:100%; } to { width:0%; } }`}</style>
            <div style={{
                position: 'fixed', bottom: 20, right: 18, zIndex: 99997,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
                pointerEvents: 'none',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, pointerEvents: 'auto' }}>
                    {alerts.length > MAX_VISIBLE && (
                        <button type="button" onClick={() => setDrawerOpen(true)} style={{
                            background: '#ffc107', color: '#000', border: 'none', borderRadius: 6,
                            padding: '5px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}>
                            <i className="feather-bell" style={{ fontSize: 11 }} />
                            +{alerts.length - MAX_VISIBLE} alerts
                        </button>
                    )}
                    <button onClick={() => setDrawerOpen(true)} title="View all workforce alerts" style={{
                        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'var(--bs-border-color)'}`,
                        borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 28, minHeight: 28, color: '#ffc107',
                    }}>
                        <i className="feather-list" style={{ fontSize: 16 }} />
                    </button>
                    <button onClick={() => setHidden(h => !h)} title={hidden ? 'Show' : 'Hide'} style={{
                        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'var(--bs-border-color)'}`,
                        borderRadius: 6, padding: '5px 8px', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        minWidth: 28, minHeight: 28, color: '#ffc107',
                    }}>
                        <i className={hidden ? 'feather-eye-off' : 'feather-eye'} style={{ fontSize: 16 }} />
                    </button>
                </div>
                {!hidden && (
                    <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 5, pointerEvents: 'auto' }}>
                        {visibleToasts.map(a => (
                            <AlertToast key={a._id} alert={a} onDismiss={() => hideId(a._id)} />
                        ))}
                    </div>
                )}
            </div>
            {drawerOpen && (
                <AlertDrawer alerts={alerts} onClose={() => setDrawerOpen(false)} onClear={dismissAll} />
            )}
        </>,
        document.body
    )
}
