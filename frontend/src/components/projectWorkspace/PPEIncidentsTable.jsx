import React, { useState, useRef, useEffect } from 'react'
import { BsArrowLeft, BsArrowRight, BsDot } from 'react-icons/bs'
import { FiCheck, FiX, FiClock, FiUser, FiEye, FiZoomIn, FiZoomOut, FiRefreshCw, FiMoreHorizontal, FiCheckCircle } from 'react-icons/fi'
import { useQuery, useQueryClient, useMutation, keepPreviousData } from '@tanstack/react-query'
import { QK } from '@/utils/queryKeys'
import { apiGet, apiPatch, API_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import topTost from '@/utils/topTost'
import { broadcastRefresh } from '@/utils/broadcast'
import { patchIncidentInCache } from '@/utils/ppeCacheUtils'

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

const ViolationBadges = ({ hasHelmet, hasVest, incidentType }) => {
    // Show explicit boolean if available, else fall back to incident_type
    const helmetMissing = hasHelmet === false || incidentType === 'no_helmet' || incidentType === 'both_missing'
    const vestMissing   = hasVest   === false || incidentType === 'no_vest'   || incidentType === 'both_missing'
    return (
        <span className="d-flex gap-2 flex-wrap">
            <span
                className={`badge fs-11 fw-semibold text-uppercase d-inline-flex align-items-center gap-1 ${helmetMissing ? 'bg-soft-danger' : 'bg-soft-success'}`}
                title={helmetMissing ? 'No helmet' : 'Helmet'}
                style={{ color: helmetMissing ? '#dc3545' : '#28a745' }}
            >
                {helmetMissing ? <FiX size={12} style={{ color: '#dc3545', stroke: '#dc3545', strokeWidth: 2.5 }} /> : <FiCheck size={12} style={{ color: '#28a745', stroke: '#28a745', strokeWidth: 2.5 }} />}
                <span>{helmetMissing ? 'No Helmet' : 'Helmet'}</span>
            </span>
            <span
                className={`badge fs-11 fw-semibold text-uppercase d-inline-flex align-items-center gap-1 ${vestMissing ? 'bg-soft-danger' : 'bg-soft-success'}`}
                title={vestMissing ? 'No vest' : 'Vest'}
                style={{ color: vestMissing ? '#dc3545' : '#28a745' }}
            >
                {vestMissing ? <FiX size={12} style={{ color: '#dc3545', stroke: '#dc3545', strokeWidth: 2.5 }} /> : <FiCheck size={12} style={{ color: '#28a745', stroke: '#28a745', strokeWidth: 2.5 }} />}
                <span>{vestMissing ? 'No Vest' : 'Vest'}</span>
            </span>
        </span>
    )
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
                            {item.icon && React.cloneElement(item.icon, { size: 14, strokeWidth: 1.8 })}
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
                    alt="Incident snapshot"
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

const snapshotPreload = (() => {
    const cache = new Map()
    return (src) => {
        if (!src) return null
        const existing = cache.get(src)
        if (existing) return existing
        const img = new Image()
        const entry = { img, status: 'loading' }
        cache.set(src, entry)
        img.onload = () => { entry.status = 'loaded' }
        img.onerror = () => { entry.status = 'error' }
        img.decoding = 'async'
        img.src = src
        return entry
    }
})()

const SnapshotThumb = ({ url }) => {
    const [modal, setModal] = useState(false)
    if (!url) {
        return (
            <button
                type="button"
                className="avatar-text avatar-md ppe-eye-disabled"
                title="Snapshot not available"
                onClick={() => topTostError('Snapshot is not available for this incident.', 'info')}
            >
                <FiEye size={14} />
            </button>
        )
    }
    const src = url.startsWith('/') ? `${API_BASE}${url}` : url
    return (
        <>
            <button
                onClick={() => setModal(true)}
                className="avatar-text avatar-md"
                title="View snapshot"
                onMouseEnter={() => snapshotPreload(src)}
                onFocus={() => snapshotPreload(src)}
                type="button"
            >
                <FiEye size={14} />
            </button>
            <PreviewModal open={modal} onClose={() => setModal(false)} title="Incident Snapshot">
                <SnapshotZoomView src={src} />
            </PreviewModal>
        </>
    )
}

const toPlayableVideoUrl = (src) => {
    if (!src) return src
    if (!src.includes('res.cloudinary.com')) return src
    if (!src.includes('/upload/')) return src
    return src.replace('/upload/', '/upload/f_mp4,vc_h264,ac_aac/')
}

const ClipPlayerInner = ({ src }) => {
    const [videoReady, setVideoReady] = useState(false)
    return (
        <div className="pm-zoom-wrap">
            {!videoReady && (
                <div className="pm-media-loading">
                    <div className="spinner-border text-primary mb-3" style={{ width: 32, height: 32 }} />
                    <div className="pm-media-loading-title">Preparing Video</div>
                    <div className="pm-media-loading-sub">This may take a few moments</div>
                </div>
            )}
            <video
                controls
                preload="auto"
                playsInline
                style={{ width: '100%', maxHeight: '70vh', borderRadius: 12, display: videoReady ? 'block' : 'none' }}
                onCanPlay={() => setVideoReady(true)}
            >
                <source src={src} type="video/mp4" />
            </video>
        </div>
    )
}

const ClipPlayer = ({ url }) => {
    const [modal, setModal] = useState(false)
    if (!url) {
        return (
            <button
                type="button"
                className="avatar-text avatar-md ppe-eye-disabled"
                title="Video clip not available"
                onClick={() => topTostError('Video clip is not available for this incident.', 'info')}
            >
                <FiEye size={14} />
            </button>
        )
    }
    const rawSrc = url.startsWith('/') ? `${API_BASE}${url}` : url
    const src = toPlayableVideoUrl(rawSrc)
    return (
        <>
            <button
                onClick={() => setModal(true)}
                className="avatar-text avatar-md"
                title="View incident recording"
            >
                <FiEye size={14} />
            </button>
            <PreviewModal open={modal} onClose={() => setModal(false)} title="Incident Recording">
                <ClipPlayerInner src={src} />
            </PreviewModal>
        </>
    )
}

const PPEIncidentsTable = ({ projectId, cameras, onStatusChange, dateFrom, dateTo, statusFilter, disabled, liveMode = false }) => {
    const queryClient = useQueryClient()
    const [page, setPage] = useState(1)
    const [updatingId, setUpdatingId] = useState(null)
    const tableBodyRef = useRef(null)

    const perPage = 10

    // Build query params helper
    const getQsParams = () => {
        const params = new URLSearchParams({ page, per_page: perPage })
        if (dateFrom)     params.set('date_from', dateFrom)
        if (dateTo)       params.set('date_to',   dateTo)
        if (statusFilter) params.set('status',    statusFilter)
        return params
    }

    const qKey = QK.ppeIncidents(projectId, page, dateFrom, dateTo, statusFilter)

    // React Query hook for incidents.
    // SSE drives updates (ppe_incident_updated patches via patchIncidentInCache, ppe_live_alert
    // invalidates ['ppe']). placeholderData keeps the table visible across page/filter changes
    // — no skeleton flash. staleTime: Infinity prevents background polls from racing SSE.
    const { data, isLoading } = useQuery({
        queryKey: qKey,
        queryFn: async () => {
            const data = await apiGet(`/projects/${projectId}/ppe/incidents?${getQsParams()}`)
            return data
        },
        staleTime: 30_000,
        placeholderData: keepPreviousData,
        enabled: !disabled,
        refetchOnWindowFocus: 'always',
        refetchInterval: liveMode ? false : 30_000,
        refetchIntervalInBackground: false,
    })

    const incidents = disabled ? [] : (data?.items ?? [])
    const total = disabled ? 0 : (data?.total ?? 0)

    // Status update mutation with optimistic update
    const statusMutation = useMutation({
        mutationFn: async ({ incidentId, newStatus }) => {
            const incident = incidents.find(i => i.id === incidentId)
            const cameraName = incident?.camera_name
                || cameras.find(c => c.camera_id === incident?.camera_id)?.camera_name
                || (incident?.camera_id != null ? `Cam #${incident.camera_id}` : 'Camera')
            const zoneText = incident?.zone_name ? ` in Zone ${incident.zone_name}` : ''
            const metaSentence = `The incident occurred on ${cameraName}${zoneText}.`

            const response = await apiPatch(
                `/projects/${projectId}/ppe/incidents/${incidentId}/status`,
                { status: newStatus, meta_sentence: metaSentence }
            )
            return response
        },

        onMutate: async ({ incidentId, newStatus }) => {
            setUpdatingId(incidentId)
            await queryClient.cancelQueries({ queryKey: qKey })
            const snapshot = queryClient.getQueryData(qKey)

            // Optimistic update
            queryClient.setQueryData(qKey, old => ({
                ...old,
                items: old.items.map(i => i.id === incidentId ? { ...i, status: newStatus } : i),
            }))

            return { snapshot }
        },

        onError: (_err, _vars, ctx) => {
            if (ctx?.snapshot) {
                queryClient.setQueryData(qKey, ctx.snapshot)
            }
            topTostError('Failed to update incident status')
            setUpdatingId(null)
        },

        onSuccess: (_data, { incidentId, newStatus }) => {
            // Surgical in-place patch — optimistic update already shows correct state,
            // no re-fetch needed (avoids full list re-render and scroll position reset)
            patchIncidentInCache(queryClient, projectId, {
                incident_id: incidentId,
                status: newStatus,
                ...(newStatus === 'resolved' ? { ended_at: new Date().toISOString() } : {}),
            })

            // Notify other tabs (same browser) and other-account windows (via their SSE)
            broadcastRefresh('ppe:incident-updated', { projectId, incident_id: incidentId, status: newStatus })

            topTost('Incident status updated', 'success')
            if (onStatusChange) onStatusChange()
            setUpdatingId(null)
        },
    })

    useEffect(() => {
        const tp = Math.max(1, Math.ceil(total / perPage))
        if (page > tp) setPage(tp)
    }, [total, page])

    // Auto-scroll to top when new incidents arrive
    useEffect(() => {
        if (tableBodyRef.current && incidents.length > 0 && page === 1) {
            tableBodyRef.current.parentElement.parentElement.scrollTop = 0
        }
    }, [incidents, page])

    // Fallback: full refetch when a new incident is added (ppe_live_alert path)
    // Status-change events are handled surgically above; this only fires for new-incident events
    useEffect(() => {
        const handler = () =>
            queryClient.invalidateQueries({ queryKey: ['ppe', 'incidents', projectId] })
        window.addEventListener('cs:ppe-incidents-refresh', handler)
        return () => window.removeEventListener('cs:ppe-incidents-refresh', handler)
    }, [projectId, queryClient])

    const handleStatusUpdate = (incidentId, newStatus) => {
        statusMutation.mutate({ incidentId, newStatus })
    }

    const getActions = (inc) => {
        const busy = updatingId === inc.id
        const ackDisabled = busy || inc.status !== 'open'
        const resolveDisabled = busy || inc.status === 'resolved'
        return [
            {
                label: 'Acknowledge',
                icon: <FiCheck />,
                onClick: () => handleStatusUpdate(inc.id, 'acknowledged'),
                disabled: ackDisabled,
            },
            { type: 'divider' },
            {
                label: 'Resolve',
                icon: <FiCheckCircle />,
                onClick: () => handleStatusUpdate(inc.id, 'resolved'),
                disabled: resolveDisabled,
            },
        ]
    }

    const totalPages = Math.ceil(total / perPage)
    const canPrev = page > 1
    const canNext = page < totalPages
    const pagerItems = getPagerItems(totalPages, page)

    return (
        <div className="card stretch stretch-full">
            <div className="card-header">
                <div>
                    <h5 className="mb-0">Safety Incidents</h5>
                    <span className="fs-12 text-muted">Comprehensive record of safety violations across monitored zones</span>
                </div>
            </div>

            <div className="card-body p-0 ppe-incidents-body d-flex flex-column">
                {incidents.length === 0 && isLoading ? (
                    <div className="text-center py-5 text-muted">Loading incidents…</div>
                ) : incidents.length === 0 ? (
                    <div className="d-flex flex-column align-items-center justify-content-center text-center text-muted fs-13" style={{ flex: 1, minHeight: 220 }}>
                        <i className="feather-file-text fs-28 d-block mb-2" style={{ opacity: 0.4 }} />
                        <span className="fw-semibold d-block mb-1">No records available</span>
                        <span className="fs-12">No results for the current selection</span>
                    </div>
                ) : (
                    <div className="table-responsive ppe-incidents-responsive">
                        <table className="table table-hover mb-0 align-middle">
                            <thead>
                                <tr className="border-b">
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Severity</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Violation Type</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Camera</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Person ID</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Timestamp</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Snapshot</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Clip</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Incident Status</th>
                                    <th className="fs-11 text-uppercase" style={{ letterSpacing: '0.06em' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody ref={tableBodyRef}>
                                {incidents.map(inc => (
                                    <tr key={inc.id}>
                                        <td><SeverityBadge severity={inc.severity} /></td>
                                        <td><ViolationBadges hasHelmet={inc.has_helmet} hasVest={inc.has_vest} incidentType={inc.incident_type} /></td>
                                        <td>
                                            <span
                                                className="badge bg-soft-success text-success fs-11 fw-semibold"
                                                style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            >
                                                {inc.camera_name || cameras.find(c => c.camera_id === inc.camera_id)?.camera_name || `Cam #${inc.camera_id}`}
                                            </span>
                                        </td>
                                        <td>
                                            {inc.zone_name ? (
                                                <span className="pm-pill pm-pill-warning" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {inc.zone_name}
                                                </span>
                                            ) : (
                                                <span className="text-muted fs-11">—</span>
                                            )}
                                        </td>
                                        <td>
                                            <span className="proj-meta d-inline-flex align-items-center gap-1">
                                                <FiUser size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 220 }}>
                                                    {inc.global_person_id != null ? `G-${inc.global_person_id}` : `T-${inc.track_id ?? '?'}`}
                                                </span>
                                            </span>
                                        </td>
                                        <td>
                                            <span className="proj-meta d-inline-flex align-items-center gap-1">
                                                <FiClock size={12} className="opacity-75 flex-shrink-0 align-middle" />
                                                <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 220 }}>
                                                    {inc.started_at ? new Date(inc.started_at).toLocaleString() : '—'}
                                                </span>
                                            </span>
                                        </td>
                                        <td><SnapshotThumb url={inc.snapshot_url} /></td>
                                        <td><ClipPlayer url={inc.video_clip_url} /></td>
                                        <td><StatusBadge status={inc.status} /></td>
                                        <td>
                                            <div className="d-flex justify-content-end">
                                                <ActionsMenu items={getActions(inc)} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
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
                                                    if (canPrev) {
                                                        const p = page - 1
                                                        setPage(p)
                                                        pageRef.current = p
                                                        fetchIncidentsRef.current(p)
                                                    }
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
                                                                const p = Number(item)
                                                                setPage(p)
                                                                pageRef.current = p
                                                                fetchIncidentsRef.current(p)
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
                                                    if (canNext) {
                                                        const p = page + 1
                                                        setPage(p)
                                                        pageRef.current = p
                                                        fetchIncidentsRef.current(p)
                                                    }
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

            <style>{`
                .ppe-incidents-body {
                    transition: none !important;
                }
                .ppe-incidents-responsive {
                    transition: none !important;
                    overflow-x: auto !important;
                    overflow-y: visible !important;
                    -webkit-overflow-scrolling: touch;
                }
                .ppe-incidents-responsive table,
                .ppe-incidents-responsive tbody {
                    transition: none !important;
                }
                .ppe-incidents-responsive th:first-child,
                .ppe-incidents-responsive td:first-child {
                    padding-left: 15px !important;
                }
                .ppe-incidents-responsive th:last-child,
                .ppe-incidents-responsive td:last-child {
                    padding-right: 15px !important;
                    width: 56px;
                }
                .ppe-incidents-responsive th:last-child,
                .ppe-incidents-responsive td:last-child {
                    text-align: right;
                }
                .ppe-incidents-responsive th:nth-child(9),
                .ppe-incidents-responsive td:nth-child(9) {
                    width: 170px;
                }
                .ppe-incidents-responsive td:nth-child(9) .badge {
                    white-space: nowrap;
                }
                .ppe-eye-disabled {
                    opacity: 0.35;
                    cursor: not-allowed;
                    pointer-events: auto;
                }
                .ppe-eye-disabled:hover {
                    opacity: 0.45;
                }

                .pm-zone-view-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1050; padding: 18px; }
                .pm-zone-view-card { width: min(740px, 100%); border-radius: 14px; border: 1px solid var(--bs-border-color); overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,0.35); }
                .pm-glass-view-card { background: rgba(255,255,255,0.92); backdrop-filter: blur(14px); }
                html.app-skin-dark .pm-glass-view-card { background: rgba(15,23,42,0.88); }
                .pm-zone-card-title { font-size: 1.05rem; font-weight: 600; color: rgba(2,6,23,0.92); }
                html.app-skin-dark .pm-zone-card-title { color: rgba(255,255,255,0.92); }
                .pm-zone-card-sub { font-size: 0.75rem; color: rgba(2,6,23,0.58); }
                html.app-skin-dark .pm-zone-card-sub { color: rgba(255,255,255,0.62); }
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
                html.app-skin-dark .pm-zoom-stage {
                    background: transparent;
                    border-color: transparent;
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
        </div>
    )
}

export default PPEIncidentsTable
