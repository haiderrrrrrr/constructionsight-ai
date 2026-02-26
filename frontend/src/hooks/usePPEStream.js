import { useEffect, useRef } from 'react'
import { STREAM_BASE, refreshTokens, isTokenValid } from '@/utils/api'
import { QK } from '@/utils/queryKeys'
import { broadcastRefresh } from '@/utils/broadcast'
import { patchIncidentInCache } from '@/utils/ppeCacheUtils'

/**
 * Opens a project-scoped SSE connection to /projects/{projectId}/ppe/stream.
 * Drives React Query cache directly on updates: setQueryData for instant patches,
 * invalidateQueries for structural changes. Maintains old callbacks for optional
 * onConnect/onDisconnect/onFeatureChanged/onAlert/onIncidentUpdated listeners.
 *
 * @param {string|number} projectId
 * @param {QueryClient} queryClient - React Query client (drives cache updates)
 * @param {{
 *   onFeatureChanged?: (data: object) => void,
 *   onConnect?: () => void,
 *   onDisconnect?: () => void,
 *   onAlert?: (data: object) => void,
 *   onIncidentUpdated?: (data: object) => void,
 * }} callbacks - Optional callbacks for lifecycle events
 */
export default function usePPEStream(projectId, queryClient, callbacks = {}) {
    const callbacksRef = useRef(callbacks)
    useEffect(() => { callbacksRef.current = callbacks }) // sync on every render — no deps

    useEffect(() => {
        if (!projectId) return

        let es = null
        let closed = false
        let reconnectTimer = null
        let backoffMs = 1000

        async function connect() {
            if (closed || es) return

            if (!isTokenValid()) {
                const newToken = await refreshTokens()
                if (!newToken || closed) return
            }

            const token = window.sessionStorage.getItem('access_token')
            if (!token || closed) return

            const url = `${STREAM_BASE}/projects/${projectId}/ppe/stream?token=${encodeURIComponent(token)}`
            try {
                es = new EventSource(url, { withCredentials: true })

                es.onopen = () => {
                    backoffMs = 1000
                    callbacksRef.current?.onConnect?.()
                }

                es.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data)
                        if (data.type === 'ppe_live_alert') {
                            callbacksRef.current?.onAlert?.(data)
                            queryClient.invalidateQueries({ queryKey: ['ppe'] })
                            broadcastRefresh('ppe:invalidate', { projectId })
                        } else if (data.type === 'ppe_feature_changed') {
                            // Source of truth: the SSE payload itself carries any_camera_active
                            // and the per-camera state. This works in every account/window
                            // including ones that have never visited the dashboard (no cache).
                            // Fallback to cache-derived computation only if the backend is older
                            // and didn't include any_camera_active.
                            let anyActive = data.any_camera_active

                            const statusKey = QK.ppeStatus(projectId)
                            const cached = queryClient.getQueryData(statusKey)

                            if (Array.isArray(data.cameras) && data.cameras.length > 0) {
                                // Authoritative per-camera state from server — overwrite cache
                                const liveStart = data.live_session_start ?? (anyActive ? cached?.live_session_start ?? null : null)
                                queryClient.setQueryData(statusKey, {
                                    ...(cached && !Array.isArray(cached) ? cached : {}),
                                    cameras: data.cameras.map(c => ({
                                        camera_id: c.camera_id,
                                        features: {
                                            ...(cached && !Array.isArray(cached)
                                                ? cached.cameras?.find(x => x.camera_id === c.camera_id)?.features
                                                : null),
                                            ppe_enabled: !!c.ppe_enabled,
                                        },
                                    })),
                                    live_session_start: liveStart,
                                })
                                if (anyActive == null) {
                                    anyActive = data.cameras.some(c => c.ppe_enabled === true)
                                }
                            } else if (data.camera_id != null && data.ppe_enabled != null && cached) {
                                // Legacy / partial payload — patch single camera in cache
                                const cams = Array.isArray(cached) ? cached : (cached.cameras ?? [])
                                const updatedCams = cams.map(c =>
                                    c.camera_id === data.camera_id
                                        ? { ...c, features: { ...c.features, ppe_enabled: data.ppe_enabled } }
                                        : c
                                )
                                if (anyActive == null) {
                                    anyActive = updatedCams.some(c => c.features?.ppe_enabled === true)
                                }
                                queryClient.setQueryData(statusKey, {
                                    ...(Array.isArray(cached) ? {} : cached),
                                    cameras: updatedCams,
                                    live_session_start: anyActive ? cached.live_session_start : null,
                                })
                            }

                            // Hard-wipe data caches on every feature transition so any
                            // tab/window/account starts from a clean slate. This hook runs at
                            // workspace level (mounted by the toast component) — so the wipe
                            // happens whether or not the dashboard is currently visible.
                            //
                            // Without this, a window that was off-dashboard during the toggle
                            // would later open the dashboard and show pre-toggle data via
                            // placeholderData until the background refetch completed — looking
                            // like "stale data persisting" on toggle off, and "incrementing on
                            // top of stale data" on the next toggle on.
                            //
                            // removeQueries actually clears cached values; invalidateQueries
                            // alone only marks them stale and would leave the data sitting in
                            // cache until next observed. We do both: removeQueries clears the
                            // value, invalidateQueries triggers an immediate refetch on any
                            // currently-mounted observer that's still enabled (e.g. dashboard
                            // on a historical filter).
                            const PPE_DATA_KEYS = [
                                ['ppe', 'summary'],   ['ppe', 'trend'],     ['ppe', 'zones'],
                                ['ppe', 'cameras'],   ['ppe', 'analytics'], ['ppe', 'incidents'],
                            ]
                            PPE_DATA_KEYS.forEach(k => {
                                queryClient.setQueriesData({ queryKey: k }, null)
                                queryClient.removeQueries({ queryKey: k })
                            })
                            queryClient.invalidateQueries({ queryKey: ['ppe'] })

                            // Sync the live-session-start key in localStorage from the SSE event
                            // payload so every tab in this Chrome profile has the same value —
                            // including ones whose dashboard wasn't mounted at toggle time. The
                            // dashboard reads this on mount to size the live date window; without
                            // this sync, a fresh dashboard mount in another tab/window would
                            // pull a stale window covering pre-toggle incidents from the server.
                            try {
                                const liveKey = `ppe_live_start_${projectId}`
                                if (data.live_session_start) {
                                    localStorage.setItem(liveKey, data.live_session_start)
                                } else {
                                    localStorage.removeItem(liveKey)
                                }
                            } catch (_) { /* localStorage may be disabled in private mode */ }
                            // Forward to same-browser tabs as a fast-path; cross-account/window
                            // tabs get the same payload directly via their own SSE.
                            broadcastRefresh('ppe:feature-changed', { projectId, ...data, anyActive })
                            callbacksRef.current?.onFeatureChanged?.({ ...data, anyActive })
                        } else if (data.type === 'ppe_incident_updated') {
                            // Surgical in-place patch — no refetch, no scroll jump
                            patchIncidentInCache(queryClient, projectId, data)
                            // Status change (resolve/acknowledge) affects open_incidents in summary + zones
                            queryClient.invalidateQueries({ queryKey: ['ppe', 'summary', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['ppe', 'zones',   projectId] })
                            callbacksRef.current?.onIncidentUpdated?.(data)
                            window.dispatchEvent(new Event('cs:ppe-incidents-refresh'))
                            broadcastRefresh('ppe:incident-updated', { projectId, ...data })
                        }
                    } catch (_) {}
                }

                es.onerror = async () => {
                    if (es) { es.close(); es = null }
                    callbacksRef.current?.onDisconnect?.()
                    if (closed) return

                    if (!isTokenValid()) {
                        await refreshTokens()
                    }

                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null
                        connect()
                    }, backoffMs)
                    backoffMs = Math.min(Math.round(backoffMs * 1.6), 10_000)
                }
            } catch (_) {}
        }

        function disconnect() {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer)
                reconnectTimer = null
            }
            if (es) { es.close(); es = null }
            callbacksRef.current?.onDisconnect?.()
        }

        // Connect immediately and stay connected regardless of tab visibility.
        // Disconnecting on tab hide causes missed alerts and stale data when users return.
        // Browsers keep SSE connections alive in background tabs; server heartbeats prevent timeouts.
        connect()

        return () => {
            closed = true
            disconnect()
        }
    }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
}
