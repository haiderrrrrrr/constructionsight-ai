/**
 * reports-safety.jsx — Global Safety Reports page (top-level nav)
 *
 * Mirrors the Members page design:
 *  - Collapsible stat cards at the top (Total / Emailed / Failed / Generating)
 *  - Filter dropdown (All / Scheduled / Manual / By status)
 *  - Project selector
 *  - Table with Download, Resend, Delete actions
 *  - RBAC: only projects where user role is PM, supervisor, or safety_officer
 *  - Real-time: polls every 3s when any report is generating/pending
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import PropTypes from 'prop-types'
import PageLoader from '@/components/shared/PageLoader'
import {
    FiDownload, FiMail, FiTrash2, FiFileText,
    FiAlertCircle, FiCheckCircle, FiShield, FiFilter,
    FiBarChart, FiCalendar, FiList, FiMoreHorizontal,
} from 'react-icons/fi'
import { apiGet, apiPost, apiDelete, API_BASE } from '@/utils/api'
import topTostError from '@/utils/topTostError'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import Table from '@/components/shared/table/Table'
import Dropdown from '@/components/shared/Dropdown'
import getIcon from '@/utils/getIcon'

const ALLOWED_ROLES = ['project_manager', 'supervisor', 'safety_officer']

const STATUS_META = {
    pending:      { label: 'Pending',      color: 'secondary', spin: false },
    generating:   { label: 'Generating',   color: 'primary',   spin: true  },
    ready:        { label: 'Ready',        color: 'success',   spin: false },
    emailed:      { label: 'Emailed',      color: 'success',   spin: false },
    failed:       { label: 'Failed',       color: 'danger',    spin: false },
    email_failed: { label: 'Email Failed', color: 'warning',   spin: false },
}

function StatusBadge({ status }) {
    const meta = STATUS_META[status] || { label: status, color: 'secondary', spin: false }
    return (
        <span className={`badge bg-soft-${meta.color} text-${meta.color} fs-11 fw-bold text-uppercase d-inline-flex align-items-center gap-1`}>
            {meta.spin && <div className="spinner-border" style={{ width: 8, height: 8, borderWidth: '1.5px' }} />}
            {meta.label}
        </span>
    )
}

StatusBadge.propTypes = {
    status: PropTypes.string,
}

const ActionsMenu = ({ items }) => (
    <div className="dropdown rpt-actions-menu">
        <button className="avatar-text avatar-md border-0 bg-transparent" data-bs-toggle="dropdown" data-bs-offset="0,4" aria-expanded="false">
            <FiMoreHorizontal size={16} />
        </button>
        <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ minWidth: 190 }}>
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
                            {item.icon ? React.cloneElement(item.icon, { size: 14, strokeWidth: 1.8 }) : null}
                            {item.label}
                        </button>
                    </li>
                )
            })}
        </ul>
    </div>
)

ActionsMenu.propTypes = {
    items: PropTypes.arrayOf(PropTypes.shape({
        type: PropTypes.string,
        label: PropTypes.string,
        title: PropTypes.string,
        danger: PropTypes.bool,
        disabled: PropTypes.bool,
        icon: PropTypes.element,
        onClick: PropTypes.func,
    })).isRequired,
}

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    })
}

function formatPeriod(label) {
    if (!label) return '—'
    const weekMatch = label.match(/^(\d{4})-W(\d{2})$/)
    if (weekMatch) return `Week ${parseInt(weekMatch[2])}, ${weekMatch[1]}`
    const monthMatch = label.match(/^(\d{4})-(\d{2})$/)
    if (monthMatch) {
        const d = new Date(parseInt(monthMatch[1]), parseInt(monthMatch[2]) - 1, 1)
        return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
    }
    if (label.startsWith('custom_')) {
        const parts = label.replace('custom_', '').split('_')
        if (parts.length === 2) {
            const fmtD = s => `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`
            return `${fmtD(parts[0])} → ${fmtD(parts[1])}`
        }
    }
    return label
}

export default function ReportsSafety() {
    const navigate  = useNavigate()
    const location  = useLocation()
    const activeFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const [projects, setProjects]               = useState([])
    const [projectsLoading, setProjectsLoading] = useState(true)
    const [selectedProject, setSelectedProject] = useState(null)

    const [reports, setReports]                 = useState([])
    const [reportsLoading, setReportsLoading]   = useState(false)
    const [total, setTotal]                     = useState(0)
    const [page, setPage]                       = useState(1)
    const [deletingId, setDeletingId]           = useState(null)
    const [resendingId, setResendingId]         = useState(null)
    const [confirmDelete, setConfirmDelete]     = useState(null)
    const [statsOpen, setStatsOpen]             = useState(true)
    const pollRef = useRef(null)
    const PER_PAGE = 20

    // Collapse toggle listener (mirrors Members header)
    useEffect(() => {
        const el = document.getElementById('collapseReportsSafety')
        if (!el) return
        const onShown  = () => setStatsOpen(true)
        const onHidden = () => setStatsOpen(false)
        el.addEventListener('shown.bs.collapse', onShown)
        el.addEventListener('hidden.bs.collapse', onHidden)
        setStatsOpen(el.classList.contains('show'))
        return () => {
            el.removeEventListener('shown.bs.collapse', onShown)
            el.removeEventListener('hidden.bs.collapse', onHidden)
        }
    }, [])

    // Load user's accessible projects
    useEffect(() => {
        setProjectsLoading(true)
        apiGet('/projects/my')
            .then(data => {
                const list = Array.isArray(data) ? data : (data?.projects || [])
                const allowed = list.filter(p =>
                    ALLOWED_ROLES.includes(p.my_role) && p.status === 'active'
                )
                setProjects(allowed)
                if (allowed.length > 0) {
                    setSelectedProject(allowed[0])
                }
            })
            .catch(() => topTostError('Failed to load projects.'))
            .finally(() => setProjectsLoading(false))
    }, [])

    const loadReports = useCallback(async (pg = 1, silent = false) => {
        if (!selectedProject) return
        if (!silent) setReportsLoading(true)
        try {
            // Only load scheduled reports on this global page
            const data = await apiGet(`/projects/${selectedProject.id}/reports?page=${pg}&per_page=${PER_PAGE}&triggered_by=scheduled`)
            setReports(data?.reports || [])
            setTotal(data?.total || 0)
        } catch {
            if (!silent) topTostError('Failed to load reports.')
        } finally {
            if (!silent) setReportsLoading(false)
        }
    }, [selectedProject])

    useEffect(() => {
        if (!selectedProject) return
        setPage(1)
        loadReports(1)

        const handler = () => loadReports(1, true)
        window.addEventListener('cs:report-status-changed', handler)
        return () => window.removeEventListener('cs:report-status-changed', handler)
    }, [selectedProject, loadReports])

    // Poll every 3s when any report is generating/pending
    useEffect(() => {
        clearInterval(pollRef.current)
        const hasActive = reports.some(r => r.status === 'generating' || r.status === 'pending')
        if (hasActive && selectedProject) {
            pollRef.current = setInterval(() => loadReports(page, true), 3000)
        }
        return () => clearInterval(pollRef.current)
    }, [reports, page, selectedProject, loadReports])

    function handleProjectChange(projectId) {
        const proj = projects.find(p => p.id === parseInt(projectId))
        if (proj) {
            setSelectedProject(proj)
            setReports([])
        }
    }

    function setFilter(next) {
        const p = new URLSearchParams(location.search)
        const value = String(next || '').toLowerCase()
        if (!value || value === 'all') p.delete('filter')
        else p.set('filter', value)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    async function handleDownload(report) {
        const token = window.sessionStorage.getItem('access_token')
        try {
            const res = await fetch(
                `${API_BASE}/projects/${selectedProject.id}/reports/${report.id}/download`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' }
            )
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Download failed.')
            const blob = await res.blob()
            const url  = window.URL.createObjectURL(blob)
            const a    = document.createElement('a')
            a.href     = url
            a.download = `PPE_Safety_Report_${formatPeriod(report.period_label).replace(/\s+/g,'_')}.pdf`
            document.body.appendChild(a); a.click(); document.body.removeChild(a)
            window.URL.revokeObjectURL(url)
            topTostError('Report downloaded successfully.', 'success')
        } catch (err) {
            topTostError(err.message || 'Could not download report. The file may have been deleted.')
        }
    }

    async function handleResend(report) {
        setResendingId(report.id)
        try {
            const res = await apiPost(`/projects/${selectedProject.id}/reports/${report.id}/resend`, {})
            topTostError(res?.message || `Report emailed to ${res?.sent} recipient${res?.sent !== 1 ? 's' : ''}.`, 'success')
            loadReports(page, true)
        } catch (err) {
            let msg = 'Failed to resend report.'
            try { msg = JSON.parse(err.message)?.detail || msg } catch (e) { void e }
            topTostError(msg)
        } finally {
            setResendingId(null)
        }
    }

    async function handleDelete(report) {
        setConfirmDelete(null)
        setDeletingId(report.id)
        try {
            await apiDelete(`/projects/${selectedProject.id}/reports/${report.id}`)
            topTostError('Report deleted.', 'success')
            setReports(prev => prev.filter(r => r.id !== report.id))
            setTotal(prev => Math.max(0, prev - 1))
        } catch (err) {
            let msg = 'Failed to delete report.'
            try { msg = JSON.parse(err.message)?.detail || msg } catch (e) { void e }
            topTostError(msg)
        } finally {
            setDeletingId(null)
        }
    }

    // Compute stats from loaded reports
    const stats = {
        total:      total,
        emailed:    reports.filter(r => r.status === 'emailed').length,
        failed:     reports.filter(r => r.status === 'failed' || r.status === 'email_failed').length,
        generating: reports.filter(r => r.status === 'generating' || r.status === 'pending').length,
        scheduled:  reports.filter(r => r.triggered_by === 'scheduled').length,
    }

    // Filter applied locally on loaded page
    const filteredReports = reports.filter(r => {
        if (activeFilter === 'all') return true
        if (activeFilter === 'scheduled') return r.triggered_by === 'scheduled'
        if (activeFilter === 'manual') return r.triggered_by === 'manual'
        return r.status === activeFilter
    })

    const filterItems = [
        { label: 'All',         icon: <FiList /> },
        { label: 'Emailed',     icon: <FiMail /> },
        { label: 'Failed',      icon: <FiAlertCircle /> },
        { label: 'Scheduled',   icon: <FiCalendar /> },
        { label: 'Manual',      icon: <FiFileText /> },
    ]

    const activeFilterLabel = (() => {
        const map = { all: 'All', emailed: 'Emailed', failed: 'Failed', scheduled: 'Scheduled', manual: 'Manual' }
        return map[activeFilter] || 'All'
    })()

    const totalPages = Math.ceil(total / PER_PAGE)

    // Table columns — mirrors Members table structure
    const columns = [
        {
            accessorKey: 'period_label',
            header: () => 'Period',
            cell: (info) => (
                <span className="fw-semibold">{formatPeriod(info.getValue())}</span>
            ),
            meta: { headerClassName: 'rpt-col-period' },
        },
        {
            accessorKey: 'report_type',
            header: () => 'Type',
            cell: (info) => (
                <span className="badge bg-soft-info text-info fs-11 fw-bold text-uppercase">
                    {String(info.getValue() || 'PPE').toUpperCase()}
                </span>
            ),
            meta: { headerClassName: 'rpt-col-type' },
        },
        {
            accessorKey: 'frequency',
            header: () => 'Frequency',
            cell: (info) => (
                <span className="badge bg-soft-secondary text-secondary fs-11 fw-bold text-capitalize">
                    {info.getValue() || '—'}
                </span>
            ),
            meta: { headerClassName: 'rpt-col-freq' },
        },
        {
            accessorKey: 'triggered_by',
            header: () => 'Triggered By',
            cell: (info) => {
                const v = info.getValue()
                return (
                    <span className={`badge bg-soft-${v === 'manual' ? 'secondary' : 'primary'} text-${v === 'manual' ? 'secondary' : 'primary'} fs-11 fw-bold text-uppercase`}>
                        {v === 'manual' ? 'Manual' : 'Scheduled'}
                    </span>
                )
            },
            meta: { headerClassName: 'rpt-col-trigger' },
        },
        {
            accessorKey: 'status',
            header: () => 'Status',
            cell: (info) => {
                const r = info.row.original
                return (
                    <span className="d-inline-flex align-items-center gap-1">
                        <StatusBadge status={info.getValue()} />
                        {(r.status === 'failed' || r.status === 'email_failed') && r.error_message && (
                            <span title={r.error_message} style={{ cursor: 'help' }}>
                                <FiAlertCircle size={12} className="text-danger" />
                            </span>
                        )}
                    </span>
                )
            },
            meta: { headerClassName: 'rpt-col-status' },
        },
        {
            accessorKey: 'generated_at',
            header: () => 'Generated',
            cell: (info) => (
                <span className="inv-meta">
                    <FiCalendar size={12} className="opacity-75" />
                    <span className="inv-meta-text text-muted">{formatDate(info.getValue())}</span>
                </span>
            ),
            meta: { headerClassName: 'rpt-col-gen' },
        },
        {
            accessorKey: 'recipient_count',
            header: () => 'Recipients',
            cell: (info) => {
                const r = info.row.original
                if (r.status === 'generating' || r.status === 'pending') return <span className="text-muted">—</span>
                const count = info.getValue() ?? 0
                return count > 0
                    ? <span className="inv-meta text-success"><FiCheckCircle size={12} /> <span className="inv-meta-text">{count}</span></span>
                    : <span className="text-muted">0</span>
            },
            meta: { headerClassName: 'rpt-col-recip' },
        },
        {
            id: 'actions',
            header: () => 'Actions',
            cell: ({ row }) => {
                const r = row.original
                const canDownload = r.has_file && (r.status === 'ready' || r.status === 'emailed' || r.status === 'email_failed')
                const canResend   = r.has_file && (r.status === 'emailed' || r.status === 'email_failed' || r.status === 'ready')
                const isBusy = deletingId === r.id || resendingId === r.id
                const isGenerating = r.status === 'generating' || r.status === 'pending'
                const items = [
                    {
                        label: 'Download PDF',
                        icon: <FiDownload />,
                        onClick: () => handleDownload(r),
                        disabled: !canDownload || isBusy,
                        title: canDownload ? 'Download PDF' : 'PDF not available yet',
                    },
                    {
                        label: 'Resend Email',
                        icon: <FiMail />,
                        onClick: () => handleResend(r),
                        disabled: !canResend || isBusy,
                        title: canResend ? 'Resend email to active members' : 'Email not available yet',
                    },
                    { type: 'divider' },
                    {
                        label: 'Delete',
                        icon: <FiTrash2 />,
                        danger: true,
                        onClick: () => setConfirmDelete(r),
                        disabled: isBusy || isGenerating,
                        title: isGenerating ? 'Cannot delete while generating' : 'Delete report',
                    },
                ]
                return (
                    <div className="d-flex justify-content-end">
                        <ActionsMenu items={items} />
                    </div>
                )
            },
            meta: { headerClassName: 'rpt-col-actions' },
        },
    ]

    if (projectsLoading) return <PageLoader minHeight="60vh" />

    if (projects.length === 0) {
        return (
            <>
                <PageHeader />
                <div className="main-content">
                    <div className="card stretch stretch-full">
                        <div className="card-body d-flex flex-column align-items-center justify-content-center py-5 text-muted gap-3">
                            <FiShield size={40} className="opacity-25" />
                            <div className="text-center">
                                <div className="fw-semibold mb-1">No accessible projects</div>
                                <div className="fs-12">
                                    Safety Reports are only available to Project Managers, Site Supervisors, and Safety Officers on active projects.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </>
        )
    }

    return (
        <>
            <style>{`
                #safetyReportsTable { table-layout: auto; min-width: 100%; }
                #safetyReportsTable .rpt-col-period  { min-width: 160px; }
                #safetyReportsTable .rpt-col-type    { min-width: 70px; }
                #safetyReportsTable .rpt-col-freq    { min-width: 90px; }
                #safetyReportsTable .rpt-col-trigger { min-width: 100px; }
                #safetyReportsTable .rpt-col-status  { min-width: 120px; }
                #safetyReportsTable .rpt-col-gen     { min-width: 150px; }
                #safetyReportsTable .rpt-col-recip   { min-width: 90px; }
                #safetyReportsTable .rpt-col-actions { min-width: 180px; }
                html:not(.app-skin-dark) #collapseReportsSafety .customer-header-card .card {
                    border: 1px solid rgba(15, 23, 42, 0.1);
                    border-top: 2px solid rgba(15, 23, 42, 0.14);
                    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
                }
                .inv-meta { display: inline-flex; align-items: center; gap: 4px; }
                .inv-meta svg { flex: 0 0 auto; transform: translateY(-1px); }
                .inv-meta-text { min-width: 0; }
                .rpt-actions-menu { position: relative; }
                .rpt-actions-menu .dropdown-item { color: inherit; transition: background-color 0.2s; }
                .rpt-actions-menu .dropdown-item.text-danger { color: #ef4444 !important; }
                .rpt-actions-menu .dropdown-item.text-danger:hover,
                .rpt-actions-menu .dropdown-item.text-danger:focus,
                .rpt-actions-menu .dropdown-item.text-danger:active {
                    color: #ef4444 !important;
                    background-color: rgba(239, 68, 68, 0.1);
                }
                .rpt-actions-menu .dropdown-item:hover,
                .rpt-actions-menu .dropdown-item:focus { color: inherit; background-color: rgba(var(--bs-primary-rgb), 0.08); }
                html.app-skin-dark .rpt-actions-menu .dropdown-item:hover { background-color: rgba(255,255,255,0.08); }
                .rpt-actions-menu .dropdown-item svg { color: currentColor; stroke-width: 1.8; }
                html.app-skin-dark .rpt-actions-menu .dropdown-item svg { color: currentColor !important; }
                .rpt-actions-menu .dropdown-item.text-danger svg,
                .rpt-actions-menu .dropdown-item.text-danger svg * {
                    color: #ef4444 !important;
                    stroke: #ef4444 !important;
                }
            `}</style>

            {/* Page header — mirrors Members page */}
            <PageHeader>
                <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                    {/* Project selector */}
                    <select
                        className="form-select form-select-sm"
                        style={{ minWidth: 200, fontSize: 13 }}
                        value={selectedProject?.id || ''}
                        onChange={e => handleProjectChange(e.target.value)}
                    >
                        {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>

                    {/* Toggle stats */}
                    <button
                        type="button"
                        className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                        data-bs-toggle="collapse"
                        data-bs-target="#collapseReportsSafety"
                        aria-expanded={statsOpen ? 'true' : 'false'}
                        aria-controls="collapseReportsSafety"
                    >
                        <FiBarChart size={16} />
                    </button>

                    {/* Filter dropdown */}
                    <Dropdown
                        dropdownItems={filterItems}
                        triggerPosition={"0, 12"}
                        triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                        triggerClass="btn btn-icon btn-light-brand"
                        isAvatar={false}
                        onClick={(label) => {
                            const map = { all: 'all', emailed: 'emailed', failed: 'failed', scheduled: 'scheduled', manual: 'manual' }
                            const key = String(label || '').toLowerCase()
                            if (map[key] !== undefined) setFilter(map[key])
                        }}
                        active={activeFilterLabel}
                        dataBsToggle=""
                    />

                </div>
            </PageHeader>

            {/* Stat cards — same accordion pattern as Members */}
            <div id="collapseReportsSafety" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
                <div className="accordion-body pb-2">
                    <div className="row">
                        {[
                            { key: 'total',      label: 'Total Reports',     icon: 'feather-file-text',  color: 'primary',   value: stats.total      },
                            { key: 'emailed',    label: 'Emailed',           icon: 'feather-mail',       color: 'success',   value: stats.emailed    },
                            { key: 'failed',     label: 'Failed',            icon: 'feather-alert-circle', color: 'danger',  value: stats.failed     },
                            { key: 'generating', label: 'Generating',        icon: 'feather-refresh-cw', color: 'warning',   value: stats.generating },
                            { key: 'scheduled',  label: 'Scheduled',         icon: 'feather-calendar',   color: 'info',      value: stats.scheduled  },
                        ].map(({ key, label, icon, color, value }) => (
                            <div key={key} className="col-xxl-3 col-md-6 customer-header-card">
                                <a
                                    href="#"
                                    className="card stretch stretch-full text-decoration-none"
                                    onClick={(e) => {
                                        e.preventDefault()
                                        if (key !== 'total' && key !== 'generating') setFilter(key)
                                        else setFilter('all')
                                    }}
                                >
                                    <div className="card-body">
                                        <div className="d-flex align-items-center justify-content-between">
                                            <div className="d-flex align-items-center gap-3">
                                                <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                                    {React.cloneElement(getIcon(icon), { size: 17 })}
                                                </div>
                                                <span className="fw-bold d-block">
                                                    <span className="text-truncate-1-line">{label}</span>
                                                    <span className="fs-24 fw-bolder d-block">{Number(value).toLocaleString()}</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="main-content">
                <div className="row">
                    <Table
                        noCard={true}
                        columns={columns}
                        data={filteredReports}
                        tableId="safetyReportsTable"
                    />
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="d-flex align-items-center justify-content-between px-2 py-3">
                        <span className="text-muted" style={{ fontSize: 12 }}>
                            Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}
                        </span>
                        <div className="d-flex gap-2">
                            <button className="btn btn-sm btn-outline-secondary"
                                onClick={() => { const p = page - 1; setPage(p); loadReports(p) }}
                                disabled={page <= 1 || reportsLoading} style={{ fontSize: 12 }}>
                                Previous
                            </button>
                            <button className="btn btn-sm btn-outline-secondary"
                                onClick={() => { const p = page + 1; setPage(p); loadReports(p) }}
                                disabled={page >= totalPages || reportsLoading} style={{ fontSize: 12 }}>
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Delete Confirm */}
            {confirmDelete && (
                <>
                    <div className="modal-backdrop fade show" style={{ zIndex: 1040 }} onClick={() => setConfirmDelete(null)} />
                    <div className="modal fade show d-block" style={{ zIndex: 1050 }} role="dialog">
                        <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 420 }}>
                            <div className="modal-content border border-secondary" style={{ background: '#0d1424' }}>
                                <div className="modal-header border-secondary px-4 py-3">
                                    <h6 className="modal-title text-white fw-bold mb-0">Delete Report</h6>
                                    <button className="btn-close btn-close-white" onClick={() => setConfirmDelete(null)} />
                                </div>
                                <div className="modal-body px-4 py-3">
                                    <p className="text-muted mb-1" style={{ fontSize: 13 }}>
                                        Are you sure you want to delete the <strong className="text-white">{formatPeriod(confirmDelete.period_label)}</strong> report?
                                    </p>
                                    <p className="text-danger mb-0" style={{ fontSize: 12 }}>
                                        This will permanently delete the PDF file and cannot be undone.
                                    </p>
                                </div>
                                <div className="modal-footer border-secondary px-4 py-3 gap-2">
                                    <button className="btn btn-outline-secondary btn-sm" onClick={() => setConfirmDelete(null)} style={{ fontSize: 12 }}>
                                        Cancel
                                    </button>
                                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(confirmDelete)} style={{ fontSize: 12 }}>
                                        Delete Report
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    )
}
