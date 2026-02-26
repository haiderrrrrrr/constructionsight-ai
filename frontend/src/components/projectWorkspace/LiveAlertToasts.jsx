import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { onBroadcast } from '@/utils/broadcast'

const MAX_ALERTS_STORED = 200

// Creates (or finds) the shared fixed portal container for all live alert stacks.
function getOrCreatePortalEl() {
    let el = document.getElementById('cs-live-alerts-portal')
    if (!el) {
        el = document.createElement('div')
        el.id = 'cs-live-alerts-portal'
        Object.assign(el.style, {
            position: 'fixed', bottom: '20px', right: '18px',
            zIndex: '99990', display: 'flex', flexDirection: 'column',
            alignItems: 'flex-end', gap: '8px', pointerEvents: 'none',
        })
        document.body.appendChild(el)
    }
    return el
}

const getColorValues = (color) => ({
    warning: { accent: '#ffc107', bg: '#fff8e6' },
    danger:  { accent: '#dc3545', bg: '#fdf0ef' },
}[color] || { accent: '#dc3545', bg: '#fdf0ef' })

const AUTO_DISMISS_MS = 60_000
const MAX_VISIBLE     = 4

// ── Single floating toast ─────────────────────────────────────────────────────
function AlertToast({ alert, config, projectId, onDismiss }) {
    const navigate = useNavigate()
    const [visible, setVisible] = useState(false)
    const [leaving, setLeaving] = useState(false)
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && document.documentElement.classList.contains('app-skin-dark')
    )

    const label = config.alertLabels[config.getAlertTypeKey(alert)] ?? config.defaultLabel
    const { accent, bg } = getColorValues(label.color)

    useEffect(() => {
        const el  = document.documentElement
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

    const line2Primary   = alert.camera_name ?? alert.zone_name ?? ''
    const line2Secondary = alert.camera_name && alert.zone_name ? alert.zone_name : null
    const line3Text      = config.getLine3(alert)

    return (
        <div
            onClick={() => { navigate(config.getNavUrl(alert, projectId)); dismiss() }}
            title={config.navTitle}
            style={{
                '--cs-accent': accent,
                background: isDark ? 'rgba(15,23,42,0.88)' : bg,
                border: `1px solid ${accent}44`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: 7,
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                cursor: 'pointer',
                boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.4)' : '0 2px 10px rgba(0,0,0,0.11)',
                width: 260,
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
            <i className={label.icon} style={{ color: accent, fontSize: 13, flexShrink: 0, marginTop: 1 }} />

            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {label.short}
                </div>
                {line2Primary && (
                    <div style={{ fontSize: 11, fontWeight: 600, color: primaryText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {line2Primary}
                        {line2Secondary ? <span style={{ color: secondaryText, fontWeight: 400 }}> · {line2Secondary}</span> : null}
                    </div>
                )}
                {(line3Text || time) && (
                    config.timeOnNewLine ? (
                        <div style={{ fontSize: 10, color: secondaryText, marginTop: 1 }}>
                            {line3Text && (
                                <div style={{
                                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                }}>
                                    {line3Text}
                                </div>
                            )}
                            {time && (
                                <div style={{ marginTop: line3Text ? 1 : 0 }}>
                                    {time}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{
                            fontSize: 10, color: secondaryText, marginTop: 1,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        }}>
                            {line3Text}{line3Text && time ? ' · ' : ''}{time}
                        </div>
                    )
                )}
            </div>

            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: accent + '22' }}>
                <div style={{ height: '100%', background: accent, animation: `${config.animKeyframe} ${AUTO_DISMISS_MS}ms linear forwards` }} />
            </div>
        </div>
    )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LiveAlertToasts({ config, projectId }) {
    const queryClient = useQueryClient()
    const storageKey = config.storageKey(projectId)

    const [alerts, setAlerts] = useState(() => {
        if (typeof window === 'undefined') return []
        try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
    })

    // Seed with already-expired IDs so they don't reappear as floating toasts after a page refresh
    const [hiddenFromFloating, setHiddenFromFloating] = useState(() => {
        if (typeof window === 'undefined') return new Set()
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
            const now    = Date.now()
            return new Set(
                stored
                    .filter(a => a.createdAt && (now - a.createdAt) >= AUTO_DISMISS_MS)
                    .map(a => a._id)
            )
        } catch { return new Set() }
    })

    const [portalTarget, setPortalTarget] = useState(null)
    const timerRefsMap = useRef({})

    useLayoutEffect(() => { setPortalTarget(getOrCreatePortalEl()) }, [])

    const notifyUpdated = useCallback(() => {
        window.dispatchEvent(new CustomEvent(`${config.eventNS}:alerts-updated`))
    }, [config.eventNS])

    const hideFromFloating = useCallback(id => {
        clearTimeout(timerRefsMap.current[id])
        delete timerRefsMap.current[id]
        setHiddenFromFloating(prev => new Set([...prev, id]))
        notifyUpdated()
    }, [notifyUpdated])

    // Timestamp of the last real ppe_live_alert — used to suppress the stats-based fallback toast
    // when both events arrive for the same violation (prevents double toasts).
    const lastRealAlertAtRef = useRef(0)

    const onAlert = useCallback(data => {
        lastRealAlertAtRef.current = Date.now()
        const id       = crypto.randomUUID()
        const newAlert = { ...data, _id: id, createdAt: Date.now() }
        setAlerts(prev => {
            const updated = [...prev, newAlert].slice(-MAX_ALERTS_STORED)
            localStorage.setItem(storageKey, JSON.stringify(updated))
            return updated
        })
        notifyUpdated()
        timerRefsMap.current[id] = setTimeout(() => hideFromFloating(id), AUTO_DISMISS_MS)
    }, [storageKey, hideFromFloating, notifyUpdated])

    // Fallback: when stats_update shows open count increased but live_alert didn't fire
    // (backend sometimes pushes only stats), synthesize a generic toast so the user isn't left silent.
    // openCountField is configurable per-feature: PPE uses 'open_incidents', others use 'open_alerts'.
    const openCountField = config.openCountField ?? 'open_incidents'
    const prevOpenIncidentsRef = useRef(null)
    const onStatsUpdate = useCallback(data => {
        if (data[openCountField] == null) return
        const prev = prevOpenIncidentsRef.current
        prevOpenIncidentsRef.current = data[openCountField]
        if (prev !== null && data[openCountField] > prev) {
            // Suppress if a real alert fired within the last 3 seconds (same violation)
            if (Date.now() - lastRealAlertAtRef.current > 3000) {
                onAlert({ incident_type: null, timestamp: new Date().toISOString() })
            }
        }
    }, [onAlert, openCountField])

    const onFeatureChanged = useCallback(({ anyActive } = {}) => {
        if (anyActive !== false) return
        Object.values(timerRefsMap.current).forEach(t => clearTimeout(t))
        timerRefsMap.current = {}
        setAlerts([])
        setHiddenFromFloating(new Set())
        localStorage.removeItem(storageKey)
    }, [storageKey])

    config.streamHook(projectId, queryClient, { onAlert, onStatsUpdate, onFeatureChanged })

    // Restore dismiss timers for alerts loaded from localStorage on this tab
    useEffect(() => {
        alerts.forEach(a => {
            const remaining = AUTO_DISMISS_MS - (Date.now() - (a.createdAt || 0))
            if (remaining > 0 && !timerRefsMap.current[a._id]) {
                timerRefsMap.current[a._id] = setTimeout(() => hideFromFloating(a._id), remaining)
            }
        })
        return () => { Object.values(timerRefsMap.current).forEach(t => clearTimeout(t)) }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Cross-tab sync: when another tab writes to localStorage, mirror new alerts here as toasts
    useEffect(() => {
        const handleStorage = (e) => {
            if (e.key !== storageKey || !e.newValue) return
            try {
                const incoming = JSON.parse(e.newValue)
                setAlerts(prev => {
                    const existingIds = new Set(prev.map(a => a._id))
                    const novel = incoming.filter(a => !existingIds.has(a._id))
                    if (!novel.length) return prev
                    novel.forEach(a => {
                        const remaining = AUTO_DISMISS_MS - (Date.now() - (a.createdAt || 0))
                        if (remaining > 0 && !timerRefsMap.current[a._id]) {
                            timerRefsMap.current[a._id] = setTimeout(() => hideFromFloating(a._id), remaining)
                        } else if (remaining <= 0) {
                            setHiddenFromFloating(h => new Set([...h, a._id]))
                        }
                    })
                    return incoming
                })
            } catch { /* ignore */ }
        }
        window.addEventListener('storage', handleStorage)
        return () => window.removeEventListener('storage', handleStorage)
    }, [storageKey, hideFromFloating])

    // Clear all when hub signals it (both local event and broadcast from other tabs)
    useEffect(() => {
        const handle = () => {
            Object.values(timerRefsMap.current).forEach(t => clearTimeout(t))
            timerRefsMap.current = {}
            setAlerts([])
            setHiddenFromFloating(new Set())
        }
        window.addEventListener('cs:alerts-clear-all', handle)
        const unsubBroadcast = onBroadcast('cs:alerts-clear-all', handle)
        return () => {
            window.removeEventListener('cs:alerts-clear-all', handle)
            unsubBroadcast()
        }
    }, [])

    const dismiss = useCallback(id => hideFromFloating(id), [hideFromFloating])

    const visibleToasts = alerts.filter(a => !hiddenFromFloating.has(a._id)).slice(-MAX_VISIBLE)

    if (!visibleToasts.length || !portalTarget) return null

    return (
        <>
            <style>{`@keyframes ${config.animKeyframe} { from { width:100%; } to { width:0%; } }`}</style>

            {createPortal(
                <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 5, pointerEvents: 'auto' }}>
                    {visibleToasts.map(a => (
                        <AlertToast
                            key={a._id}
                            alert={a}
                            config={config}
                            projectId={projectId}
                            onDismiss={() => dismiss(a._id)}
                        />
                    ))}
                </div>,
                portalTarget
            )}
        </>
    )
}
