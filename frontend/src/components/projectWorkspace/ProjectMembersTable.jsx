import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FiMoreHorizontal, FiEdit2, FiXCircle, FiMail, FiUser, FiCalendar } from 'react-icons/fi'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Table from '@/components/shared/table/Table'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { parseApiError } from '@/utils/errorHandler'
import { apiDelete, apiGet, API_BASE } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import ChangeRoleModal from './ChangeRoleModal'
import * as XLSX from 'xlsx'

const DEFAULT_USER_AVATAR = '/images/icons/profile-picture.png'

const getInitials = (fullName) => {
    const parts = fullName.trim().split(/\s+/)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0][0].toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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

const ProjectMembersTable = ({ projectId, currentUserId, myRole }) => {
    // Note: When a member's role is changed, any pending invitations they have for other roles
    // in the same project are automatically cancelled to avoid conflicting enrollments
    const location = useLocation()
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const [members, setMembers] = useState([])
    const [loading, setLoading] = useState(false)
    const [confirm, setConfirm] = useState(null)
    const [acting, setActing] = useState(false)
    const [changeRoleModal, setChangeRoleModal] = useState(null)

    const isPM = myRole === 'project_manager'

    const load = React.useCallback(() => {
        setLoading(true)
        apiGet(`/projects/${projectId}/members`)
            .then(data => setMembers(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load members.'))
            .finally(() => setLoading(false))
    }, [projectId])


    useEffect(() => { load() }, [load])

    useEffect(() => {
        const handler = () => load()
        const unsubBroadcast = onBroadcast('cs:project-members-refresh', handler)
        return () => { unsubBroadcast() }
    }, [load])

    useEffect(() => {
        const handler = () => { if (!document.hidden) load() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [load])

    const askRemove = React.useCallback((member) => {
        if (member.user_id === currentUserId) {
            topTostError('Cannot remove yourself from the project')
            return
        }
        setConfirm({
            open: true,
            variant: 'danger',
            title: 'Remove Member',
            message: `Are you sure you want to remove ${member.full_name} from this project? They will lose access to all project resources immediately.`,
            onConfirm: async () => {
                try {
                    await apiDelete(`/projects/${projectId}/members/${member.user_id}`)
                    setMembers(prev => prev.filter(m => m.user_id !== member.user_id))
                    topTost(`${member.full_name} removed from project`)
                    broadcastRefresh('cs:project-members-refresh')
                    setConfirm(null)
                } catch (err) {
                    topTostError(parseApiError(err, 'Failed to remove member'))
                }
            },
        })
    }, [projectId, currentUserId])

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

    const getActions = React.useCallback((member) => {
        if (!isPM) return []

        const isYou = member.user_id === currentUserId
        const canRemove = !isYou

        return [
            ...(!isYou ? [{
                label: 'Change Role',
                icon: <FiEdit2 />,
                onClick: () => setChangeRoleModal(member),
                disabled: false,
                title: 'Change this member\'s project role',
            }] : []),
            { type: 'divider' },
            {
                label: 'Remove',
                icon: <FiXCircle />,
                danger: true,
                onClick: () => askRemove(member),
                disabled: !canRemove,
                title: canRemove ? 'Remove this member from the project' : 'Cannot remove yourself',
            },
        ]
    }, [isPM, currentUserId, askRemove])

    const roleColorMap = {
        project_manager: 'bg-soft-success text-success',
        site_supervisor: 'bg-soft-primary text-primary',
        safety_officer: 'bg-soft-danger text-danger',
        data_analyst: 'bg-soft-warning text-warning',
        stakeholder: 'bg-soft-info text-info',
    }

    const humanizeRole = (role) => role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const getInitials = (name) => (name || '?').split(' ').slice(0, 2).map(n => n[0].toUpperCase()).join('')

    useEffect(() => {
        const counts = {
            project_manager: 0,
            site_supervisor: 0,
            safety_officer: 0,
            data_analyst: 0,
            stakeholder: 0,
        }
        for (const m of members) {
            const k = String(m?.project_role || '')
            if (Object.prototype.hasOwnProperty.call(counts, k)) counts[k] += 1
        }
        broadcastRefresh('cs:project-members-stats', counts)
    }, [members])

    const filteredMembers = useMemo(() => {
        if (activeFilter === 'all') return members
        return members.filter(m => norm(m.project_role) === activeFilter)
    }, [members, activeFilter])

    const membersWithDerived = useMemo(() => {
        return filteredMembers.map((m) => {
            const role = String(m?.project_role || '')
            return {
                ...m,
                project_role_label: humanizeRole(role),
            }
        })
    }, [filteredMembers])

    const exportRowsRef = useRef(membersWithDerived)
    const exportFilterRef = useRef(activeFilter)
    exportRowsRef.current = membersWithDerived
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
                all: 'All Members',
                project_manager: 'Project Managers',
                site_supervisor: 'Site Supervisors',
                safety_officer: 'Safety Officers',
                data_analyst: 'Data Analysts',
                stakeholder: 'Stakeholders',
            }
            return map[String(f || 'all')] || 'All Members'
        }

        const headers = ['Member', 'Email', 'Project Role', 'Joined At']
        const toRow = (m) => [
            m?.full_name || '',
            m?.email || '',
            m?.project_role_label || humanizeRole(String(m?.project_role || '')),
            fmtDate(m?.joined_at),
        ]

        const exportFile = (rows, f, format) => {
            const today = pkDateStamp()
            const kind = String(format || 'csv').toLowerCase()
            const label = filterLabel(f)

            if (kind === 'pdf') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/members/export/pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ filter: f }),
                })
                    .then(res => {
                        if (!res.ok) throw new Error('PDF generation failed')
                        return res.blob()
                    })
                    .then(blob => triggerDownload(blob, `Project_Members_Export_${today}.pdf`))
                    .catch(() => topTostError('Failed to generate PDF export.'))
                return
            }
            if (kind === 'print') {
                const token = window.sessionStorage.getItem('access_token')
                fetch(`${API_BASE}/projects/${projectId}/members/export/pdf`, {
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
                    ['ConstructionSight AI — Project Members Export'],
                    [`Filter:,${label}`],
                    [`Generated:,${genTs}`],
                    [`Total Records:,${rows.length}`],
                    [],
                    headers.map(esc).join(','),
                    ...rows.map(m => toRow(m).map(esc).join(',')),
                ]
                triggerDownload(new Blob(['﻿' + meta.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `Project_Members_Export_${today}.csv`)
                return
            }

            if (kind === 'xml') {
                const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                const genTs = pkDateTimeLabel()
                const nodes = rows.map(m => {
                    const r = toRow(m)
                    return [
                        `  <member>`,
                        `    <full_name>${esc(r[0])}</full_name>`,
                        `    <email>${esc(r[1])}</email>`,
                        `    <project_role>${esc(r[2])}</project_role>`,
                        `    <joined_at>${esc(r[3])}</joined_at>`,
                        `  </member>`,
                    ].join('\n')
                })
                const xml = [
                    `<?xml version="1.0" encoding="UTF-8"?>`,
                    `<report type="project_members">`,
                    `  <title>ConstructionSight AI — Project Members Export</title>`,
                    `  <filter>${esc(label)}</filter>`,
                    `  <generated_at>${esc(genTs)}</generated_at>`,
                    `  <total_records>${rows.length}</total_records>`,
                    `  <members>`,
                    ...nodes,
                    `  </members>`,
                    `</report>`,
                ].join('\n')
                triggerDownload(new Blob([xml], { type: 'application/xml;charset=utf-8' }), `Project_Members_Export_${today}.xml`)
                return
            }

            if (kind === 'text') {
                const genTs = pkDateTimeLabel()
                const allRows = rows.map(m => toRow(m))
                const colWidths = headers.map((h, i) => Math.min(46, Math.max(h.length, ...allRows.map(r => String(r[i] ?? '').length))))
                const pad = (s, w) => String(s ?? '').slice(0, w).padEnd(w)
                const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
                const row = (cells) => '| ' + cells.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |'
                const lines = [
                    'ConstructionSight AI — Project Members Export',
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
                triggerDownload(new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), `Project_Members_Export_${today}.txt`)
                return
            }

            if (kind === 'excel') {
                const genTs = pkDateTimeLabel()
                const aoa = [
                    ['ConstructionSight AI — Project Members Export'],
                    ['Filter', label],
                    ['Generated', genTs],
                    ['Total Records', rows.length],
                    [],
                    headers,
                    ...rows.map(r => toRow(r)),
                ]
                const ws = XLSX.utils.aoa_to_sheet(aoa)
                ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 18 }, { wch: 14 }]
                const wb = XLSX.utils.book_new()
                XLSX.utils.book_append_sheet(wb, ws, 'Members')
                const xlsxBuf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
                triggerDownload(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Project_Members_Export_${today}.xlsx`)
                return
            }

            topTostError('Unsupported export format')
        }

        const handler = (e) => {
            exportFile(exportRowsRef.current, exportFilterRef.current, e?.detail?.format)
        }
        window.addEventListener('cs:members-export', handler)
        return () => window.removeEventListener('cs:members-export', handler)
    }, [])

    const columns = [
        {
            accessorKey: 'full_name',
            header: () => 'Member',
            cell: (info) => {
                const member = info.row.original
                const isYou = member.user_id === currentUserId
                const rawAvatar = String(member?.avatar_url || '').trim()
                const resolveAvatarSrc = () => {
                    if (!rawAvatar) return DEFAULT_USER_AVATAR
                    if (/^https?:\/\//i.test(rawAvatar)) return rawAvatar
                    if (rawAvatar.startsWith('/images/') || rawAvatar.startsWith('/logos/') || rawAvatar.startsWith('/favicon')) return rawAvatar
                    if (rawAvatar.startsWith('/')) return `${API_BASE}${rawAvatar}`
                    return rawAvatar
                }
                const avatarSrc = resolveAvatarSrc()
                return (
                    <span className="inv-meta d-flex align-items-center gap-2">
                        <div
                            className="cam-logo-circle"
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                border: '2px solid var(--bs-border-color)',
                                overflow: 'hidden',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 'bold',
                                flexShrink: 0,
                            }}
                        >
                            <img
                                src={avatarSrc}
                                alt=""
                                style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
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
                                    e.currentTarget.parentElement.textContent = getInitials(member.full_name)
                                }}
                            />
                        </div>
                        <div>
                            <span className="fw-semibold">{info.getValue()}</span>
                            {isYou && <span className="badge bg-soft-primary text-primary fs-11 ms-2">(You)</span>}
                        </div>
                    </span>
                )
            },
            meta: { className: 'mem-col-name', headerClassName: 'mem-col-name' },
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
            meta: { className: 'mem-col-email', headerClassName: 'mem-col-email' },
        },
        {
            accessorKey: 'project_role',
            header: () => 'Project Role',
            cell: (info) => {
                const role = String(info.getValue() || '')
                const colorClass = roleColorMap[role] || 'bg-soft-secondary text-secondary'
                return <span className={`badge ${colorClass} fs-11 fw-bold text-uppercase`}>{humanizeRole(role)}</span>
            },
            meta: { className: 'mem-col-role', headerClassName: 'mem-col-role' },
        },
        {
            accessorKey: 'joined_at',
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
            meta: { className: 'mem-col-joined', headerClassName: 'mem-col-joined' },
        },
        ...(isPM ? [{
            id: 'actions',
            header: () => 'Actions',
            cell: ({ row }) => (
                <div className="d-flex justify-content-end">
                    <ActionsMenu items={getActions(row.original)} />
                </div>
            ),
            enableSorting: false,
            meta: { className: 'mem-col-actions text-end', headerClassName: 'mem-col-actions text-end', headerAlign: 'end' },
        }] : []),
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
                .inv-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                .inv-meta-text { min-width: 0; }
                .cam-logo-circle { background: var(--bs-secondary-bg); color: var(--bs-body-color); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; color: rgba(226, 232, 240, 0.92); }
                #projectMembers-${projectId} { table-layout: auto; min-width: 100%; }
                #projectMembers-${projectId} .mem-col-name { min-width: 200px; }
                #projectMembers-${projectId} .mem-col-email { min-width: 180px; }
                #projectMembers-${projectId} .mem-col-role { min-width: 140px; }
                #projectMembers-${projectId} .mem-col-joined { min-width: 120px; }
                #projectMembers-${projectId} .mem-col-actions { min-width: 100px; text-align: right; }
            `}</style>
            <Table
                tableId={`projectMembers-${projectId}`}
                noCard={true}
                columns={columns}
                data={membersWithDerived}
                searchKeys={['full_name', 'email', 'project_role_label', 'project_role', 'joined_at']}
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
            {changeRoleModal && (
                <ChangeRoleModal
                    projectId={projectId}
                    member={changeRoleModal}
                    onClose={() => setChangeRoleModal(null)}
                    onSuccess={() => setChangeRoleModal(null)}
                />
            )}
        </>
    )
}

export default ProjectMembersTable
