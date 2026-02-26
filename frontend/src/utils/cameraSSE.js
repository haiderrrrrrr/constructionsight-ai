import { STREAM_BASE, refreshTokens, isTokenValid } from '@/utils/api'

/**
 * Open a camera SSE stream and register event type handlers.
 * - Pauses when the tab is hidden, resumes when visible.
 * - On error, silently refreshes the JWT and reconnects — no error shown to user.
 * - If refresh fails (session truly expired), stops silently; next normal API call
 *   will redirect to login via api.js.
 *
 * @param {string} path  - e.g. '/admin/cameras/stream' or '/projects/5/cameras/stream'
 * @param {object} handlers - map of event type → handler fn
 * @param {object} [options]
 * @param {function} [options.onReconnect] - called after SSE successfully reconnects (use to re-fetch stale data)
 * @returns {function} cleanup — call on useEffect teardown to close the stream
 */
export function openCameraStream(path, handlers, { onReconnect } = {}) {
    let src = null
    let closed = false
    let reconnectTimer = null
    let reconnectAttempts = 0
    let isFirstConnect = true
    const maxReconnectAttempts = 30  // ~5 minutes max with exponential backoff

    async function connect() {
        if (src || closed) return

        // Ensure token is fresh before opening SSE
        if (!isTokenValid()) {
            const newToken = await refreshTokens()
            if (!newToken || closed) return
        }

        const token = window.sessionStorage.getItem('access_token')
        if (!token || closed) return

        const url = `${STREAM_BASE}${path}?token=${encodeURIComponent(token)}`
        src = new EventSource(url)

        src.onopen = () => {
            if (!isFirstConnect && onReconnect) {
                // Reconnected after a drop — data may be stale, trigger a silent refetch
                onReconnect()
            }
            isFirstConnect = false
            reconnectAttempts = 0
        }

        src.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data)
                if (data.type && handlers[data.type]) {
                    handlers[data.type](data)
                }
            } catch {
                // ignore parse errors
            }
        }

        src.onerror = async () => {
            if (src) { src.close(); src = null }
            if (closed) return

            // Exponential backoff: 1s, 2s, 4s, 8s... max 30s between attempts
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)

            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++
                // Attempt reconnect (even if token refresh fails — server might be restarting)
                reconnectTimer = setTimeout(() => { if (!closed) connect() }, delay)
            }
        }
    }

    function disconnect() {
        clearTimeout(reconnectTimer)
        if (src) { src.close(); src = null }
    }

    function onVisibilityChange() {
        if (document.hidden) {
            disconnect()
        } else {
            // onReconnect will fire from src.onopen after connect() succeeds
            connect()
        }
    }

    if (!document.hidden) connect()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
        closed = true
        document.removeEventListener('visibilitychange', onVisibilityChange)
        disconnect()
    }
}
