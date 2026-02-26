import { useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { getCurrentUserId } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'

const ALERT_EVENTS = ['ppe:alerts-updated', 'wf:alerts-updated', 'act:alerts-updated', 'cs:alerts-clear-all', 'storage']

function getKeys(projectId) {
    const uid = getCurrentUserId()
    return [
        `ppe-alerts-${uid}-${projectId}`,
        `wf-alerts-${uid}-${projectId}`,
        `act-alerts-${uid}-${projectId}`,
    ]
}

function countTotal(projectId) {
    return getKeys(projectId).reduce((acc, k) => {
        try { return acc + JSON.parse(localStorage.getItem(k) || '[]').length } catch { return acc }
    }, 0)
}

function getPortalEl() {
    return document.getElementById('cs-live-alerts-portal') || document.body
}

export default function LiveAlertsDismissAll({ projectId }) {
    const [count, setCount] = useState(() => countTotal(projectId))
    const [portalTarget, setPortalTarget] = useState(null)
    const [isDark, setIsDark] = useState(() =>
        typeof window !== 'undefined' && document.documentElement.classList.contains('app-skin-dark')
    )

    useLayoutEffect(() => {
        // Use a small delay so the portal container is guaranteed to be created by toast components
        const t = setTimeout(() => setPortalTarget(getPortalEl()), 50)
        return () => clearTimeout(t)
    }, [])

    useEffect(() => {
        const el  = document.documentElement
        const obs = new MutationObserver(() => setIsDark(el.classList.contains('app-skin-dark')))
        obs.observe(el, { attributes: true, attributeFilter: ['class'] })
        return () => obs.disconnect()
    }, [])

    useEffect(() => {
        const update = () => setCount(countTotal(projectId))
        ALERT_EVENTS.forEach(e => window.addEventListener(e, update))
        return () => ALERT_EVENTS.forEach(e => window.removeEventListener(e, update))
    }, [projectId])

    const dismissAll = () => {
        getKeys(projectId).forEach(k => localStorage.removeItem(k))
        broadcastRefresh('cs:alerts-clear-all')
        setCount(0)
    }

    if (count === 0 || !portalTarget) return null

    return createPortal(
        <div style={{ display: 'flex', justifyContent: 'flex-end', pointerEvents: 'auto' }}>
            <button
                type="button"
                onClick={dismissAll}
                style={{
                    background: isDark ? 'rgba(30,41,59,0.92)' : 'rgba(255,255,255,0.95)',
                    border: '1px solid rgba(220,53,69,0.35)',
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#dc3545',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.1)',
                    letterSpacing: '0.3px',
                    textTransform: 'uppercase',
                    transition: 'opacity 0.2s',
                    whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
                <i className="feather-x" style={{ fontSize: 12 }} />
                Dismiss all
            </button>
        </div>,
        portalTarget
    )
}
