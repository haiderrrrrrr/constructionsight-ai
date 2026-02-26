import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import {
    FiCamera,
    FiRefreshCw,
} from 'react-icons/fi'
import { API_BASE, STREAM_BASE, apiGet } from '@/utils/api'
import PtzOverlay from '@/components/cameras/PtzOverlay'
import { onBroadcast } from '@/utils/broadcast'
import { openCameraStream } from '@/utils/cameraSSE'
import topTostError from '@/utils/topTostError'

// Live MJPEG stream panel — uses token param since <img> can't send Authorization header
const LiveStream = ({ cameraId, fallbackUrl, verified, emptyText, ptzOverlay }) => {
    const [streamFailed, setStreamFailed] = useState(false)
    const [imgKey, setImgKey] = useState(0)
    const [retryCount, setRetryCount] = useState(0)
    const [baseIdx, setBaseIdx] = useState(0)
    const imgRef = React.useRef(null)
    const bases = React.useMemo(() => {
        const arr = [STREAM_BASE, API_BASE].filter(Boolean)
        return Array.from(new Set(arr))
    }, [])

    useEffect(() => {
        setStreamFailed(false)
        setImgKey(k => k + 1)
        setRetryCount(0)
        setBaseIdx(0)
    }, [cameraId])

    const token = window.sessionStorage.getItem('access_token') || ''
    const base = bases[Math.min(baseIdx, bases.length - 1)] || STREAM_BASE
    const streamUrl = `${base}/admin/cameras/${cameraId}/mjpeg-stream?token=${encodeURIComponent(token)}&r=${imgKey}`

    const handleRetry = () => {
        setStreamFailed(false)
        setImgKey(k => k + 1)
    }

    const showStream = verified && !streamFailed
    const showFallback = !showStream && !!fallbackUrl

    useEffect(() => {
        if (!showStream) return
        let cancelled = false
        const id = setInterval(() => {
            if (cancelled) return
            const el = imgRef.current
            if (!el) return
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                if (retryCount !== 0) setRetryCount(0)
                return
            }
            setStreamFailed(true)
            setRetryCount(n => n + 1)
        }, 6000)
        return () => { cancelled = true; clearInterval(id) }
    }, [showStream, imgKey, retryCount])

    useEffect(() => {
        if (!verified) return
        if (!streamFailed) return
        if (baseIdx < bases.length - 1) {
            setBaseIdx(i => i + 1)
            setStreamFailed(false)
            setImgKey(k => k + 1)
            return
        }
        const delay = Math.min(1000 * Math.pow(2, Math.max(0, retryCount - 1)), 8000)
        const id = setTimeout(() => {
            setStreamFailed(false)
            setImgKey(k => k + 1)
        }, delay)
        return () => clearTimeout(id)
    }, [streamFailed, retryCount, verified, baseIdx, bases.length])

    return (
        <div className="cs-verify-stream">
            {showStream ? (
                <img
                    key={imgKey}
                    src={streamUrl}
                    alt="Live stream"
                    onError={() => {
                        setStreamFailed(true)
                        setRetryCount(n => n + 1)
                    }}
                    className="cs-verify-stream-img"
                    ref={imgRef}
                />
            ) : showFallback ? (
                <img src={fallbackUrl} alt="Last snapshot" className="cs-verify-stream-img" />
            ) : (
                <div className="d-flex flex-column align-items-center justify-content-center cs-verify-stream-empty">
                    <FiCamera size={40} className="mb-3 cs-verify-stream-empty-icon" />
                    <p className="fs-12 mb-0 cs-verify-stream-empty-text">
                        {emptyText || (verified ? 'Stream unavailable' : 'A snapshot will be available after verification is complete')}
                    </p>
                </div>
            )}
            {(showStream || showFallback) && (
                <span className={`badge cs-verify-live-pill ${showStream ? 'cs-verify-live' : 'cs-verify-snapshot'}`}>
                    {showStream ? <span className="cs-verify-live-dot" /> : null}
                    {showStream ? 'LIVE' : 'LAST SNAPSHOT'}
                </span>
            )}
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

// ── Main Component ─────────────────────────────────────────────────────────────
const PMCameraVerifyView = () => {
    const { projectId, cameraId } = useParams()
    const [camera, setCamera] = useState(null)
    const [myRole, setMyRole] = useState(null)
    const [loading, setLoading] = useState(true)

    const loadCamera = useCallback(() =>
        apiGet(`/projects/${projectId}/cameras/${cameraId}`)
            .then(setCamera)
            .catch(() => topTostError('Failed to load camera.'))
    , [projectId, cameraId])

    // Silent version — no loading spinner, used for background polling / reconnect
    const silentLoad = useCallback(() =>
        apiGet(`/projects/${projectId}/cameras/${cameraId}`)
            .then(setCamera)
            .catch(() => {})
    , [projectId, cameraId])

    useEffect(() => {
        setLoading(true)
        Promise.all([
            loadCamera(),
            apiGet(`/projects/${projectId}`).then(d => setMyRole(d.my_role || null)).catch(() => {}),
        ]).finally(() => setLoading(false))

        const closeSSE = openCameraStream(`/projects/${projectId}/cameras/stream`, {
            camera_health_update: (d) => {
                if (Number(d.camera_id) === Number(cameraId)) {
                    setCamera(prev => prev ? {
                        ...prev,
                        latest_health_status: d.health_status,
                        last_health_check_at: d.checked_at,
                    } : prev)
                }
            },
            camera_verification_update: (d) => {
                if (Number(d.camera_id) === Number(cameraId)) {
                    setCamera(prev => prev ? { ...prev, registry_status: d.registry_status } : prev)
                    if (d.registry_status !== 'verifying') loadCamera()
                }
            },
        }, { onReconnect: silentLoad })

        const unsubBroadcast = onBroadcast('cs:cameras-stats-refresh', loadCamera)

        // Fallback polling every 10s — catches missed SSE events (server restart, cross-window actions)
        // Skips when tab is hidden to avoid wasteful background requests
        const pollId = setInterval(() => { if (!document.hidden) silentLoad() }, 10_000)

        return () => {
            closeSSE()
            clearInterval(pollId)
            unsubBroadcast()
        }
    }, [projectId, cameraId, loadCamera, silentLoad])

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
        : baseStatusKey === 'verifying' ? 'verifying' : baseStatusKey
    const isVerified = effectiveStatusKey === 'verified'
    const showLatestVerification = !['draft', 'archived'].includes(effectiveStatusKey) && !!latestVerification
    const healthKey = String(camera.latest_health_status || '').toLowerCase()
    const canShowLive = isVerified && !['offline', 'maintenance'].includes(healthKey)
    const canControlPtz = camera.ptz_supported && camera.onvif_supported && myRole === 'project_manager'
    const liveEmptyText = (() => {
        if (effectiveStatusKey === 'archived') return 'Archived camera — live feed disabled'
        if (healthKey === 'offline' && isVerified) return 'Camera offline — live feed unavailable'
        if (healthKey === 'maintenance' && isVerified) return 'Maintenance mode — live feed unavailable'
        if (effectiveStatusKey === 'draft') return 'Run verification to enable live feed'
        return null
    })()

    return (
        <>
        <div className="col-lg-12">
            <style>{`
                .cs-verify-info-row { border-bottom: 1px solid var(--bs-border-color); }
                html.app-skin-dark .cs-verify-info-row { border-bottom-color: rgba(255,255,255,0.10); }
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
                .cs-verify-stream { position: relative; background: #0d0d0d; border-radius: 10px; overflow: hidden; width: 100%; height: min(72vh, 780px); }
                @supports (aspect-ratio: 16 / 9) { .cs-verify-stream { height: auto; aspect-ratio: 16 / 9; max-height: min(72vh, 780px); } }
                .cs-verify-stream-img { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; }
                .cs-verify-stream-empty { height: 100%; min-height: 320px; }
                .cs-verify-stream-empty-icon { opacity: 0.3; color: rgba(255,255,255,0.7); }
                .cs-verify-stream-empty-text { color: rgba(255,255,255,0.55); }
                .cs-verify-live-pill { position: absolute; top: 10px; left: 10px; border-radius: 999px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 800; letter-spacing: 0.10em; }
                .cs-verify-live { background: rgba(var(--bs-danger-rgb), 0.92); color: #fff; }
                .cs-verify-snapshot { background: rgba(100,100,100,0.70); color: #fff; }
                .cs-verify-live-dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; display: inline-block; animation: pulse 1.5s ease-in-out infinite; }
                .cs-verify-card-title { font-size: 1.25rem; font-weight: 700; letter-spacing: 0; line-height: 1.2; color: rgba(2,6,23,0.92); }
                html.app-skin-dark .cs-verify-card-title { color: rgba(255,255,255,0.92); }
                .cs-verify-card-sub { font-size: 0.75rem; font-weight: 400; letter-spacing: 0; line-height: 1.3; color: rgba(2,6,23,0.58); }
                html.app-skin-dark .cs-verify-card-sub { color: rgba(255,255,255,0.62); }
                html.app-skin-dark .cam-onvif-badge svg { color: var(--bs-danger) !important; }
                .cam-meta { display: inline-flex; align-items: center; gap: 4px; color: rgba(2,6,23,0.62); }
                html.app-skin-dark .cam-meta { color: rgba(255,255,255,0.66); }
                .cam-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                .cam-meta-text { min-width: 0; }
                .cam-metric-badge svg { color: currentColor !important; }
                .cam-metric-badge svg * { stroke: currentColor !important; fill: none !important; }
                .cs-verify-results { color: rgba(2,6,23,0.86); }
                html.app-skin-dark .cs-verify-results { color: rgba(255,255,255,0.86); }
                html.app-skin-dark .cs-verify-results .text-muted { color: rgba(255,255,255,0.66) !important; }
            `}</style>
            <div className="card">
                <div className="card-body p-0">
                    <LiveStream
                        cameraId={cameraId}
                        fallbackUrl={showLatestVerification ? latestVerification?.preview_image_url : null}
                        verified={canShowLive}
                        emptyText={liveEmptyText}
                        ptzOverlay={canControlPtz ? <PtzOverlay cameraId={cameraId} /> : null}
                    />
                </div>
            </div>
        </div>
        </>
    )
}

export default PMCameraVerifyView
