import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiEye, FiWifi, FiCheck } from 'react-icons/fi'
import Table from '@/components/shared/table/Table'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { SelectDropdown } from '@/components/shared/Dropdown'
import { apiGet, apiPatch, apiDelete, apiPost, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { openCameraStream } from '@/utils/cameraSSE'
import topTostError from '@/utils/topTostError'
import * as XLSX from 'xlsx'

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png'

const registryStatusCfg = (raw) => {
    const key = (raw?.content || raw || '').toLowerCase()
    const map = {
        draft:         { color: 'bg-soft-danger text-danger',   content: 'Draft' },
        verifying:     { color: 'bg-soft-teal text-teal',       content: 'Verifying' },
        verified:      { color: 'bg-soft-warning text-warning', content: 'Verified' },
        verify_failed: { color: 'bg-soft-danger text-danger',   content: 'Failed' },
        archived:      { color: 'bg-soft-info text-info',       content: 'Archived' },
    }
    return map[key] || null
}

const healthStatusCfg = (raw) => {
    const key = (raw?.value || raw || '').toLowerCase()
    const map = {
        healthy:     { color: 'bg-soft-success text-success', content: 'Healthy' },
        degraded:    { color: 'bg-soft-warning text-warning', content: 'Degraded' },
        offline:     { color: 'bg-soft-danger text-danger',   content: 'Offline' },
        maintenance: { color: 'bg-soft-info text-info',       content: 'Maintenance' },
        no_data:     { color: 'bg-gray-200 text-muted',       content: 'No Data' },
    }
    return map[key] || map.no_data
}

const applyFilter = (cameras, filter) => {
    const f = String(filter || 'all').toLowerCase()
    if (f === 'all') return cameras
    const normRegistry = (s) => String(s?.content || s || '').toLowerCase()
    const normHealth = (s) => String(s?.value || s || '').toLowerCase()
    switch (f) {
        case 'verified':   return cameras.filter(c => normRegistry(c.registry_status) === 'verified')
        case 'draft':      return cameras.filter(c => normRegistry(c.registry_status) === 'draft')
        case 'healthy':    return cameras.filter(c => normHealth(c.latest_health_status) === 'healthy')
        case 'offline':    return cameras.filter(c => normHealth(c.latest_health_status) === 'offline')
        case 'degraded':   return cameras.filter(c => normHealth(c.latest_health_status) === 'degraded')
        case 'unassigned': return cameras.filter(c => !c.zone_id)
        default:           return cameras
    }
}

const ProjectCamerasTable = ({ myRole, projectStatus, isArchived }) => {
    const { projectId } = useParams()
    const location = useLocation()
    const isPM = myRole === 'project_manager'
    const isSetup = projectStatus === 'setup_in_progress'
    const canWrite = isPM && !isArchived
    const [cameras, setCameras] = useState([])
    const [zones, setZones] = useState([])
    const [availableCameras, setAvailableCameras] = useState([])
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)

    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const load = useCallback(() => {
        setLoading(true)
        const promises = [
            apiGet(`/projects/${projectId}/cameras`),
            apiGet(`/projects/${projectId}/zones`),
        ]
        if (isPM) promises.push(apiGet(`/projects/${projectId}/cameras/available`))

        Promise.all(promises)
            .then(([cams, zns, ...rest]) => {
                setCameras(Array.isArray(cams) ? cams : [])
                setZones(Array.isArray(zns) ? zns : [])
                if (isPM && rest.length > 0) {
                    const available = rest[0]
                    setAvailableCameras(Array.isArray(available) ? available.filter(c => !c.is_assigned) : [])
                }
            })
            .catch(() => topTostError('Failed to load cameras.'))
            .finally(() => setLoading(false))
    }, [projectId, isPM])

    const silentLoad = useCallback(() => {
        const promises = [
            apiGet(`/projects/${projectId}/cameras`),
            apiGet(`/projects/${projectId}/zones`),
        ]
        if (isPM) promises.push(apiGet(`/projects/${projectId}/cameras/available`))

        Promise.all(promises)
            .then(([cams, zns, ...rest]) => {
                setCameras(Array.isArray(cams) ? cams : [])
                setZones(Array.isArray(zns) ? zns : [])
                if (isPM && rest.length > 0) {
                    const available = rest[0]
                    setAvailableCameras(Array.isArray(available) ? available.filter(c => !c.is_assigned) : [])
                }
            })
            .catch(() => {})
    }, [projectId, isPM])

    useEffect(() => { load() }, [load])

    useEffect(() => {
        const handler = () => load()
        const unsubBroadcast = onBroadcast('cs:project-cameras-refresh', handler)
        return () => { unsubBroadcast() }
    }, [load])

    useEffect(() => {
        const handler = () => { if (!document.hidden) silentLoad() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [silentLoad])

    // SSE: update individual camera rows in-place without reloading the full list
    useEffect(() => {
        return openCameraStream(`/projects/${projectId}/cameras/stream`, {
            camera_health_update: (d) => {
                setCameras(prev => prev.map(c =>
                    c.id === d.camera_id ? { ...c, latest_health_status: d.health_status } : c
                ))
            },
            camera_verification_update: (d) => {
                setCameras(prev => prev.map(c =>
                    c.id === d.camera_id ? { ...c, registry_status: d.registry_status } : c
                ))
                // If camera just became verified, refresh available list for PM
                if (isPM && d.registry_status === 'verified') {
                    silentLoad()
                }
            },
        }, { onReconnect: silentLoad })
    }, [projectId, isPM, silentLoad])

    // Fallback polling every 15s — catches missed SSE events (server restart, cross-window actions)
    useEffect(() => {
        const pollId = setInterval(silentLoad, 15_000)
        return () => clearInterval(pollId)
    }, [silentLoad])

    useEffect(() => {
        const normRegistry = (s) => String(s?.content || s || '').toLowerCase()
        const normHealth = (s) => String(s?.value || s || '').toLowerCase()
        const total = cameras.length
        const verified = cameras.filter(c => normRegistry(c.registry_status) === 'verified').length
        const draft = cameras.filter(c => normRegistry(c.registry_status) === 'draft').length
        const healthy = cameras.filter(c => normHealth(c.latest_health_status) === 'healthy').length
        const offline = cameras.filter(c => normHealth(c.latest_health_status) === 'offline').length
        const unassigned = cameras.filter(c => !c.zone_id).length
        broadcastRefresh('cs:project-cameras-stats', { total, verified, draft, healthy, offline, unassigned })
    }, [cameras])

    const zoneMap = useMemo(() => {
        const m = {}
        zones.forEach(z => { m[z.id] = z.name })
        return m
    }, [zones])

    const camerasWithDerived = useMemo(() => {
        return cameras.map((c) => {
            const registryKey = String(c.registry_status?.content || c.registry_status || '').toLowerCase()
            const healthKey = String(c.latest_health_status?.value || c.latest_health_status || '').toLowerCase()
            const reg = registryStatusCfg(c.registry_status)
            const health = healthStatusCfg(c.latest_health_status)
            const zoneName = c.zone_id ? (zoneMap[c.zone_id] || '') : 'Unassigned'
            return {
                ...c,
                registry_status_key: registryKey,
                registry_status_label: reg?.content || String(c.registry_status?.content || c.registry_status || ''),
                health_status_key: healthKey,
                health_status_label: health?.content || '',
                health_status_label_short: health?.content === 'No Data' ? 'No Data' : health?.content,
                zone_name: zoneName,
                onvif_label: c.onvif_supported ? 'ONVIF' : '',
            }
        })
    }, [cameras, zoneMap])

    const filteredCameras = useMemo(() => applyFilter(camerasWithDerived, activeFilter), [camerasWithDerived, activeFilter])

    const filteredCamerasRef = useRef(filteredCameras)
    const activeFilterRef = useRef(activeFilter)
    filteredCamerasRef.current = filteredCameras
    activeFilterRef.current = activeFilter

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

        const fmtDate = (v) => {
            if (!v) return ''
            try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
            catch { return String(v) }
        }

        const filterLabel = (f) => {
            const map = {
                all: 'All Cameras',
                verified: 'Verified Cameras',
                draft: 'Draft Cameras',
                healthy: 'Healthy Cameras',
                offline: 'Offline Cameras',
                unassigned: 'Unassigned Cameras',
            }
            return map[String(f || 'all')] || 'All Cameras'
        }

        const headers = ['Camera Name', 'Vendor', 'Model', 'Serial', 'Verification Status', 'Health Status', 'Zone', 'ONVIF']
        const toRow = (c) => [
            c?.name || '',
            c?.vendor || '',
            c?.model || '',
            c?.serial_number || '',
            (c?.registry_status_label || c?.registry_status_key || '').toString().replace(/_/g, ' ').trim(),
            (c?.health_status_label || c?.health_status_key || '').toString().replace(/_/g, ' ').trim(),
            c?.zone_name || 'Unassigned',
            c?.onvif_supported ? 'Yes' : 'No',
        ]

        const exportFile = (rows, f, format) => {
            const today = pkDateStamp()
            const kind = String(format || 'csv').toLowerCase()
            const label = filterLabel(f)

            if (kind === 'pdf') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/cameras/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: f }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Project_Cameras_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }
            if (kind === 'print') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/cameras/export/pdf`, {
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
                    ['ConstructionSight AI — Project Cameras Export'],
                    [`Filter:,${label}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(c => toRow(c).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Project_Cameras_Export_${today}.csv`)
                return
            }

            if (kind === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const nodes = rows.map(c => {
                    const r = toRow(c)
                    return [
                        `  <camera>`,
                        `    <name>${esc(r[0])}</name>`,
                        `    <vendor>${esc(r[1])}</vendor>`,
                        `    <model>${esc(r[2])}</model>`,
                        `    <serial>${esc(r[3])}</serial>`,
                        `    <verification_status>${esc(r[4])}</verification_status>`,
                        `    <health_status>${esc(r[5])}</health_status>`,
                        `    <zone_assignment>${esc(r[6])}</zone_assignment>`,
                        `    <onvif>${esc(r[7])}</onvif>`,
                        `  </camera>`,
                    ].join('\n')
                })
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report type="project_cameras">`,
                    `  <title>ConstructionSight AI — Project Cameras Export</title>`,
                    `  <filter>${esc(label)}</filter>`,
                    `  <generated_at>${esc(genTs)}</generated_at>`,
                    `  <total_records>${rows.length}</total_records>`,
                    `  <cameras>`,
                    ...nodes,
                    `  </cameras>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Project_Cameras_Export_${today}.xml`)
                return
            }

            if (kind === 'text') {
                const genTs = pkDateTimeLabel()
                const allRows = rows.map(c => toRow(c))
                const colWidths = headers.map((h, i) => Math.min(42, Math.max(h.length, ...allRows.map(r => String(r[i] ?? '').length))))
                const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
                const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
                const row = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
                const lines = [
                    'ConstructionSight AI — Project Cameras Export',
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
                triggerDownload(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), `Project_Cameras_Export_${today}.txt`)
                return
            }

            if (kind === 'excel') {
                const genTs = pkDateTimeLabel()
                const aoa = [
                    ['ConstructionSight AI — Project Cameras Export'],
                    ['Filter', label],
                    ['Generated', genTs],
                    ['Total Records', rows.length],
                    [],
                    headers,
                    ...rows.map(r => toRow(r)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(aoa)
                ws['!cols'] = headers.map(() => ({ wch: 18 }))
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Cameras')
                const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
                triggerDownload(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Project_Cameras_Export_${today}.xlsx`)
                return
            }

            topTostError('Unsupported export format')
        }

        const handler = (e) => {
            const format = String(e?.detail?.format || '').toLowerCase()
            exportFile(filteredCamerasRef.current, activeFilterRef.current, format)
        }

        window.addEventListener('cs:project-cameras-export', handler)
        return () => window.removeEventListener('cs:project-cameras-export', handler)
    }, [])

    const handleChangeZone = (cameraId, zoneId) => {
        const camera = cameras.find(c => c.id === cameraId)
        if (!camera || !zoneId) return

        const zone = zones.find(z => z.id === parseInt(zoneId))
        if (!zone) { topTostError('Selected zone not found'); return }

        const oldZone = zones.find(z => z.id === camera.zone_id)
        const oldZoneName = oldZone?.name || 'Unassigned'

        // Show ConfirmDialog with same design as admin panel
        setConfirm({
            variant: 'warning',
            title: 'Change Camera Zone',
            message: `Changing "${camera.name}" from zone "${oldZoneName}" to "${zone.name}" will stop inferences for the old zone and start new ones. Analytics are preserved. Continue?`,
            onConfirm: async () => {
                // Optimistic update
                setCameras(prev => prev.map(c => c.id === cameraId ? { ...c, zone_id: parseInt(zoneId) } : c))

                try {
                    const result = await apiPatch(`/projects/${projectId}/cameras/${cameraId}/zone`, {
                        zone_id: parseInt(zoneId),
                    })
                    if (!result || !result.ok) {
                        topTostError('Zone assignment failed — please try again')
                        silentLoad()
                        return
                    }
                    topTostError(`Zone changed to "${zone.name}"`, 'success')
                    broadcastRefresh('cs:project-zones-refresh')
                } catch (err) {
                    silentLoad()
                    topTostError(err.response?.data?.detail || 'Failed to assign zone to camera')
                }
            },
        })
    }

    const closeConfirm = () => { if (!acting) setConfirm(null) }
    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try {
            await confirm.onConfirm()
        } catch (err) {
            console.error('Zone change error:', err)
        } finally {
            setActing(false)
            setConfirm(null)
        }
    }

    const handleUnassignCamera = async (cameraId) => {
        const camera = cameras.find(c => c.id === cameraId)
        if (!camera) return

        if (!window.confirm(`Remove "${camera.name}" from this project?`)) return

        // Optimistic update
        setCameras(prev => prev.filter(c => c.id !== cameraId))

        try {
            await apiDelete(`/projects/${projectId}/cameras/${cameraId}`)
            topTostError(`"${camera.name}" removed from project`, 'success')
            broadcastRefresh('cs:project-cameras-refresh')
        } catch (err) {
            silentLoad()
            topTostError(err.response?.data?.detail || 'Failed to unassign camera')
        }
    }

    const handleAssignCamera = (cameraId) => {
        const camera = availableCameras.find(c => c.id === cameraId)
        if (!camera) return

        setConfirm({
            variant: 'primary',
            title: 'Assign Camera',
            message: `Assign "${camera.name}" to this project? This will start monitoring for this camera on your site.`,
            onConfirm: async () => {
                try {
                    await apiPost(`/projects/${projectId}/cameras/${cameraId}`, {})
                    topTostError(`"${camera.name}" assigned to project`, 'success')
                    silentLoad()
                    broadcastRefresh('cs:project-cameras-refresh')
                } catch (err) {
                    topTostError(err.response?.data?.detail || 'Failed to assign camera')
                }
            },
        })
    }

    const columns = [
        {
            accessorKey: 'name',
            header: () => 'Camera',
            cell: (info) => {
                const cam = info.row.original
                const logoSrc = cam.logo_url || DEFAULT_CAMERA_LOGO
                return (
                    <Link to={`/projects/${projectId}/cameras/${cam.id}`} className="hstack gap-3 text-decoration-none">
                        <div className="flex-shrink-0 cam-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img
                                src={logoSrc}
                                alt={cam.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }}
                                onError={(e) => { e.currentTarget.src = DEFAULT_CAMERA_LOGO }}
                            />
                        </div>
                        <div>
                            <span className="fw-semibold d-block text-truncate-1-line">{cam.name || 'Not set'}</span>
                            {cam.serial_number && <small className="fs-12 fw-normal text-muted">S/N: {cam.serial_number}</small>}
                        </div>
                    </Link>
                )
            },
            meta: { headerClassName: 'text-start' },
        },
        {
            accessorKey: 'vendor',
            header: () => 'Vendor / Model',
            cell: (info) => {
                const cam = info.row.original
                return (
                    <div>
                        <span className="fw-semibold d-block text-truncate-1-line">{cam.vendor || 'Not set'}</span>
                        {cam.model && (
                            <small className="fs-12 fw-normal text-muted d-flex align-items-center gap-1 text-truncate-1-line">
                                {cam.model}
                                {cam.onvif_supported && (
                                    <span className="badge bg-soft-danger text-danger fs-10 ms-1 d-inline-flex align-items-center gap-1 cam-onvif-badge" style={{ padding: '1px 5px' }}>
                                        <FiWifi size={9} />ONVIF
                                    </span>
                                )}
                            </small>
                        )}
                        {!cam.model && cam.onvif_supported && (
                            <span className="badge bg-soft-danger text-danger fs-10 mt-1 d-inline-flex align-items-center gap-1 cam-onvif-badge" style={{ padding: '1px 5px' }}>
                                <FiWifi size={9} />ONVIF
                            </span>
                        )}
                    </div>
                )
            },
        },
        {
            accessorKey: 'registry_status_key',
            header: () => 'Verification Status',
            cell: (info) => {
                const cfg = registryStatusCfg(info.getValue())
                if (!cfg) return <span className="text-muted">Not set</span>
                return <span className={`badge ${cfg.color} fs-11 fw-bold text-uppercase`}>{cfg.content}</span>
            },
        },
        {
            accessorKey: 'health_status_key',
            header: () => 'Health Status',
            cell: (info) => {
                const cfg = healthStatusCfg(info.getValue())
                return <span className={`badge ${cfg.color} fs-11 fw-bold text-uppercase`}>{cfg.content}</span>
            },
        },
        {
            accessorKey: 'zone_id',
            header: () => 'Zone',
            meta: { className: 'cam-col-zone', headerClassName: 'cam-col-zone' },
            cell: (info) => {
                const cam = info.row.original
                const zoneId = info.getValue()
                if (canWrite) {
                    const unassigned = !zoneId
                    if (zones.length === 0) {
                        return (
                            <SelectDropdown
                                value=""
                                placeholder="No zones yet"
                                disabled={true}
                                options={[]}
                                fullWidth={false}
                                menuMatchTriggerWidth={false}
                                buttonClassName="form-select-sm"
                                buttonStyle={{
                                    width: 160,
                                    maxWidth: '100%',
                                    minHeight: 34,
                                    borderRadius: '0.375rem',
                                    border: '1.5px solid var(--bs-danger)',
                                    opacity: 0.7,
                                }}
                                menuStyle={{ minWidth: 160, maxWidth: 160 }}
                            />
                        )
                    }
                    return (
                        <SelectDropdown
                            value={zoneId ? String(zoneId) : ''}
                            placeholder="Select zone"
                            options={zones.map(z => ({ value: String(z.id), label: z.name }))}
                            onChange={(v) => handleChangeZone(cam.id, v)}
                            fullWidth={false}
                            menuMatchTriggerWidth={false}
                            dropdownDisplay="static"
                            menuStyle={{ zIndex: 5000, minWidth: 160, maxWidth: 160 }}
                            buttonClassName="form-select-sm"
                            buttonStyle={{
                                width: 160,
                                maxWidth: '100%',
                                minHeight: 34,
                                borderRadius: '0.375rem',
                                ...(unassigned ? { border: '1.5px solid var(--bs-danger)' } : {}),
                            }}
                        />
                    )
                }
                // Read-only view for non-PM or archived
                const zoneName = zoneId ? zoneMap[zoneId] : null
                return zoneName
                    ? <span className="pm-pill pm-pill-warning">{zoneName}</span>
                    : <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">Unassigned</span>
            },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            cell: (info) => {
                const camera = info.row.original
                // Only PM can unassign, and only during SETUP_IN_PROGRESS
                const canUnassign = isPM && isSetup

                return (
                    <div className="hstack gap-2 justify-content-end">
                        <Link to={`/projects/${projectId}/cameras/${camera.id}`} className="avatar-text avatar-md" title="View details">
                            <FiEye />
                        </Link>
                        {canUnassign && (
                            <button
                                type="button"
                                className="btn btn-icon btn-sm btn-light-danger"
                                onClick={() => handleUnassignCamera(camera.id)}
                                title="Remove camera from project"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                )
            },
            enableSorting: false,
            meta: { headerClassName: 'text-end', headerAlign: 'end' },
        },
    ]

    if (loading) return <PageLoader />

    return (
        <>
            <style>{`
                html.app-skin-dark .cam-onvif-badge svg { color: var(--bs-danger) !important; }
                .cam-logo-circle { background: var(--bs-secondary-bg); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }
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
                .pm-cam-logo {
                    width: 40px; height: 40px; border-radius: 999px;
                    display: inline-flex; align-items: center; justify-content: center;
                    background: var(--bs-secondary-bg); border: 1px solid var(--bs-border-color);
                    overflow: hidden; flex: 0 0 auto;
                }
                html.app-skin-dark .pm-cam-logo { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
                .pm-cam-logo img { width: 24px; height: 24px; object-fit: contain; display: block; }
                .pm-table-wrap { border-radius: 0.5rem; overflow: hidden; }
                .pm-table-wrap .table > :not(caption) > * > * { padding: 0.95rem 0.85rem; }
                .pm-table-wrap .table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
                .pm-table-wrap .table td { vertical-align: middle; }
                .pm-actions-end { padding-right: 30px; }
                .pm-actions-end-btn { padding-right: 10px; }
                .cam-col-zone { width: 180px; min-width: 160px; max-width: 180px; }
            `}</style>
            <Table
                tableId={`projectCameras-${projectId}`}
                data={filteredCameras}
                columns={columns}
                searchKeys={[
                    'name',
                    'serial_number',
                    'vendor',
                    'model',
                    'registry_status_label',
                    'health_status_label',
                    'health_status_label_short',
                    'zone_name',
                    'onvif_label',
                ]}
            />

            {/* ── Available Cameras Section for PM ── */}
            {isPM && (
                <div className="col-lg-12">
                    <div className="card stretch stretch-full function-table mt-3">
                        <div className="card-header d-flex align-items-center justify-content-between">
                            <div>
                                <h5 className="mb-0">Available Cameras</h5>
                                <span className="fs-12 text-muted">Cameras on this site available for assignment</span>
                            </div>
                            <span className="badge bg-soft-warning text-warning">{availableCameras.length}</span>
                        </div>
                        {availableCameras.length === 0 ? (
                            <div className="card-body d-flex align-items-center justify-content-center text-center text-muted" style={{ minHeight: 80 }}>
                                No cameras available for assignment on this site.
                            </div>
                        ) : (
                            <div className="card-body custom-card-action p-0">
                                <div className="table-responsive pm-table-wrap">
                                    <table className="table table-hover mb-0 align-middle">
                                        <colgroup>
                                            <col style={{ width: '44%' }} />
                                            <col style={{ width: '41%' }} />
                                            <col style={{ width: '15%' }} />
                                        </colgroup>
                                        <thead>
                                            <tr className="border-b">
                                                <th>Camera</th>
                                                <th>Verification Status</th>
                                                <th className="text-end">
                                                    <div className="d-flex justify-content-end pm-actions-end">Actions</div>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {availableCameras.map(cam => {
                                                const isVerified = cam.registry_status === 'verified'
                                                const statusCfg = registryStatusCfg(cam.registry_status)
                                                return (
                                                    <tr key={cam.id}>
                                                        <td>
                                                            <div className="d-flex align-items-center gap-3">
                                                                <div className="pm-cam-logo">
                                                                    <img
                                                                        src={cam.logo_url || DEFAULT_CAMERA_LOGO}
                                                                        alt=""
                                                                        onError={(e) => { e.currentTarget.src = DEFAULT_CAMERA_LOGO }}
                                                                    />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <span className="d-block fw-semibold">{cam.name || 'Not set'}</span>
                                                                    <span className="fs-12 d-block fw-normal text-muted text-truncate-1-line">
                                                                        {(cam.vendor || '').trim()} {(cam.model || '').trim()}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td>
                                                            {statusCfg && (
                                                                <span className={`badge ${statusCfg.color} text-uppercase`}>{statusCfg.content}</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            {!isArchived && (
                                                                <div className="d-flex justify-content-end pm-actions-end-btn">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-sm btn-primary"
                                                                        onClick={() => isVerified && handleAssignCamera(cam.id)}
                                                                        disabled={!isVerified}
                                                                        title={isVerified ? 'Assign to project' : `Camera must be verified before assignment (current: ${cam.registry_status})`}
                                                                    >
                                                                        Assign
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Zone Change Confirmation Dialog ── */}
            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant || 'warning'}
                title={confirm?.title || ''}
                message={confirm?.message || ''}
                onConfirm={runConfirm}
                onClose={closeConfirm}
                loading={acting}
            />
        </>
    )
}

export default ProjectCamerasTable
