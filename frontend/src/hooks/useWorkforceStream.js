import { useEffect, useRef } from 'react'
import { STREAM_BASE, refreshTokens, isTokenValid } from '@/utils/api'
import { QK } from '@/utils/queryKeys'
import { broadcastRefresh } from '@/utils/broadcast'
import { patchAlertInCache } from '@/utils/workforceCacheUtils'

/**
 * Opens a project-scoped SSE connection to /projects/{projectId}/workforce/stream.
 * Mirrors usePPEStream.js — drives React Query cache directly (setQueryData for
 * surgical patches, removeQueries+invalidateQueries on feature-changed) so every
 * tab/window/account stays consistent without polling.
 *
 * Event types handled:
 *   workforce_stats_update   — per-camera live metrics (patches wfCameras cache)
 *   workforce_alert          — new alert (invalidates wfSummary/wfAlerts; toast fires)
 *   workforce_alert_updated  — status change (patches wfAlerts in place + open_alerts counter)
 *   workforce_feature_changed — toggle on/off (wipes data caches, syncs live_session_start)
 *
 * @param {string|number} projectId
 * @param {QueryClient} queryClient
 * @param {{
 *   onStatsUpdate?:  (data: object) => void,
 *   onAlert?:        (data: object) => void,
 *   onAlertUpdated?: (data: object) => void,
 *   onFeatureChanged?: (data: object) => void,
 *   onConnect?:      () => void,
 *   onDisconnect?:   () => void,
 * }} callbacks
 */
export default function useWorkforceStream(projectId, queryClient, callbacks = {}) {
    const callbacksRef = useRef(callbacks)
    useEffect(() => { callbacksRef.current = callbacks }) // sync every render — no deps

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

            const url = `${STREAM_BASE}/projects/${projectId}/workforce/stream?token=${encodeURIComponent(token)}`
            try {
                es = new EventSource(url, { withCredentials: true })

                es.onopen = () => {
                    backoffMs = 1000
                    callbacksRef.current?.onConnect?.()
                }

                es.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data)

                        if (data.type === 'workforce_stats_update') {
                            // Patch the cameras list cache in-place (array format from /cameras endpoint)
                            queryClient.setQueryData(QK.wfCameras(projectId, null, null), old => {
                                if (!Array.isArray(old)) return old
                                return old.map(cam =>
                                    cam.camera_id === data.camera_id
                                        ? {
                                            ...cam,
                                            latest_worker_count: data.current_worker_count,
                                            active_count:        data.active_count,
                                            idle_count:          data.idle_count,
                                            latest_utilization:  data.utilization_score,
                                            latest_zone_status:  data.zone_status,
                                            congestion_flag:     data.congestion_flag,
                                            avg_dwell_seconds:   data.avg_dwell_seconds,
                                            sparkline:           data.sparkline ?? cam.sparkline,
                                        }
                                        : cam
                                )
                            })
                            callbacksRef.current?.onStatsUpdate?.(data)

                        } else if (data.type === 'workforce_alert') {
                            // Keep invalidation focused. Live charts use SSE stats; these endpoints are the ones
                            // that actually change due to alerts.
                            queryClient.invalidateQueries({ queryKey: ['workforce', 'summary', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['workforce', 'alerts',  projectId] })
                            queryClient.invalidateQueries({ queryKey: ['workforce', 'cameras', projectId] })
                            // Fire window event so off-page tables also refetch.
                            window.dispatchEvent(new Event('cs:workforce-alerts-refresh'))
                            // Cross-tab sync (same browser).
                            broadcastRefresh('wf:new-alert', { projectId, ...data })
                            callbacksRef.current?.onAlert?.(data)

                        } else if (data.type === 'workforce_alert_updated') {
                            // Surgical in-place patch — no refetch, no scroll jump
                            patchAlertInCache(queryClient, projectId, data)
                            // Summary open-alert count must reflect the status change
                            queryClient.invalidateQueries({ queryKey: ['workforce', 'summary', projectId] })
                            // Per-zone/camera open-alert counts also change when an alert is resolved/acknowledged.
                            queryClient.invalidateQueries({ queryKey: ['workforce', 'cameras', projectId] })
                            callbacksRef.current?.onAlertUpdated?.(data)
                            window.dispatchEvent(new Event('cs:workforce-alerts-refresh'))
                            broadcastRefresh('wf:alert-updated', { projectId, ...data })

                        } else if (data.type === 'workforce_feature_changed') {
                            // Source of truth: the SSE payload itself carries any_camera_active
                            // and the per-camera state. Works in every account/window including
                            // ones that have never visited the dashboard (no cache).
                            let anyActive = data.any_camera_active

                            const statusKey = QK.wfStatus(projectId)
                            const cached = queryClient.getQueryData(statusKey)

                            if (Array.isArray(data.cameras) && data.cameras.length > 0) {
                                const liveStart = (() => {
                                    if (!anyActive) return null
                                    // Match PPE behaviour: trust server-authoritative start if present.
                                    // Do NOT synthesize "now" — that creates cross-tab drift.
                                    if (data.live_session_start) return data.live_session_start
                                    return cached?.live_session_start ?? null
                                })()
                                queryClient.setQueryData(statusKey, {
                                    ...(cached && !Array.isArray(cached) ? cached : {}),
                                    cameras: data.cameras.map(c => ({
                                        camera_id: c.camera_id,
                                        features: {
                                            ...(cached && !Array.isArray(cached)
                                                ? cached.cameras?.find(x => x.camera_id === c.camera_id)?.features
                                                : null),
                                            workforce_enabled: !!c.workforce_enabled,
                                        },
                                    })),
                                    live_session_start: liveStart,
                                })
                                if (anyActive == null) {
                                    anyActive = data.cameras.some(c => c.workforce_enabled === true)
                                }
                            } else if (data.camera_id != null && data.workforce_enabled != null && cached) {
                                // Legacy / partial payload — patch single camera in cache
                                const cams = Array.isArray(cached) ? cached : (cached.cameras ?? [])
                                const updatedCams = cams.map(c =>
                                    c.camera_id === data.camera_id
                                        ? { ...c, features: { ...c.features, workforce_enabled: data.workforce_enabled } }
                                        : c
                                )
                                if (anyActive == null) {
                                    anyActive = updatedCams.some(c => c.features?.workforce_enabled === true)
                                }
                                queryClient.setQueryData(statusKey, {
                                    ...(Array.isArray(cached) ? {} : cached),
                                    cameras: updatedCams,
                                    live_session_start: anyActive ? (cached?.live_session_start ?? null) : null,
                                })
                            }

                            // Hard-wipe data caches on every feature transition so any
                            // tab/window/account starts from a clean slate. This hook runs at
                            // workspace level (mounted by the toast component) — so the wipe
                            // happens whether or not the dashboard is currently visible.
                            const WF_DATA_KEYS = [
                                ['workforce', 'summary'],
                                ['workforce', 'trend'],
                                ['workforce', 'trend-live'],
                                ['workforce', 'cameras'],
                                ['workforce', 'scatter'],
                                ['workforce', 'heatmap'],
                                ['workforce', 'alerts'],
                            ]
                            WF_DATA_KEYS.forEach(k => {
                                queryClient.setQueriesData({ queryKey: k }, null)
                                queryClient.removeQueries({ queryKey: k })
                            })
                            queryClient.invalidateQueries({ queryKey: ['workforce'] })

                            // Forward to same-browser tabs as a fast-path; cross-account/window
                            // tabs get the same payload directly via their own SSE.
                            broadcastRefresh('wf:feature-changed', { projectId, ...data, anyActive })
                            callbacksRef.current?.onFeatureChanged?.({ ...data, anyActive })
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

        // Stay connected in background tabs — alerts must not be missed.
        // Browsers keep SSE alive in background tabs; server heartbeats prevent timeouts.
        connect()

        return () => {
            closed = true
            disconnect()
        }
    }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
}
