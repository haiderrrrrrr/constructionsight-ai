import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { FiRefreshCw, FiXCircle, FiMoreHorizontal, FiLink, FiMail, FiUser, FiCalendar } from 'react-icons/fi'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Table from '@/components/shared/table/Table'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiDelete, apiGet, apiPost, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import * as XLSX from 'xlsx'

const norm = (val) => String(val || '').toLowerCase()

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
                            type="button"
                            className={`dropdown-item d-flex align-items-center gap-2 ${item.danger ? 'text-danger' : ''} ${item.disabled ? 'opacity-50 pe-none' : ''}`}
                            onClick={(e) => {
                                e.preventDefault()
                                if (!item.disabled && item.onClick) {
                                    item.onClick()
                                }
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

const ProjectInvitationsTable = ({ projectId: propProjectId, currentUserEmail }) => {
    const { projectId: paramProjectId } = useParams()
    const location = useLocation()
    const projectId = propProjectId || parseInt(paramProjectId, 10)
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const [invitations, setInvitations] = useState([])
    const [loading, setLoading] = useState(false)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)

    const load = React.useCallback(() => {
        setLoading(true)
        apiGet(`/projects/${projectId}/invitations`)
            .then(data => setInvitations(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load invitations.'))
            .finally(() => setLoading(false))
    }, [projectId])


    useEffect(() => { load() }, [load])

    useEffect(() => {
        const handler = () => load()
        const unsubBroadcast = onBroadcast('cs:project-invitations-refresh', handler)
        return () => { unsubBroadcast() }
    }, [load])

    useEffect(() => {
        const handler = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [load])

    const askResend = React.useCallback((inv) => {
        setConfirm({
            open: true,
            variant: 'warning',
            title: 'Resend Invitation',
            message: `Resend invitation to ${inv.email}?`,
            onConfirm: async () => {
                try {
                    await apiPost(`/projects/${projectId}/invitations/${inv.id}/resend`, {})
                    setInvitations(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'pending' } : i))
                    topTost(`Invitation resent to "${inv.email}"`)
                    broadcastRefresh('cs:project-invitations-refresh')
                    setConfirm(null)
                } catch (err) {
                    topTostError(parseApiError(err, `Failed to resend invitation`))
                }
            },
        })
    }, [projectId])

    const askCancel = React.useCallback((inv) => {
        setConfirm({
            open: true,
            variant: 'danger',
            title: 'Cancel Invitation',
            message: `Cancel invitation to ${inv.email}? This will revoke the pending invitation and they will not be able to accept it.`,
            onConfirm: async () => {
                try {
                    await apiDelete(`/projects/${projectId}/invitations/${inv.id}`)
                    setInvitations(prev => prev.map(i => i.id === inv.id ? { ...i, status: 'cancelled' } : i))
                    topTost(`Invitation to "${inv.email}" cancelled`)
                    broadcastRefresh('cs:project-invitations-refresh')
                    setConfirm(null)
                } catch (err) {
                    topTostError(parseApiError(err, `Failed to cancel invitation`))
                }
            },
        })
    }, [projectId])

    const copyInviteLink = React.useCallback(async (inv) => {
        const link = `${window.location.origin}/invite/${inv.token}`
        try {
            await navigator.clipboard.writeText(link)
            topTost('Invite link copied to clipboard')
        } catch (err) {
            topTostError('Failed to copy invite link')
        }
    }, [])

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

    const getActions = React.useCallback((inv) => {
        if (!inv) return []
        const status = getDerivedStatus(inv)
        const isPending = status === 'pending'
        const isExpiredStatus = status === 'expired'
        const isCancelled = status === 'cancelled'
        const canResend = isPending || isExpiredStatus || isCancelled

        return [
            { label: 'Resend', icon: <FiRefreshCw />, onClick: () => askResend(inv), disabled: !canResend, title: canResend ? '' : 'Only pending, expired, or cancelled invitations can be resent' },
            { label: 'Copy Link', icon: <FiLink />, onClick: () => copyInviteLink(inv), disabled: !isPending, title: isPending ? '' : 'Only pending invitations can be copied' },
            { label: 'Cancel', icon: <FiXCircle />, danger: true, onClick: () => askCancel(inv), disabled: !isPending, title: isPending ? '' : 'Only pending invitations can be cancelled' },
        ]
    }, [askResend, askCancel, copyInviteLink])

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
    const isExpiredDate = (expiresAt) => expiresAt && new Date(expiresAt) < new Date()
    const getDerivedStatus = (inv) => {
        const s = String(inv?.status || '').toLowerCase()
        if (s === 'pending' && inv?.expires_at && isExpiredDate(inv.expires_at)) return 'expired'
        return s
    }

    const baseInvitations = useMemo(() => {
        return invitations.filter(i => norm(i.email) !== norm(currentUserEmail))
    }, [invitations, currentUserEmail])

    const invitationsWithDerived = useMemo(() => {
        return baseInvitations.map((inv) => {
            const s = getDerivedStatus(inv)
            const r = String(inv?.role || '')
            return {
                ...inv,
                status_derived: s,
                status_label: s.replace(/_/g, ' '),
                role_label: humanizeRole(r),
            }
        })
    }, [baseInvitations])

    const filteredInvitations = useMemo(() => {
        if (activeFilter === 'all') return invitationsWithDerived
        return invitationsWithDerived.filter(i => String(i.status_derived || '') === activeFilter)
    }, [invitationsWithDerived, activeFilter])

    const exportRowsRef = useRef(filteredInvitations)
    const exportFilterRef = useRef(activeFilter)
    exportRowsRef.current = filteredInvitations
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

        const fmtDate = (v) => {
            if (!v) return ''
            try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
            catch { return String(v) }
        }

        const filterLabel = (f) => {
            const map = {
                all: 'All Invitations',
                pending: 'Pending Invitations',
                accepted: 'Accepted Invitations',
                expired: 'Expired Invitations',
                cancelled: 'Cancelled Invitations',
            }
            return map[String(f || 'all')] || 'All Invitations'
        }

        const headers = ['Invitee Email', 'Role', 'Sent By', 'Sent At', 'Expires At', 'Status']
        const toRow = (inv) => [
            inv?.email || '',
            inv?.role_label || humanizeRole(String(inv?.role || '')),
            inv?.invited_by_name || '',
            fmtDate(inv?.created_at),
            fmtDate(inv?.expires_at),
            String(inv?.status_derived || '').replace(/_/g, ' '),
        ]

        const exportFile = (rows, f, format) => {
            const today = pkDateStamp()
            const kind = String(format || 'csv').toLowerCase()
            const label = filterLabel(f)

            if (kind === 'pdf') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/invitations/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: f }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Project_Invitations_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }
            if (kind === 'print') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/invitations/export/pdf`, {
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
                    ['ConstructionSight AI — Project Invitations Export'],
                    [`Filter:,${label}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(inv => toRow(inv).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Project_Invitations_Export_${today}.csv`)
                return
            }

            if (kind === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const nodes = rows.map(inv => {
                    const r = toRow(inv)
                    return [
                        `  <invitation>`,
                        `    <email>${esc(r[0])}</email>`,
                        `    <role>${esc(r[1])}</role>`,
                        `    <sent_by>${esc(r[2])}</sent_by>`,
                        `    <sent_at>${esc(r[3])}</sent_at>`,
                        `    <expires_at>${esc(r[4])}</expires_at>`,
                        `    <status>${esc(r[5])}</status>`,
                        `  </invitation>`,
                    ].join('\n')
                })
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report type="project_invitations">`,
                    `  <title>ConstructionSight AI — Project Invitations Export</title>`,
                    `  <filter>${esc(label)}</filter>`,
                    `  <generated_at>${esc(genTs)}</generated_at>`,
                    `  <total_records>${rows.length}</total_records>`,
                    `  <invitations>`,
                    ...nodes,
                    `  </invitations>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Project_Invitations_Export_${today}.xml`)
                return
            }

            if (kind === 'text') {
                const genTs = pkDateTimeLabel()
                const allRows = rows.map(inv => toRow(inv))
                const colWidths = headers.map((h, i) => Math.min(46, Math.max(h.length, ...allRows.map(r => String(r[i] ?? '').length))))
                const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
                const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
                const row = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
                const lines = [
                    'ConstructionSight AI — Project Invitations Export',
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
                triggerDownload(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), `Project_Invitations_Export_${today}.txt`)
                return
            }

            if (kind === 'excel') {
                const genTs = pkDateTimeLabel()
                const aoa = [
                    ['ConstructionSight AI — Project Invitations Export'],
                    ['Filter', label],
                    ['Generated', genTs],
                    ['Total Records', rows.length],
                    [],
                    headers,
                    ...rows.map(r => toRow(r)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(aoa)
                ws['!cols'] = [{ wch: 26 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }]
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Invitations')
                const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
                triggerDownload(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Project_Invitations_Export_${today}.xlsx`)
                return
            }

            topTostError('Unsupported export format')
        }

        const handler = (e) => {
            exportFile(exportRowsRef.current, exportFilterRef.current, e?.detail?.format)
        }

        window.addEventListener('cs:invitations-export', handler)
        return () => window.removeEventListener('cs:invitations-export', handler)
    }, [])

    useEffect(() => {
        const rows = invitationsWithDerived
        const by = (k) => rows.filter(r => String(r.status_derived || '') === k).length
        broadcastRefresh('cs:project-invitations-stats', {
            pending: by('pending'),
            accepted: by('accepted'),
            expired: by('expired'),
            cancelled: by('cancelled'),
        })
    }, [invitationsWithDerived])

    const columns = [
        {
            accessorKey: 'email',
            header: () => 'Invitee Email',
            cell: (info) => {
                const email = info.getValue()
                return (
                    <span className="inv-meta">
                        <FiMail size={12} className="opacity-75" />
                        <span className="inv-meta-text">{email}</span>
                    </span>
                )
            },
            meta: { className: 'inv-col-email', headerClassName: 'inv-col-email' },
        },
        {
            accessorKey: 'role',
            header: () => 'Project Role',
            cell: (info) => {
                const role = String(info.getValue() || '')
                const colorClass = roleColorMap[role] || 'bg-soft-secondary text-secondary'
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{humanizeRole(role)}</span>
            },
            meta: { className: 'inv-col-role', headerClassName: 'inv-col-role' },
        },
        {
            accessorKey: 'invited_by_name',
            header: () => 'Sent By',
            cell: (info) => {
                const name = info.getValue()
                return (
                    <span className="inv-meta">
                        <FiUser size={12} className="opacity-75" />
                        <span className="inv-meta-text">{name || '—'}</span>
                    </span>
                )
            },
            meta: { className: 'inv-col-sent-by', headerClassName: 'inv-col-sent-by' },
        },
        {
            accessorKey: 'created_at',
            header: () => 'Sent At',
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
            meta: { className: 'inv-col-sent', headerClassName: 'inv-col-sent' },
        },
        {
            accessorKey: 'expires_at',
            header: () => 'Expires At',
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
            meta: { className: 'inv-col-expires', headerClassName: 'inv-col-expires' },
        },
        {
            accessorKey: 'status_derived',
            header: () => 'INVITATION STATUS',
            cell: (info) => {
                const inv = info.row.original
                const status = String(info.getValue() || getDerivedStatus(inv) || '').toLowerCase()
                const colorClass = statusColorMap[status] || 'bg-soft-secondary text-secondary'
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{status}</span>
            },
            meta: { className: 'inv-col-status', headerClassName: 'inv-col-status' },
        },
        {
            id: 'actions',
            header: () => 'Actions',
            cell: ({ row }) => (
                <div className="d-flex justify-content-end">
                    <ActionsMenu items={getActions(row.original)} />
                </div>
            ),
            enableSorting: false,
            meta: { className: 'inv-col-actions text-end', headerClassName: 'inv-col-actions text-end', headerAlign: 'end' },
        },
    ]

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
                html.app-skin-dark .cam-actions-menu .dropdown-item:hover { background-color: rgba(255,255,255,0.08); }
                .inv-meta { display: inline-flex; align-items: center; gap: 4px; }
                .inv-meta svg { flex: 0 0 auto; transform: translateY(0px); }
                .inv-meta-text { min-width: 0; }
            `}</style>
            <Table
                tableId={`projectInvitations-${projectId}`}
                noCard={true}
                disableDefaultSorting={true}
                columns={columns}
                data={filteredInvitations}
                searchKeys={[
                    'email',
                    'role_label',
                    'role',
                    'invited_by_name',
                    'status_label',
                    'status_derived',
                    'created_at',
                    'expires_at',
                ]}
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

export default ProjectInvitationsTable
