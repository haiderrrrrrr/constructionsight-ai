import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Link, useLocation } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiArchive, FiEdit3, FiEye, FiMoreHorizontal, FiRefreshCw, FiMapPin, FiCalendar, FiTrash2 } from 'react-icons/fi'
import Dropdown from '@/components/shared/Dropdown'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Table from '@/components/shared/table/Table'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiDelete, apiGet, apiPatch, apiPost, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import { getProjectStatusMeta } from '@/utils/projectStatusMeta'
import EditProjectModal from '@/components/projectsView/EditProjectModal'

const ActionsMenu = ({ items }) => (
    <div className="dropdown cam-actions-menu">
        <button className="avatar-text avatar-md border-0 bg-transparent" data-bs-toggle="dropdown" data-bs-offset="0,4" aria-expanded="false">
            <FiMoreHorizontal size={16} />
        </button>
        <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ minWidth: 160 }}>
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

const DEFAULT_PROJECT_LOGO = '/images/icons/project-icon.png'

const ProjectsTable = () => {
    const location = useLocation()

    const [projects, setProjects] = useState([])
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)
    const [editProject, setEditProject] = useState(null)

    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const projectsWithDerived = useMemo(() => (
        (projects || []).map(p => {
            const meta = getProjectStatusMeta(String(p?.status || ''))
            return {
                ...p,
                status_label: meta?.label || String(p?.status || ''),
            }
        })
    ), [projects])

    useEffect(() => {
        const norm = (s) => String(s || '').toLowerCase()
        const rows = projectsWithDerived
        const counts = {
            total: rows.length,
            active: rows.filter(r => norm(r.status) === 'active').length,
            completed: rows.filter(r => norm(r.status) === 'completed').length,
            archived: rows.filter(r => norm(r.status) === 'archived').length,
        }
        broadcastRefresh('cs:projects-stats', counts)
    }, [projectsWithDerived])

    const load = React.useCallback(() => {
        setLoading(true)
        apiGet('/admin/projects')
            .then(data => setProjects(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load projects.'))
            .finally(() => setLoading(false))
    }, [])


    useEffect(() => { load() }, [load])

    // Same-tab event + cross-tab BroadcastChannel
    useEffect(() => {
        const handler = () => load()
        window.addEventListener('cs:projects-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:projects-stats-refresh', () => load())
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', handler)
            unsubBroadcast()
        }
    }, [load])

    // Refresh when page becomes visible again (user returns from other tab/page)
    useEffect(() => {
        const handler = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [load])

    const askArchive = (p) => setConfirm({
        variant: 'archive',
        title: 'Archive Project',
        message: `Archive "${p.name}"? You can restore it later.`,
        onConfirm: async () => {
            try {
                await apiPatch(`/admin/projects/${p.id}/status`, { status: 'archived' })
                setProjects(prev => prev.map(proj => proj.id === p.id ? { ...proj, status: 'archived' } : proj))
                topTost(`"${p.name}" archived successfully.`)
                broadcastRefresh('cs:projects-stats-refresh')
                setConfirm(null)  // ← Close dialog after success
            } catch (err) {
                topTostError(parseApiError(err, `Failed to archive "${p.name}"`))
            }
        },
    })

    const askRestore = (p) => setConfirm({
        variant: 'unarchive',
        title: 'Restore Project',
        message: `Restore "${p.name}" from archive?`,
        onConfirm: async () => {
            try {
                await apiPost(`/admin/projects/${p.id}/unarchive`, {})
                setProjects(prev => prev.map(proj => proj.id === p.id ? { ...proj, status: 'active' } : proj))
                topTost(`"${p.name}" restored successfully.`)
                broadcastRefresh('cs:projects-stats-refresh')
                setConfirm(null)  // ← Close dialog after success
            } catch (err) {
                topTostError(parseApiError(err, `Failed to restore "${p.name}"`))
            }
        },
    })

    const askDelete = (p) => setConfirm({
        variant: 'delete',
        title: 'Delete Project',
        message: `Delete "${p.name}" permanently? This will remove all team members, cameras, zones, invitations, and settings. This action cannot be undone.`,
        onConfirm: async () => {
            try {
                await apiDelete(`/admin/projects/${p.id}`)
                setProjects(prev => prev.filter(proj => proj.id !== p.id))
                topTost(`"${p.name}" deleted successfully.`)
                broadcastRefresh('cs:projects-stats-refresh')
                setConfirm(null)  // ← Close dialog after success
            } catch (err) {
                topTostError(parseApiError(err, `Failed to delete "${p.name}"`))
            }
        },
    })

    const closeConfirm = () => { if (!acting) setConfirm(null) }
    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try {
            await confirm.onConfirm()
            // Note: dialog closing and error handling are now done inside individual onConfirm handlers
        } finally {
            setActing(false)
        }
    }

    const getActions = (p) => {
        const status = String(p.status || '').toLowerCase()
        const isDraft = status === 'draft'
        const isArchived = status === 'archived'
        const isCompleted = status === 'completed'
        const canEdit = !isArchived && !isCompleted

        const actions = canEdit
            ? [
                { label: 'Edit', icon: <FiEdit3 />, onClick: () => setEditProject(p) },
              ]
            : [
                { label: 'Edit', icon: <FiEdit3 />, disabled: true, title: 'Archived or completed projects cannot be edited' },
              ]

        // Archive/Restore based on status
        if (isArchived) {
            actions.push({ label: 'Restore', icon: <FiRefreshCw />, onClick: () => askRestore(p) })
        } else {
            actions.push({ label: 'Archive', icon: <FiArchive />, onClick: () => askArchive(p) })
        }

        // Delete only available for DRAFT projects
        if (isDraft) {
            actions.push({ label: 'Delete', icon: <FiTrash2 />, danger: true, onClick: () => askDelete(p) })
        } else {
            actions.push({ label: 'Delete', icon: <FiTrash2 />, disabled: true, title: 'Only draft projects can be deleted' })
        }

        return actions
    }

    const columns = [
        {
            accessorKey: 'name',
            header: () => (
                <span className="cs-th-leading cs-leading-avatar">
                    <span className="cs-leading-slot cs-leading-slot-avatar" aria-hidden="true" />
                    <span>Project</span>
                </span>
            ),
            cell: (info) => {
                const p = info.row.original
                const logoSrc = p.logo_url || DEFAULT_PROJECT_LOGO
                return (
                    <Link to={`/admin/projects/${p.id}`} className="hstack gap-3 text-decoration-none">
                        <div className="flex-shrink-0 cam-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={logoSrc} alt={p.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <span className="fw-semibold d-block proj-title">{p.name || 'Not set'}</span>
                            {p.client_name && (
                                <small className="fs-12 fw-normal text-muted d-block text-truncate-1-line">
                                    {p.client_name}
                                </small>
                            )}
                        </div>
                    </Link>
                )
            },
            meta: { className: 'proj-col-project', headerClassName: 'proj-col-project' },
        },
        {
            accessorKey: 'location',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Location</span>
                </span>
            ),
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="proj-meta">
                            <FiMapPin size={12} className="opacity-75" />
                            <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 220 }}>{v}</span>
                        </span>
                    )
                    : <span className="text-muted">Not set</span>
            },
            meta: { className: 'proj-col-location', headerClassName: 'proj-col-location' },
        },
        {
            accessorKey: 'status',
            header: () => 'PROJECT STATUS',
            cell: (info) => {
                const raw = String(info.getValue() || '')
                const meta = getProjectStatusMeta(raw)
                return <span className={`${meta.badge} fs-11 fw-bold text-uppercase`}>{meta.label}</span>
            },
            meta: { className: 'proj-col-status', headerClassName: 'proj-col-status' },
        },
        {
            accessorKey: 'start_date',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Start Date</span>
                </span>
            ),
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="proj-meta">
                            <FiCalendar size={12} className="opacity-75" />
                            <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 180 }}>
                                {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </span>
                    )
                    : <span className="text-muted">—</span>
            },
            meta: { className: 'proj-col-start', headerClassName: 'proj-col-start' },
        },
        {
            accessorKey: 'end_date',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>End Date</span>
                </span>
            ),
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="proj-meta">
                            <FiCalendar size={12} className="opacity-75" />
                            <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 180 }}>
                                {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </span>
                    )
                    : <span className="text-muted">—</span>
            },
            meta: { className: 'proj-col-end', headerClassName: 'proj-col-end' },
        },
        {
            accessorKey: 'created_at',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Created At</span>
                </span>
            ),
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="proj-meta">
                            <FiCalendar size={12} className="opacity-75" />
                            <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 180 }}>
                                {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </span>
                    )
                    : <span className="text-muted">—</span>
            },
            meta: { className: 'proj-col-created', headerClassName: 'proj-col-created' },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            cell: info => (
                <div className="hstack gap-2 justify-content-end">
                    <Link to={`/admin/projects/${info.row.original.id}`} className="avatar-text avatar-md">
                        <FiEye />
                    </Link>
                    <ActionsMenu items={getActions(info.row.original)} />
                </div>
            ),
            enableSorting: false,
            meta: { headerClassName: 'text-end proj-col-actions', className: 'text-end proj-col-actions', headerAlign: 'end' }
        },
    ]

    const filteredProjectsRef = useRef([])
    const activeFilterLabelRef = useRef('all')

    const filteredProjects = useMemo(() => {
        const norm = (s) => String(s || '').toLowerCase()
        switch (activeFilter) {
            case 'active': return projectsWithDerived.filter(p => norm(p.status) === 'active')
            case 'draft': return projectsWithDerived.filter(p => norm(p.status) === 'draft')
            case 'setup': return projectsWithDerived.filter(p => norm(p.status).includes('setup'))
            case 'archived': return projectsWithDerived.filter(p => norm(p.status) === 'archived')
            case 'completed': return projectsWithDerived.filter(p => norm(p.status) === 'completed')
            default: return projectsWithDerived
        }
    }, [projectsWithDerived, activeFilter])

    filteredProjectsRef.current = filteredProjects
    activeFilterLabelRef.current = activeFilter

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail?.page && e.detail.page !== 'list') return
            const format = String(e?.detail?.format || '').toLowerCase()
            const rows = filteredProjectsRef.current
            const activeFilterRef = activeFilterLabelRef.current

            const fmtDate = (v) => {
                if (!v) return ''
                try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                catch { return String(v) }
            }

            const headers = ['Project Name', 'Client', 'Location', 'Status', 'Start Date', 'End Date', 'Created At']
            const toRow = (p) => [
                p.name || '',
                p.client_name || '',
                p.location || '',
                p.status_label || '',
                fmtDate(p.start_date),
                fmtDate(p.end_date),
                fmtDate(p.created_at),
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

            if (format === 'pdf') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/admin/projects/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Projects_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }

            if (format === 'csv') {
                const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
                const genTs = pkDateTimeLabel()
                const filterLabel = activeFilterRef === 'all' ? 'All Projects' : activeFilterRef.charAt(0).toUpperCase() + activeFilterRef.slice(1)
                const meta = [
                    ['ConstructionSight AI — Projects Directory Report'],
                    [`Filter:,${filterLabel}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(p => toRow(p).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Projects_Export_${today}.csv`)
                return
            }

            if (format === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const filterLabel = activeFilterRef === 'all' ? 'All Projects' : activeFilterRef.charAt(0).toUpperCase() + activeFilterRef.slice(1)
                const projectNodes = rows.map(p => {
                    const r = toRow(p)
                    return [
                        `  <project>`,
                        `    <name>${esc(r[0])}</name>`,
                        `    <client>${esc(r[1])}</client>`,
                        `    <location>${esc(r[2])}</location>`,
                        `    <status>${esc(r[3])}</status>`,
                        `    <start_date>${esc(r[4])}</start_date>`,
                        `    <end_date>${esc(r[5])}</end_date>`,
                        `    <created_at>${esc(r[6])}</created_at>`,
                        `  </project>`,
                    ].join('\n')
                }).join('\n')
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report>`,
                    `  <metadata>`,
                    `    <title>ConstructionSight AI — Projects Directory Report</title>`,
                    `    <filter>${esc(filterLabel)}</filter>`,
                    `    <generated_at>${genTs}</generated_at>`,
                    `    <total_records>${rows.length}</total_records>`,
                    `    <exported_by>Administrator</exported_by>`,
                    `  </metadata>`,
                    `  <projects>`,
                    projectNodes,
                    `  </projects>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Projects_Export_${today}.xml`)
                return
            }

            if (format === 'text') {
                const genTs = pkDateTimeLabel()
                const filterLabel = activeFilterRef === 'all' ? 'All Projects' : activeFilterRef.charAt(0).toUpperCase() + activeFilterRef.slice(1)
                const allRows = rows.map(p => toRow(p))
                const colWidths = headers.map((h, i) =>
                    Math.min(40, Math.max(h.length, ...allRows.map(r => String(r[i] ?? '').length)))
                )
                const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
                const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
                const row = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
                const reportWidth = sep.length
                const center = (s) => { const p = Math.max(0, Math.floor((reportWidth - s.length) / 2)); return ' '.repeat(p) + s }
                const lines = [
                    '='.repeat(reportWidth),
                    center('CONSTRUCTIONSIGHT AI'),
                    center('Projects Directory Report'),
                    center(`Filter: ${filterLabel}`),
                    center(`Generated: ${genTs}`),
                    center(`Total Records: ${rows.length}`),
                    '='.repeat(reportWidth),
                    '',
                    sep,
                    row(headers),
                    sep,
                    ...allRows.map(r => row(r)),
                    sep,
                    '',
                    `Report generated by ConstructionSight AI. CONFIDENTIAL — authorised personnel only.`,
                ]
                triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `Projects_Export_${today}.txt`)
                return
            }

            if (format === 'excel') {
                const genTs = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
                const filterLabel = activeFilterRef === 'all' ? 'All Projects' : activeFilterRef.charAt(0).toUpperCase() + activeFilterRef.slice(1)

                const wb = XLSX.utils.book_new()

                // ── Main data sheet ──
                const sheetData = [
                    ['ConstructionSight AI — Projects Directory Report'],
                    [`Filter: ${filterLabel}`],
                    [`Generated: ${genTs}`],
                    [`Total Records: ${rows.length}`],
                    [],
                    headers,
                    ...rows.map(p => toRow(p)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(sheetData)

                // Column widths
                ws['!cols'] = [
                    { wch: 32 }, // Project Name
                    { wch: 22 }, // Client
                    { wch: 26 }, // Location
                    { wch: 18 }, // Status
                    { wch: 14 }, // Start Date
                    { wch: 14 }, // End Date
                    { wch: 16 }, // Created At
                ]

                // Merge title cell across all columns
                ws['!merges'] = [
                    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
                ]

                const NAVY   = '1e3a5f'
                const BLUE   = '3b5bdb'
                const WHITE  = 'ffffff'
                const LIGHT  = 'f1f5f9'
                const ALT    = 'f8fafc'

                // Style title row
                const titleCell = ws['A1']
                if (titleCell) {
                    titleCell.s = {
                        font:      { bold: true, sz: 14, color: { rgb: WHITE } },
                        fill:      { fgColor: { rgb: NAVY } },
                        alignment: { horizontal: 'center', vertical: 'center' },
                    }
                }

                // Style meta rows (rows 2-4, index 1-3)
                ;['A2','A3','A4'].forEach(addr => {
                    const cell = ws[addr]
                    if (cell) cell.s = {
                        font: { italic: true, sz: 10, color: { rgb: '374151' } },
                        fill: { fgColor: { rgb: LIGHT } },
                    }
                })

                // Style header row (row 6, index 5)
                headers.forEach((_, ci) => {
                    const addr = XLSX.utils.encode_cell({ r: 5, c: ci })
                    const cell = ws[addr]
                    if (cell) cell.s = {
                        font:      { bold: true, sz: 10, color: { rgb: WHITE } },
                        fill:      { fgColor: { rgb: NAVY } },
                        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                        border: {
                            bottom: { style: 'thin', color: { rgb: BLUE } },
                            right:  { style: 'thin', color: { rgb: BLUE } },
                        },
                    }
                })

                // Style data rows with alternating bg + status colors
                const STATUS_COLORS = {
                    active:            { bg: 'dcfce7', fg: '15803d' },
                    archived:          { bg: 'fee2e2', fg: 'b91c1c' },
                    completed:         { bg: 'f1f5f9', fg: '6b7280' },
                    draft:             { bg: 'e8eef7', fg: '1e3a5f' },
                    setup_in_progress: { bg: 'fef3c7', fg: 'b45309' },
                }
                rows.forEach((p, ri) => {
                    const rowBg = ri % 2 === 0 ? WHITE : ALT
                    headers.forEach((_, ci) => {
                        const addr = XLSX.utils.encode_cell({ r: ri + 6, c: ci })
                        const cell = ws[addr]
                        if (!cell) return
                        const isStatusCol = ci === 3
                        const statusKey = String(p.status || '').toLowerCase()
                        const sc = isStatusCol ? STATUS_COLORS[statusKey] : null
                        cell.s = {
                            font:      { sz: 9, bold: isStatusCol, color: { rgb: sc ? sc.fg : '111827' } },
                            fill:      { fgColor: { rgb: sc ? sc.bg : rowBg } },
                            alignment: { vertical: 'center', wrapText: false },
                            border: {
                                bottom: { style: 'hair', color: { rgb: 'd1d5db' } },
                                right:  { style: 'hair', color: { rgb: 'd1d5db' } },
                            },
                        }
                    })
                })

                // Row heights
                ws['!rows'] = [
                    { hpt: 28 },  // title
                    { hpt: 16 },  // meta
                    { hpt: 16 },
                    { hpt: 16 },
                    { hpt: 6  },  // spacer
                    { hpt: 20 },  // header
                    ...rows.map(() => ({ hpt: 16 })),
                ]

                XLSX.utils.book_append_sheet(wb, ws, 'Projects')

                // ── Summary sheet ──
                const summaryRows = [
                    ['ConstructionSight AI — Projects Summary'],
                    [],
                    ['Metric', 'Count'],
                    ['Total Projects', rows.length],
                    ['Active',    rows.filter(p => String(p.status||'').toLowerCase() === 'active').length],
                    ['Archived',  rows.filter(p => String(p.status||'').toLowerCase() === 'archived').length],
                    ['Completed', rows.filter(p => String(p.status||'').toLowerCase() === 'completed').length],
                    ['Draft',     rows.filter(p => String(p.status||'').toLowerCase() === 'draft').length],
                ]
                const ws2 = XLSX.utils.aoa_to_sheet(summaryRows)
                ws2['!cols'] = [{ wch: 24 }, { wch: 12 }]
                // Style summary header
                const s2title = ws2['A1']
                if (s2title) s2title.s = { font: { bold: true, sz: 12, color: { rgb: WHITE } }, fill: { fgColor: { rgb: NAVY } } }
                const s2h1 = ws2['A3'], s2h2 = ws2['B3']
                if (s2h1) s2h1.s = { font: { bold: true, color: { rgb: WHITE } }, fill: { fgColor: { rgb: NAVY } } }
                if (s2h2) s2h2.s = { font: { bold: true, color: { rgb: WHITE } }, fill: { fgColor: { rgb: NAVY } } }
                XLSX.utils.book_append_sheet(wb, ws2, 'Summary')

                const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
                triggerDownload(
                    new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                    `Projects_Export_${today}.xlsx`
                )
                return
            }

            if (format === 'print') {
                // Open the same styled PDF in a new tab so user prints the full report with cover page
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/admin/projects/export/pdf`, {
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
                        // Revoke after a delay to give the tab time to load
                        setTimeout(() => URL.revokeObjectURL(url), 60000)
                    })
                    .catch(() => topTostError('Failed to generate print PDF.'))
            }
        }
        window.addEventListener('cs:projects-export', handler)
        return () => window.removeEventListener('cs:projects-export', handler)
    }, [])

    if (loading) return <PageLoader />

    return (
        <>
            <style>{`
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
                .cs-th-leading { display: inline-flex; align-items: center; gap: 4px; }
                .cs-th-leading.cs-leading-avatar { gap: 1rem; }
                .cs-leading-slot { display: inline-block; flex: 0 0 auto; }
                .cs-leading-slot-icon { width: 16px; }
                .cs-leading-slot-avatar { width: 46px; }
                .proj-meta { display: inline-flex; align-items: center; gap: 4px; }
                #projectList .cs-leading-slot { display: none; }
                .proj-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                html.app-skin-dark .proj-meta svg { color: inherit !important; }
                html.app-skin-dark .proj-col-actions svg { color: inherit !important; }
                .proj-meta-text { min-width: 0; }
                .proj-title { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25; }
                #projectList { table-layout: auto; min-width: 100%; }
                #projectList .proj-col-project { min-width: 200px; }
                #projectList .proj-col-location { min-width: 150px; }
                #projectList .proj-col-status { min-width: 100px; }
                #projectList .proj-col-start { min-width: 130px; }
                #projectList .proj-col-end { min-width: 130px; }
                #projectList .proj-col-created { min-width: 130px; }
                #projectList .proj-col-actions { min-width: 100px; }
            `}</style>
            <Table
                data={filteredProjects}
                columns={columns}
                searchKeys={['name', 'client_name', 'location', 'status', 'status_label', 'start_date', 'end_date', 'created_at']}
                disableDefaultSorting={true}
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
            <EditProjectModal
                isOpen={!!editProject}
                project={editProject}
                onClose={() => setEditProject(null)}
                onSuccess={() => { broadcastRefresh('cs:projects-stats-refresh') }}
            />
        </>
    )
}

export default ProjectsTable
