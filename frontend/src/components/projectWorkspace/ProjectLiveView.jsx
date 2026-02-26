import React, { useState, useEffect, useCallback } from 'react'
import { FiMaximize2 } from 'react-icons/fi'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE, STREAM_BASE, apiGet, apiPatch } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { openCameraStream } from '@/utils/cameraSSE'
import { QK } from '@/utils/queryKeys'

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png'

// ── Status badges ─────────────────────────────────────────────────────────────

const registryStatus = (raw) => {
    const key = String(raw?.content || raw || '').toLowerCase().replace(/\s/g, '_')
    const map = {
        draft:         { color: 'bg-soft-danger text-danger',     label: 'Draft' },
        verifying:     { color: 'bg-soft-teal text-teal',         label: 'Verifying' },
        verified:      { color: 'bg-soft-warning text-warning',   label: 'Verified' },
        verify_failed: { color: 'bg-soft-danger text-danger',     label: 'Failed' },
        archived:      { color: 'bg-soft-info text-info',         label: 'Archived' },
    }
    return map[key] || { color: 'bg-soft-secondary text-muted', label: 'Unknown' }
}

const RegistryStatusBadge = ({ status }) => {
    const cfg = registryStatus(status)
    return <span className={`badge ${cfg.color} fs-11 fw-bold text-uppercase`}>{cfg.label}</span>
}

const ZoneBadge = ({ zoneName }) => (
    <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">
        Zone {zoneName ? zoneName : '?'}
    </span>
)

const HealthStatusBadge = ({ status }) => {
    const map = {
        healthy:     { color: 'bg-soft-success text-success', label: 'Healthy' },
        degraded:    { color: 'bg-soft-warning text-warning', label: 'Degraded' },
        offline:     { color: 'bg-soft-danger text-danger', label: 'Offline' },
        maintenance: { color: 'bg-soft-info text-info', label: 'Maintenance' },
        no_data:     { color: 'bg-gray-200 text-muted', label: 'No Data' },
    }
    const cfg = map[(status || 'no_data').toLowerCase()] || map.no_data
    return <span className={`badge ${cfg.color} fs-11 fw-bold text-uppercase`}>{cfg.label}</span>
}

const WorkerBadge = ({ status }) => {
    if (status === 'running') return <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase">Running</span>
    if (status === 'error')   return <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">Error</span>
    return <span className="badge bg-soft-info text-info fs-11 fw-bold text-uppercase">Idle</span>
}

const FeatureCountBadge = ({ count, heavy }) => {
    if (count === 0) return null
    const color = heavy ? 'bg-soft-warning text-warning' : 'bg-soft-info text-info'
    return (
        <span className={`badge ${color} fs-11 fw-bold text-uppercase`}>
            {count} Feature{count !== 1 ? 's' : ''} Active{heavy ? ' · GPU Heavy' : ''}
        </span>
    )
}

// ── Feature toggle row ────────────────────────────────────────────────────────

const ToggleSwitch = ({ checked, onChange, disabled }) => (
    <label className={`cs-fc-toggle ${disabled ? 'cs-fc-toggle-disabled' : ''}`}>
        <input
            className="cs-fc-toggle-input"
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
        />
        <span className="cs-fc-toggle-ui" />
    </label>
)

const FeatureRow = ({ label, icon, enabled, onToggle, loading, disabled, disabledReason }) => (
    <div
        className="d-flex align-items-center justify-content-between py-1"
        style={{
            borderBottom: '1px solid rgba(128,128,128,0.12)',
            opacity: disabled ? 0.6 : 1,
        }}
        title={disabledReason}
    >
        <div className="d-flex align-items-center gap-2">
            <i className={`${icon} fs-13 text-muted`} />
            <span className="fs-13">{label}</span>
        </div>
        <div className="d-flex align-items-center gap-2">
            {loading && <span className="spinner-border spinner-border-sm text-muted" style={{ width: 14, height: 14 }} />}
            <ToggleSwitch
                checked={enabled}
                onChange={e => onToggle(e.target.checked)}
                disabled={loading || disabled}
            />
        </div>
    </div>
)

// ── Camera feature control card ───────────────────────────────────────────────

const CameraFeatureCard = ({ cam: initialCam, projectId, onFeatureToggle }) => {
    const [cam, setCam] = useState(initialCam)
    const [toggling, setToggling] = useState({})
    const queryClient = useQueryClient()

    // Sync if parent reloads the camera
    useEffect(() => { setCam(initialCam) }, [initialCam])

    const features = cam.features || {}
    const activeCount = Object.values(features).filter(Boolean).length
    const isGpuHeavy  = activeCount >= 2

    const toggle = useCallback(async (featureName, newValue) => {
        // Only enable check — disabling doesn't require zone or health
        if (newValue) {
            // Check zone assignment
            if (!cam.zone_name) {
                topTostError(`Assign zone for "${cam.camera_name}" first before enabling features`, 'warning')
                return
            }

            // Check camera verification status
            if (cam.registry_status !== 'verified') {
                topTostError(`Camera must be verified first (current: ${cam.registry_status})`, 'warning')
                return
            }

            // Check camera health — must be healthy or degraded (not offline/maintenance)
            const healthOk = ['healthy', 'degraded'].includes(cam.latest_health_status)
            if (!healthOk) {
                topTostError(
                    `Camera is ${cam.latest_health_status} — check RTSP connection and verify again`,
                    'warning'
                )
                return
            }
        }

        setToggling(t => ({ ...t, [featureName]: true }))
        const colName = `${featureName}_enabled`

        // Optimistic update — instant visual feedback
        const updatedCam = {
            ...cam,
            features: { ...cam.features, [colName]: newValue },
        }
        setCam(updatedCam)

        try {
            const response = await apiPatch(`/projects/${projectId}/cameras/${cam.camera_id}/features`, {
                [colName]: newValue,
            })

            // Update with returned health status, worker_status, AND features (race condition fix)
            // Use response features as source of truth since backend just updated them
            const syncedCam = {
                ...cam,
                latest_health_status: response.latest_health_status || cam.latest_health_status,
                worker_status: response.worker_status || cam.worker_status,
                features: response.features || cam.features,  // Use response features, not optimistic update
            }
            setCam(syncedCam)

            // Check for startup warnings (feature enabled but pipeline failed)
            if (response.startup_warnings) {
                topTostError(
                    response.startup_warnings.message,
                    'warning'
                )
            }

            // Notify parent to update streams section immediately with synced data
            if (onFeatureToggle) {
                onFeatureToggle(cam.camera_id, syncedCam)
            }

            // Instant cross-tab/window clear — don't wait for SSE round-trip
            if (featureName === 'ppe') {
                const cached = queryClient.getQueryData(QK.ppeStatus(projectId))
                const cams = Array.isArray(cached) ? cached : (cached?.cameras ?? [])
                const updatedCams = cams.map(c =>
                    c.camera_id === cam.camera_id
                        ? { ...c, features: { ...c.features, ppe_enabled: newValue } }
                        : c
                )
                const anyActive = updatedCams.length
                    ? updatedCams.some(c => c.features?.ppe_enabled === true)
                    : newValue
                broadcastRefresh('ppe:feature-changed', {
                    projectId,
                    camera_id: cam.camera_id,
                    ppe_enabled: newValue,
                    anyActive,
                    // ProjectLiveView listener uses these:
                    featureKey: 'ppe_enabled',
                    enabled: newValue,
                })
            } else if (featureName === 'workforce') {
                const cached = queryClient.getQueryData(QK.wfStatus(projectId))
                const cams = Array.isArray(cached) ? cached : (cached?.cameras ?? [])
                const updatedCams = cams.map(c =>
                    c.camera_id === cam.camera_id
                        ? { ...c, features: { ...c.features, workforce_enabled: newValue } }
                        : c
                )
                const anyActive = updatedCams.length
                    ? updatedCams.some(c => c.features?.workforce_enabled === true)
                    : newValue
                broadcastRefresh('workforce:feature-changed', {
                    projectId,
                    camera_id: cam.camera_id,
                    workforce_enabled: newValue,
                    anyActive,
                    featureKey: colName,
                    enabled: newValue,
                })
            } else {
                // Activity / Equipment — feature-agnostic broadcast
                // for instant cross-tab sync of toggle UI. SSE catches up
                // cross-browser within RTT.
                broadcastRefresh(`${featureName}:feature-changed`, {
                    projectId,
                    camera_id: cam.camera_id,
                    featureKey: colName,
                    enabled: newValue,
                })
            }
            // Broadcast to trigger feature section re-render (show/hide streams based on toggle)
            broadcastRefresh('cs:feature-toggle-updated')
        } catch (err) {
            // Revert on failure
            setCam(prev => ({
                ...prev,
                features: { ...prev.features, [colName]: !newValue },
            }))
            topTostError(err?.response?.data?.detail || `Failed to toggle ${featureName}`)
        } finally {
            setToggling(t => ({ ...t, [featureName]: false }))
        }
    }, [cam, projectId, onFeatureToggle])

    return (
        <div className="card stretch stretch-full h-100 cs-fc-camera-card">
            <div className="card-body py-3 px-3 d-flex flex-column gap-2">
                <div className="cs-fc-cam-head">
                    <div className="d-flex align-items-center gap-2">
                        <div
                            className="flex-shrink-0 cam-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <img
                                src={cam.logo_url || cam.logo || DEFAULT_CAMERA_LOGO}
                                alt={cam.camera_name}
                                onError={(e) => { e.currentTarget.src = DEFAULT_CAMERA_LOGO }}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }}
                            />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div className="cs-fc-cam-title text-truncate">{cam.camera_name}</div>
                            <div className="d-flex flex-wrap align-items-center gap-1 mt-1">
                                <RegistryStatusBadge status={cam.registry_status} />
                                <ZoneBadge zoneName={cam.zone_name} />
                            </div>
                        </div>
                    </div>
                    <div className="d-flex align-items-center gap-1 flex-wrap">
                        <HealthStatusBadge status={cam.latest_health_status} />
                        <span className="d-none d-sm-inline-flex align-items-center gap-1">
                            <WorkerBadge status={cam.worker_status} />
                            <FeatureCountBadge count={activeCount} heavy={isGpuHeavy} />
                        </span>
                    </div>
                </div>

                <div>
                    <span className="text-muted fs-11 fw-semibold text-uppercase" style={{ letterSpacing: '0.06em' }}>
                        Analytics Modules
                    </span>
                    <div className="mt-1">
                        <FeatureRow
                            label="PPE Detection"
                            icon="feather-shield"
                            enabled={!!features.ppe_enabled}
                            onToggle={v => toggle('ppe', v)}
                            loading={!!toggling.ppe}
                            disabled={!cam.zone_name || cam.registry_status !== 'verified' || !['healthy', 'degraded'].includes(cam.latest_health_status)}
                            disabledReason={
                                !cam.zone_name ? 'Assign zone first' :
                                cam.registry_status !== 'verified' ? `Camera ${cam.registry_status}` :
                                !['healthy', 'degraded'].includes(cam.latest_health_status) ? `Camera ${cam.latest_health_status}` :
                                undefined
                            }
                        />
                        <FeatureRow
                            label="Workforce Analytics"
                            icon="feather-users"
                            enabled={!!features.workforce_enabled}
                            onToggle={v => toggle('workforce', v)}
                            loading={!!toggling.workforce}
                            disabled={!cam.zone_name || cam.registry_status !== 'verified' || !['healthy', 'degraded'].includes(cam.latest_health_status)}
                            disabledReason={
                                !cam.zone_name ? 'Assign zone first' :
                                cam.registry_status !== 'verified' ? `Camera ${cam.registry_status}` :
                                !['healthy', 'degraded'].includes(cam.latest_health_status) ? `Camera ${cam.latest_health_status}` :
                                undefined
                            }
                        />
                        <FeatureRow
                            label="Activity Tracking"
                            icon="feather-activity"
                            enabled={!!features.activity_enabled}
                            onToggle={v => toggle('activity', v)}
                            loading={!!toggling.activity}
                            disabled={!cam.zone_name || cam.registry_status !== 'verified' || !['healthy', 'degraded'].includes(cam.latest_health_status)}
                            disabledReason={
                                !cam.zone_name ? 'Assign zone first' :
                                cam.registry_status !== 'verified' ? `Camera ${cam.registry_status}` :
                                !['healthy', 'degraded'].includes(cam.latest_health_status) ? `Camera ${cam.latest_health_status}` :
                                undefined
                            }
                        />
                        <FeatureRow
                            label="Equipment Detection"
                            icon="feather-truck"
                            enabled={!!features.equipment_enabled}
                            onToggle={v => toggle('equipment', v)}
                            loading={!!toggling.equipment}
                            disabled={!cam.zone_name || cam.registry_status !== 'verified' || !['healthy', 'degraded'].includes(cam.latest_health_status)}
                            disabledReason={
                                !cam.zone_name ? 'Assign zone first' :
                                cam.registry_status !== 'verified' ? `Camera ${cam.registry_status}` :
                                !['healthy', 'degraded'].includes(cam.latest_health_status) ? `Camera ${cam.latest_health_status}` :
                                undefined
                            }
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Camera Stream Display (for feature sections) ──────────────────────────────

const _streamPathFor = (featureName, projectId, cameraId) => {
    if (featureName === 'workforce') return `/projects/${projectId}/workforce/stream/${cameraId}`
    if (featureName === 'activity')  return `/projects/${projectId}/activity/stream/${cameraId}`
    return `/stream/${cameraId}`
}

const _uniqueBases = () => {
    const arr = [STREAM_BASE, API_BASE].filter(Boolean)
    return Array.from(new Set(arr))
}

const useMjpegStream = (streamPath) => {
    const [imgError, setImgError] = useState(false)
    const [imgKey, setImgKey] = useState(0)
    const [retryCount, setRetryCount] = useState(0)
    const [baseIdx, setBaseIdx] = useState(0)
    const imgRef = React.useRef(null)
    const bases = React.useMemo(() => _uniqueBases(), [])

    useEffect(() => {
        setImgError(false)
        setImgKey(k => k + 1)
        setRetryCount(0)
        setBaseIdx(0)
    }, [streamPath])

    const base = bases[Math.min(baseIdx, bases.length - 1)] || STREAM_BASE
    const sep = streamPath.includes('?') ? '&' : '?'
    const src = `${base}${streamPath}${sep}r=${imgKey}`

    useEffect(() => {
        if (imgError) return
        let cancelled = false
        const id = setInterval(() => {
            if (cancelled) return
            const el = imgRef.current
            if (!el) return
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                if (retryCount !== 0) setRetryCount(0)
                return
            }
            setImgError(true)
            setRetryCount(n => n + 1)
        }, 8000)
        return () => { cancelled = true; clearInterval(id) }
    }, [imgError, imgKey, retryCount])

    useEffect(() => {
        if (!imgError) return
        if (baseIdx < bases.length - 1) {
            setBaseIdx(i => i + 1)
            setImgError(false)
            setImgKey(k => k + 1)
            return
        }
        const delay = Math.min(1000 * Math.pow(2, Math.max(0, retryCount - 1)), 8000)
        const id = setTimeout(() => {
            setImgError(false)
            setImgKey(k => k + 1)
        }, delay)
        return () => clearTimeout(id)
    }, [imgError, retryCount, baseIdx, bases.length])

    return {
        imgError,
        imgKey,
        imgRef,
        src,
        onError: () => {
            setImgError(true)
            setRetryCount(n => n + 1)
        },
    }
}

const CameraStreamCard = ({ cam, featureName, projectId }) => {
    const [fullscreen, setFullscreen] = useState(false)
    const streamPath = _streamPathFor(featureName, projectId, cam.camera_id)
    const { imgError, imgKey, imgRef, src, onError } = useMjpegStream(streamPath)

    useEffect(() => {
        if (!fullscreen) return
        const onKey = e => { if (e.key === 'Escape') setFullscreen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [fullscreen])

    return (
        <>
            <div
                className={fullscreen ? 'col-12 cs-fc-overlay' : 'col-12 col-md-6'}
                style={
                    fullscreen
                        ? { position: 'fixed', inset: 0, zIndex: 9999, padding: 18, display: 'flex' }
                        : undefined
                }
            >
                <div
                    className="card stretch stretch-full h-100 cs-fc-stream-card"
                    style={fullscreen ? { width: '100%' } : undefined}
                >
                    <div className="card-header py-2 px-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                            <span className="cs-fc-stream-title fw-semibold fs-13 text-truncate">{cam.camera_name}</span>
                            <ZoneBadge zoneName={cam.zone_name} />
                        </div>
                        <div className="d-flex align-items-center gap-2">
                            {fullscreen ? (
                                <button type="button" className="btn-close cs-fc-overlay-close" onClick={() => setFullscreen(false)} title="Close (Esc)" />
                            ) : (
                                <button className="cs-fc-expand-btn d-none d-sm-flex" onClick={() => setFullscreen(true)} title="Expand to fullscreen">
                                    <FiMaximize2 size={16} />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className={`card-body p-0 ${fullscreen ? 'cs-fc-overlay-body' : ''}`} style={{ overflow: 'hidden' }}>
                        {imgError ? (
                            <div className="d-flex align-items-center justify-content-center text-muted" style={{ aspectRatio: '16/9' }}>
                                <div className="text-center">
                                    <i className="feather-camera-off fs-24 d-block mb-2" />
                                    <span className="fs-12">Stream unavailable</span>
                                </div>
                            </div>
                        ) : (
                            <div style={fullscreen ? { width: '100%', height: '100%' } : { position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden' }}>
                                <img
                                    key={imgKey}
                                    src={src}
                                    alt={cam.camera_name}
                                    className={fullscreen ? 'cs-fc-overlay-img' : undefined}
                                    style={fullscreen ? undefined : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                    onError={onError}
                                    ref={imgRef}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}

// ── Feature section with cameras ──────────────────────────────────────────────

const FeatureSection = ({ featureName, featureLabel, featureIcon, cameras, projectId }) => {
    const filteredCams = cameras.filter(cam => {
        const features = cam.features || {}
        const colName = `${featureName}_enabled`
        return features[colName] === true
    })

    if (filteredCams.length === 0) return null

    return (
        <div className="mt-4">
            <div className="d-flex align-items-center gap-2 mb-3">
                <i className={`${featureIcon} fs-20 text-primary`} />
                <div className="cs-fc-feature-title">{featureLabel}</div>
                <span className="badge bg-soft-primary text-primary fs-11 fw-bold text-uppercase">
                    {filteredCams.length} CAM
                </span>
            </div>
            <div className="row g-3">
                {filteredCams.map(cam => (
                    <CameraStreamCard key={cam.camera_id} cam={cam} featureName={featureName} projectId={projectId} />
                ))}
            </div>
        </div>
    )
}

// ── Main ProjectLiveView ──────────────────────────────────────────────────────

const SNAP_TTL_MS = 5 * 60 * 1000
const _snapKey = (projectId) => `cs:cameras_snap_${projectId}`

const _readSnap = (projectId) => {
    try {
        const raw = localStorage.getItem(_snapKey(projectId))
        if (!raw) return []
        const parsed = JSON.parse(raw)
        // Backwards-compat: old sessionStorage snapshots were a bare array
        if (Array.isArray(parsed)) return parsed
        if (!parsed || typeof parsed !== 'object') return []
        if (typeof parsed.ts !== 'number' || (Date.now() - parsed.ts) > SNAP_TTL_MS) return []
        return Array.isArray(parsed.data) ? parsed.data : []
    } catch { return [] }
}

const _writeSnap = (projectId, data) => {
    try { localStorage.setItem(_snapKey(projectId), JSON.stringify({ ts: Date.now(), data })) } catch { /* ignore */ }
}

const ProjectLiveView = ({ projectId }) => {
    const [cameras, setCameras] = useState(() => {
        // Restore from localStorage instantly on mount — streams begin loading before fetch.
        // Survives refresh and is shared across tabs of the same project.
        if (!projectId) return []
        return _readSnap(projectId)
    })
    const [loading, setLoading]  = useState(true)
    const loadRef = React.useRef(null)

    // Define load function but don't include it in dependency arrays
    const load = useCallback(() => {
        if (!projectId) {
            setCameras([])
            setLoading(false)
            return
        }
        setLoading(true)
        apiGet(`/projects/${projectId}/cameras/features`)
            .then(data => {
                const fresh = Array.isArray(data) ? data : (data?.cameras ?? [])
                setCameras(fresh)
                setLoading(false)
                _writeSnap(projectId, fresh)
            })
            .catch(() => {
                topTostError('Failed to load camera list')
                setLoading(false)
            })
    }, [projectId])

    // Store load in ref to avoid dependency issues
    useEffect(() => {
        loadRef.current = load
    }, [load])

    // Persist cameras snapshot whenever state changes (toggle, SSE, broadcast)
    // so a fresh tab opens to the latest known state.
    useEffect(() => {
        if (!projectId || cameras.length === 0) return
        _writeSnap(projectId, cameras)
    }, [projectId, cameras])

    // Handle feature toggle from child card — update parent cameras list
    const handleFeatureToggle = useCallback((cameraId, updatedCam) => {
        setCameras(prev => prev.map(cam => cam.camera_id === cameraId ? updatedCam : cam))
    }, [])

    // Initial load
    useEffect(() => {
        load()
    }, [load])

    // Auto-refresh when cameras are added / removed / changed
    useEffect(() => {
        const handleRefresh = () => {
            if (loadRef.current) loadRef.current()
        }

        // Reload on major changes (zone assignment, camera removal, etc.)
        window.addEventListener('cs:cameras-stats-refresh', handleRefresh)
        window.addEventListener('cs:project-cameras-refresh', handleRefresh)
        window.addEventListener('cs:project-zones-refresh', handleRefresh)

        // Feature toggle doesn't need full reload — just re-render with current cameras data
        const handleFeatureToggle = () => {
            // Trigger a re-render to show/hide streams in feature sections
            setCameras(c => [...c])
        }
        window.addEventListener('cs:feature-toggle-updated', handleFeatureToggle)

        const unsubCameras = onBroadcast('cs:cameras-stats-refresh', handleRefresh)
        const unsubProjCams = onBroadcast('cs:project-cameras-refresh', handleRefresh)
        const unsubProjZones = onBroadcast('cs:project-zones-refresh', handleRefresh)

        return () => {
            window.removeEventListener('cs:cameras-stats-refresh', handleRefresh)
            window.removeEventListener('cs:project-cameras-refresh', handleRefresh)
            window.removeEventListener('cs:project-zones-refresh', handleRefresh)
            window.removeEventListener('cs:feature-toggle-updated', handleFeatureToggle)
            unsubCameras()
            unsubProjCams()
            unsubProjZones()
        }
    }, []) // No dependencies

    // SSE: reload when health/verification changes
    useEffect(() => {
        if (!projectId) return
        return openCameraStream(`/projects/${projectId}/cameras/stream`, {
            camera_health_update: () => loadRef.current && loadRef.current(),
            camera_verification_update: () => loadRef.current && loadRef.current(),
        })
    }, [projectId])

    // Cross-tab feature-change sync: apply server-authoritative state from SSE
    // payload to local cameras list so toggle UI in every tab/window stays in sync.
    const applyFeatureChange = useCallback((featureKey, data) => {
        if (!data || !Array.isArray(data.cameras)) return
        setCameras(prev => prev.map(c => {
            const match = data.cameras.find(x => x.camera_id === c.camera_id)
            if (!match) return c
            return {
                ...c,
                features: { ...(c.features || {}), [featureKey]: match[featureKey] === true },
            }
        }))
    }, [])

    // SSE: subscribe to per-feature change events on the same backend brokers
    // already used by dashboards. Each window has its own EventSource so
    // cross-account / cross-browser sync works without BroadcastChannel.
    useEffect(() => {
        if (!projectId) return
        const closers = [
            openCameraStream(`/projects/${projectId}/ppe/stream`, {
                ppe_feature_changed: (d) => applyFeatureChange('ppe_enabled', d),
            }),
            openCameraStream(`/projects/${projectId}/workforce/stream`, {
                workforce_feature_changed: (d) => applyFeatureChange('workforce_enabled', d),
            }),
            openCameraStream(`/projects/${projectId}/activity/stream`, {
                activity_feature_changed: (d) => applyFeatureChange('activity_enabled', d),
            }),
            openCameraStream(`/projects/${projectId}/equipment/stream`, {
                equipment_feature_changed: (d) => applyFeatureChange('equipment_enabled', d),
            }),
        ]
        return () => closers.forEach(close => { try { close && close() } catch { /* ignore */ } })
    }, [projectId, applyFeatureChange])

    // BroadcastChannel: same-browser fast path (~100ms) — applies before SSE
    // round-trip so other tabs flip instantly. Falls through to SSE for
    // cross-browser/cross-account.
    useEffect(() => {
        if (!projectId) return
        const handler = (payload) => {
            if (!payload || payload.projectId !== projectId) return
            const { camera_id, featureKey, enabled } = payload
            if (!camera_id || !featureKey) return
            setCameras(prev => prev.map(c =>
                c.camera_id === camera_id
                    ? { ...c, features: { ...(c.features || {}), [featureKey]: !!enabled } }
                    : c
            ))
        }
        const unsubs = [
            onBroadcast('ppe:feature-changed',       handler),
            onBroadcast('workforce:feature-changed', handler),
            onBroadcast('activity:feature-changed',  handler),
            onBroadcast('equipment:feature-changed', handler),
        ]
        return () => unsubs.forEach(u => { try { u && u() } catch { /* ignore */ } })
    }, [projectId])

    // Visibility change: reload when tab becomes visible (but only if we don't have data)
    useEffect(() => {
        const handler = () => {
            if (!document.hidden && cameras.length === 0) {
                loadRef.current && loadRef.current()
            }
        }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [cameras.length])

    const colClass =
        cameras.length <= 2 ? 'col-12 col-md-6' :
        cameras.length <= 3 ? 'col-12 col-md-4' :
        'col-12 col-md-3'

    const hasAnyFeatures = cameras.some(cam => {
        const features = cam.features || {}
        return Object.values(features).some(v => v === true)
    })

    return (
        <div className="main-content">
            <style>{`
                .cs-fc-section-title { font-weight: 800; font-size: 14px; letter-spacing: 0.2px; color: var(--bs-heading-color); }
                html.app-skin-dark .cs-fc-section-title { color: rgba(255,255,255,0.96); }
                .cs-fc-section-sub { font-size: 12px; color: var(--bs-secondary-color); }
                html.app-skin-dark .cs-fc-section-sub { color: rgba(255,255,255,0.74); }
                .cs-fc-feature-title {
                    font-size: 12px;
                    font-weight: 800;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: var(--bs-secondary-color);
                }
                html.app-skin-dark .cs-fc-feature-title { color: rgba(255,255,255,0.74); }

                .cam-logo-circle { background: rgba(2, 6, 23, 0.06); border: 2px solid var(--bs-border-color); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }

                .cs-fc-camera-card { overflow: hidden; }
                .cs-fc-camera-card { border-color: rgba(var(--bs-primary-rgb), 0.18) !important; }
                .cs-fc-camera-card { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.12) 0%, rgba(var(--bs-primary-rgb), 0.04) 55%, rgba(var(--bs-info-rgb), 0.08) 100%); }
                .cs-fc-camera-card { color: var(--bs-body-color); }
                html.app-skin-dark .cs-fc-camera-card { border-color: rgba(255,255,255,0.10) !important; }
                html.app-skin-dark .cs-fc-camera-card { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.20) 0%, rgba(255,255,255, 0.04) 55%, rgba(var(--bs-info-rgb), 0.14) 100%); }
                html.app-skin-dark .cs-fc-camera-card { color: rgba(255,255,255,0.92); }
                .cs-fc-camera-card .cs-fc-cam-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
                .cs-fc-camera-card .cs-fc-cam-title { font-weight: 800; font-size: 14px; letter-spacing: 0.2px; color: var(--bs-heading-color); }
                html.app-skin-dark .cs-fc-camera-card .cs-fc-cam-title { color: rgba(255,255,255,0.96); }

                .cs-fc-toggle { position: relative; display: inline-flex; align-items: center; }
                .cs-fc-toggle-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
                .cs-fc-toggle-ui {
                    width: 46px;
                    height: 24px;
                    border-radius: 999px;
                    background: linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.06));
                    border: 1px solid rgba(0,0,0,0.14);
                    box-shadow: 0 10px 20px rgba(0,0,0,0.10);
                    position: relative;
                    transition: all 180ms ease;
                    cursor: pointer;
                    display: inline-block;
                }
                .cs-fc-toggle-ui::before {
                    content: '';
                    position: absolute;
                    top: 3px;
                    left: 3px;
                    width: 18px;
                    height: 18px;
                    border-radius: 999px;
                    background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,255,255,0.82));
                    box-shadow: 0 8px 16px rgba(0,0,0,0.18);
                    transition: all 180ms ease;
                }
                .cs-fc-toggle-input:checked + .cs-fc-toggle-ui {
                    background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 1) 0%, rgba(var(--bs-info-rgb), 0.85) 100%);
                    border-color: rgba(var(--bs-primary-rgb), 0.45);
                    box-shadow: 0 12px 24px rgba(var(--bs-primary-rgb), 0.22);
                }
                .cs-fc-toggle-input:checked + .cs-fc-toggle-ui::before {
                    left: 25px;
                    background: linear-gradient(180deg, rgba(255,255,255,1), rgba(255,255,255,0.86));
                }
                .cs-fc-toggle-input:focus + .cs-fc-toggle-ui {
                    outline: none;
                    box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.18), 0 12px 24px rgba(0,0,0,0.10);
                }
                .cs-fc-toggle-disabled .cs-fc-toggle-ui { cursor: not-allowed; opacity: 0.6; box-shadow: none; }
                html.app-skin-dark .cs-fc-toggle-ui {
                    background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06));
                    border-color: rgba(255,255,255,0.14);
                    box-shadow: none;
                }
                html.app-skin-dark .cs-fc-toggle-ui::before {
                    background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.74));
                    box-shadow: 0 10px 22px rgba(0,0,0,0.35);
                }
                html.app-skin-dark .cs-fc-toggle-input:checked + .cs-fc-toggle-ui { box-shadow: 0 0 0 .2rem rgba(var(--bs-primary-rgb), 0.16); }

                .cs-fc-stream-card { overflow: hidden; }
                .cs-fc-stream-card { border-color: rgba(var(--bs-primary-rgb), 0.18) !important; }
                .cs-fc-stream-card { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.06) 0%, rgba(var(--bs-primary-rgb), 0.02) 55%, rgba(var(--bs-info-rgb), 0.05) 100%); }
                .cs-fc-stream-card { color: var(--bs-body-color); }
                html.app-skin-dark .cs-fc-stream-card { border-color: rgba(255,255,255,0.10) !important; }
                html.app-skin-dark .cs-fc-stream-card { background: linear-gradient(135deg, rgba(var(--bs-primary-rgb), 0.14) 0%, rgba(255,255,255, 0.02) 55%, rgba(var(--bs-info-rgb), 0.10) 100%); }
                html.app-skin-dark .cs-fc-stream-card { color: rgba(255,255,255,0.92); }
                .cs-fc-stream-card .card-header { background: transparent; border-bottom-color: rgba(128,128,128,0.16); }
                html.app-skin-dark .cs-fc-stream-card .card-header { border-bottom-color: rgba(255,255,255,0.10); }
                .cs-fc-stream-title { color: var(--bs-heading-color); }
                html.app-skin-dark .cs-fc-stream-title { color: rgba(255,255,255,0.96); }
                .cs-fc-expand-btn {
                    border: none;
                    background: transparent;
                    padding: 0;
                    width: 28px;
                    height: 28px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    color: var(--bs-secondary-color);
                }
                .cs-fc-expand-btn:hover { color: var(--bs-primary); }
                html.app-skin-dark .cs-fc-expand-btn { color: rgba(255,255,255,0.78); }
                html.app-skin-dark .cs-fc-expand-btn:hover { color: rgba(255,255,255,0.92); }

                .cs-fc-overlay { background: rgba(2,6,23,0.78); }
                html.app-skin-dark .cs-fc-overlay { background: rgba(0,0,0,0.70); }
                .cs-fc-overlay-card { height: calc(100vh - 36px); }
                .cs-fc-overlay-body { height: calc(100% - 46px); }
                .cs-fc-overlay-img { width: 100%; height: 100%; object-fit: contain; display: block; background: rgba(0,0,0,0.25); }
                .cs-fc-overlay-close {
                    width: 34px;
                    height: 34px;
                    border-radius: 10px;
                }
            `}</style>

            {loading ? (
                <div className="py-5 text-center text-muted">Loading cameras…</div>
            ) : cameras.length === 0 ? (
                <div className="py-5 text-center text-muted">
                    <hr className="my-4 opacity-25" />
                    <div
                        className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                        style={{ width: 56, height: 56, background: 'rgba(var(--bs-primary-rgb), 0.12)', color: 'var(--bs-primary)' }}
                    >
                        <i className="feather-camera" style={{ fontSize: 18, lineHeight: 1 }} />
                    </div>
                    <div className="fw-bold fs-16" style={{ color: 'var(--bs-heading-color)' }}>
                        No cameras assigned
                    </div>
                    <div className="fs-13 text-muted mt-1">
                        Assign cameras from the Cameras section to enable feature controls
                    </div>
                    <hr className="my-4 opacity-25" />
                </div>
            ) : (
                <>
                    <div className="mb-3">
                        <h5 className="mb-0">Camera Control</h5>
                    </div>
                    <div className="row g-3 mb-4">
                        {cameras.map(cam => (
                            <div key={cam.camera_id} className={colClass}>
                                <CameraFeatureCard cam={cam} projectId={projectId} onFeatureToggle={handleFeatureToggle} />
                            </div>
                        ))}
                    </div>

                    {/* Feature Sections with Streams */}
                    {hasAnyFeatures && (
                        <>
                            <FeatureSection
                                featureName="ppe"
                                featureLabel="PPE Detection"
                                featureIcon="feather-shield"
                                cameras={cameras}
                                projectId={projectId}
                            />

                            <FeatureSection
                                featureName="workforce"
                                featureLabel="Workforce Analytics"
                                featureIcon="feather-users"
                                cameras={cameras}
                                projectId={projectId}
                            />

                            <FeatureSection
                                featureName="activity"
                                featureLabel="Activity Tracking"
                                featureIcon="feather-activity"
                                cameras={cameras}
                                projectId={projectId}
                            />

                            <FeatureSection
                                featureName="equipment"
                                featureLabel="Equipment Detection"
                                featureIcon="feather-truck"
                                cameras={cameras}
                                projectId={projectId}
                            />
                        </>
                    )}
                </>
            )}
        </div>
    )
}

export default ProjectLiveView
