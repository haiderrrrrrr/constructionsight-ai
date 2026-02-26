import { useEffect, useRef } from 'react'
import { STREAM_BASE, refreshTokens, isTokenValid } from '@/utils/api'
import { QK } from '@/utils/queryKeys'
import { broadcastRefresh } from '@/utils/broadcast'
import { patchAlertInCache } from '@/utils/activityCacheUtils'

/**
 * Opens a project-scoped SSE connection to /projects/{projectId}/activity/stream.
 * Mirrors useWorkforceStream.js — drives React Query cache directly (setQueryData for
 * surgical patches) so every tab/window/account stays consistent without polling.
 *
 * Event types handled:
 *   activity_stats_update — per-camera live metrics (patches actCameras cache)
 *   activity_alert        — new alert (invalidates actSummary/actAlerts; toast fires)
 *
 * @param {string|number} projectId
 * @param {QueryClient} queryClient
 * @param {{
 *   onStatsUpdate?: (data: object) => void,
 *   onAlert?:       (data: object) => void,
 *   onConnect?:     () => void,
 *   onDisconnect?:  () => void,
 * }} callbacks
 */
export default function useActivityStream(projectId, queryClient, callbacks = {}) {
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

            const url = `${STREAM_BASE}/projects/${projectId}/activity/stream?token=${encodeURIComponent(token)}`
            try {
                es = new EventSource(url, { withCredentials: true })

                es.onopen = () => {
                    backoffMs = 1000
                    callbacksRef.current?.onConnect?.()
                }

                es.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data)

                        if (data.type === 'activity_stats_update') {
                            // Patch the cameras list cache in-place (array format from /cameras endpoint)
                            queryClient.setQueryData(QK.actCameras(projectId, null, null), old => {
                                if (!Array.isArray(old)) return old
                                return old.map(cam =>
                                    cam.camera_id === data.camera_id
                                        ? {
                                            ...cam,
                                            moving_count:           data.moving_count,
                                            idle_count:             data.idle_count,
                                            stationary_count:       data.stationary_count,
                                            activity_score:         data.activity_score,
                                            motion_intensity_score: data.motion_intensity_score,
                                            idle_duration_seconds:  data.idle_duration_seconds,
                                            zone_state:             data.zone_state,
                                            sparkline:              data.sparkline ?? cam.sparkline,
                                        }
                                        : cam
                                )
                            })
                            callbacksRef.current?.onStatsUpdate?.(data)

                        } else if (data.type === 'activity_alert') {
                            // New alert — invalidate summary + alerts so KPI cards and table refetch.
                            queryClient.invalidateQueries({ queryKey: ['activity', 'summary', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['activity', 'alerts',  projectId] })
                            // Keep dashboard charts/tables consistent even when the dashboard isn't mounted.
                            queryClient.invalidateQueries({ queryKey: ['activity', 'cameras', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['activity', 'scatter', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['activity', 'trend',   projectId] })
                            // Fire window event so off-page tables also refetch.
                            window.dispatchEvent(new Event('cs:activity-alerts-refresh'))
                            // Cross-tab toast sync (same browser).
                            broadcastRefresh('act:new-alert', { projectId, ...data })
                            callbacksRef.current?.onAlert?.(data)
                        } else if (data.type === 'activity_alert_updated') {
                            patchAlertInCache(queryClient, projectId, data)
                            queryClient.invalidateQueries({ queryKey: ['activity', 'summary', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['activity', 'cameras', projectId] })
                            window.dispatchEvent(new Event('cs:activity-alerts-refresh'))
                            broadcastRefresh('act:alert-updated', { projectId, ...data })
                        } else if (data.type === 'activity_feature_changed') {
                            let anyActive = data.any_camera_active
                            const statusKey = QK.actStatus(projectId)
                            const cached = queryClient.getQueryData(statusKey)

                            if (Array.isArray(data.cameras) && data.cameras.length > 0) {
                                const liveStart = (() => {
                                    if (!anyActive) return null
                                    if (data.live_session_start) return data.live_session_start
                                    return cached?.activity_live_session_start ?? null
                                })()
                                queryClient.setQueryData(statusKey, {
                                    ...(cached && !Array.isArray(cached) ? cached : {}),
                                    cameras: data.cameras.map(c => ({
                                        camera_id: c.camera_id,
                                        features: {
                                            ...(cached && !Array.isArray(cached)
                                                ? cached.cameras?.find(x => x.camera_id === c.camera_id)?.features
                                                : null),
                                            activity_enabled: !!c.activity_enabled,
                                        },
                                    })),
                                    activity_live_session_start: liveStart,
                                })
                                if (anyActive == null) {
                                    anyActive = data.cameras.some(c => c.activity_enabled === true)
                                }
                            } else if (data.camera_id != null && data.activity_enabled != null && cached) {
                                const cams = Array.isArray(cached) ? cached : (cached.cameras ?? [])
                                const updatedCams = cams.map(c =>
                                    c.camera_id === data.camera_id
                                        ? { ...c, features: { ...c.features, activity_enabled: data.activity_enabled } }
                                        : c
                                )
                                if (anyActive == null) {
                                    anyActive = updatedCams.some(c => c.features?.activity_enabled === true)
                                }
                                queryClient.setQueryData(statusKey, {
                                    ...(Array.isArray(cached) ? {} : cached),
                                    cameras: updatedCams,
                                    activity_live_session_start: anyActive ? (cached?.activity_live_session_start ?? null) : null,
                                })
                            }

                            const ACT_DATA_KEYS = [
                                ['activity', 'summary'],
                                ['activity', 'trend'],
                                ['activity', 'trend-live'],
                                ['activity', 'cameras'],
                                ['activity', 'scatter'],
                                ['activity', 'heatmap'],
                                ['activity', 'alerts'],
                            ]
                            ACT_DATA_KEYS.forEach(k => {
                                queryClient.setQueriesData({ queryKey: k }, null)
                                queryClient.removeQueries({ queryKey: k })
                            })
                            queryClient.invalidateQueries({ queryKey: ['activity'] })

                            broadcastRefresh('act:feature-changed', { projectId, ...data, anyActive })
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
