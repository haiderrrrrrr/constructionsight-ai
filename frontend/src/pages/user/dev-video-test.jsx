import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { STREAM_BASE } from '@/utils/api'
import EquipmentDashboard from '@/components/projectWorkspace/EquipmentDashboard'

const getToken = () => window.sessionStorage.getItem('access_token') || ''

// ── MJPEG stream hook (same pattern as ProjectLiveView) ───────────────────────
const useMjpegStream = (active) => {
    const [imgKey, setImgKey] = useState(0)
    const [imgError, setImgError] = useState(false)
    const imgRef = useRef(null)

    useEffect(() => {
        if (!active) return
        setImgError(false)
        setImgKey(k => k + 1)
    }, [active])

    useEffect(() => {
        if (!active || imgError) return
        const id = setInterval(() => {
            const el = imgRef.current
            if (!el) return
            if (el.naturalWidth > 0 && el.naturalHeight > 0) return
            setImgError(true)
        }, 8000)
        return () => clearInterval(id)
    }, [active, imgError, imgKey])

    useEffect(() => {
        if (!imgError) return
        const id = setTimeout(() => {
            setImgError(false)
            setImgKey(k => k + 1)
        }, 3000)
        return () => clearTimeout(id)
    }, [imgError])

    const token = getToken()
    const src = active
        ? `${STREAM_BASE}/dev/stream?token=${encodeURIComponent(token)}&r=${imgKey}`
        : null

    return { src, imgRef, imgError, onError: () => { setImgError(true) } }
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DevVideoTestPage() {
    const { projectId } = useParams()

    const [file, setFile] = useState(null)
    const [zoneName, setZoneName] = useState('Zone A')
    const [ppeEnabled, setPpeEnabled] = useState(true)
    const [equipmentEnabled, setEquipmentEnabled] = useState(false)
    const [running, setRunning] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [status, setStatus] = useState(null)
    const [error, setError] = useState(null)
    const [frameCount, setFrameCount] = useState(0)
    const [activeTab, setActiveTab] = useState('upload')

    const { src, imgRef, imgError, onError } = useMjpegStream(running)
    const liveDateFilter = useMemo(() => {
        const now = new Date()
        const start = new Date(now)
        start.setHours(0, 0, 0, 0)
        const end = new Date(now)
        end.setHours(23, 59, 59, 999)
        return { preset: 'live', from: start, to: end }
    }, [])

    // Poll status while running
    useEffect(() => {
        if (!running) return
        const poll = async () => {
            try {
                const token = getToken()
                const res = await fetch(`${STREAM_BASE}/dev/status`, {
                    headers: { Authorization: `Bearer ${token}` },
                })
                if (res.ok) {
                    const data = await res.json()
                    setFrameCount(data.frame_count || 0)
                }
            } catch (_) {}
        }
        const id = setInterval(poll, 2000)
        return () => clearInterval(id)
    }, [running])

    const handleUpload = useCallback(async () => {
        if (!file) return setError('Select a video file first.')
        setError(null)
        setUploading(true)
        try {
            const token = getToken()
            const form = new FormData()
            form.append('file', file)
            form.append('project_id', projectId)
            form.append('zone_name', zoneName)
            form.append('ppe_enabled', ppeEnabled)
            form.append('equipment_enabled', equipmentEnabled)

            const res = await fetch(`${STREAM_BASE}/dev/video-upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: form,
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || 'Upload failed')
            }
            const data = await res.json()
            setStatus(data)
            setRunning(true)
            setFrameCount(0)
        } catch (e) {
            setError(e.message)
        } finally {
            setUploading(false)
        }
    }, [file, projectId, zoneName, ppeEnabled, equipmentEnabled])

    const handleStop = useCallback(async () => {
        try {
            const token = getToken()
            await fetch(`${STREAM_BASE}/dev/video-stop`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
        } catch (_) {}
        setRunning(false)
        setStatus(null)
        setFrameCount(0)
    }, [])

    const handleToggleFeature = useCallback(async (field, value) => {
        try {
            const token = getToken()
            await fetch(`${STREAM_BASE}/dev/features`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ [field]: value }),
            })
        } catch (_) {}
    }, [])

    const onPpeToggle = async (val) => {
        setPpeEnabled(val)
        if (running) await handleToggleFeature('ppe_enabled', val)
    }

    const onEquipmentToggle = async (val) => {
        setEquipmentEnabled(val)
        if (running) await handleToggleFeature('equipment_enabled', val)
    }

    return (
        <div className="container-fluid py-4 dev-video-test-page">
            {/* Header */}
            <div className="d-flex align-items-center gap-3 mb-4">
                <div>
                    <h4 className="mb-0 fw-semibold">
                        Equipment Usage Demo
                    </h4>
                    <small className="text-muted">
                        Dev tool — upload a video, run PPE / equipment pipeline, view live annotated stream
                    </small>
                </div>
                {running && (
                    <span className="badge ms-auto px-3 py-2 demo-running-badge">
                        ● RUNNING &nbsp;·&nbsp; {frameCount} frames
                    </span>
                )}
            </div>

            <div className="d-flex gap-2 mb-4">
                <button
                    type="button"
                    className={`btn btn-sm ${activeTab === 'upload' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setActiveTab('upload')}
                >
                    Upload
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setActiveTab('dashboard')}
                >
                    Dashboard
                </button>
            </div>

            {activeTab === 'dashboard' ? (
                <EquipmentDashboard projectId={projectId} dateFilter={liveDateFilter} />
            ) : (
            <div className="row g-4">
                {/* ── Left panel ─────────────────────────────────────────── */}
                <div className="col-12 col-xl-4">
                    {/* Upload */}
                    <div className="rounded-3 p-4 mb-3 demo-panel">
                        <h6 className="mb-3 fw-semibold">Video File</h6>

                        <div className="mb-3">
                            <input
                                type="file"
                                accept="video/*"
                                className="form-control demo-input"
                                onChange={e => setFile(e.target.files[0] || null)}
                                disabled={uploading}
                            />
                            {file && (
                                <small className="text-muted mt-1 d-block">
                                    {file.name} &nbsp;·&nbsp; {(file.size / 1024 / 1024).toFixed(1)} MB
                                </small>
                            )}
                        </div>

                        <div className="mb-3">
                            <label className="form-label text-muted small mb-1">Zone Name</label>
                            <input
                                type="text"
                                className="form-control demo-input"
                                value={zoneName}
                                onChange={e => setZoneName(e.target.value)}
                                placeholder="Zone A"
                                disabled={uploading}
                            />
                        </div>

                        {error && (
                            <div className="alert alert-danger py-2 small mb-3">{error}</div>
                        )}

                        <div className="d-flex gap-2">
                            <button
                                className="btn btn-primary flex-fill"
                                onClick={handleUpload}
                                disabled={uploading || !file}>
                                {uploading ? (
                                    <><span className="spinner-border spinner-border-sm me-2" />Uploading…</>
                                ) : running ? 'Restart with new video' : 'Upload & Start'}
                            </button>
                            {running && (
                                <button className="btn btn-outline-danger" onClick={handleStop}>
                                    Stop
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Feature toggles */}
                    <div className="rounded-3 p-4 mb-3 demo-panel">
                        <h6 className="mb-3 fw-semibold">Analytics Modules</h6>

                        <FeatureToggle
                            label="PPE Detection"
                            description="Helmet & vest compliance overlays"
                            enabled={ppeEnabled}
                            onChange={onPpeToggle}
                        />
                        <FeatureToggle
                            label="Equipment Detection"
                            description={`YOLO-World · Zone: ${zoneName}`}
                            enabled={equipmentEnabled}
                            onChange={onEquipmentToggle}
                        />
                    </div>

                    {/* Info */}
                    {running && (
                        <div className="rounded-3 p-3 demo-panel">
                            <h6 className="mb-2 fw-semibold small">Pipeline Info</h6>
                            <div className="text-muted small">
                                <div>Zone: <span className="fw-medium text-body">{zoneName}</span></div>
                                <div>Project ID: <span className="fw-medium text-body">{projectId}</span></div>
                                <div>Frames processed: <span className="fw-medium text-body">{frameCount}</span></div>
                                {equipmentEnabled && (
                                    <div className="mt-2 text-warning small">
                                        Equipment analytics writing to DB — visible in Equipment dashboard
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Right panel — live stream ───────────────────────────── */}
                <div className="col-12 col-xl-8">
                    <div className="rounded-3 overflow-hidden demo-stream-panel"
                        style={{
                            background: '#0d1117',
                            aspectRatio: '16/9',
                            position: 'relative',
                        }}>
                        {!running ? (
                            <div className="d-flex flex-column align-items-center justify-content-center h-100 text-muted">
                                <div style={{ fontSize: 48, opacity: 0.2 }}>▶</div>
                                <div className="mt-2 small">Upload a video to start</div>
                            </div>
                        ) : imgError ? (
                            <div className="d-flex flex-column align-items-center justify-content-center h-100 text-muted">
                                <div className="spinner-border mb-3" style={{ color: '#4caf50' }} />
                                <div className="small">Waiting for first frame…</div>
                            </div>
                        ) : (
                            <img
                                ref={imgRef}
                                src={src}
                                onError={onError}
                                alt="dev stream"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    display: 'block',
                                }}
                            />
                        )}

                        {/* Overlay badge */}
                        {running && !imgError && (
                            <div style={{
                                position: 'absolute', top: 12, left: 12,
                                background: 'rgba(0,0,0,0.7)',
                                borderRadius: 6, padding: '4px 10px',
                                fontSize: 12, color: '#4caf50',
                                border: '1px solid rgba(76,175,80,0.3)',
                            }}>
                                ● LIVE
                            </div>
                        )}
                    </div>

                    <div className="mt-2 text-muted small text-center">
                        Video plays at original FPS · loops continuously · overlays drawn by same GPU pipeline as real cameras
                    </div>
                </div>
            </div>
            )}

            <style>{`
                .dev-video-test-page {
                    min-height: 100vh;
                    background: var(--bs-body-bg);
                    color: var(--bs-body-color);
                }
                .demo-running-badge {
                    background: rgba(25, 135, 84, 0.14);
                    color: #198754;
                    font-size: 13px;
                }
                .demo-panel {
                    background: var(--bs-card-bg, var(--bs-body-bg));
                    border: 1px solid var(--bs-border-color);
                }
                .demo-input {
                    background: var(--bs-body-bg);
                    border: 1px solid var(--bs-border-color);
                    color: var(--bs-body-color);
                }
                .demo-stream-panel {
                    border: 1px solid var(--bs-border-color);
                }
                .demo-feature-row {
                    border-bottom: 1px solid var(--bs-border-color);
                }
                html.app-skin-dark .demo-running-badge,
                [data-bs-theme="dark"] .demo-running-badge {
                    background: #1a3a1a;
                    color: #4caf50;
                }
                html.app-skin-dark .demo-panel,
                [data-bs-theme="dark"] .demo-panel {
                    background: #161b22;
                    border-color: #30363d;
                }
                html.app-skin-dark .demo-input,
                [data-bs-theme="dark"] .demo-input {
                    background: #0d1117;
                    border-color: #30363d;
                    color: #e6edf3;
                }
            `}</style>
        </div>
    )
}

// ── Feature toggle component ──────────────────────────────────────────────────
function FeatureToggle({ label, description, enabled, onChange }) {
    return (
        <div className="d-flex align-items-center justify-content-between py-2 demo-feature-row">
            <div>
                <div className="small fw-medium">{label}</div>
                {description && <div className="text-muted" style={{ fontSize: 11 }}>{description}</div>}
            </div>
            <div
                className="form-check form-switch mb-0 ms-3"
                style={{ paddingLeft: 0 }}>
                <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    checked={enabled}
                    onChange={e => onChange(e.target.checked)}
                    style={{ width: 40, height: 22, cursor: 'pointer' }}
                />
            </div>
        </div>
    )
}
