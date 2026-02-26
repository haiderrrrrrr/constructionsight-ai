import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Link, useLocation, useNavigate } from 'react-router-dom';
import PageLoader from '@/components/shared/PageLoader'
import { FiArchive, FiEdit3, FiEye, FiMapPin, FiMoreHorizontal, FiRefreshCw, FiShield, FiTrash2, FiWifi } from 'react-icons/fi'
import Table from '@/components/shared/table/Table';
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { apiGet, apiPost, apiDelete, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { openCameraStream } from '@/utils/cameraSSE'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'

const DEFAULT_CAMERA_LOGO = '/images/logo/security-camera-logo.png'

const registryStatus = (raw) => {
    const key = (raw?.content || raw || '').toLowerCase()
    const map = {
        draft:         { color: 'bg-soft-danger text-danger',     content: 'Draft' },
        verifying:     { color: 'bg-soft-teal text-teal',         content: 'Verifying' },
        verified:      { color: 'bg-soft-warning text-warning',   content: 'Verified' },
        verify_failed: { color: 'bg-soft-danger text-danger',     content: 'Failed' },
        archived:      { color: 'bg-soft-info text-info',         content: 'Archived' },
    }
    return map[key] || null
}

const healthStatus = (raw) => {
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

// ── Custom action dropdown (avoids Dropdown component's target=_blank) ────────
const ActionsMenu = ({ items }) => (
    <div className="dropdown cam-actions-menu">
        <button
            className="avatar-text avatar-md border-0 bg-transparent"
            data-bs-toggle="dropdown"
            data-bs-offset="0,4"
            data-bs-auto-close="outside"
            aria-expanded="false"
        >
            <FiMoreHorizontal size={16} />
        </button>
        <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ minWidth: 160, zIndex: 1050 }}>
            {items.map((item, i) => {
                if (item.type === 'divider') return <li key={i}><hr className="dropdown-divider" /></li>
                return (
                    <li key={i} title={item.title}>
                        <button
                            className={`dropdown-item d-flex align-items-center gap-2 ${item.danger ? 'text-danger' : ''} ${item.disabled ? 'opacity-50 pe-none' : ''}`}
                            onClick={item.onClick}
                            disabled={item.disabled}
                            style={item.disabled ? { pointerEvents: 'none', cursor: 'not-allowed' } : {}}
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

// ── Main component ─────────────────────────────────────────────────────────────
const CameraTable = ({ refresh }) => {
    const navigate = useNavigate()
    const location = useLocation()
    const [cameras, setCameras] = useState([])
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)   // { variant, title, message, onConfirm }
    const [acting, setActing] = useState(false)
    const [projectsModal, setProjectsModal] = useState(null)  // { camera, projects }
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const load = () => {
        setLoading(true)
        apiGet('/admin/cameras')
            .then(data => setCameras(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load cameras.'))
            .finally(() => {
                setLoading(false)
            })
    }

    useEffect(() => { load() }, [refresh])

    // Poll every 3s while any camera is in 'verifying' state
    useEffect(() => {
        const hasVerifying = cameras.some(c => (c.registry_status || '').toLowerCase() === 'verifying')
        if (!hasVerifying) return
        const timer = setInterval(() => {
            apiGet('/admin/cameras')
                .then(data => {
                    if (Array.isArray(data)) setCameras(data)
                })
                .catch(() => {})
        }, 3000)
        return () => clearInterval(timer)
    }, [cameras])

    const closeConfirm = () => { if (!acting) setConfirm(null) }

    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try {
            await confirm.onConfirm()
            setConfirm(null)
        } finally {
            setActing(false)
        }
    }

    const handleVerify = (camera) => {
        apiPost(`/admin/cameras/${camera.id}/verify`, {})
            .then(() => {
                setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, registry_status: 'verifying' } : c))
                topTost(`Verification started for "${camera.name}".`)
                broadcastRefresh('cs:cameras-stats-refresh')
            })
            .catch(err => topTostError(parseApiError(err)))
    }

    const askArchive = (camera) => setConfirm({
        variant: 'archive',
        title: 'Archive Camera',
        message: `"${camera.name}" will be archived and hidden from active use. You can restore it later`,
        onConfirm: async () => {
            await apiPost(`/admin/cameras/${camera.id}/archive`, {})
            setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, archived_at: new Date().toISOString() } : c))
            topTost(`"${camera.name}" archived.`)
            broadcastRefresh('cs:cameras-stats-refresh')
            broadcastRefresh('cs:project-cameras-refresh')
            broadcastRefresh('cs:project-zones-refresh')
        },
    })

    const askUnarchive = (camera) => setConfirm({
        variant: 'unarchive',
        title: 'Restore Camera',
        message: `Restore "${camera.name}" from archive? It will return to Draft status`,
        onConfirm: async () => {
            await apiPost(`/admin/cameras/${camera.id}/unarchive`, {})
            setCameras(prev => prev.map(c => c.id === camera.id ? { ...c, archived_at: null, registry_status: 'draft' } : c))
            topTost(`"${camera.name}" restored.`)
            broadcastRefresh('cs:cameras-stats-refresh')
            broadcastRefresh('cs:project-cameras-refresh')
            broadcastRefresh('cs:project-zones-refresh')
        },
    })

    const askDelete = (camera) => setConfirm({
        variant: 'delete',
        title: 'Delete Camera',
        message: `Permanently delete "${camera.name}"? This will unassign it from all projects and remove verification records, health logs, and zone polygons. This action cannot be undone`,
        onConfirm: async () => {
            try {
                await apiDelete(`/admin/cameras/${camera.id}`)
                setCameras(prev => prev.filter(c => c.id !== camera.id))
                topTost(`"${camera.name}" deleted successfully.`)
                broadcastRefresh('cs:cameras-stats-refresh')
                broadcastRefresh('cs:project-cameras-refresh')
                broadcastRefresh('cs:project-zones-refresh')
                setConfirm(null)  // ← Close dialog after success
            } catch (err) {
                topTostError(parseApiError(err, `Failed to delete "${camera.name}"`))
            }
        },
    })

    const getActions = (camera) => {
        const isArchived = !!camera.archived_at
        return [
            isArchived
                ? { label: 'Edit',   icon: <FiEdit3 />,   disabled: true, title: 'Cannot edit archived cameras' }
                : { label: 'Edit',   icon: <FiEdit3 />,   onClick: () => navigate(`/admin/cameras/${camera.id}/edit`) },
            isArchived
                ? { label: 'Verify', icon: <FiShield />,   disabled: true, title: 'Cannot verify archived cameras' }
                : { label: 'Verify', icon: <FiShield />,   onClick: () => handleVerify(camera) },
            { type: 'divider' },
            isArchived
                ? { label: 'Restore',  icon: <FiRefreshCw />, onClick: () => askUnarchive(camera) }
                : { label: 'Archive',  icon: <FiArchive />,   onClick: () => askArchive(camera) },
            isArchived
                ? { label: 'Delete', icon: <FiTrash2 />, disabled: true, title: 'Cannot delete archived cameras' }
                : { label: 'Delete', icon: <FiTrash2 />, danger: true, onClick: () => askDelete(camera) },
        ]
    }

    const camerasWithDerived = useMemo(() => {
        const norm = (s) => String(s?.content || s || '').toLowerCase()
        return (cameras || []).map(c => {
            const registryKey = c.archived_at ? 'archived' : norm(c.registry_status)
            const regCfg = registryStatus(registryKey) || registryStatus(c.registry_status)
            const healthCfg = healthStatus(c.latest_health_status)
            const assignment_label = c.project_id ? 'Assigned' : 'Unassigned'
            return {
                ...c,
                registry_status_key: registryKey,
                registry_status_label: regCfg?.content || String(registryKey || '').replace(/_/g, ' ').trim(),
                latest_health_status_label: healthCfg?.content || '',
                assignment_label,
            }
        })
    }, [cameras])

    useEffect(() => {
        const list = camerasWithDerived
        const total = list.length
        const archived = list.filter(c => c.archived_at || c.registry_status_key === 'archived').length
        const verified = list.filter(c => c.registry_status_key === 'verified').length
        const draft = list.filter(c => c.registry_status_key === 'draft').length
        broadcastRefresh('cs:cameras-stats', { total, verified, draft, archived })
    }, [camerasWithDerived])

    const columns = [
        {
            accessorKey: 'name',
            header: () => 'Camera',
            cell: (info) => {
                const cam = info.row.original
                const logoSrc = cam.logo_url || DEFAULT_CAMERA_LOGO
                return (
                    <Link to={`/admin/cameras/${cam.id}/verify`} className="hstack gap-3 text-decoration-none">
                        <div className="flex-shrink-0 cam-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={logoSrc} alt={cam.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
                        </div>
                        <div>
                            <span className="fw-semibold d-block text-truncate-1-line">{cam.name || 'Not set'}</span>
                            {cam.serial_number && <small className="fs-12 fw-normal text-muted">S/N: {cam.serial_number}</small>}
                        </div>
                    </Link>
                )
            },
        },
        {
            accessorKey: 'site_name',
            header: () => 'Site Location',
            cell: (info) => {
                const name = info.getValue()
                return name
                    ? (
                        <span className="cam-meta">
                            <FiMapPin size={12} className="opacity-75" />
                            <span className="cam-meta-text text-truncate-1-line" style={{ maxWidth: 220 }}>{name}</span>
                        </span>
                    )
                    : <span className="text-muted">Not set</span>
            },
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
            accessorKey: 'registry_status',
            header: () => 'Verification Status',
            cell: (info) => {
                const cfg = registryStatus(info.getValue())
                if (!cfg) return <span className="text-muted">Not set</span>
                return <span className={`badge ${cfg.color} fs-11 fw-bold text-uppercase`}>{cfg.content}</span>
            },
        },
        {
            accessorKey: 'latest_health_status',
            header: () => 'Health Status',
            cell: (info) => {
                const cfg = healthStatus(info.getValue())
                return <span className={`badge ${cfg.color} fs-11 fw-bold text-uppercase`}>{cfg.content}</span>
            },
        },
        {
            accessorKey: 'project_id',
            header: () => 'Project Assignment Status',
            cell: (info) => {
                const projectId = info.getValue()
                const projectName = info.row.original.project_name
                return projectId
                    ? <span className="badge bg-soft-primary text-primary fs-11 fw-bold text-uppercase" title={projectName || ''}>Assigned</span>
                    : <span className="badge bg-soft-danger text-danger fs-11 fw-bold text-uppercase">Unassigned</span>
            },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            cell: info => (
                <div className="hstack gap-2 justify-content-end">
                    <Link to={`/admin/cameras/${info.row.original.id}/verify`} className="avatar-text avatar-md">
                        <FiEye />
                    </Link>
                    <ActionsMenu items={getActions(info.row.original)} />
                </div>
            ),
            enableSorting: false,
            meta: { headerClassName: 'text-end cam-col-actions', className: 'text-end cam-col-actions', headerAlign: 'end' }
        },
    ]

    const filteredCameras = useMemo(() => {
        const norm = (s) => String(s?.content || s || '').toLowerCase()

        switch (activeFilter) {
            case 'verified':
                return camerasWithDerived.filter(c => c.registry_status_key === 'verified')
            case 'draft':
                return camerasWithDerived.filter(c => c.registry_status_key === 'draft')
            case 'archived':
                return camerasWithDerived.filter(c => c.archived_at || c.registry_status_key === 'archived')
            case 'assigned':
                return camerasWithDerived.filter(c => c.project_id != null)
            case 'unassigned':
                return camerasWithDerived.filter(c => c.project_id == null)
            default:
                return camerasWithDerived
        }
    }, [camerasWithDerived, activeFilter])

    const filteredCamerasRef = useRef([])
    const activeFilterLabelRef = useRef('all')
    filteredCamerasRef.current = filteredCameras
    activeFilterLabelRef.current = activeFilter

    const exportFile = (rows, activeFilterRef, format) => {
        const fmtDate = (v) => {
            if (!v) return ''
            try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
            catch { return String(v) }
        }

        const filterLabel = (() => {
            const map = {
                all: 'All Cameras',
                verified: 'Verified',
                draft: 'Draft',
                archived: 'Archived',
                assigned: 'Assigned',
                unassigned: 'Unassigned',
            }
            return map[String(activeFilterRef || 'all')] || 'All Cameras'
        })()

        const headers = ['Camera Name', 'Site', 'Vendor', 'Model', 'Serial', 'Verification Status', 'Health Status', 'Assignment', 'Created At']
        const toRow = (c) => [
            c.name || '',
            c.site_name || '',
            c.vendor || '',
            c.model || '',
            c.serial_number || '',
            (registryStatus(c.registry_status)?.content || (c.registry_status?.content || c.registry_status || '')).toString().replace(/_/g, ' ').trim() || '',
            (healthStatus(c.latest_health_status)?.content || (c.latest_health_status?.value || c.latest_health_status || '')).toString().replace(/_/g, ' ').trim() || '',
            c.project_id ? 'Assigned' : 'Unassigned',
            fmtDate(c.created_at),
        ]

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

        const today = pkDateStamp()
        const kind = String(format || 'csv').toLowerCase()

        if (kind === 'pdf') {
            const token = window.sessionStorage.getItem('access_token')
            fetch(`${API_BASE}/admin/cameras/export/pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
            })
                .then(res => {
                    if (!res.ok) throw new Error('PDF generation failed')
                    return res.blob()
                })
                .then(blob => triggerDownload(blob, `Cameras_Export_${today}.pdf`))
                .catch(() => topTostError('Failed to generate PDF export.'))
            return
        }

        if (kind === 'print') {
            const token = window.sessionStorage.getItem('access_token')
            fetch(`${API_BASE}/admin/cameras/export/pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
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
                ['ConstructionSight AI — Cameras Directory Report'],
                [`Filter:,${filterLabel}`],
                [`Generated:,${genTs}`],
                [`Total Records:,${rows.length}`],
                [],
                headers.map(esc).join(','),
                ...rows.map(c => toRow(c).map(esc).join(',')),
            ]
            triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Cameras_Export_${today}.csv`)
            return
        }

        if (kind === 'xml') {
            const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            const genTs = pkDateTimeLabel()
            const camNodes = rows.map(c => {
                const r = toRow(c)
                return [
                    `  <camera>`,
                    `    <name>${esc(r[0])}</name>`,
                    `    <site>${esc(r[1])}</site>`,
                    `    <vendor>${esc(r[2])}</vendor>`,
                    `    <model>${esc(r[3])}</model>`,
                    `    <serial>${esc(r[4])}</serial>`,
                    `    <verification_status>${esc(r[5])}</verification_status>`,
                    `    <health_status>${esc(r[6])}</health_status>`,
                    `    <assignment>${esc(r[7])}</assignment>`,
                    `    <created_at>${esc(r[8])}</created_at>`,
                    `  </camera>`,
                ].join('\n')
            }).join('\n')
            const xml = [
                `<?xml version="1.0" encoding="UTF-8"?>`,
                `<report>`,
                `  <metadata>`,
                `    <title>ConstructionSight AI — Cameras Directory Report</title>`,
                `    <filter>${esc(filterLabel)}</filter>`,
                `    <generated_at>${genTs}</generated_at>`,
                `    <total_records>${rows.length}</total_records>`,
                `    <exported_by>Administrator</exported_by>`,
                `  </metadata>`,
                `  <cameras>`,
                camNodes,
                `  </cameras>`,
                `</report>`,
            ].join('\n')
            triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Cameras_Export_${today}.xml`)
            return
        }

        if (kind === 'text') {
            const genTs = pkDateTimeLabel()
            const allRows = rows.map(c => toRow(c))
            const colWidths = headers.map((h, i) =>
                Math.min(40, Math.max(h.length, ...allRows.map(r => String(r[i] ?? '').length)))
            )
            const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
            const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
            const rowLine = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
            const reportWidth = sep.length
            const center = (s) => { const p = Math.max(0, Math.floor((reportWidth - s.length) / 2)); return ' '.repeat(p) + s }
            const lines = [
                '='.repeat(reportWidth),
                center('CONSTRUCTIONSIGHT AI'),
                center('Cameras Directory Report'),
                center(`Filter: ${filterLabel}`),
                center(`Generated: ${genTs}`),
                center(`Total Records: ${rows.length}`),
                '='.repeat(reportWidth),
                '',
                sep,
                rowLine(headers),
                sep,
                ...allRows.map(r => rowLine(r)),
                sep,
                '',
                `Report generated by ConstructionSight AI. CONFIDENTIAL — authorised personnel only.`,
            ]
            triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `Cameras_Export_${today}.txt`)
            return
        }

        if (kind === 'excel') {
            const genTs = pkDateTimeLabel()
            const wb = XLSX.utils.book_new()
            const sheetData = [
                ['ConstructionSight AI — Cameras Directory Report'],
                [`Filter: ${filterLabel}`],
                [`Generated: ${genTs}`],
                [`Total Records: ${rows.length}`],
                [],
                headers,
                ...rows.map(c => toRow(c)),
            ]
            const ws = XLSX.utils.aoa_to_sheet(sheetData)
            ws['!cols'] = [
                { wch: 26 },
                { wch: 20 },
                { wch: 16 },
                { wch: 16 },
                { wch: 16 },
                { wch: 18 },
                { wch: 14 },
                { wch: 12 },
                { wch: 14 },
            ]
            ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }]

            const NAVY = '1e3a5f'
            const BLUE = '3b5bdb'
            const WHITE = 'ffffff'
            const LIGHT = 'f1f5f9'
            const ALT = 'f8fafc'

            const titleCell = ws['A1']
            if (titleCell) {
                titleCell.s = {
                    font: { bold: true, sz: 14, color: { rgb: WHITE } },
                    fill: { fgColor: { rgb: NAVY } },
                    alignment: { horizontal: 'center', vertical: 'center' },
                }
            }

            ;['A2', 'A3', 'A4'].forEach(addr => {
                const cell = ws[addr]
                if (cell) cell.s = {
                    font: { italic: true, sz: 10, color: { rgb: '374151' } },
                    fill: { fgColor: { rgb: LIGHT } },
                }
            })

            headers.forEach((_, ci) => {
                const addr = XLSX.utils.encode_cell({ r: 5, c: ci })
                const cell = ws[addr]
                if (cell) cell.s = {
                    font: { bold: true, sz: 10, color: { rgb: WHITE } },
                    fill: { fgColor: { rgb: NAVY } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                    border: {
                        bottom: { style: 'thin', color: { rgb: BLUE } },
                        right: { style: 'thin', color: { rgb: BLUE } },
                    },
                }
            })

            const STATUS_COLORS = {
                verified: { bg: 'dcfce7', fg: '15803d' },
                draft: { bg: 'fef3c7', fg: 'b45309' },
                verifying: { bg: 'ccfbf1', fg: '0f766e' },
                failed: { bg: 'fee2e2', fg: 'b91c1c' },
                archived: { bg: 'f1f5f9', fg: '6b7280' },
            }

            const HEALTH_COLORS = {
                healthy: { bg: 'dcfce7', fg: '15803d' },
                degraded: { bg: 'fef3c7', fg: 'b45309' },
                offline: { bg: 'fee2e2', fg: 'b91c1c' },
                maintenance: { bg: 'e0f2fe', fg: '0369a1' },
            }

            rows.forEach((c, ri) => {
                const rowBg = ri % 2 === 0 ? WHITE : ALT
                headers.forEach((_, ci) => {
                    const addr = XLSX.utils.encode_cell({ r: ri + 6, c: ci })
                    const cell = ws[addr]
                    if (!cell) return

                    const isVerifyCol = ci === 5
                    const isHealthCol = ci === 6
                    let sc = null
                    if (isVerifyCol) {
                        const key = String(c.registry_status?.content || c.registry_status || '').toLowerCase()
                        sc = STATUS_COLORS[key === 'verify_failed' ? 'failed' : key]
                    } else if (isHealthCol) {
                        const key = String(c.latest_health_status?.value || c.latest_health_status || '').toLowerCase()
                        sc = HEALTH_COLORS[key]
                    }

                    cell.s = {
                        font: { sz: 9, bold: (isVerifyCol || isHealthCol), color: { rgb: sc ? sc.fg : '111827' } },
                        fill: { fgColor: { rgb: sc ? sc.bg : rowBg } },
                        alignment: { vertical: 'center', wrapText: false },
                        border: {
                            bottom: { style: 'hair', color: { rgb: 'd1d5db' } },
                            right: { style: 'hair', color: { rgb: 'd1d5db' } },
                        },
                    }
                })
            })

            ws['!rows'] = [
                { hpt: 28 },
                { hpt: 16 },
                { hpt: 16 },
                { hpt: 16 },
                { hpt: 6 },
                { hpt: 20 },
                ...rows.map(() => ({ hpt: 16 })),
            ]

            XLSX.utils.book_append_sheet(wb, ws, 'Cameras')

            const summaryRows = [
                ['ConstructionSight AI — Cameras Summary'],
                [],
                ['Metric', 'Count'],
                ['Total Cameras', rows.length],
                ['Assigned', rows.filter(c => c.project_id).length],
                ['Unassigned', rows.filter(c => !c.project_id).length],
            ]
            const ws2 = XLSX.utils.aoa_to_sheet(summaryRows)
            ws2['!cols'] = [{ wch: 24 }, { wch: 12 }]
            const s2title = ws2['A1']
            if (s2title) s2title.s = { font: { bold: true, sz: 12, color: { rgb: WHITE } }, fill: { fgColor: { rgb: NAVY } } }
            const s2h1 = ws2['A3'], s2h2 = ws2['B3']
            if (s2h1) s2h1.s = { font: { bold: true, color: { rgb: WHITE } }, fill: { fgColor: { rgb: NAVY } } }
            if (s2h2) s2h2.s = { font: { bold: true, color: { rgb: WHITE } }, fill: { fgColor: { rgb: NAVY } } }
            XLSX.utils.book_append_sheet(wb, ws2, 'Summary')

            const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
            triggerDownload(
                new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                `Cameras_Export_${today}.xlsx`
            )
        }
    }

    useEffect(() => {
        const refreshHandler = () => load()
        window.addEventListener('cs:cameras-stats-refresh', refreshHandler)
        const unsubBroadcast = onBroadcast('cs:cameras-stats-refresh', () => load())
        return () => {
            window.removeEventListener('cs:cameras-stats-refresh', refreshHandler)
            unsubBroadcast()
        }
    }, [])

    // SSE: update individual camera rows in-place without reloading the full list
    useEffect(() => {
        return openCameraStream('/admin/cameras/stream', {
            camera_health_update: (d) => {
                setCameras(prev => prev.map(c =>
                    c.id === d.camera_id
                        ? { ...c, latest_health_status: { value: d.health_status }, last_health_check_at: d.checked_at }
                        : c
                ))
            },
            camera_verification_update: (d) => {
                setCameras(prev => prev.map(c =>
                    c.id === d.camera_id ? { ...c, registry_status: d.registry_status } : c
                ))
            },
        })
    }, [])

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail?.page && e.detail.page !== 'list') return
            exportFile(filteredCamerasRef.current, activeFilterLabelRef.current, e?.detail?.format)
        }
        window.addEventListener('cs:cameras-export', handler)
        return () => window.removeEventListener('cs:cameras-export', handler)
    }, [])

    if (loading) return <PageLoader />

    return (
        <>
            <style>{`
                html.app-skin-dark .cam-onvif-badge svg { color: var(--bs-danger) !important; }
                .cam-actions-menu { position: relative; }
                .cam-actions-menu .dropdown-item { color: inherit; transition: background-color 0.2s; }
                .cam-actions-menu .dropdown-item.text-danger { color: #ef4444 !important; }
                .cam-actions-menu .dropdown-item.text-danger:hover,
                .cam-actions-menu .dropdown-item.text-danger:focus,
                .cam-actions-menu .dropdown-item.text-danger:active {
                    color: #ef4444 !important;
                    background-color: rgba(239, 68, 68, 0.1);
                }
                .cam-actions-menu .dropdown-item:hover,
                .cam-actions-menu .dropdown-item:focus { color: inherit; background-color: rgba(var(--bs-primary-rgb), 0.08); }
                .cam-actions-menu .dropdown-item svg { color: currentColor; stroke-width: 1.8; }
                html.app-skin-dark .cam-actions-menu .dropdown-item svg { color: currentColor !important; }
                .cam-actions-menu .dropdown-item.text-danger svg,
                .cam-actions-menu .dropdown-item.text-danger svg * {
                    color: #ef4444 !important;
                    stroke: #ef4444 !important;
                }
                .cam-logo-circle { background: var(--bs-secondary-bg); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }
                html.app-skin-dark .cam-actions-menu .dropdown-item:hover { background-color: rgba(255,255,255,0.08); }
                .cam-meta { display: inline-flex; align-items: center; gap: 4px; }
                .cam-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                html.app-skin-dark .cam-meta svg { color: inherit !important; }
                .cam-meta-text { min-width: 0; }
                #camerasList { table-layout: auto; min-width: 100%; }
                #camerasList .cam-col-actions { min-width: 100px; }

                /* Keep simple like projects table - Bootstrap handles positioning */
            `}</style>
            <Table
                data={filteredCameras}
                columns={columns}
                searchKeys={['name', 'site_name', 'vendor', 'model', 'serial_number', 'registry_status_key', 'registry_status_label', 'latest_health_status_label', 'assignment_label', 'project_name', 'created_at']}
                disableDefaultSorting={true}
                tableId="camerasList"
            />
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

export default CameraTable
