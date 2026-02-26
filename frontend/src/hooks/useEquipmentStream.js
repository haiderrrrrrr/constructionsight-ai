import { useEffect, useRef } from 'react'
import { STREAM_BASE, refreshTokens, isTokenValid } from '@/utils/api'
import { QK } from '@/utils/queryKeys'
import { broadcastRefresh } from '@/utils/broadcast'
import { patchAlertInCache } from '@/utils/equipmentCacheUtils'

/**
 * Opens a project-scoped SSE connection to /projects/{projectId}/equipment/stream.
 * Mirrors useWorkforceStream.js — drives React Query cache directly (setQueryData for
 * surgical patches, removeQueries+invalidateQueries on feature-changed) so every
 * tab/window/account stays consistent without polling.
 *
 * Event types handled:
 *   equipment_stats_update   — per-camera live metrics (patches eqCameras cache)
 *   equipment_alert          — new alert (invalidates eqSummary/eqAlerts; toast fires)
 *   equipment_alert_updated  — status change (patches eqAlerts in place + open_alerts counter)
 *   equipment_feature_changed — toggle on/off (wipes data caches, syncs live_session_start)
 *
 * @param {string|number} projectId
 * @param {QueryClient} queryClient
 * @param {{
 *   onStatsUpdate?:   (data: object) => void,
 *   onAlert?:         (data: object) => void,
 *   onAlertUpdated?:  (data: object) => void,
 *   onFeatureChanged?: (data: object) => void,
 *   onConnect?:       () => void,
 *   onDisconnect?:    () => void,
 * }} callbacks
 */
export default function useEquipmentStream(projectId, queryClient, callbacks = {}) {
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

            const url = `${STREAM_BASE}/projects/${projectId}/equipment/stream?token=${encodeURIComponent(token)}`
            try {
                es = new EventSource(url, { withCredentials: true })

                es.onopen = () => {
                    backoffMs = 1000
                    callbacksRef.current?.onConnect?.()
                }

                es.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data)

                        if (data.type === 'equipment_stats_update') {
                            // Patch the cameras list cache in-place (array format from /cameras endpoint)
                            queryClient.setQueryData(QK.eqCameras(projectId, null, null), old => {
                                if (!Array.isArray(old)) return old
                                return old.map(cam =>
                                    cam.camera_id === data.camera_id
                                        ? {
                                            ...cam,
                                            latest_active_count:  data.active_count,
                                            active_count:         data.active_count,
                                            idle_count:           data.idle_count,
                                            total_count:          data.total_count,
                                            latest_utilization:   data.utilization_score,
                                            latest_zone_status:   data.zone_status,
                                            misuse_flags:         data.misuse_flags ?? cam.misuse_flags,
                                            avg_active_duration:  data.avg_active_duration,
                                            cross_zone_conflicts: data.cross_zone_conflicts,
                                            sparkline:            data.sparkline ?? cam.sparkline,
                                        }
                                        : cam
                                )
                            })
                            callbacksRef.current?.onStatsUpdate?.(data)

                        } else if (data.type === 'equipment_alert') {
                            queryClient.invalidateQueries({ queryKey: ['equipment', 'summary', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['equipment', 'alerts',  projectId] })
                            queryClient.invalidateQueries({ queryKey: ['equipment', 'cameras', projectId] })
                            window.dispatchEvent(new Event('cs:equipment-alerts-refresh'))
                            broadcastRefresh('eq:new-alert', { projectId, ...data })
                            callbacksRef.current?.onAlert?.(data)

                        } else if (data.type === 'equipment_alert_updated') {
                            patchAlertInCache(queryClient, projectId, data)
                            queryClient.invalidateQueries({ queryKey: ['equipment', 'summary', projectId] })
                            queryClient.invalidateQueries({ queryKey: ['equipment', 'cameras', projectId] })
                            callbacksRef.current?.onAlertUpdated?.(data)
                            window.dispatchEvent(new Event('cs:equipment-alerts-refresh'))
                            broadcastRefresh('eq:alert-updated', { projectId, ...data })

                        } else if (data.type === 'equipment_feature_changed') {
                            let anyActive = data.any_camera_active

                            const statusKey = QK.eqStatus(projectId)
                            const cached = queryClient.getQueryData(statusKey)

                            if (Array.isArray(data.cameras) && data.cameras.length > 0) {
                                const liveStart = (() => {
                                    if (!anyActive) return null
                                    if (data.live_session_start) return data.live_session_start
                                    return cached?.live_session_start ?? null
                                })()
                                const cachedCams = Array.isArray(cached) ? cached : (cached?.cameras ?? [])
                                const incomingById = new Map(data.cameras.map(c => [c.camera_id, c]))
                                const mergedCams = [
                                    ...cachedCams.map(c => {
                                        const inc = incomingById.get(c.camera_id)
                                        if (!inc) return c
                                        incomingById.delete(c.camera_id)
                                        return {
                                            ...c,
                                            features: {
                                                ...(c.features || {}),
                                                equipment_enabled: !!inc.equipment_enabled,
                                            },
                                        }
                                    }),
                                    ...Array.from(incomingById.values()).map(c => ({
                                        camera_id: c.camera_id,
                                        camera_name: c.camera_name,
                                        zone_name: c.zone_name,
                                        features: { equipment_enabled: !!c.equipment_enabled },
                                    })),
                                ]
                                queryClient.setQueryData(statusKey, {
                                    ...(cached && !Array.isArray(cached) ? cached : {}),
                                    cameras: mergedCams,
                                    live_session_start: liveStart,
                                })
                                if (anyActive == null) {
                                    anyActive = mergedCams.some(c => c.features?.equipment_enabled === true)
                                }
                            } else if (data.camera_id != null && data.equipment_enabled != null && cached) {
                                const cams = Array.isArray(cached) ? cached : (cached.cameras ?? [])
                                const updatedCams = cams.map(c =>
                                    c.camera_id === data.camera_id
                                        ? { ...c, features: { ...c.features, equipment_enabled: data.equipment_enabled } }
                                        : c
                                )
                                if (anyActive == null) {
                                    anyActive = updatedCams.some(c => c.features?.equipment_enabled === true)
                                }
                                queryClient.setQueryData(statusKey, {
                                    ...(Array.isArray(cached) ? {} : cached),
                                    cameras: updatedCams,
                                    live_session_start: anyActive ? (cached?.live_session_start ?? null) : null,
                                })
                            }

                            const EQ_DATA_KEYS = [
                                ['equipment', 'summary'],
                                ['equipment', 'trend'],
                                ['equipment', 'trend-live'],
                                ['equipment', 'cameras'],
                                ['equipment', 'scatter'],
                                ['equipment', 'alerts'],
                            ]
                            EQ_DATA_KEYS.forEach(k => {
                                queryClient.setQueriesData({ queryKey: k }, null)
                                queryClient.removeQueries({ queryKey: k })
                            })
                            queryClient.invalidateQueries({ queryKey: ['equipment'] })

                            broadcastRefresh('eq:feature-changed', { projectId, ...data, anyActive })
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

        connect()

        return () => {
            closed = true
            disconnect()
        }
    }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps
}
