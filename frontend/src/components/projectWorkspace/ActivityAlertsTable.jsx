import { useState, useRef, useEffect } from 'react'
import {
    FiClock, FiAlertCircle,
    FiCheckCircle, FiCheck, FiMoreHorizontal, FiEye,
    FiZoomIn, FiZoomOut, FiRefreshCw,
} from 'react-icons/fi'
import { BsArrowLeft, BsArrowRight, BsDot } from 'react-icons/bs'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { QK } from '@/utils/queryKeys'
import { apiGet, apiPatch } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import topTost from '@/utils/topTost'
import { broadcastRefresh } from '@/utils/broadcast'
import { patchAlertInCache } from '@/utils/activityCacheUtils'

const TYPE_MAP = {
    zone_idle:            { label: 'Zone Idle',           color: 'warning' },
    activity_drop:        { label: 'Activity Drop',       color: 'danger'  },
    low_activity:         { label: 'Low Activity',        color: 'warning' },
    repeated_inactivity:  { label: 'Repeated Inactivity', color: 'danger'  },
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

const SeverityBadge = ({ severity }) => {
    const map = { high: 'danger', medium: 'warning', low: 'success' }
    const color = map[severity] || 'secondary'
    return <span className={`badge bg-soft-${color} text-${color} fs-11 fw-bold text-uppercase`}>{severity || '—'}</span>
}

const StatusBadge = ({ status }) => {
    const map = { open: 'danger', acknowledged: 'warning', resolved: 'success' }
    const color = map[status] || 'secondary'
    return <span className={`badge bg-soft-${color} text-${color} fs-11 fw-bold text-uppercase`}>{status || '—'}</span>
}

const ActionsMenu = ({ items }) => (
    <div className="dropdown cam-actions-menu">
        <button className="avatar-text avatar-md border-0 bg-transparent" data-bs-toggle="dropdown" data-bs-offset="0,4" data-bs-strategy="fixed" aria-expanded="false">
            <FiMoreHorizontal size={16} />
        </button>
        <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ minWidth: 170 }}>
            {items.map((item, i) => {
                if (item.type === 'divider') return <li key={i}><hr className="dropdown-divider" /></li>
                return (
                    <li key={i} title={item.title}>
                        <button
                            type="button"
                            className={`dropdown-item d-flex align-items-center gap-2 ${item.danger ? 'text-danger' : ''} ${item.disabled ? 'opacity-50 pe-none' : ''}`}
                            onClick={(e) => {
                                e.preventDefault()
                                if (!item.disabled && item.onClick) item.onClick()
                            }}
                            style={item.disabled ? { cursor: 'not-allowed' } : {}}
                        >
                            {item.icon && item.icon}
                            {item.label}
                        </button>
                    </li>
                )
            })}
        </ul>
    </div>
)

const PreviewModal = ({ open, onClose, title, children }) => {
    if (!open) return null
    return (
        <div className="pm-zone-view-overlay" onClick={onClose}>
            <div className="card pm-zone-view-card pm-glass-view-card" onClick={(e) => e.stopPropagation()}>
                <div className="card-header d-flex align-items-center justify-content-between">
                    <div>
                        <div className="pm-zone-card-title">{title}</div>
                    </div>
                    <button type="button" className="btn-close" onClick={onClose} />
                </div>
                <div className="card-body p-2">
                    <div className="pm-preview-body">
                        {children}
                    </div>
                </div>
            </div>
        </div>
    )
}

const SnapshotZoomView = ({ src }) => {
    const [scale, setScale] = useState(1)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
    const [panning, setPanning] = useState(false)
    const [imgReady, setImgReady] = useState(false)
    const panRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0 })

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
    const setZoom = (next) => {
        const s = clamp(next, 1, 4)
        setScale(s)
        if (s === 1) setOffset({ x: 0, y: 0 })
    }

    const onWheel = (e) => {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.15 : 0.15
        setZoom(scale + delta)
    }

    const onPointerDown = (e) => {
        if (scale <= 1) return
        setPanning(true)
        panRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y }
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }

    const onPointerMove = (e) => {
        if (!panning) return
        const p = panRef.current
        setOffset({
            x: p.originX + (e.clientX - p.startX),
            y: p.originY + (e.clientY - p.startY),
        })
    }

    const onPointerUp = () => setPanning(false)

    return (
        <div className="pm-zoom-wrap" onWheel={onWheel}>
            {!imgReady && (
                <div className="pm-media-loading">
                    <div className="spinner-border text-primary mb-3" style={{ width: 32, height: 32 }} />
                    <div className="pm-media-loading-title">Preparing Snapshot</div>
                    <div className="pm-media-loading-sub">This may take a few moments</div>
                </div>
            )}
            <div
                className="pm-zoom-stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={() => setZoom(1)}
                style={{ cursor: scale > 1 ? (panning ? 'grabbing' : 'grab') : 'default', display: imgReady ? 'flex' : 'none' }}
            >
                <img
                    src={src}
                    alt="Alert snapshot"
                    className="pm-zoom-img"
                    style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
                    draggable={false}
                    onLoad={() => setImgReady(true)}
                    onError={e => { e.target.style.display = 'none'; setImgReady(true) }}
                />
            </div>
            {imgReady && (
                <div className="pm-zoom-controls">
                    <button type="button" className="pm-modal-iconbtn" onClick={() => setZoom(scale + 0.2)} title="Zoom in">
                        <FiZoomIn size={14} />
                    </button>
                    <button type="button" className="pm-modal-iconbtn" onClick={() => setZoom(scale - 0.2)} title="Zoom out">
                        <FiZoomOut size={14} />
                    </button>
                    <button type="button" className="pm-modal-iconbtn" onClick={() => setZoom(1)} title="Reset zoom">
                        <FiRefreshCw size={14} />
                    </button>
                </div>
            )}
        </div>
    )
}

const SnapshotThumb = ({ url, onClick }) => {
    if (!url) {
        return (
            <button
                type="button"
                className="avatar-text avatar-md wf-eye-disabled"
                title="Snapshot not available"
                disabled
            >
                <FiEye size={14} />
            </button>
        )
    }
    return (
        <button
            onClick={onClick}
            className="avatar-text avatar-md"
            title="View snapshot"
            type="button"
        >
            <FiEye size={14} />
        </button>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ActivityAlertsTable({
    projectId,
    cameraId,
    dateFrom,
    dateTo,
    cameras = [],
    disabled = false,
    liveMode = false,
}) {
    const queryClient = useQueryClient()
    const [page, setPage] = useState(1)
    const [updatingId, setUpdatingId] = useState(null)
    const [snapshotUrl, setSnapshotUrl] = useState(null)
    const PER_PAGE = 10

    const qKey = QK.actAlerts(projectId, page, dateFrom, dateTo, null, cameraId)

    const waitingForLiveWindow = liveMode && !disabled && !dateFrom

    const { data, isLoading } = useQuery({
        queryKey: qKey,
        queryFn: async () => {
            const camParam  = cameraId ? `&camera_id=${cameraId}` : ''
            const liveTo = liveMode && !dateTo ? new Date().toISOString() : dateTo
            const dateParam = dateFrom && liveTo
                ? `&date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(liveTo)}`
                : ''
            return apiGet(`/projects/${projectId}/activity/alerts?page=${page}&per_page=${PER_PAGE}${camParam}${dateParam}`)
        },
        staleTime: 30_000,
        placeholderData: keepPreviousData,
        enabled: !!projectId && !disabled && (!liveMode || !!dateFrom),
        refetchOnWindowFocus: 'always',
        refetchInterval: liveMode ? false : 30_000,
        refetchIntervalInBackground: false,
    })

    const effectiveLoading = isLoading || waitingForLiveWindow

    const alerts = disabled ? [] : (data?.items ?? [])
    const total  = disabled ? 0  : (data?.total ?? 0)

    // Reset page when camera or date filter changes
    useEffect(() => { setPage(1) }, [cameraId, dateFrom, dateTo])

    // Clamp page if total shrinks below current page
    useEffect(() => {
        const tp = Math.max(1, Math.ceil(total / PER_PAGE))
        if (page > tp) setPage(tp)
    }, [total, page])

    // Fallback: full refetch when a new alert arrives (activity_alert path).
    // Status-change events are handled surgically by patchAlertInCache in the SSE hook.
    useEffect(() => {
        const handler = () =>
            queryClient.invalidateQueries({ queryKey: ['activity', 'alerts', projectId] })
        window.addEventListener('cs:activity-alerts-refresh', handler)
        return () => window.removeEventListener('cs:activity-alerts-refresh', handler)
    }, [projectId, queryClient])

    const statusMutation = useMutation({
        mutationFn: async ({ alertId, newStatus }) => {
            return apiPatch(`/projects/${projectId}/activity/alerts/${alertId}/status`, { status: newStatus })
        },

        onMutate: async ({ alertId, newStatus }) => {
            setUpdatingId(alertId)
            await queryClient.cancelQueries({ queryKey: qKey })
            const snapshot = queryClient.getQueryData(qKey)
            queryClient.setQueryData(qKey, old => ({
                ...old,
                items: (old?.items || []).map(a => a.id === alertId ? { ...a, status: newStatus } : a),
            }))
            return { snapshot }
        },

        onError: (_err, _vars, ctx) => {
            if (ctx?.snapshot) {
                queryClient.setQueryData(qKey, ctx.snapshot)
            }
            topTostError('Failed to update alert status')
            setUpdatingId(null)
        },

        onSuccess: (_data, { alertId, newStatus }) => {
            // Surgical patch across all cached alerts pages — optimistic update already
            // shows correct state on this tab, no re-fetch needed (preserves scroll).
            patchAlertInCache(queryClient, projectId, {
                alert_id: alertId,
                status:   newStatus,
            })
            // Notify other tabs (same browser); cross-account windows pick up via SSE.
            broadcastRefresh('act:alert-updated', { projectId, alert_id: alertId, status: newStatus })
            topTost('Insight status updated', 'success')
            setUpdatingId(null)
        },
    })

    const updateStatus = (alertId, newStatus) => {
        statusMutation.mutate({ alertId, newStatus })
    }

    const totalPages = Math.ceil(total / PER_PAGE)
    const canPrev = page > 1
    const canNext = page < totalPages
    const pagerItems = getPagerItems(totalPages, page)

    return (
        <>
            <PreviewModal open={!!snapshotUrl} onClose={() => setSnapshotUrl(null)} title="Alert Evidence">
                {snapshotUrl ? <SnapshotZoomView src={snapshotUrl} /> : null}
            </PreviewModal>

            <div className="card stretch stretch-full">
                <div className="card-header">
                    <div>
                        <h5 className="mb-0">Activity Insights</h5>
                        <span className="fs-12 text-muted">Zone-level activity insights across monitored cameras</span>
                    </div>
                </div>

                <div className="card-body p-0 wf-alerts-body d-flex flex-column">
                    {alerts.length === 0 && effectiveLoading ? (
                        <div className="text-center py-5 text-muted">Loading alerts…</div>
                    ) : alerts.length === 0 ? (
                        <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted" style={{ flex: 1, minHeight: 220 }}>
                            <span className="fw-semibold d-block mb-1">No records available</span>
                            <span className="fs-12">No results for the current selection</span>
                        </div>
                    ) : (
                        <div className="table-responsive wf-alerts-responsive">
                            <table className="table table-hover mb-0 align-middle">
                                <colgroup>
                                    <col style={{ width: '9%' }} />
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: '9%' }} />
                                    <col style={{ width: '24%' }} />
                                    <col style={{ width: '8%' }} />
                                    <col style={{ width: '16%' }} />
                                    <col style={{ width: '12%' }} />
                                    <col style={{ width: '6%' }} />
                                </colgroup>
                                <thead>
                                    <tr className="border-b">
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Severity</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Insight Type</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Camera</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Details</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Snapshot</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Timestamp</th>
                                        <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Insight Status</th>
                                        <th className="fs-11 text-uppercase text-end" style={{ letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {alerts.map(a => {
                                        const t = TYPE_MAP[a.alert_type] || { label: a.alert_type, color: 'secondary' }
                                        const busy = updatingId === a.id
                                        const cameraName =
                                            a.camera_name
                                            || cameras.find(c => String(c.camera_id) === String(a.camera_id))?.camera_name
                                            || '—'
                                        const items = (() => {
                                            const ackDisabled = busy || a.status !== 'open'
                                            const resolveDisabled = busy || a.status === 'resolved'
                                            return [
                                                {
                                                    label: 'Acknowledge',
                                                    icon: <FiCheck size={14} />,
                                                    onClick: () => updateStatus(a.id, 'acknowledged'),
                                                    disabled: ackDisabled,
                                                },
                                                { type: 'divider' },
                                                {
                                                    label: 'Resolve',
                                                    icon: <FiCheckCircle size={14} />,
                                                    onClick: () => updateStatus(a.id, 'resolved'),
                                                    disabled: resolveDisabled,
                                                },
                                            ]
                                        })()
                                        return (
                                            <tr key={a.id}>
                                                <td>
                                                    <SeverityBadge severity={a.severity} />
                                                </td>
                                                <td>
                                                    <span className={`badge bg-soft-${t.color} text-${t.color} fs-11 fw-bold text-uppercase`} style={{ whiteSpace: 'nowrap' }}>
                                                        {t.label || '—'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        className="badge bg-soft-success text-success fs-11 fw-semibold"
                                                        style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                                    >
                                                        {cameraName}
                                                    </span>
                                                </td>
                                                <td>
                                                    {a.zone_name ? (
                                                        <span className="pm-pill pm-pill-warning" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {a.zone_name}
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted fs-11">—</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <span className="proj-meta d-inline-flex align-items-center gap-1">
                                                        <FiAlertCircle size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                        <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: '100%' }}>
                                                            {a.message || '—'}
                                                        </span>
                                                    </span>
                                                </td>
                                                <td><SnapshotThumb url={a.snapshot_url} onClick={() => setSnapshotUrl(a.snapshot_url)} /></td>
                                                <td>
                                                    <span className="proj-meta d-inline-flex align-items-center gap-1">
                                                        <FiClock size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                        <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: '100%' }}>
                                                            {a.triggered_at ? new Date(a.triggered_at).toLocaleString() : '—'}
                                                        </span>
                                                    </span>
                                                </td>
                                                <td>
                                                    <StatusBadge status={a.status} />
                                                </td>
                                                <td className="text-end">
                                                    <div className="d-flex justify-content-end">
                                                        <ActionsMenu items={items} />
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="px-3 py-3 border-top">
                            <div className="row gy-2">
                                <div className="col-sm-12 p-0">
                                    <div className="dataTables_paginate paging_simple_numbers">
                                        <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style justify-content-md-end justify-content-center">
                                            <li className={!canPrev ? 'opacity-50 pe-none' : ''}>
                                                <a
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        if (canPrev) setPage(page - 1)
                                                    }}
                                                    aria-label="Previous page"
                                                >
                                                    <BsArrowLeft size={16} />
                                                </a>
                                            </li>
                                            {pagerItems.map((item, idx) => (
                                                item === 'dots'
                                                    ? (
                                                        <li key={`dots-${idx}`}>
                                                            <a href="#" onClick={(e) => e.preventDefault()} aria-hidden="true">
                                                                <BsDot size={16} />
                                                            </a>
                                                        </li>
                                                    )
                                                    : (
                                                        <li key={`p-${item}`}>
                                                            <a
                                                                href="#"
                                                                className={item === page ? 'active' : ''}
                                                                onClick={(e) => {
                                                                    e.preventDefault()
                                                                    setPage(Number(item))
                                                                }}
                                                                aria-current={item === page ? 'page' : undefined}
                                                            >
                                                                {item}
                                                            </a>
                                                        </li>
                                                    )
                                            ))}
                                            <li className={!canNext ? 'opacity-50 pe-none' : ''}>
                                                <a
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        if (canNext) setPage(page + 1)
                                                    }}
                                                    aria-label="Next page"
                                                >
                                                    <BsArrowRight size={16} />
                                                </a>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .wf-alerts-body {
                    transition: none !important;
                }
                .wf-alerts-responsive {
                    transition: none !important;
                    overflow-x: auto !important;
                    overflow-y: visible !important;
                    -webkit-overflow-scrolling: touch;
                }
                .wf-alerts-responsive table,
                .wf-alerts-responsive tbody {
                    transition: none !important;
                }
                .wf-alerts-responsive table {
                    table-layout: fixed;
                }
                .wf-alerts-responsive th:first-child,
                .wf-alerts-responsive td:first-child {
                    padding-left: 15px !important;
                }
                .wf-alerts-responsive th:last-child,
                .wf-alerts-responsive td:last-child {
                    padding-right: 15px !important;
                    text-align: right;
                }
                .wf-eye-disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                }

                .pm-zone-view-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1050; padding: 18px; }
                .pm-zone-view-card { width: min(740px, 100%); border-radius: 14px; border: 1px solid var(--bs-border-color); overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,0.35); }
                .pm-glass-view-card { background: rgba(255,255,255,0.92); backdrop-filter: blur(14px); }
                html.app-skin-dark .pm-glass-view-card { background: rgba(15,23,42,0.88); }
                .pm-zone-card-title { font-size: 1.05rem; font-weight: 600; color: rgba(2,6,23,0.92); }
                html.app-skin-dark .pm-zone-card-title { color: rgba(255,255,255,0.92); }
                html.app-skin-dark .pm-zone-view-card .btn-close { filter: invert(1) grayscale(100%); opacity: .8; }
                .pm-preview-body { width: 100%; display: flex; align-items: center; justify-content: center; }
                .pm-modal-iconbtn {
                    width: 44px;
                    height: 44px;
                    border-radius: 999px;
                    border: 1.5px solid rgba(255,255,255,0.34);
                    background: rgba(0,0,0,0.58);
                    color: rgba(255,255,255,0.96);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    cursor: pointer;
                    transition: all 140ms ease;
                    box-shadow: 0 8px 18px rgba(0,0,0,0.35);
                    backdrop-filter: blur(6px);
                }
                .pm-modal-iconbtn:hover {
                    background: rgba(0,0,0,0.74);
                    border-color: rgba(255,255,255,0.44);
                    color: rgba(255,255,255,0.98);
                    box-shadow: 0 10px 22px rgba(0,0,0,0.42);
                    transform: translateY(-2px);
                }
                .pm-modal-iconbtn:active {
                    background: rgba(0,0,0,0.82);
                    transform: translateY(0px);
                    box-shadow: 0 6px 14px rgba(0,0,0,0.30);
                }
                html.app-skin-dark .pm-modal-iconbtn {
                    background: rgba(0,0,0,0.58);
                    border-color: rgba(255,255,255,0.34);
                    color: rgba(255,255,255,0.96);
                    box-shadow: 0 8px 18px rgba(0,0,0,0.35);
                }
                html.app-skin-dark .pm-modal-iconbtn:hover {
                    background: rgba(0,0,0,0.74);
                    border-color: rgba(255,255,255,0.44);
                    color: rgba(255,255,255,0.98);
                    box-shadow: 0 10px 22px rgba(0,0,0,0.42);
                    transform: translateY(-2px);
                }
                html.app-skin-dark .pm-modal-iconbtn:active {
                    background: rgba(0,0,0,0.82);
                    transform: translateY(0px);
                    box-shadow: 0 6px 14px rgba(0,0,0,0.30);
                }
                .pm-zoom-wrap { width: 100%; position: relative; min-height: 420px; }
                .pm-media-loading {
                    width: 100%;
                    min-height: 420px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    border-radius: 12px;
                    background: rgba(2,6,23,0.04);
                }
                html.app-skin-dark .pm-media-loading { background: rgba(255,255,255,0.04); }
                .pm-media-loading-title { font-size: 14px; font-weight: 600; color: var(--bs-heading-color); margin-bottom: 4px; }
                html.app-skin-dark .pm-media-loading-title { color: rgba(255,255,255,0.92); }
                .pm-media-loading-sub { font-size: 12px; color: var(--bs-secondary-color); }
                html.app-skin-dark .pm-media-loading-sub { color: rgba(255,255,255,0.58); }
                .pm-zoom-stage {
                    width: 100%;
                    height: auto;
                    max-height: 70vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    border-radius: 12px;
                    background: transparent;
                    border: 0;
                    touch-action: none;
                }
                .pm-zoom-img {
                    max-width: 100%;
                    max-height: 70vh;
                    object-fit: contain;
                    border-radius: 10px;
                    user-select: none;
                    -webkit-user-drag: none;
                    will-change: transform;
                    transition: transform 120ms ease-out;
                }
                .pm-zoom-controls {
                    position: absolute;
                    right: 10px;
                    bottom: 18px;
                    display: flex;
                    gap: 8px;
                }
                .pm-pill {
                    display: inline-flex;
                    align-items: center;
                    padding: 0.45rem 0.65rem;
                    border-radius: var(--bs-border-radius);
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                    line-height: 1;
                }
                .pm-pill-warning {
                    background: rgba(var(--bs-warning-rgb), 1);
                    border: 0;
                    color: #fff;
                }
            `}</style>
        </>
    )
}
