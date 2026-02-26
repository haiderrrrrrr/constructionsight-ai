import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiRefreshCw, FiXCircle, FiMoreHorizontal, FiLink, FiEye, FiMail, FiUser, FiCalendar } from 'react-icons/fi'
import Dropdown from '@/components/shared/Dropdown'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Table from '@/components/shared/table/Table'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiDelete, apiGet, apiPatch, apiPost, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'

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

const InvitationsTable = () => {
    const navigate = useNavigate()
    const location = useLocation()

    const [invitations, setInvitations] = useState([])
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)
    const [viewDetailsInv, setViewDetailsInv] = useState(null)
    const [timeNonce, setTimeNonce] = useState(0)

    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const load = React.useCallback(() => {
        setLoading(true)
        apiGet('/admin/invitations')
            .then(data => setInvitations(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load invitations.'))
            .finally(() => setLoading(false))
    }, [])


    useEffect(() => { load() }, [load])

    useEffect(() => {
        const t = setInterval(() => setTimeNonce(v => v + 1), 30000)
        return () => clearInterval(t)
    }, [])

    useEffect(() => {
        const handler = () => load()
        window.addEventListener('cs:invitations-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:invitations-stats-refresh', () => load())
        return () => {
            window.removeEventListener('cs:invitations-stats-refresh', handler)
            unsubBroadcast()
        }
    }, [load])

    useEffect(() => {
        const handler = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [load])

    const askResend = (inv) => setConfirm({
        variant: 'warning',
        title: 'Resend Invitation',
        message: `Resend invitation to ${inv.email}?`,
        onConfirm: async () => {
            try {
                await apiPost(`/admin/invitations/${inv.id}/resend`, {})
                setInvitations(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'pending' } : i))
                topTost(`Invitation resent to "${inv.email}"`)
                broadcastRefresh('cs:invitations-stats-refresh')
                setConfirm(null)
            } catch (err) {
                topTostError(parseApiError(err, `Failed to resend invitation`))
            }
        },
    })

    const askCancel = (inv) => setConfirm({
        variant: 'danger',
        title: 'Cancel Invitation',
        message: `Cancel invitation to ${inv.email}? This will revoke the pending invitation and they will not be able to accept it.`,
        onConfirm: async () => {
            try {
                await apiPatch(`/admin/invitations/${inv.id}/cancel`, {})
                setInvitations(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'cancelled' } : i))
                topTost(`Invitation to "${inv.email}" cancelled`)
                broadcastRefresh('cs:invitations-stats-refresh')
                setConfirm(null)
            } catch (err) {
                topTostError(parseApiError(err, `Failed to cancel invitation`))
            }
        },
    })

    const copyInviteLink = async (inv) => {
        const link = `${window.location.origin}/invite/${inv.token}`
        try {
            await navigator.clipboard.writeText(link)
            topTost('Invite link copied to clipboard')
        } catch (err) {
            topTostError('Failed to copy invite link')
        }
    }

    const closeConfirm = () => { if (!acting) setConfirm(null) }
    const runConfirm = async () => {
        if (!confirm) return
        setActing(true)
        try {
            await confirm.onConfirm()
        } finally {
            setActing(false)
        }
    }

    const getActions = (inv) => {
        const status = getDerivedStatus(inv)
        const isPending = status === 'pending'
        const isExpiredStatus = status === 'expired'
        const isCancelledStatus = status === 'cancelled'
        const canResend = isPending || isExpiredStatus || isCancelledStatus

        const actions = [
            { label: 'Resend', icon: <FiRefreshCw />, onClick: () => askResend(inv), disabled: !canResend, title: canResend ? '' : 'Only pending, expired, or cancelled invitations can be resent' },
            { label: 'Copy Link', icon: <FiLink />, onClick: () => copyInviteLink(inv), disabled: !isPending, title: isPending ? '' : 'Only pending invitations can be copied' },
            { label: 'Cancel', icon: <FiXCircle />, danger: true, onClick: () => askCancel(inv), disabled: !isPending, title: isPending ? '' : 'Only pending invitations can be cancelled' },
        ]

        return actions
    }

    const roleColorMap = {
        project_manager: 'bg-soft-success text-success',
        site_supervisor: 'bg-soft-primary text-primary',
        safety_officer: 'bg-soft-danger text-danger',
        data_analyst: 'bg-soft-warning text-warning',
        stakeholder: 'bg-soft-info text-info',
    }

    const statusColorMap = {
        pending: 'bg-soft-warning text-warning',
        accepted: 'bg-soft-success text-success',
        expired: 'bg-soft-danger text-danger',
        cancelled: 'bg-soft-danger text-danger',
    }

    const humanizeRole = (role) => role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const parseExpiresAtMs = (val) => {
        if (!val) return null
        if (val instanceof Date) {
            const ms = val.getTime()
            return Number.isFinite(ms) ? ms : null
        }
        const raw = String(val).trim()
        if (!raw) return null
        const direct = Date.parse(raw)
        if (Number.isFinite(direct)) return direct
        const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
        const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`
        const fallback = Date.parse(withTz)
        return Number.isFinite(fallback) ? fallback : null
    }
    const isExpired = (expiresAt) => {
        const ms = parseExpiresAtMs(expiresAt)
        if (ms == null) return false
        return ms < Date.now()
    }
    const getDerivedStatus = (inv) => {
        const s = String(inv?.status || '').toLowerCase()
        if (s === 'pending' && inv?.expires_at && isExpired(inv.expires_at)) return 'expired'
        return s
    }

    const invitationsWithDerived = useMemo(() => (
        invitations.map(inv => {
            const derived_status = getDerivedStatus(inv)
            const role = String(inv?.role || '')
            return {
                ...inv,
                derived_status,
                role_label: role ? humanizeRole(role) : '',
            }
        })
    ), [invitations, timeNonce])

    useEffect(() => {
        const next = { pending: 0, accepted: 0, expired: 0, cancelled: 0 }
        for (const inv of invitationsWithDerived) {
            const s = String(inv?.derived_status || '').toLowerCase()
            if (s === 'pending') next.pending += 1
            else if (s === 'accepted') next.accepted += 1
            else if (s === 'expired') next.expired += 1
            else if (s === 'cancelled') next.cancelled += 1
        }
        window.dispatchEvent(new CustomEvent('cs:invitations-stats', { detail: next }))
    }, [invitationsWithDerived])

    const filteredInvitationsRef = useRef([])
    const activeFilterLabelRef = useRef('all')

    const columns = [
        {
            accessorKey: 'project_name',
            header: () => (
                <span className="cs-th-leading cs-leading-avatar">
                    <span className="cs-leading-slot cs-leading-slot-avatar" aria-hidden="true" />
                    <span>Project</span>
                </span>
            ),
            cell: (info) => {
                const inv = info.row.original
                const logoSrc = inv.project_logo_url || DEFAULT_PROJECT_LOGO
                return (
                    <Link to={`/admin/projects/${inv.project_id}`} className="hstack gap-3 text-decoration-none">
                        <div className="flex-shrink-0 cam-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={logoSrc} alt={inv.project_name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
                        </div>
                        <span className="fw-semibold inv-project-name">{inv.project_name || 'Not set'}</span>
                    </Link>
                )
            },
            meta: { className: 'inv-col-project', headerClassName: 'inv-col-project text-start' },
        },
        {
            accessorKey: 'email',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Invitee Email</span>
                </span>
            ),
            cell: (info) => {
                const email = info.getValue()
                return (
                    <span className="inv-meta">
                        <FiMail size={12} className="opacity-75" />
                        <span className="inv-meta-text">{email}</span>
                    </span>
                )
            },
            meta: { className: 'inv-col-email', headerClassName: 'inv-col-email text-start' },
        },
        {
            accessorKey: 'role',
            header: () => 'Project Role',
            cell: (info) => {
                const role = String(info.getValue() || '')
                const colorClass = roleColorMap[role] || 'bg-soft-secondary text-secondary'
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{humanizeRole(role)}</span>
            },
            meta: { className: 'inv-col-role', headerClassName: 'inv-col-role text-start' },
        },
        {
            accessorKey: 'invited_by_name',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Sent By</span>
                </span>
            ),
            cell: (info) => {
                const name = info.getValue()
                return (
                    <span className="inv-meta">
                        <FiUser size={12} className="opacity-75" />
                        <span className="inv-meta-text">{name || '—'}</span>
                    </span>
                )
            },
            meta: { className: 'inv-col-sent-by', headerClassName: 'inv-col-sent-by text-start' },
        },
        {
            accessorKey: 'created_at',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Sent At</span>
                </span>
            ),
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="inv-meta">
                            <FiCalendar size={12} className="opacity-75" />
                            <span className="inv-meta-text">
                                {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </span>
                    )
                    : <span className="text-muted">—</span>
            },
            meta: { className: 'inv-col-sent', headerClassName: 'inv-col-sent text-start' },
        },
        {
            accessorKey: 'expires_at',
            header: () => (
                <span className="cs-th-leading">
                    <span className="cs-leading-slot cs-leading-slot-icon" aria-hidden="true" />
                    <span>Expires At</span>
                </span>
            ),
            cell: (info) => {
                const v = info.getValue()
                return v
                    ? (
                        <span className="inv-meta">
                            <FiCalendar size={12} className="opacity-75" />
                            <span className="inv-meta-text">
                                {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                        </span>
                    )
                    : <span className="text-muted">—</span>
            },
            meta: { className: 'inv-col-expires', headerClassName: 'inv-col-expires text-start' },
        },
        {
            accessorKey: 'derived_status',
            header: () => 'INVITATION STATUS',
            cell: (info) => {
                const inv = info.row.original
                const status = String(info.getValue() || getDerivedStatus(inv) || '').toLowerCase()
                const colorClass = statusColorMap[status] || 'bg-soft-secondary text-secondary'
                const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—'
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{label}</span>
            },
            meta: { className: 'inv-col-status', headerClassName: 'inv-col-status text-start' },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            cell: info => (
                <div className="hstack gap-2 justify-content-end">
                    <ActionsMenu items={getActions(info.row.original)} />
                </div>
            ),
            enableSorting: false,
            meta: { headerClassName: 'text-end inv-col-actions', className: 'text-end inv-col-actions', headerAlign: 'end' }
        },
    ]

    const filteredInvitations = useMemo(() => {
        switch (activeFilter) {
            case 'pending': return invitationsWithDerived.filter(i => String(i?.derived_status || '').toLowerCase() === 'pending')
            case 'accepted': return invitationsWithDerived.filter(i => String(i?.derived_status || '').toLowerCase() === 'accepted')
            case 'expired': return invitationsWithDerived.filter(i => String(i?.derived_status || '').toLowerCase() === 'expired')
            case 'cancelled': return invitationsWithDerived.filter(i => String(i?.derived_status || '').toLowerCase() === 'cancelled')
            default: return invitationsWithDerived
        }
    }, [invitationsWithDerived, activeFilter])

    filteredInvitationsRef.current = filteredInvitations
    activeFilterLabelRef.current = activeFilter

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail?.page && e.detail.page !== 'list') return
            const format = String(e?.detail?.format || '').toLowerCase()
            const rows = filteredInvitationsRef.current
            const activeFilterRef = activeFilterLabelRef.current

            const fmtDate = (v) => {
                if (!v) return ''
                try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                catch { return String(v) }
            }

            const deriveStatus = (inv) => getDerivedStatus(inv)

            const filterLabel = (() => {
                const map = {
                    all: 'All Invitations',
                    pending: 'Pending Invitations',
                    accepted: 'Accepted Invitations',
                    expired: 'Expired Invitations',
                    cancelled: 'Cancelled Invitations',
                }
                return map[activeFilterRef] || 'All Invitations'
            })()

            const headers = ['Project', 'Invitee Email', 'Role', 'Sent By', 'Sent At', 'Expires At', 'Status']
            const toRow = (inv) => [
                inv.project_name || '',
                inv.email || '',
                humanizeRole(String(inv.role || '')),
                inv.invited_by_name || '',
                fmtDate(inv.created_at),
                fmtDate(inv.expires_at),
                deriveStatus(inv) || '',
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
                fetch(`${API_BASE}/admin/invitations/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Invitations_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }

            if (format === 'csv') {
                const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
                const genTs = pkDateTimeLabel()
                const meta = [
                    ['ConstructionSight AI — Invitations Directory Report'],
                    [`Filter:,${filterLabel}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(inv => toRow(inv).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Invitations_Export_${today}.csv`)
                return
            }

            if (format === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const invNodes = rows.map(inv => {
                    const r = toRow(inv)
                    return [
                        `  <invitation>`,
                        `    <project>${esc(r[0])}</project>`,
                        `    <email>${esc(r[1])}</email>`,
                        `    <role>${esc(r[2])}</role>`,
                        `    <sent_by>${esc(r[3])}</sent_by>`,
                        `    <sent_at>${esc(r[4])}</sent_at>`,
                        `    <expires_at>${esc(r[5])}</expires_at>`,
                        `    <status>${esc(r[6])}</status>`,
                        `  </invitation>`,
                    ].join('\n')
                }).join('\n')
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report>`,
                    `  <metadata>`,
                    `    <title>ConstructionSight AI — Invitations Directory Report</title>`,
                    `    <filter>${esc(filterLabel)}</filter>`,
                    `    <generated_at>${genTs}</generated_at>`,
                    `    <total_records>${rows.length}</total_records>`,
                    `    <exported_by>Administrator</exported_by>`,
                    `  </metadata>`,
                    `  <invitations>`,
                    invNodes,
                    `  </invitations>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Invitations_Export_${today}.xml`)
                return
            }

            if (format === 'text') {
                const genTs = pkDateTimeLabel()
                const allRows = rows.map(inv => toRow(inv))
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
                    center('Invitations Directory Report'),
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
                triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `Invitations_Export_${today}.txt`)
                return
            }

            if (format === 'excel') {
                const genTs = pkDateTimeLabel()

                const wb = XLSX.utils.book_new()
                const sheetData = [
                    ['ConstructionSight AI — Invitations Directory Report'],
                    [`Filter: ${filterLabel}`],
                    [`Generated: ${genTs}`],
                    [`Total Records: ${rows.length}`],
                    [],
                    headers,
                    ...rows.map(inv => toRow(inv)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(sheetData)

                ws['!cols'] = [
                    { wch: 28 }, // Project
                    { wch: 30 }, // Email
                    { wch: 18 }, // Role
                    { wch: 20 }, // Sent By
                    { wch: 14 }, // Sent At
                    { wch: 14 }, // Expires At
                    { wch: 14 }, // Status
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
                    pending:   { bg: 'fef3c7', fg: 'b45309' },
                    accepted:  { bg: 'dcfce7', fg: '15803d' },
                    expired:   { bg: 'fee2e2', fg: 'b91c1c' },
                    cancelled: { bg: 'fee2e2', fg: 'b91c1c' },
                }

                rows.forEach((inv, ri) => {
                    const rowBg = ri % 2 === 0 ? WHITE : ALT
                    headers.forEach((_, ci) => {
                        const addr = XLSX.utils.encode_cell({ r: ri + 6, c: ci })
                        const cell = ws[addr]
                        if (!cell) return
                        const isStatusCol = ci === 6
                        const statusKey = String(deriveStatus(inv) || '').toLowerCase()
                        const sc = isStatusCol ? STATUS_COLORS[statusKey] : null
                        cell.s = {
                            font: { sz: 9, bold: isStatusCol, color: { rgb: sc ? sc.fg : '111827' } },
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

                XLSX.utils.book_append_sheet(wb, ws, 'Invitations')

                const summaryRows = [
                    ['ConstructionSight AI — Invitations Summary'],
                    [],
                    ['Metric', 'Count'],
                    ['Total Invitations', rows.length],
                    ['Pending', rows.filter(i => deriveStatus(i) === 'pending').length],
                    ['Accepted', rows.filter(i => deriveStatus(i) === 'accepted').length],
                    ['Expired', rows.filter(i => deriveStatus(i) === 'expired').length],
                    ['Cancelled', rows.filter(i => deriveStatus(i) === 'cancelled').length],
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
                    `Invitations_Export_${today}.xlsx`
                )
                return
            }

            if (format === 'print') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/admin/invitations/export/pdf`, {
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
            }
        }
        window.addEventListener('cs:invitations-export', handler)
        return () => window.removeEventListener('cs:invitations-export', handler)
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
                #invitationsList .cs-th-leading { display: inline-flex; align-items: center; gap: 4px; }
                #invitationsList .cs-th-leading.cs-leading-avatar { gap: 1rem; }
                #invitationsList .cs-leading-slot { display: none; }
                .inv-meta { display: inline-flex; align-items: center; gap: 4px; }
                .inv-meta svg { flex: 0 0 auto; transform: translateY(0px); }
                html.app-skin-dark .inv-meta svg { color: inherit !important; }
                .inv-meta-text { min-width: 0; }
                .inv-project-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.25; }
                #invitationsList { table-layout: auto; min-width: 100%; }
                #invitationsList .inv-col-email { min-width: 180px; }
                #invitationsList .inv-col-project { min-width: 180px; }
                #invitationsList .inv-col-role { min-width: 140px; }
                #invitationsList .inv-col-sent-by { min-width: 140px; }
                #invitationsList .inv-col-sent { min-width: 130px; }
                #invitationsList .inv-col-expires { min-width: 130px; }
                #invitationsList .inv-col-status { min-width: 100px; }
                #invitationsList .inv-col-actions { min-width: 100px; }
            `}</style>
            <Table
                data={filteredInvitations}
                columns={columns}
                searchKeys={['project_name', 'email', 'role', 'role_label', 'invited_by_name', 'created_at', 'expires_at', 'derived_status']}
                disableDefaultSorting={true}
                tableId="invitationsList"
            />

            {/* Details Modal */}
            {viewDetailsInv && (
                <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setViewDetailsInv(null)}>
                    <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">Invitation Details</h5>
                                <button type="button" className="btn-close" onClick={() => setViewDetailsInv(null)} />
                            </div>
                            <div className="modal-body">
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Invitee Email</label>
                                    <input type="text" className="form-control" value={viewDetailsInv.email} disabled />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Project</label>
                                    <input type="text" className="form-control" value={viewDetailsInv.project_name} disabled />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Role</label>
                                    <input type="text" className="form-control" value={humanizeRole(viewDetailsInv.role)} disabled />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Status</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={(() => {
                                            const s = String(getDerivedStatus(viewDetailsInv) || '').toLowerCase()
                                            return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'
                                        })()}
                                        disabled
                                    />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Invite Link</label>
                                    <div className="input-group">
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={`${window.location.origin}/invite/${viewDetailsInv.token}`}
                                            disabled
                                        />
                                        <button
                                            className="btn btn-outline-primary"
                                            type="button"
                                            onClick={() => {
                                                navigator.clipboard.writeText(`${window.location.origin}/invite/${viewDetailsInv.token}`)
                                                topTost('Invite link copied to clipboard')
                                            }}
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Expires At</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={new Date(viewDetailsInv.expires_at).toLocaleString()}
                                        disabled
                                    />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Sent By</label>
                                    <input type="text" className="form-control" value={viewDetailsInv.invited_by_name} disabled />
                                </div>
                                <div className="mb-3">
                                    <label className="form-label fw-semibold">Sent At</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={new Date(viewDetailsInv.created_at).toLocaleString()}
                                        disabled
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setViewDetailsInv(null)}>Close</button>
                            </div>
                        </div>
                    </div>
                </div>
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

export default InvitationsTable
