import React, { useCallback, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiAlertCircle, FiEdit2, FiEye, FiLayers, FiPlus, FiTrash2 } from 'react-icons/fi'
import Table from '@/components/shared/table/Table'
import { apiDelete, apiGet, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import topTostError from '@/utils/topTostError'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import ZoneFormModal from './ZoneFormModal'
import * as XLSX from 'xlsx'

const truncate = (val, max = 80) => {
    const s = String(val || '').trim()
    if (!s) return ''
    if (s.length <= max) return s
    return `${s.slice(0, max).trimEnd()}…`
}

const ProjectZonesContent = ({ myRole, isArchived }) => {
    const { projectId } = useParams()
    const location = useLocation()
    const isPM = myRole === 'project_manager'
    const canWrite = isPM && !isArchived

    const [zones, setZones] = useState([])
    const [assignedCameras, setAssignedCameras] = useState([])
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)
    const [zoneModal, setZoneModal] = useState(null)
    const [viewZone, setViewZone] = useState(null)

    // URL filter — matches zone_type (scaffold/entry/storage/perimeter/other) or 'all'
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const load = useCallback(() => {
        setLoading(true)
        Promise.all([
            apiGet(`/projects/${projectId}/zones`),
            apiGet(`/projects/${projectId}/cameras`),
        ])
            .then(([zns, cams]) => {
                setZones(Array.isArray(zns) ? zns : [])
                setAssignedCameras(Array.isArray(cams) ? cams : [])
            })
            .catch(() => topTostError('Failed to load zones.'))
            .finally(() => setLoading(false))
    }, [projectId])


    useEffect(() => { load() }, [load])

    useEffect(() => {
        const handler = () => load()
        const unsubBroadcast = onBroadcast('cs:project-zones-refresh', handler)
        return () => { unsubBroadcast() }
    }, [load])

    // Listen for "Create Zone" button in the page header nav bar
    useEffect(() => {
        const handler = () => { if (canWrite) setZoneModal({ zone: null }) }
        window.addEventListener('cs:open-add-zone-modal', handler)
        return () => window.removeEventListener('cs:open-add-zone-modal', handler)
    }, [canWrite])

    useEffect(() => {
        const handler = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [load])

    const filteredZones = activeFilter === 'all'
        ? zones
        : zones.filter(z => (z.zone_type || 'other') === activeFilter)

    useEffect(() => {
        const zns = Array.isArray(zones) ? zones : []
        const cams = Array.isArray(assignedCameras) ? assignedCameras : []
        const assigned = cams.filter(c => c.zone_id != null).length
        const normHealth = (s) => String(s?.value || s || '').toLowerCase()
        const offline = cams.filter(c => normHealth(c.latest_health_status) === 'offline').length
        broadcastRefresh('cs:project-zones-stats', {
            total: zns.length,
            cameras: cams.length,
            assigned,
            offline,
        })
    }, [zones, assignedCameras])

    const zonesWithDerived = React.useMemo(() => {
        const cams = Array.isArray(assignedCameras) ? assignedCameras : []
        const byZone = new Map()
        for (const c of cams) {
            if (c.zone_id == null) continue
            const arr = byZone.get(c.zone_id) || []
            arr.push(c)
            byZone.set(c.zone_id, arr)
        }
        return (Array.isArray(zones) ? zones : []).map((z) => {
            const zoneType = String(z.zone_type || 'other')
            const zoneCams = byZone.get(z.id) || []
            const cameraNames = zoneCams.map(c => c.name || `Cam #${c.id}`).join(' ')
            return {
                ...z,
                zone_type_key: zoneType.toLowerCase(),
                zone_type_label: zoneType.replace(/_/g, ' '),
                camera_names: cameraNames,
                camera_count: zoneCams.length,
                camera_badges: zoneCams.map(c => ({ id: c.id, name: c.name || `Cam #${c.id}` })),
            }
        })
    }, [zones, assignedCameras])

    const tableZones = React.useMemo(() => {
        return activeFilter === 'all'
            ? zonesWithDerived
            : zonesWithDerived.filter(z => (z.zone_type_key || 'other') === activeFilter)
    }, [zonesWithDerived, activeFilter])

    const exportRowsRef = React.useRef(tableZones)
    const exportFilterRef = React.useRef(activeFilter)
    exportRowsRef.current = tableZones
    exportFilterRef.current = activeFilter

    useEffect(() => {
        const triggerDownload = (blob, filename) => {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            a.click()
            URL.revokeObjectURL(url)
        }

        const pkDateStamp = (d = new Date()) => {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Karachi',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(d)
            const get = (type) => parts.find(p => p.type === type)?.value
            return `${get('year')}-${get('month')}-${get('day')}`
        }

        const pkDateTimeLabel = (d = new Date()) =>
            new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Karachi',
                dateStyle: 'long',
                timeStyle: 'short',
            }).format(d) + ' PKT'

        const filterLabel = (f) => {
            const map = {
                all: 'All Zones',
                scaffold: 'Scaffold',
                entry: 'Entry',
                storage: 'Storage',
                perimeter: 'Perimeter',
                other: 'Other',
            }
            const k = String(f || 'all').toLowerCase()
            return map[k] ? `${map[k]} Zones` : 'All Zones'
        }

        const headers = ['Zone Name', 'Type', 'Description', 'Cameras Count', 'Cameras']
        const toRow = (z) => [
            z?.name || '',
            (z?.zone_type_label || z?.zone_type_key || z?.zone_type || 'other').toString().replace(/_/g, ' ').trim(),
            (z?.description || '').toString().trim(),
            String(z?.camera_count ?? 0),
            Array.isArray(z?.camera_badges) ? z.camera_badges.map(c => c.name).join(', ') : '',
        ]

        const exportFile = (rows, f, format) => {
            const today = pkDateStamp()
            const kind = String(format || 'csv').toLowerCase()
            const label = filterLabel(f)

            if (kind === 'pdf') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/zones/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: f }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Project_Zones_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }
            if (kind === 'print') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/zones/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: f }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => {
                        const url = URL.createObjectURL(blob)
                        window.open(url, '_blank')
                        setTimeout(() => URL.revokeObjectURL(url), 60000)
                    })
                    .catch(() => topTostError('Failed to generate print PDF.'))
                return
            }

            if (kind === 'csv') {
                const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
                const genTs = pkDateTimeLabel()
                const meta = [
                    ['ConstructionSight AI — Project Zones Export'],
                    [`Filter:,${label}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(z => toRow(z).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Project_Zones_Export_${today}.csv`)
                return
            }

            if (kind === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const nodes = rows.map(z => {
                    const r = toRow(z)
                    return [
                        `  <zone>`,
                        `    <name>${esc(r[0])}</name>`,
                        `    <type>${esc(r[1])}</type>`,
                        `    <description>${esc(r[2])}</description>`,
                        `    <cameras_count>${esc(r[3])}</cameras_count>`,
                        `    <cameras>${esc(r[4])}</cameras>`,
                        `  </zone>`,
                    ].join('\n')
                })
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report type="project_zones">`,
                    `  <title>ConstructionSight AI — Project Zones Export</title>`,
                    `  <filter>${esc(label)}</filter>`,
                    `  <generated_at>${esc(genTs)}</generated_at>`,
                    `  <total_records>${rows.length}</total_records>`,
                    `  <zones>`,
                    ...nodes,
                    `  </zones>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Project_Zones_Export_${today}.xml`)
                return
            }

            if (kind === 'text') {
                const genTs = pkDateTimeLabel()
                const allRows = rows.map(z => toRow(z))
                const colWidths = headers.map((h, i) => Math.min(46, Math.max(h.length, ...allRows.map(r => String(r[i] ?? '').length))))
                const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
                const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
                const row = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
                const lines = [
                    'ConstructionSight AI — Project Zones Export',
                    `Filter: ${label}`,
                    `Generated: ${genTs}`,
                    `Total Records: ${rows.length}`,
                    '',
                    sep,
                    row(headers),
                    sep,
                    ...allRows.map(r => row(r)),
                    sep,
                ]
                triggerDownload(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), `Project_Zones_Export_${today}.txt`)
                return
            }

            if (kind === 'excel') {
                const genTs = pkDateTimeLabel()
                const aoa = [
                    ['ConstructionSight AI — Project Zones Export'],
                    ['Filter', label],
                    ['Generated', genTs],
                    ['Total Records', rows.length],
                    [],
                    headers,
                    ...rows.map(r => toRow(r)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(aoa)
                ws['!cols'] = headers.map(() => ({ wch: 22 }))
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Zones')
                const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
                triggerDownload(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Project_Zones_Export_${today}.xlsx`)
                return
            }

            topTostError('Unsupported export format')
        }

        const handler = (e) => {
            exportFile(exportRowsRef.current, exportFilterRef.current, e?.detail?.format)
        }

        window.addEventListener('cs:zones-export', handler)
        return () => window.removeEventListener('cs:zones-export', handler)
    }, [])

    const askDeleteZone = (zone) => {
        const cameraCount = assignedCameras.filter(c => c.zone_id === zone.id).length

        if (cameraCount > 0) {
            topTostError(
                `Cannot delete "${zone.name}". It has ${cameraCount} camera(s) assigned. Unassign cameras first.`,
                'error'
            )
            return
        }

        setConfirm({
            variant: 'danger',
            title: 'Delete Zone',
            message: `Delete "${zone.name}" permanently? This cannot be undone.`,
            onConfirm: async () => {
                await apiDelete(`/projects/${projectId}/zones/${zone.id}`)
                setZones(prev => prev.filter(z => z.id !== zone.id))
                topTostError(`Zone "${zone.name}" deleted`, 'success')
                broadcastRefresh('cs:project-cameras-refresh')
                setConfirm(null)
            },
        })
    }

    const closeConfirm = () => { if (!acting) setConfirm(null) }
    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try { await confirm.onConfirm() }
        catch (err) { topTostError(err.response?.data?.detail || 'Failed to delete zone', 'error') }
        finally { setActing(false) }
    }

    const handleZoneSuccess = (result) => {
        const isEdit = zoneModal?.zone != null
        if (isEdit) {
            setZones(prev => prev.map(z => z.id === result.id ? result : z))
        } else {
            setZones(prev => [...prev, result])
        }
        setZoneModal(null)
    }

    const columns = [
        {
            accessorKey: 'name',
            header: () => 'Zone',
            cell: (info) => {
                const zone = info.row.original
                return <span className="pm-pill pm-pill-warning">{zone.name}</span>
            },
        },
        {
            accessorKey: 'zone_type',
            header: () => 'Type',
            cell: (info) => {
                const zoneType = info.getValue() || 'other'
                return (
                    <span className="badge bg-soft-info text-info fs-11 fw-bold text-uppercase">
                        {String(zoneType).replace(/_/g, ' ') || 'other'}
                    </span>
                )
            },
        },
        {
            accessorKey: 'description',
            header: () => 'Description',
            cell: (info) => {
                const val = info.getValue()
                return val
                    ? (
                        <span className="cam-meta">
                            <span className="cam-meta-text text-truncate-2-line" style={{ maxWidth: 560, lineHeight: 1.5 }}>
                                {String(val)}
                            </span>
                        </span>
                    )
                    : <span className="text-muted fs-12">—</span>
            },
            meta: { className: 'zone-col-desc', headerClassName: 'zone-col-desc' },
        },
        {
            accessorKey: 'camera_count',
            header: () => 'Cameras',
            cell: (info) => {
                const zone = info.row.original
                const zoneCams = Array.isArray(zone.camera_badges) ? zone.camera_badges : []
                if (zoneCams.length === 0) {
                    return (
                        <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">
                            No cameras
                        </span>
                    )
                }
                return (
                    <div className="d-flex flex-wrap gap-1">
                        {zoneCams.map(c => (
                            <span key={c.id} className="badge bg-soft-success text-success fs-11 fw-semibold"
                                style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {c.name}
                            </span>
                        ))}
                    </div>
                )
            },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            enableSorting: false,
            cell: (info) => {
                const zone = info.row.original
                return (
                    <div className="hstack gap-2 justify-content-end">
                        <button
                            type="button"
                            className="avatar-text avatar-md"
                            onClick={() => setViewZone(zone)}
                            title="View zone"
                        >
                            <FiEye />
                        </button>
                        {isPM && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => canWrite && setZoneModal({ zone })}
                                    title={isArchived ? 'Project is archived' : 'Edit zone'}
                                    disabled={!canWrite}
                                    style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: canWrite ? '#3b82f6' : '#94a3b8',
                                        border: '2px solid transparent', color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: canWrite ? 'pointer' : 'not-allowed',
                                        padding: 0, lineHeight: 1, boxSizing: 'border-box',
                                        opacity: canWrite ? 1 : 0.5, outline: 'none', boxShadow: 'none',
                                    }}
                                >
                                    <FiEdit2 size={13} strokeWidth={2} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => canWrite && askDeleteZone(zone)}
                                    title={isArchived ? 'Project is archived' : 'Delete zone'}
                                    disabled={!canWrite}
                                    style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: canWrite ? '#ef4444' : '#94a3b8',
                                        border: '2px solid transparent', color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: canWrite ? 'pointer' : 'not-allowed',
                                        padding: 0, lineHeight: 1, boxSizing: 'border-box',
                                        opacity: canWrite ? 1 : 0.5, outline: 'none', boxShadow: 'none',
                                    }}
                                >
                                    <FiTrash2 size={13} strokeWidth={2} />
                                </button>
                            </>
                        )}
                    </div>
                )
            },
            meta: { headerClassName: 'text-end', headerAlign: 'end' },
        },
    ]

    if (loading) return <PageLoader />

    return (
        <>
            <style>{`
                .zones-table-premium .table tbody tr {
                    transition: all 0.2s ease;
                    border-bottom: 1px solid rgba(0,0,0,0.06);
                }
                .zones-table-premium .table tbody tr:hover {
                    background-color: rgba(59, 130, 246, 0.03);
                    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.1);
                }
                html.app-skin-dark .zones-table-premium .table tbody tr:hover {
                    background-color: rgba(59, 130, 246, 0.08);
                    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.15);
                }
                .zones-table-premium .table th {
                    font-weight: 600;
                    letter-spacing: 0.3px;
                    border-bottom: 2px solid rgba(0,0,0,0.08);
                }
                .pm-actions-end { padding-right: 30px; }
                html.app-skin-dark .zones-table-premium .table th {
                    border-bottom-color: rgba(255,255,255,0.1);
                }
                .zones-table-premium .zone-col-desc { width: 580px; }
                @media (max-width: 1199.98px) { .zones-table-premium .zone-col-desc { width: 420px; } }
                @media (max-width: 991.98px) { .zones-table-premium .zone-col-desc { width: auto; } }
                .pm-zone-view-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1050; padding: 18px; }
                .pm-zone-view-card { width: min(860px, 100%); border-radius: 14px; border: 1px solid var(--bs-border-color); overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,0.35); }
                .pm-zone-card-title { font-size: 1.25rem; font-weight: 700; color: rgba(2,6,23,0.92); }
                html.app-skin-dark .pm-zone-card-title { color: rgba(255,255,255,0.92); }
                .pm-zone-card-sub { font-size: 0.75rem; color: rgba(2,6,23,0.58); }
                html.app-skin-dark .pm-zone-card-sub { color: rgba(255,255,255,0.62); }
                html.app-skin-dark .pm-zone-view-card .btn-close { filter: invert(1) grayscale(100%); opacity: .8; }
                .pm-zone-avatar-wrap { width: 72px; height: 72px; border-radius: 999px; display: flex; align-items: center; justify-content: center; background: rgba(2,6,23,0.06); border: 1px solid var(--bs-border-color); }
                html.app-skin-dark .pm-zone-avatar-wrap { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
                .pm-zone-split-col { border-left: 1px dashed var(--bs-border-color); }
                html.app-skin-dark .pm-zone-split-col { border-left-color: rgba(255,255,255,0.10); }
                @media (max-width: 767.98px) { .pm-zone-split-col { border-left: none; } }
                .pm-zone-surface { background: rgba(2,6,23,0.025); border: 1px solid var(--bs-border-color); }
                html.app-skin-dark .pm-zone-surface { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.10); }
                .pm-zone-desc { color: var(--bs-body-color); }
                html.app-skin-dark .pm-zone-desc { color: rgba(226, 232, 240, 0.88); }
                .cam-meta { display: inline-flex; align-items: center; gap: 4px; }
                .cam-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                .cam-meta-text { min-width: 0; }
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
                .pm-pill-primary {
                    background: rgba(var(--bs-primary-rgb), 1);
                    border: 0;
                    color: #fff;
                }
            `}</style>

            {isArchived && (
                <div className="col-12 mb-3">
                    <div className="alert alert-dark mb-0">
                        <small>This project is archived. Zone management is disabled.</small>
                    </div>
                </div>
            )}

            <div className="zones-table-premium">
                <Table
                    tableId={`projectZones-${projectId}`}
                    data={tableZones}
                    columns={columns}
                    searchKeys={['name', 'zone_type_label', 'zone_type_key', 'description', 'camera_names']}
                />
            </div>

            {zoneModal && (
                <ZoneFormModal
                    projectId={projectId}
                    zone={zoneModal.zone}
                    onSuccess={handleZoneSuccess}
                    onClose={() => setZoneModal(null)}
                />
            )}

            {/* Zone View Modal */}
            {viewZone && (
                <div className="pm-zone-view-overlay" onClick={() => setViewZone(null)}>
                    <div className="card pm-zone-view-card" onClick={(e) => e.stopPropagation()}>
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <div>
                                <div className="pm-zone-card-title">Zone Overview</div>
                                <div className="pm-zone-card-sub">Overview of zone configuration and monitoring purpose</div>
                            </div>
                            <button type="button" className="btn-close" onClick={() => setViewZone(null)} />
                        </div>
                        <div className="card-body p-4">
                            <div className="row g-4 align-items-start">
                                <div className="col-md-4">
                                    <div className="text-center">
                                        <div className="pm-zone-avatar-wrap mx-auto">
                                            <FiLayers size={26} />
                                        </div>
                                        <div className="mt-3 d-flex align-items-center justify-content-center gap-2 flex-wrap">
                                            <span className="fs-11 fw-semibold text-muted text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone Name:</span>
                                            <span className="fs-12 fw-bold" style={{ color: 'rgba(148,163,184,0.92)' }}>{viewZone.name}</span>
                                        </div>
                                        <div className="mt-2 d-flex align-items-center justify-content-center gap-2 flex-wrap">
                                            <span className="fs-11 fw-semibold text-muted text-uppercase" style={{ letterSpacing: '0.06em' }}>Zone Type:</span>
                                            <span className="fs-12 fw-semibold" style={{ color: 'rgba(148,163,184,0.92)' }}>
                                                {(viewZone.zone_type || 'other').toString().slice(0, 1).toUpperCase() + (viewZone.zone_type || 'other').toString().slice(1)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="col-md-8 pm-zone-split-col">
                                    <div className="pm-zone-surface rounded-3 p-3">
                                        <div className="fs-11 fw-semibold text-muted text-uppercase mb-2" style={{ letterSpacing: '0.06em' }}>
                                            Description
                                        </div>
                                        <div className="cam-meta pm-zone-desc fs-12">
                                            <span className="cam-meta-text text-truncate-2-line" style={{ lineHeight: 1.6 }}>
                                                {String(viewZone.description || '').trim() || 'None'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Zone Create / Edit Modal */}
            {zoneModal && (
                <ZoneFormModal
                    projectId={projectId}
                    zone={zoneModal.zone}
                    onSuccess={handleZoneSuccess}
                    onClose={() => setZoneModal(null)}
                />
            )}

            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant}
                title={confirm?.title}
                message={confirm?.message}
                loading={acting}
                onClose={closeConfirm}
                onConfirm={runConfirm}
            />
        </>
    )
}

export default ProjectZonesContent
