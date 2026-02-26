import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useLocation } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiMoreHorizontal, FiUserCheck, FiPower, FiLogOut, FiMail, FiCalendar } from 'react-icons/fi'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Table from '@/components/shared/table/Table'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiGet, apiPatch, apiPost, API_BASE } from '@/utils/api'
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

const getInitials = (fullName) => {
    const parts = fullName.trim().split(/\s+/)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0][0].toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const DEFAULT_USER_AVATAR = '/images/icons/profile-picture.png'

const UsersTable = () => {
    const location = useLocation()

    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)
    const [currentAdminId, setCurrentAdminId] = useState(null)

    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()
    const getApprovalStatus = (u) => {
        const raw = u?.approval_status ?? u?.approvalStatus
        if (typeof raw === 'string' && raw.trim()) return raw.toLowerCase()
        if (u?.is_approved === true) return 'approved'
        if (u?.is_approved === false) return 'pending'
        return 'approved'
    }

    // Get current admin ID on mount
    useEffect(() => {
        apiGet('/users/me')
            .then(me => setCurrentAdminId(me.id))
            .catch(() => {})
    }, [])

    const load = React.useCallback(() => {
        setLoading(true)
        apiGet('/admin/users')
            .then(data => setUsers(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load users.'))
            .finally(() => setLoading(false))
    }, [])


    useEffect(() => { load() }, [load])

    useEffect(() => {
        const handler = () => load()
        window.addEventListener('cs:users-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:users-stats-refresh', () => load())
        return () => {
            window.removeEventListener('cs:users-stats-refresh', handler)
            unsubBroadcast()
        }
    }, [load])

    useEffect(() => {
        const handler = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [load])

    const askToggleApprove = (user) => setConfirm({
        variant: 'warning',
        title: user.is_approved ? 'Unapprove User' : 'Approve User',
        message: `${user.is_approved ? 'Unapprove' : 'Approve'} ${user.full_name}?`,
        onConfirm: async () => {
            try {
                await apiPatch(`/admin/users/${user.id}/approve`, {})
                setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_approved: !u.is_approved } : u))
                topTost(`User ${user.is_approved ? 'unapproved' : 'approved'}`)
                broadcastRefresh('cs:users-stats-refresh')
                setConfirm(null)
            } catch (err) {
                topTostError(parseApiError(err, `Failed to ${user.is_approved ? 'unapprove' : 'approve'} user`))
            }
        },
    })

    const askToggleActivate = (user) => setConfirm({
        variant: 'warning',
        title: user.is_active ? 'Deactivate User' : 'Activate User',
        message: `${user.is_active ? 'Deactivate' : 'Activate'} ${user.full_name}?`,
        onConfirm: async () => {
            try {
                await apiPatch(`/admin/users/${user.id}/activate`, {})
                setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: !u.is_active } : u))
                topTost(`User ${user.is_active ? 'deactivated' : 'activated'}`)
                broadcastRefresh('cs:users-stats-refresh')
                setConfirm(null)
            } catch (err) {
                topTostError(parseApiError(err, `Failed to ${user.is_active ? 'deactivate' : 'activate'} user`))
            }
        },
    })

    const askForceLogout = (user) => setConfirm({
        variant: 'danger',
        title: 'Force Logout',
        message: `Force logout all sessions for ${user.full_name}? This will immediately terminate all active sessions and require them to log in again.`,
        onConfirm: async () => {
            try {
                await apiPost(`/admin/users/${user.id}/force-logout`, {})
                topTost(`User sessions invalidated`)
                setConfirm(null)
            } catch (err) {
                topTostError(parseApiError(err, `Failed to force logout user`))
            }
        },
    })

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

    const getActions = (user) => {
        const isSelf = user.id === currentAdminId
        const isAdmin = user.platform_role === 'admin'

        const actions = [
            { label: user.is_approved ? 'Unapprove' : 'Approve', icon: <FiUserCheck />, onClick: () => askToggleApprove(user), disabled: isAdmin, title: isAdmin ? 'Cannot change approval for admin users' : '' },
            { label: user.is_active ? 'Deactivate' : 'Activate', icon: <FiPower />, onClick: () => askToggleActivate(user), disabled: isSelf, title: isSelf ? 'Cannot deactivate yourself' : '' },
            { label: 'Force Logout', icon: <FiLogOut />, danger: true, onClick: () => askForceLogout(user), disabled: isSelf, title: isSelf ? 'Cannot force-logout yourself' : '' },
        ]

        return actions
    }

    const roleColorMap = {
        admin: 'bg-soft-danger text-danger',
        user: 'bg-soft-info text-info',
    }

    const authColorMap = {
        local: 'bg-soft-primary text-primary',
        google: 'bg-soft-success text-success',
        hybrid: 'bg-soft-warning text-warning',
    }

    const usersWithDerived = useMemo(() => (
        (users || []).map(u => {
            const role = String(u?.platform_role || '').toLowerCase()
            const role_label = role === 'admin' ? 'Administrator' : 'User'
            const provider = String(u?.auth_provider || '').toLowerCase()
            const auth_provider_label = provider ? (provider.charAt(0).toUpperCase() + provider.slice(1)) : ''
            const approval_status = getApprovalStatus(u)
            const approval_label = approval_status === 'pending' ? 'Pending' : 'Approved'
            const account_status_label = u?.is_active ? 'Active' : 'Deactivated'
            return {
                ...u,
                approval_status,
                role_label,
                auth_provider_label,
                approval_label,
                account_status_label,
            }
        })
    ), [users])

    useEffect(() => {
        const list = usersWithDerived
        const active = list.filter(u => u?.is_active === true).length
        const inactive = list.filter(u => u?.is_active === false).length
        const pending = list.filter(u => String(u?.approval_status || '').toLowerCase() === 'pending').length
        const approved = list.filter(u => String(u?.approval_status || '').toLowerCase() === 'approved').length
        const admins = list.filter(u => String(u?.platform_role || '').toLowerCase() === 'admin').length
        broadcastRefresh('cs:users-stats', { active, inactive, pending, approved, admins })
    }, [usersWithDerived])

    const columns = [
        {
            accessorKey: 'full_name',
            header: () => 'Account',
            cell: (info) => {
                const user = info.row.original
                const rawAvatar = String(user?.avatar_url || '').trim()
                const resolveAvatarSrc = () => {
                    if (!rawAvatar) return DEFAULT_USER_AVATAR
                    if (/^https?:\/\//i.test(rawAvatar)) return rawAvatar
                    if (rawAvatar.startsWith('/images/') || rawAvatar.startsWith('/logos/') || rawAvatar.startsWith('/favicon')) return rawAvatar
                    if (rawAvatar.startsWith('/')) return `${API_BASE}${rawAvatar}`
                    return rawAvatar
                }
                const avatarSrc = resolveAvatarSrc()
                return (
                    <div className="hstack gap-3 text-decoration-none">
                        <div
                            className="flex-shrink-0 cam-logo-circle"
                            style={{
                                width: 46,
                                height: 46,
                                borderRadius: '50%',
                                overflow: 'hidden',
                                border: '2px solid var(--bs-border-color)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: '700',
                                color: 'var(--bs-primary)',
                            }}
                        >
                            <img
                                src={avatarSrc}
                                alt={user.full_name}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    padding: 0,
                                }}
                                data-fallback="0"
                                onError={(e) => {
                                    if (e.currentTarget.dataset.fallback === '0') {
                                        e.currentTarget.dataset.fallback = '1'
                                        e.currentTarget.src = DEFAULT_USER_AVATAR
                                        e.currentTarget.style.objectFit = 'cover'
                                        e.currentTarget.style.padding = '0'
                                        return
                                    }
                                    e.currentTarget.style.display = 'none'
                                    e.currentTarget.parentElement.textContent = getInitials(user.full_name)
                                }}
                            />
                        </div>
                        <div className="vstack gap-0">
                            <span className="fw-semibold">{user.full_name}</span>
                            <span className="fs-12 text-muted">@{user.username}</span>
                        </div>
                    </div>
                )
            },
            meta: { className: 'usr-col-user', headerClassName: 'usr-col-user' },
        },
        {
            accessorKey: 'email',
            header: () => 'Email',
            cell: (info) => {
                const email = info.getValue()
                return (
                    <span className="inv-meta">
                        <FiMail size={12} className="opacity-75" />
                        <span className="inv-meta-text">{email}</span>
                    </span>
                )
            },
            meta: { className: 'usr-col-email', headerClassName: 'usr-col-email' },
        },
        {
            accessorKey: 'platform_role',
            header: () => 'Access Level',
            cell: (info) => {
                const role = String(info.getValue() || '')
                const colorClass = roleColorMap[role] || 'bg-soft-secondary text-secondary'
                const label = role === 'admin' ? 'Administrator' : 'User'
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{label}</span>
            },
            meta: { className: 'usr-col-role', headerClassName: 'usr-col-role' },
        },
        {
            accessorKey: 'is_active',
            header: () => 'Account Status',
            cell: (info) => {
                const isActive = info.getValue()
                return (
                    <span className={`badge ${isActive ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                        {isActive ? 'Active' : 'Deactivated'}
                    </span>
                )
            },
            meta: { className: 'usr-col-active', headerClassName: 'usr-col-active' },
        },
        {
            accessorKey: 'is_approved',
            header: () => 'Approval',
            cell: (info) => {
                const isApproved = info.getValue()
                return (
                    <span className={`badge ${isApproved ? 'bg-soft-success text-success' : 'bg-soft-warning text-warning'} fs-11 fw-bold text-uppercase`}>
                        {isApproved ? 'Approved' : 'Pending'}
                    </span>
                )
            },
            meta: { className: 'usr-col-approval', headerClassName: 'usr-col-approval' },
        },
        {
            accessorKey: 'auth_provider',
            header: () => 'Sign-in Method',
            cell: (info) => {
                const provider = String(info.getValue() || '')
                const colorClass = authColorMap[provider] || 'bg-soft-secondary text-secondary'
                const label = provider.charAt(0).toUpperCase() + provider.slice(1)
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{label}</span>
            },
            meta: { className: 'usr-col-auth', headerClassName: 'usr-col-auth' },
        },
        {
            accessorKey: 'active_project_count',
            header: () => 'Assigned Projects',
            cell: (info) => {
                const raw = info.getValue()
                const n = Number(raw || 0)
                const label = n > 0 ? String(n) : 'None'
                return <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase">{label}</span>
            },
            meta: { className: 'usr-col-projects', headerClassName: 'usr-col-projects' },
        },
        {
            accessorKey: 'created_at',
            header: () => 'Joined At',
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
            meta: { className: 'usr-col-joined', headerClassName: 'usr-col-joined' },
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
            meta: { headerClassName: 'text-end usr-col-actions', className: 'text-end usr-col-actions', headerAlign: 'end' }
        },
    ]

    const filteredUsers = useMemo(() => {
        switch (activeFilter) {
            case 'active': return usersWithDerived.filter(u => u.is_active)
            case 'inactive': return usersWithDerived.filter(u => !u.is_active)
            case 'pending': return usersWithDerived.filter(u => String(u?.approval_status || '').toLowerCase() === 'pending')
            case 'approved': return usersWithDerived.filter(u => String(u?.approval_status || '').toLowerCase() === 'approved')
            case 'admins': return usersWithDerived.filter(u => String(u?.platform_role || '').toLowerCase() === 'admin')
            default: return usersWithDerived
        }
    }, [usersWithDerived, activeFilter])

    const filteredUsersRef = useRef([])
    const activeFilterLabelRef = useRef('all')
    filteredUsersRef.current = filteredUsers
    activeFilterLabelRef.current = activeFilter

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail?.page && e.detail.page !== 'list') return
            const format = String(e?.detail?.format || '').toLowerCase()
            const rows = filteredUsersRef.current
            const activeFilterRef = activeFilterLabelRef.current

            const fmtDate = (v) => {
                if (!v) return ''
                try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                catch { return String(v) }
            }

            const filterLabel = (() => {
                const map = {
                    all: 'All Users',
                    active: 'Active Users',
                    inactive: 'Inactive Users',
                    pending: 'Pending Approval',
                    approved: 'Approved Users',
                    admins: 'Admins',
                }
                return map[activeFilterRef] || 'All Users'
            })()

            const headers = ['User', 'Username', 'Email', 'Access Level', 'Account Status', 'Approval', 'Sign-in Method', 'Assigned Projects', 'Joined At']
            const toRow = (u) => [
                u.full_name || '',
                u.username || '',
                u.email || '',
                String(u.platform_role || '').toLowerCase() === 'admin' ? 'Administrator' : 'User',
                u.is_active ? 'Active' : 'Deactivated',
                u.is_approved ? 'Approved' : 'Pending',
                String(u.auth_provider || '').toLowerCase() ? (String(u.auth_provider).charAt(0).toUpperCase() + String(u.auth_provider).slice(1)) : '',
                String(u.active_project_count ?? ''),
                fmtDate(u.created_at),
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
                fetch(`${API_BASE}/admin/users/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: activeFilterRef, generated_by_name: 'Administrator' }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Users_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }

            if (format === 'csv') {
                const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
                const genTs = pkDateTimeLabel()
                const meta = [
                    ['ConstructionSight AI — Users Directory Report'],
                    [`Filter:,${filterLabel}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(u => toRow(u).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Users_Export_${today}.csv`)
                return
            }

            if (format === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const userNodes = rows.map(u => {
                    const r = toRow(u)
                    return [
                        `  <user>`,
                        `    <name>${esc(r[0])}</name>`,
                        `    <username>${esc(r[1])}</username>`,
                        `    <email>${esc(r[2])}</email>`,
                        `    <access_level>${esc(r[3])}</access_level>`,
                        `    <account_status>${esc(r[4])}</account_status>`,
                        `    <approval>${esc(r[5])}</approval>`,
                        `    <sign_in_method>${esc(r[6])}</sign_in_method>`,
                        `    <assigned_projects>${esc(r[7])}</assigned_projects>`,
                        `    <joined_at>${esc(r[8])}</joined_at>`,
                        `  </user>`,
                    ].join('\n')
                }).join('\n')
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report>`,
                    `  <metadata>`,
                    `    <title>ConstructionSight AI — Users Directory Report</title>`,
                    `    <filter>${esc(filterLabel)}</filter>`,
                    `    <generated_at>${genTs}</generated_at>`,
                    `    <total_records>${rows.length}</total_records>`,
                    `    <exported_by>Administrator</exported_by>`,
                    `  </metadata>`,
                    `  <users>`,
                    userNodes,
                    `  </users>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Users_Export_${today}.xml`)
                return
            }

            if (format === 'text') {
                const genTs = pkDateTimeLabel()
                const allRows = rows.map(u => toRow(u))
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
                    center('Users Directory Report'),
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
                triggerDownload(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `Users_Export_${today}.txt`)
                return
            }

            if (format === 'excel') {
                const genTs = pkDateTimeLabel()

                const wb = XLSX.utils.book_new()
                const sheetData = [
                    ['ConstructionSight AI — Users Directory Report'],
                    [`Filter: ${filterLabel}`],
                    [`Generated: ${genTs}`],
                    [`Total Records: ${rows.length}`],
                    [],
                    headers,
                    ...rows.map(u => toRow(u)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(sheetData)

                ws['!cols'] = [
                    { wch: 24 },
                    { wch: 16 },
                    { wch: 30 },
                    { wch: 14 },
                    { wch: 14 },
                    { wch: 12 },
                    { wch: 14 },
                    { wch: 16 },
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
                    active: { bg: 'dcfce7', fg: '15803d' },
                    deactivated: { bg: 'fee2e2', fg: 'b91c1c' },
                }

                rows.forEach((u, ri) => {
                    const rowBg = ri % 2 === 0 ? WHITE : ALT
                    headers.forEach((_, ci) => {
                        const addr = XLSX.utils.encode_cell({ r: ri + 6, c: ci })
                        const cell = ws[addr]
                        if (!cell) return
                        const isStatusCol = ci === 4
                        const statusKey = (u.is_active ? 'active' : 'deactivated')
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

                XLSX.utils.book_append_sheet(wb, ws, 'Users')

                const summaryRows = [
                    ['ConstructionSight AI — Users Summary'],
                    [],
                    ['Metric', 'Count'],
                    ['Total Users', rows.length],
                    ['Active', rows.filter(u => u.is_active).length],
                    ['Inactive', rows.filter(u => !u.is_active).length],
                    ['Pending', rows.filter(u => !u.is_approved && u.is_active).length],
                    ['Admins', rows.filter(u => String(u.platform_role || '').toLowerCase() === 'admin').length],
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
                    `Users_Export_${today}.xlsx`
                )
                return
            }

            if (format === 'print') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/admin/users/export/pdf`, {
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
        window.addEventListener('cs:users-export', handler)
        return () => window.removeEventListener('cs:users-export', handler)
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
                .inv-meta { display: inline-flex; align-items: center; gap: 4px; }
                .inv-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                html.app-skin-dark .inv-meta svg { color: inherit !important; }
                .inv-meta-text { min-width: 0; }
                #usersList { table-layout: auto; min-width: 100%; }
                #usersList .usr-col-user     { min-width: 200px; }
                #usersList .usr-col-email    { min-width: 180px; }
                #usersList .usr-col-role     { min-width: 130px; }
                #usersList .usr-col-active   { min-width: 120px; }
                #usersList .usr-col-approval { min-width: 110px; }
                #usersList .usr-col-auth     { min-width: 120px; }
                #usersList .usr-col-projects { min-width: 90px; }
                #usersList .usr-col-joined   { min-width: 130px; }
                #usersList .usr-col-actions  { min-width: 100px; }
            `}</style>
            <Table
                data={filteredUsers}
                columns={columns}
                searchKeys={['full_name', 'username', 'email', 'platform_role', 'role_label', 'auth_provider', 'auth_provider_label', 'approval_status', 'approval_label', 'account_status_label', 'active_project_count', 'created_at']}
                disableDefaultSorting={true}
                tableId="usersList"
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

export default UsersTable
