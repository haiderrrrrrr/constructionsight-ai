import { useEffect, useRef } from 'react'
import { API_BASE, refreshTokens, isTokenValid } from '@/utils/api'
import { QK } from '@/utils/queryKeys'
import { broadcastRefresh } from '@/utils/broadcast'

/**
 * Opens a project-scoped SSE connection to /projects/{projectId}/risk/stream.
 * Mirrors useWorkforceStream.js — drives React Query cache directly so every
 * tab/window stays consistent without polling.
 *
 * Event types handled:
 *   risk_stats_update    — full zone risk payload; invalidates summary/zones/trend
 *   risk_event_created   — new risk event (toast fires for high/critical)
 *   risk_event_updated   — status change (invalidates events cache)
 *
 * @param {string|number} projectId
 * @param {QueryClient} queryClient
 * @param {{
 *   onStatsUpdate?:    (data: object) => void,
 *   onEventCreated?:   (data: object) => void,
 *   onEventUpdated?:   (data: object) => void,
 *   onConnect?:        () => void,
 *   onDisconnect?:     () => void,
 * }} callbacks
 */
export default function useRiskStream(projectId, queryClient, callbacks = {}) {
    const callbacksRef = useRef(callbacks)
    useEffect(() => { callbacksRef.current = callbacks })

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

            const url = `${API_BASE}/projects/${projectId}/risk/stream?token=${encodeURIComponent(token)}`
            try {
                es = new EventSource(url, { withCredentials: true })

                es.onopen = () => {
                    backoffMs = 1000
                    callbacksRef.current?.onConnect?.()
                }

                es.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data)

                        if (data.type === 'risk_stats_update') {
                            const zones = Array.isArray(data.zones) ? data.zones : []
                            const criticalZones = zones.filter(z => z?.risk_level === 'critical').length
                            const highRiskZones = zones.filter(z => z?.risk_level === 'high' || z?.risk_level === 'critical').length

                            // Invalidate summary + zones so dashboard cards refetch fresh data.
                            queryClient.invalidateQueries({ queryKey: QK.riskSummary(projectId) })
                            queryClient.invalidateQueries({ queryKey: QK.riskZones(projectId) })
                            queryClient.invalidateQueries({ queryKey: ['risk', 'trend', projectId] })
                            broadcastRefresh('risk:invalidate', {
                                projectId,
                                timestamp: data.timestamp || null,
                                zones: zones.length,
                                critical_zones: criticalZones,
                                high_risk_zones: highRiskZones,
                                overall_risk: data.overall_risk ?? null,
                                overall_risk_p95: data.overall_risk_p95 ?? null,
                                overall_risk_avg: data.overall_risk_avg ?? null,
                                overall_risk_max: data.overall_risk_max ?? null,
                            })
                            callbacksRef.current?.onStatsUpdate?.(data)

                        } else if (data.type === 'risk_event_created') {
                            queryClient.invalidateQueries({ queryKey: ['risk', 'events', projectId] })
                            broadcastRefresh('risk:new-event', { projectId, ...data })
                            callbacksRef.current?.onEventCreated?.(data)
                            if (data.severity === 'high' || data.severity === 'critical') {
                                callbacksRef.current?.onAlert?.(data)
                            }

                        } else if (data.type === 'risk_event_updated') {
                            queryClient.invalidateQueries({ queryKey: ['risk', 'events', projectId] })
                            broadcastRefresh('risk:event-updated', { projectId, ...data })
                            callbacksRef.current?.onEventUpdated?.(data)
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
