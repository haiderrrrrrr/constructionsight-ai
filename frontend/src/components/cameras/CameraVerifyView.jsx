import React, { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { BsArrowLeft, BsArrowRight, BsDot } from 'react-icons/bs'
import getIcon from '@/utils/getIcon'
import {
    FiActivity, FiAlertCircle, FiArchive, FiCamera, FiCheckCircle,
    FiClock, FiEdit, FiRefreshCw, FiShield,
    FiHash, FiMapPin, FiMonitor, FiPackage, FiWifi, FiXCircle, FiZap,
} from 'react-icons/fi'
import { API_BASE, STREAM_BASE, apiGet, apiPost } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { openCameraStream } from '@/utils/cameraSSE'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import PtzOverlay from '@/components/cameras/PtzOverlay'
import ConfirmDialog from '@/components/shared/ConfirmDialog'

const STATUS_CONFIG = {
    draft:         { color: 'bg-soft-danger text-danger',   label: 'Draft' },
    verifying:     { color: 'bg-soft-teal text-teal',       label: 'Verifying' },
    verified:      { color: 'bg-soft-warning text-warning', label: 'Verified' },
    verify_failed: { color: 'bg-soft-danger text-danger',   label: 'Failed' },
    failed:        { color: 'bg-soft-danger text-danger',   label: 'Failed' },
    archived:      { color: 'bg-soft-info text-info',       label: 'Archived' },
}

const DetailsRow = ({ icon, label, value, valueNode, isLast }) => (
    <div
        className={isLast ? '' : 'cam-summary-row'}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 0' }}
    >
        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
            <span className="cam-icon-wrap">
                {icon ? React.cloneElement(icon, { size: 13, strokeWidth: 2 }) : null}
            </span>
            <span className="fs-10 fw-bold text-muted text-uppercase" style={{ letterSpacing: '0.08em' }}>
                {label}
            </span>
        </div>
        <div className="text-end" style={{ minWidth: 0 }}>
            {valueNode ?? <span className="fs-12 fw-semibold text-break cs-verify-details-value">{value || '—'}</span>}
        </div>
    </div>
)

const StatCard = ({ color, icon, value, label }) => {
    const iconColor = `rgb(var(--bs-${color}-rgb))`
    return (
        <div className={`card bg-soft-${color} border-soft-${color} text-${color} overflow-hidden h-100`}>
            <div className="card-body py-3">
                <div className="d-flex align-items-center justify-content-between">
                    <div>
                        <div className="fs-12 text-reset fw-normal">{label}</div>
                        <div className="fs-4 text-reset mt-1 mb-0">{value}</div>
                    </div>
                    <div className="fs-20 cs-verify-stat-icon" style={{ '--cs-icon-color': iconColor }}>
                        {icon ? React.cloneElement(icon, { size: 18, strokeWidth: 2 }) : null}
                    </div>
                </div>
            </div>
            <style>{`
                .cs-verify-stat-icon svg { color: var(--cs-icon-color); }
                html.app-skin-dark .cs-verify-stat-icon svg { color: var(--cs-icon-color) !important; }
            `}</style>
        </div>
    )
}

const getPagerItems = (pageCount, current) => {
    if (pageCount <= 1) return [1]
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)

    const items = new Set([1, 2, pageCount - 1, pageCount, current - 1, current, current + 1])
    const nums = Array.from(items).filter(n => n >= 1 && n <= pageCount).sort((a, b) => a - b)

    const out = []
    for (let i = 0; i < nums.length; i++) {
        const n = nums[i]
        const prev = nums[i - 1]
        if (i > 0 && n - prev > 1) out.push('dots')
        out.push(n)
    }
    return out
}

// ── Live MJPEG Stream Panel ───────────────────────────────────────────────────
// Uses <img src="...mjpeg-stream?token=..."> — browser decodes multipart/x-mixed-replace natively.
// Token is passed as a query param because <img> tags cannot send Authorization headers.
const LiveStream = ({ cameraId, fallbackUrl, verified, emptyText, ptzOverlay }) => {
    const [streamFailed, setStreamFailed] = useState(false)
    const [imgKey, setImgKey] = useState(0)  // bump to force <img> remount on retry

    useEffect(() => {
        // Reset stream state whenever camera changes
        setStreamFailed(false)
        setImgKey(k => k + 1)
    }, [cameraId])

    const token = window.sessionStorage.getItem('access_token') || ''
    const streamUrl = `${STREAM_BASE}/admin/cameras/${cameraId}/mjpeg-stream?token=${encodeURIComponent(token)}`

    const handleRetry = () => {
        setStreamFailed(false)
        setImgKey(k => k + 1)
    }

    const showStream = verified && !streamFailed
    const showFallback = !showStream && !!fallbackUrl

    return (
        <div className="cs-verify-stream">
            {showStream ? (
                <img
                    key={imgKey}
                    src={streamUrl}
                    alt="Live stream"
                    onError={() => setStreamFailed(true)}
                    className="cs-verify-stream-img"
                />
            ) : showFallback ? (
                <img
                    src={fallbackUrl}
                    alt="Last snapshot"
                    className="cs-verify-stream-img"
                />
            ) : (
                <div className="d-flex flex-column align-items-center justify-content-center cs-verify-stream-empty">
                    <FiCamera size={40} className="mb-3 cs-verify-stream-empty-icon" />
                    <p className="fs-12 mb-0 cs-verify-stream-empty-text">
                        {emptyText || (verified ? 'Stream unavailable' : 'A snapshot will be available after verification is complete')}
                    </p>
                </div>
            )}

            {/* Status pill */}
            {(showStream || showFallback) && (
                <span className={`badge cs-verify-live-pill ${showStream ? 'cs-verify-live' : 'cs-verify-snapshot'}`}>
                    {showStream ? <span className="cs-verify-live-dot" /> : null}
                    {showStream ? 'LIVE' : 'LAST SNAPSHOT'}
                </span>
            )}

            {/* Retry button when stream fails */}
            {verified && streamFailed && (
                <button type="button" onClick={handleRetry} className="btn btn-sm cs-verify-overlay-btn">
                    <FiRefreshCw size={12} />
                    Retry
                </button>
            )}

            {ptzOverlay}
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────
const CameraVerifyView = () => {
    const { id } = useParams()
    const [camera, setCamera] = useState(null)
    const [loading, setLoading] = useState(true)
    const [verifying, setVerifying] = useState(false)
    const [archiving, setArchiving] = useState(false)
    const [showArchiveModal, setShowArchiveModal] = useState(false)
    const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
    const [historyPageIndex, setHistoryPageIndex] = useState(0)

    const loadCamera = useCallback(() =>
        apiGet(`/admin/cameras/${id}`).then(setCamera).catch(() => topTostError('Failed to load camera.'))
    , [id])

    // Silent version — no loading spinner, used for background polling / reconnect
    const silentLoad = useCallback(() =>
        apiGet(`/admin/cameras/${id}`).then(setCamera).catch(() => {})
    , [id])

    useEffect(() => {
        setLoading(true)
        loadCamera().finally(() => setLoading(false))

        const closeSSE = openCameraStream('/admin/cameras/stream', {
            camera_health_update: (d) => {
                if (Number(d.camera_id) === Number(id)) {
                    setCamera(prev => prev ? {
                        ...prev,
                        latest_health_status: d.health_status,
                        last_health_check_at: d.checked_at,
                    } : prev)
                }
            },
            camera_verification_update: (d) => {
                if (Number(d.camera_id) === Number(id)) {
                    setCamera(prev => prev ? { ...prev, registry_status: d.registry_status } : prev)
                    if (d.registry_status !== 'verifying') {
                        broadcastRefresh('cs:cameras-stats-refresh')
                        loadCamera()
                        // Auto-trigger health check immediately after successful verification
                        if (d.registry_status === 'verified') {
                            apiPost(`/admin/cameras/${id}/health-check`, {}).catch(() => {})
                        }
                    }
                }
            },
        }, { onReconnect: silentLoad })

        // Reload when camera is updated from another tab (edit wizard, archive, etc.)
        window.addEventListener('cs:cameras-stats-refresh', loadCamera)
        const unsubBroadcast = onBroadcast('cs:cameras-stats-refresh', loadCamera)

        // Fallback polling every 10s — catches missed SSE events (server restart, cross-window actions)
        // Skips when tab is hidden to avoid wasteful background requests
        const pollId = setInterval(() => { if (!document.hidden) silentLoad() }, 10_000)

        return () => {
            closeSSE()
            clearInterval(pollId)
            window.removeEventListener('cs:cameras-stats-refresh', loadCamera)
            unsubBroadcast()
        }
    }, [id, loadCamera, silentLoad])

    useEffect(() => {
        setHistoryPageIndex(0)
    }, [id])

    const handleVerify = async () => {
        setVerifying(true)
        try {
            await apiPost(`/admin/cameras/${id}/verify`, {})
            setCamera(prev => ({ ...prev, registry_status: 'verifying' }))
            topTost('Verification started.')
            broadcastRefresh('cs:cameras-stats-refresh')
            // Polling will automatically increase frequency via adaptive mechanism
        } catch (err) { topTostError(parseApiError(err)) }
        finally { setVerifying(false) }
    }

    const handleArchive = async () => {
        setArchiving(true)
        try {
            await apiPost(`/admin/cameras/${id}/archive`, {})
            setCamera(prev => ({ ...prev, archived_at: new Date().toISOString() }))
            topTost('Camera archived.')
            broadcastRefresh('cs:cameras-stats-refresh')
            setShowArchiveModal(false)
        } catch (err) { topTostError(parseApiError(err)) }
        finally { setArchiving(false) }
    }

    const handleUnarchive = async () => {
        setArchiving(true)
        try {
            await apiPost(`/admin/cameras/${id}/unarchive`, {})
            setCamera(prev => ({ ...prev, archived_at: null, registry_status: 'draft' }))
            topTost('Camera restored.')
            broadcastRefresh('cs:cameras-stats-refresh')
            setShowUnarchiveModal(false)
        } catch (err) { topTostError(parseApiError(err)) }
        finally { setArchiving(false) }
    }

    const handleHealthCheck = async () => {
        try {
            await apiPost(`/admin/cameras/${id}/health-check`, {})
            topTost('Health check initiated.')
            loadCamera() // Reload to get latest health status
        } catch (err) { topTostError(parseApiError(err)) }
    }

    if (loading) return <PageLoader />

    if (!camera) {
        return (
            <div className="col-lg-12">
                <div className="card"><div className="card-body text-center py-5 text-muted">Camera not found.</div></div>
            </div>
        )
    }

    const latestVerification = camera.verifications?.[0]
    const baseStatusKey = (camera.registry_status?.content || camera.registry_status || 'draft').toLowerCase().replace(/\s/g, '_')
    const effectiveStatusKey = camera.archived_at
        ? 'archived'
        : baseStatusKey === 'verifying'
            ? 'verifying'
            : baseStatusKey
    const statusCfg = STATUS_CONFIG[effectiveStatusKey] || STATUS_CONFIG.draft
    const isVerified = effectiveStatusKey === 'verified'
    const showLatestVerification = !['draft', 'archived'].includes(effectiveStatusKey) && !!latestVerification
    const historyPageSize = 5
    const allVerifications = Array.isArray(camera.verifications) ? camera.verifications : []
    const historyPageCount = Math.max(1, Math.ceil(allVerifications.length / historyPageSize))
    const safeHistoryIndex = Math.min(historyPageIndex, historyPageCount - 1)
    const historyStart = safeHistoryIndex * historyPageSize
    const historyRows = allVerifications.slice(historyStart, historyStart + historyPageSize)
    const historyPagerItems = getPagerItems(historyPageCount, safeHistoryIndex + 1)
    const healthKey = String(camera.latest_health_status || '').toLowerCase()
    const healthCfg = (() => {
        const map = {
            healthy:     { color: 'bg-soft-success text-success', content: 'Healthy' },
            degraded:    { color: 'bg-soft-warning text-warning', content: 'Degraded' },
            offline:     { color: 'bg-soft-danger text-danger',   content: 'Offline' },
            maintenance: { color: 'bg-soft-info text-info',       content: 'Maintenance' },
            no_data:     { color: 'bg-gray-200 text-muted',       content: 'No Data' },
        }
        return map[healthKey] || map.no_data
    })()
    const healthSolidColor = (() => {
        const map = { healthy: 'success', degraded: 'warning', offline: 'danger', maintenance: 'info', no_data: 'warning' }
        return map[healthKey] || 'warning'
    })()
    const onvifEnabled = !!camera.onvif_supported
    const canControlPtz = !!camera.ptz_supported && !!camera.onvif_supported
    const canShowLive = isVerified && !['offline', 'maintenance'].includes(healthKey)
    const canShowVerifyResults = showLatestVerification && !['offline', 'maintenance'].includes(healthKey)
    const liveEmptyText = (() => {
        if (effectiveStatusKey === 'archived') return 'Archived camera — live feed disabled'
        if (healthKey === 'offline' && isVerified) return 'Camera offline — live feed unavailable'
        if (healthKey === 'maintenance' && isVerified) return 'Maintenance mode — live feed unavailable'
        if (effectiveStatusKey === 'draft') return 'Run verification to enable live feed'
        return null
    })()
    const verificationCfg = (raw) => {
        const key = String(raw || '').toLowerCase()
        const map = {
            verified: { color: 'success', label: 'Verified' },
            verifying: { color: 'primary', label: 'Verifying' },
            draft: { color: 'warning', label: 'Draft' },
            archived: { color: 'warning', label: 'Archived' },
            failed: { color: 'danger', label: 'Failed' },
            verify_failed: { color: 'danger', label: 'Failed' },
        }
        return map[key] || { color: 'primary', label: 'In Progress' }
    }

    return (
        <>
        <div className="col-lg-12">
            <style>{`
                .cs-verify-info-row { border-bottom: 1px solid var(--bs-border-color); }
                html.app-skin-dark .cs-verify-info-row { border-bottom-color: rgba(255,255,255,0.10); }
                .cs-verify-row-icon { transform: translateY(-1px); color: rgba(2,6,23,0.58); }
                html.app-skin-dark .cs-verify-row-icon { color: rgba(255,255,255,0.72); }
                .cam-icon-wrap { width:28px; height:28px; border-radius:7px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.06); color:rgba(2,6,23,0.78); }
                html.app-skin-dark .cam-icon-wrap { background:rgba(255,255,255,0.08) !important; color:rgba(255,255,255,0.75) !important; }
                .cam-summary-row { border-bottom: 1px solid rgba(148,163,184,0.35); }
                html.app-skin-dark .cam-summary-row { border-bottom: 1px solid rgba(255,255,255,0.10); }
                .cs-verify-details-value { color: rgba(2,6,23,0.86); }
                html.app-skin-dark .cs-verify-details-value { color: rgba(255,255,255,0.86); }
                .cs-verify-avatar-wrap { width:72px; height:72px; border-radius:999px; overflow:hidden; background:rgba(2,6,23,0.06); border:2px solid rgba(148,163,184,0.35); display:flex; align-items:center; justify-content:center; }
                html.app-skin-dark .cs-verify-avatar-wrap { background:rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.10) !important; }
                .cs-verify-avatar-img { width:100%; height:100%; object-fit:contain; padding:8px; }

                .cs-verify-surface { background: var(--bs-tertiary-bg, rgba(0,0,0,0.03)); border: 1px solid var(--bs-border-color); }
                html.app-skin-dark .cs-verify-surface { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); }

                .cs-verify-danger-surface { background: rgba(var(--bs-danger-rgb), 0.08); border: 1px solid rgba(var(--bs-danger-rgb), 0.22); }
                html.app-skin-dark .cs-verify-danger-surface { background: rgba(var(--bs-danger-rgb), 0.14); border-color: rgba(var(--bs-danger-rgb), 0.28); }

                .cs-verify-subtitle { letter-spacing: 0.08em; }

                .cs-verify-split-col { border-left: 1px dashed var(--bs-border-color); }
                html.app-skin-dark .cs-verify-split-col { border-left-color: rgba(255,255,255,0.10); }

                .cs-verify-stream { position: relative; background: #0d0d0d; border-radius: 10px; overflow: hidden; height: 420px; }
                .cs-verify-stream-img { width: 100%; height: 100%; display: block; object-fit: cover; }
                .cs-verify-stream-empty { height: 420px; }
                .cs-verify-stream-empty-icon { opacity: 0.3; color: rgba(255,255,255,0.7); }
                .cs-verify-stream-empty-text { color: rgba(255,255,255,0.55); }

                .cs-verify-live-pill { position: absolute; top: 10px; left: 10px; border-radius: 999px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; letter-spacing: 0.10em; }
                .cs-verify-live { background: rgba(var(--bs-danger-rgb), 0.92); color: #fff; }
                .cs-verify-snapshot { background: rgba(100,100,100,0.70); color: #fff; }
                .cs-verify-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; display: inline-block; animation: pulse 1.5s ease-in-out infinite; }

                .cs-verify-overlay-btn { position: absolute; top: 10px; right: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 11px; }
                .cs-verify-overlay-btn { background: rgba(0,0,0,0.55) !important; border: 1px solid rgba(255,255,255,0.16) !important; color: #fff !important; }
                .cs-verify-overlay-btn:hover { background: rgba(0,0,0,0.70) !important; }

                .cs-verify-card-title { font-size: 1.25rem; font-weight: 700; letter-spacing: 0; line-height: 1.2; color: rgba(2,6,23,0.92); }
                html.app-skin-dark .cs-verify-card-title { color: rgba(255,255,255,0.92); }
                .cs-verify-card-sub { font-size: 0.75rem; font-weight: 400; letter-spacing: 0; line-height: 1.3; color: rgba(2,6,23,0.58); }
                html.app-skin-dark .cs-verify-card-sub { color: rgba(255,255,255,0.62); }
                html.app-skin-dark .cam-onvif-badge svg { color: var(--bs-danger) !important; }
                .cam-meta { display: inline-flex; align-items: center; gap: 4px; }
                .cam-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                .cam-meta-text { min-width: 0; }
                .cam-meta { color: rgba(2,6,23,0.62); }
                html.app-skin-dark .cam-meta { color: rgba(255,255,255,0.66); }
                .cam-metric-badge svg { color: currentColor !important; }
                .cam-metric-badge svg * { stroke: currentColor !important; fill: none !important; }
                .cs-verify-results { color: rgba(2,6,23,0.86); }
                html.app-skin-dark .cs-verify-results { color: rgba(255,255,255,0.86); }
                html.app-skin-dark .cs-verify-results .text-muted { color: rgba(255,255,255,0.66) !important; }
            `}</style>
            <div className="row g-4">

                {/* ── LEFT COLUMN ─────────────────────────────────────────── */}
                <div className="col-xl-8">

                    {/* Live Snapshot card */}
                    <div className="card mb-4">
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <div>
                                <div className="cs-verify-card-title">Live Feed</div>
                                <div className="cs-verify-card-sub">View the live camera preview and the latest captured snapshot</div>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                                <span className={`badge ${statusCfg.color} fs-11 fw-bold text-uppercase`}>{statusCfg.label}</span>
                                {onvifEnabled ? (
                                    <span className="badge bg-soft-danger text-danger fs-10 d-inline-flex align-items-center gap-1 cam-onvif-badge" style={{ padding: '1px 5px' }}>
                                        <FiWifi size={9} />ONVIF
                                    </span>
                                ) : null}
                            </div>
                        </div>
                        <div className="card-body p-3">
                            <LiveStream
                                cameraId={id}
                                fallbackUrl={showLatestVerification ? latestVerification?.preview_image_url : null}
                                verified={canShowLive}
                                emptyText={liveEmptyText}
                                ptzOverlay={canControlPtz ? <PtzOverlay cameraId={id} /> : null}
                            />

                            {/* Stream metrics strip */}
                            {showLatestVerification && canShowLive && (
                                <div className="row g-3 mt-3">
                                    <div className="col-md-4">
                                        <StatCard
                                            color="success"
                                            icon={<FiZap />}
                                            label="FPS"
                                            value={latestVerification.fps_detected ?? '—'}
                                        />
                                    </div>
                                    <div className="col-md-4">
                                        <StatCard
                                            color="warning"
                                            icon={<FiMonitor />}
                                            label="Resolution"
                                            value={latestVerification.resolution_detected ?? '—'}
                                        />
                                    </div>
                                    <div className="col-md-4">
                                        <StatCard
                                            color="danger"
                                            icon={<FiShield />}
                                            label="Protocol"
                                            value={camera.connection_type?.toUpperCase() ?? 'RTSP'}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RTSP + ONVIF Results */}
                    <div className="card mb-4">
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <div>
                                <div className="cs-verify-card-title">Verification Results</div>
                                <div className="cs-verify-card-sub">Review RTSP and ONVIF verification results for this camera</div>
                            </div>
                            {canShowVerifyResults && (
                                <span className="cam-meta" title={new Date(latestVerification.started_at).toLocaleString()}>
                                    <FiClock size={12} className="opacity-75" />
                                    <span className="cam-meta-text">{new Date(latestVerification.started_at).toLocaleString()}</span>
                                </span>
                            )}
                        </div>
                        <div className="card-body cs-verify-results">
                            <div className="row g-4">
                                {/* RTSP column */}
                                <div className="col-sm-6">
                                    <div className="fs-11 fw-bold text-uppercase text-muted mb-3 cs-verify-subtitle">RTSP Stream</div>
                                    {canShowVerifyResults ? (() => {
                                        const ok = latestVerification.result_status === 'verified'
                                        return (
                                            <div className="vstack gap-2">
                                                <div className="d-flex align-items-center gap-2">
                                                    {ok
                                                        ? <FiCheckCircle size={13} className="text-success flex-shrink-0" />
                                                        : <FiXCircle size={13} className="text-danger flex-shrink-0" />}
                                                    <span className="fs-12">
                                                        {ok ? 'Stream Reachable' : 'Stream Unreachable'}
                                                    </span>
                                                </div>
                                                {ok && latestVerification.fps_detected != null && (
                                                    <div className="d-flex align-items-center gap-2">
                                                        <FiCheckCircle size={13} className="text-success flex-shrink-0" />
                                                        <span className="fs-12">
                                                            FPS detected: <strong>{latestVerification.fps_detected}</strong>
                                                        </span>
                                                    </div>
                                                )}
                                                {ok && latestVerification.resolution_detected && (
                                                    <div className="d-flex align-items-center gap-2">
                                                        <FiCheckCircle size={13} className="text-success flex-shrink-0" />
                                                        <span className="fs-12">
                                                            Resolution: <strong>{latestVerification.resolution_detected}</strong>
                                                        </span>
                                                    </div>
                                                )}
                                                {latestVerification.failure_reason && (
                                                    <div className="d-flex align-items-start gap-2 mt-1 p-2 rounded cs-verify-danger-surface">
                                                        <FiAlertCircle size={13} className="text-danger flex-shrink-0 mt-1" />
                                                        <span className="fs-12 text-danger">{latestVerification.failure_reason}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })() : (
                                        <div className="d-flex align-items-center gap-2">
                                            <FiAlertCircle size={13} className="text-muted" />
                                            <span className="fs-12 text-muted">
                                                {effectiveStatusKey === 'verifying'
                                                    ? 'Verification in progress'
                                                    : ['offline', 'maintenance'].includes(healthKey)
                                                        ? 'Camera is not healthy. Restore health to view RTSP results'
                                                        : effectiveStatusKey === 'archived'
                                                            ? 'Archived camera. Restore to run verification'
                                                            : 'Run verification to see results'}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* ONVIF column */}
                                <div className="col-sm-6 cs-verify-split-col">
                                    <div className="fs-11 fw-bold text-uppercase text-muted mb-3 cs-verify-subtitle">ONVIF</div>
                                    {camera.onvif_supported ? (
                                        <div className="vstack gap-2">
                                            <div className="d-flex align-items-center gap-2">
                                                <FiCheckCircle size={13} className="text-success" />
                                                <span className="fs-12">ONVIF Enabled</span>
                                            </div>
                                            <div className="d-flex align-items-center gap-2">
                                                <FiCheckCircle size={13} className="text-success" />
                                                <span className="fs-12">Profile S</span>
                                            </div>
                                            <div className="d-flex align-items-center gap-2">
                                                <FiWifi size={13} className="text-info" />
                                                <span className="fs-12">
                                                    Port: {camera.onvif_port ?? 80}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="vstack gap-2">
                                            <div className="d-flex align-items-center gap-2">
                                                <FiXCircle size={13} className="text-muted" />
                                                <span className="fs-12 text-muted">Not enabled for this camera</span>
                                            </div>
                                            <div className="d-flex align-items-center gap-2">
                                                <FiShield size={13} className="text-muted" />
                                                <span className="fs-12 text-muted">Standard RTSP only</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Verification History */}
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <div className="cs-verify-card-title">Verification History</div>
                                <div className="cs-verify-card-sub">History of verification runs and results</div>
                            </div>
                        </div>
                        <div className="card-body p-0">
                            {allVerifications.length > 0 ? (
                                <div className="table-responsive">
                                    <table className="table table-hover mb-0">
                                        <thead>
                                            <tr>
                                                <th scope="col">Run</th>
                                                <th scope="col">Last Health Check</th>
                                                <th scope="col">Verification Status</th>
                                                <th scope="col">FPS</th>
                                                <th scope="col">Latency</th>
                                                <th scope="col">Resolution</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {historyRows.map((v, index) => {
                                                const absoluteIndex = historyStart + index
                                                const cfg = verificationCfg(v.result_status)
                                                const logoSrc = camera.logo_url || '/images/logo/security-camera-logo.png'
                                                const runId = v.id ? `#${v.id}` : `#${absoluteIndex + 1}`
                                                const startedAt = v.started_at ? new Date(v.started_at).toLocaleString() : '—'
                                                const completedAt = v.completed_at ? new Date(v.completed_at).toLocaleString() : startedAt
                                                const fps = v.fps_detected == null ? null : Number(v.fps_detected)
                                                const res = v.resolution_detected || null
                                                const latencyMs = v.latency_ms == null ? null : Number(v.latency_ms)
                                                return (
                                                    <tr key={v.id ?? absoluteIndex}>
                                                        <td className="position-relative">
                                                            <div className={`ht-50 position-absolute start-0 top-50 translate-middle border-start border-5 border-${cfg.color}`} />
                                                            <div className="hstack gap-3">
                                                                <div className="avatar-image rounded">
                                                                    <img className="img-fluid" src={logoSrc} alt="camera" />
                                                                </div>
                                                                <div>
                                                                    <a href="#" className="d-block" onClick={(e) => e.preventDefault()}>
                                                                        Verification {runId}
                                                                    </a>
                                                                    <span className="fs-12 text-muted">
                                                                        Started: {startedAt}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span className="cam-meta" title={completedAt}>
                                                                <FiClock size={12} className="opacity-75" />
                                                                <span className="cam-meta-text">{completedAt}</span>
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <a href="#" className={`badge bg-soft-${cfg.color} text-${cfg.color} fs-11 fw-bold text-uppercase`} onClick={(e) => e.preventDefault()}>
                                                                {cfg.label}
                                                            </a>
                                                        </td>
                                                        <td>
                                                            {fps == null
                                                                ? <span className="text-muted">—</span>
                                                                : (
                                                                    <span className="badge bg-warning text-white fs-12 cam-meta cam-metric-badge">
                                                                        <FiActivity size={12} />
                                                                        <span className="cam-meta-text">{`${fps.toFixed(0)} fps`}</span>
                                                                    </span>
                                                                )}
                                                        </td>
                                                        <td>
                                                            {latencyMs == null
                                                                ? <span className="text-muted">—</span>
                                                                : (
                                                                    <span className="badge bg-primary text-white fs-12 cam-meta cam-metric-badge">
                                                                        <FiZap size={12} />
                                                                        <span className="cam-meta-text">{`${Number(latencyMs).toFixed(0)} ms`}</span>
                                                                    </span>
                                                                )}
                                                        </td>
                                                        <td>
                                                            {res
                                                                ? (
                                                                    <span className="cam-meta">
                                                                        <FiMonitor size={12} className="opacity-75" />
                                                                        <span className="cam-meta-text">{res}</span>
                                                                    </span>
                                                                )
                                                                : <span className="text-muted">—</span>}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="text-center text-muted py-4">
                                    <p className="fs-12 mb-0">No verification runs yet. Click "Run Verification" to start.</p>
                                </div>
                            )}
                        </div>
                        <div className="card-footer">
                            {historyPageCount > 1 ? (
                                <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style">
                                    <li className={!safeHistoryIndex ? 'opacity-50 pe-none' : ''}>
                                        <Link
                                            to="#"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                if (safeHistoryIndex > 0) setHistoryPageIndex(safeHistoryIndex - 1)
                                            }}
                                        >
                                            <BsArrowLeft size={16} />
                                        </Link>
                                    </li>
                                    {historyPagerItems.map((item, i) => (
                                        item === 'dots'
                                            ? (
                                                <li key={`dots-${i}`}>
                                                    <Link to="#" onClick={(e) => e.preventDefault()}>
                                                        <BsDot size={16} />
                                                    </Link>
                                                </li>
                                            )
                                            : (
                                                <li key={`p-${item}`}>
                                                    <Link
                                                        to="#"
                                                        className={item === safeHistoryIndex + 1 ? 'active' : ''}
                                                        onClick={(e) => {
                                                            e.preventDefault()
                                                            setHistoryPageIndex(Number(item) - 1)
                                                        }}
                                                    >
                                                        {item}
                                                    </Link>
                                                </li>
                                            )
                                    ))}
                                    <li className={safeHistoryIndex >= historyPageCount - 1 ? 'opacity-50 pe-none' : ''}>
                                        <Link
                                            to="#"
                                            onClick={(e) => {
                                                e.preventDefault()
                                                if (safeHistoryIndex < historyPageCount - 1) setHistoryPageIndex(safeHistoryIndex + 1)
                                            }}
                                        >
                                            <BsArrowRight size={16} />
                                        </Link>
                                    </li>
                                </ul>
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* ── RIGHT COLUMN ─────────────────────────────────────────── */}
                <div className="col-xl-4">

                    {/* Camera info card */}
                    <div className="card mb-4">
                        <div className="card-header">
                            <div>
                                <div className="cs-verify-card-title">Camera Details</div>
                                <div className="cs-verify-card-sub">Overview of camera identity and connection status</div>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="text-center mb-3">
                                <div className="cs-verify-avatar-wrap mx-auto">
                                    <img
                                        src={camera.logo_url || '/images/logo/security-camera-logo.png'}
                                        alt={camera.name}
                                        className="cs-verify-avatar-img"
                                    />
                                </div>
                                <h5 className="fw-bold fs-15 mb-1 mt-2">{camera.name}</h5>
                                <span className={`badge ${statusCfg.color} fs-11 fw-bold text-uppercase`}>{statusCfg.label}</span>
                            </div>

                            {(() => {
                                const rows = [
                                    { label: 'Site Location', icon: <FiMapPin />, value: camera.site_name },
                                    { label: 'Vendor', icon: <FiPackage />, value: camera.vendor },
                                    { label: 'Model', icon: <FiCamera />, value: camera.model },
                                    { label: 'Serial Number', icon: <FiHash />, value: camera.serial_number },
                                    {
                                        label: 'Connection Type',
                                        icon: <FiWifi />,
                                        valueNode: (
                                            <span className="badge bg-soft-primary text-primary fs-11 fw-bold text-uppercase">
                                                {String(camera.connection_type || 'rtsp').toUpperCase()}
                                            </span>
                                        ),
                                    },
                                    {
                                        label: 'ONVIF',
                                        icon: <FiShield />,
                                        valueNode: onvifEnabled
                                            ? (
                                                <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase d-inline-flex align-items-center gap-1 cam-onvif-badge">
                                                    <FiWifi size={12} />ENABLED
                                                </span>
                                            )
                                            : <span className="badge bg-gray-200 text-muted fs-11 fw-bold text-uppercase">DISABLED</span>,
                                    },
                                    { label: 'Health Status', icon: <FiActivity />, valueNode: <span className={`badge ${healthCfg.color} fs-11 fw-bold text-uppercase`}>{healthCfg.content}</span> },
                                    ...(camera.verified_at ? [{ label: 'Verified On', icon: <FiCheckCircle />, value: new Date(camera.verified_at).toLocaleDateString() }] : []),
                                    ...(camera.last_health_check_at ? [{ label: 'Last Health Check', icon: <FiClock />, value: new Date(camera.last_health_check_at).toLocaleString() }] : []),
                                ]
                                return rows.map((r, i) => (
                                    <DetailsRow
                                        key={r.label}
                                        icon={r.icon}
                                        label={r.label}
                                        value={r.value}
                                        valueNode={r.valueNode}
                                        isLast={i === rows.length - 1}
                                    />
                                ))
                            })()}
                        </div>
                    </div>

                    {/* Actions card */}
                    <div className="card mb-4">
                        <div className="card-header">
                            <div>
                                <div className="cs-verify-card-title">Actions</div>
                                <div className="cs-verify-card-sub">Manage camera verification and settings</div>
                            </div>
                        </div>
                        <div className="card-body d-grid gap-2">
                            <button
                                className="btn btn-primary d-flex align-items-center justify-content-center gap-2"
                                onClick={handleVerify}
                                disabled={verifying || effectiveStatusKey === 'archived'}
                            >
                                {verifying ? <span className="spinner-border spinner-border-sm" /> : <FiShield size={14} />}
                                {verifying ? 'Verifying…' : 'Run Verification'}
                            </button>
                            <button
                                className="btn btn-secondary d-flex align-items-center justify-content-center gap-2"
                                onClick={handleHealthCheck}
                                disabled={effectiveStatusKey === 'archived' || !isVerified}
                                title={!isVerified ? 'Camera must be verified first' : ''}
                            >
                                <FiActivity size={14} />
                                RUN HEALTH CHECK
                            </button>
                            {camera?.archived_at ? (
                                <button
                                    className="btn btn-success d-flex align-items-center justify-content-center gap-2 opacity-50"
                                    disabled
                                    title="Cannot edit archived cameras"
                                    style={{ cursor: 'not-allowed' }}
                                >
                                    <FiEdit size={14} />Edit Details
                                </button>
                            ) : (
                                <Link
                                    to={`/admin/cameras/${id}/edit`}
                                    className="btn btn-success d-flex align-items-center justify-content-center gap-2"
                                >
                                    <FiEdit size={14} />Edit Details
                                </Link>
                            )}
                            {camera?.archived_at ? (
                                <button
                                    className="btn btn-success d-flex align-items-center justify-content-center gap-2"
                                    onClick={() => setShowUnarchiveModal(true)}
                                    disabled={archiving || camera?.registry_status === 'verifying'}
                                    title={camera?.registry_status === 'verifying' ? 'Cannot restore while verification is in progress' : ''}
                                >
                                    {archiving ? <span className="spinner-border spinner-border-sm" /> : <FiRefreshCw size={14} />}
                                    Restore Camera
                                </button>
                            ) : (
                                <button
                                    className="btn btn-danger d-flex align-items-center justify-content-center gap-2"
                                    onClick={() => setShowArchiveModal(true)}
                                    disabled={archiving || camera?.registry_status === 'verifying'}
                                    title={camera?.registry_status === 'verifying' ? 'Cannot archive while verification is in progress' : ''}
                                >
                                    {archiving ? <span className="spinner-border spinner-border-sm" /> : <FiArchive size={14} />}
                                    Archive Camera
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="row g-3">
                        {(() => {
                            const verificationsCount = allVerifications.length
                            const lastChecked = camera.last_health_check_at ? new Date(camera.last_health_check_at) : null
                            const lastCheckLabel = lastChecked ? lastChecked.toLocaleDateString() : 'Never'
                            const lastCheckColor = (() => {
                                if (!lastChecked) return 'danger'
                                const ageMs = Date.now() - lastChecked.getTime()
                                if (ageMs > 24 * 60 * 60 * 1000) return 'warning'
                                return 'primary'
                            })()
                            const statusSolidColor = (() => {
                                const map = {
                                    verified: 'primary',
                                    verifying: 'primary',
                                    draft: 'danger',
                                    archived: 'info',
                                    verify_failed: 'danger',
                                    failed: 'danger',
                                }
                                return map[effectiveStatusKey] || 'primary'
                            })()
                            const cards = [
                                { icon: 'feather-shield', number: statusCfg.label, title: 'Verification Status', color: statusSolidColor },
                                { icon: 'feather-activity', number: healthCfg.content, title: 'Health Status', color: healthSolidColor },
                                { icon: 'feather-check-circle', number: String(verificationsCount), title: 'Verification Count', color: 'warning' },
                                { icon: 'feather-clock', number: lastCheckLabel, title: 'Last Health Check', color: lastCheckColor },
                            ]
                            return cards.map(({ icon, number, title, color }, index) => (
                                <div key={index} className="col-6">
                                    <div className={`card bg-${color} border-${color} text-white overflow-hidden h-100`}>
                                        <div className="card-body">
                                            <i className="fs-20">{getIcon(icon)}</i>
                                            <h5 className="fs-4 text-reset mt-4 mb-1">{number}</h5>
                                            <div className="fs-12 text-reset fw-normal">{title}</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        })()}
                    </div>
                </div>
            </div>
        </div>

        <ConfirmDialog
            open={showArchiveModal}
            variant="archive"
            title="Archive Camera"
            message={`"${camera?.name}" will be archived and hidden from active use. You can restore it later`}
            loading={archiving}
            onClose={() => setShowArchiveModal(false)}
            onConfirm={handleArchive}
        />
        <ConfirmDialog
            open={showUnarchiveModal}
            variant="unarchive"
            title="Restore Camera"
            message={`Restore "${camera?.name}" from archive? It will return to Draft status`}
            loading={archiving}
            onClose={() => setShowUnarchiveModal(false)}
            onConfirm={handleUnarchive}
        />
        </>
    )
}

export default CameraVerifyView
