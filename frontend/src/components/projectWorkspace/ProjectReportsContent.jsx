/**
 * Report Delivery Log
 * Replicates the admin camera list page structure exactly:
 *  - PageHeader with right-side buttons
 *  - Collapsible stat cards (4 colours)
 *  - Shared Table component with search/sort/pagination
 *  - Broadcast-based live refresh (no polling except while generating)
 */
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import PropTypes from 'prop-types'
import PageLoader from '@/components/shared/PageLoader'
import {
    FiBarChart, FiFilter, FiDownload,
    FiFileText, FiAlertCircle, FiClock,
    FiUser, FiRefreshCw, FiEye, FiMoreHorizontal,
} from 'react-icons/fi'
import Table from '@/components/shared/table/Table'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import Dropdown from '@/components/shared/Dropdown'
import Footer from '@/components/shared/Footer'
import { apiGet, apiPost, API_BASE } from '@/utils/api'
import ReportSchedulerBar from './ReportSchedulerBar'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import topTostError from '@/utils/topTostError'
import getIcon from '@/utils/getIcon'

// ── Actions dropdown (mirrors CameraTable ActionsMenu exactly) ────────────────

const ActionsMenu = ({ items }) => (
    <div className="dropdown report-actions-menu">
        <button
            className="avatar-text avatar-md border-0 bg-transparent"
            data-bs-toggle="dropdown"
            data-bs-offset="0,4"
            data-bs-auto-close="outside"
            aria-expanded="false"
        >
            <FiMoreHorizontal size={16} />
        </button>
        <ul className="dropdown-menu dropdown-menu-end shadow-sm" style={{ minWidth: 180, zIndex: 1050 }}>
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
                            {item.loading
                                ? <><div className="spinner-border spinner-border-sm me-1" style={{ width: 12, height: 12 }} />{item.label}</>
                                : item.label
                            }
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
        loading: PropTypes.bool,
        icon: PropTypes.element,
        onClick: PropTypes.func,
    })).isRequired,
}

// ── helpers ───────────────────────────────────────────────────────────────────

const ROLE_LABELS = {
    project_manager:  'Project Manager',
    site_supervisor:  'Site Supervisor',
    safety_officer:   'Safety Officer',
}

const REPORT_TYPE_LABELS = {
    ppe:       'PPE Detection Report',
    workforce: 'Workforce Analytics Report',
    activity:  'Activity Monitoring Report',
    risk:      'Risk Analytics Report',
}

const GROUP_COLORS = ['#5b8dee','#28a745','#f59e0b','#a78bfa','#ef4444','#06b6d4']

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    })
}

function formatPeriod(label) {
    if (!label) return '—'
    const cleaned = String(label).replace(/^preview_+/i, '')
    const wm = cleaned.match(/^(\d{4})-W(\d{2})$/)
    if (wm) return `Week ${parseInt(wm[2])}, ${wm[1]}`
    const mm = cleaned.match(/^(\d{4})-(\d{2})$/)
    if (mm) {
        const d = new Date(parseInt(mm[1]), parseInt(mm[2]) - 1, 1)
        return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
    }
    return cleaned
}

// ── Stat cards (collapsible accordion — identical to CameraHeaderContent) ────

const ReportStatsCards = ({ projectId, nonce }) => {
    const [stats, setStats] = useState({ total: 0, delivered: 0, emailFailed: 0, totalRecipients: 0, successRate: null })

    useEffect(() => {
        let active = true
        apiGet(`/projects/${projectId}/reports?per_page=200&exclude_custom=true`)
            .then(data => {
                if (!active) return
                const reports = data?.reports || []
                // Flatten all recipient rows across all reports
                const allRecipients = reports.flatMap(r => r.recipients || [])
                const totalEmails   = allRecipients.length
                const delivered     = allRecipients.filter(r => r.delivered).length
                const failed        = allRecipients.filter(r => !r.delivered).length
                setStats({
                    total:           reports.filter(r => ['emailed','email_failed','failed'].includes(r.status)).length,
                    delivered,
                    emailFailed:     failed,
                    totalRecipients: totalEmails,
                    successRate:     totalEmails > 0 ? Math.round((delivered / totalEmails) * 100) : null,
                })
            })
            .catch(() => {})
        return () => { active = false }
    }, [projectId, nonce])

    const cards = [
        { icon: 'feather-send',         number: stats.total,                                                    title: 'Reports Dispatched',       color: 'primary' },
        { icon: 'feather-check-circle', number: stats.successRate !== null ? `${stats.successRate}%` : '—',    title: 'Email Delivery Rate',      color: 'success' },
        { icon: 'feather-alert-circle', number: stats.emailFailed,                                             title: 'Failed Deliveries',        color: 'danger'  },
        { icon: 'feather-users',        number: stats.totalRecipients,                                         title: 'Total Emails Sent',        color: 'warning' },
    ]

    return (
        <div id="collapseReports" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {cards.map(({ icon, number, title, color }, i) => (
                        <div key={i} className="col-xxl-3 col-md-6">
                            <div className={`card bg-${color} border-${color} text-white overflow-hidden`}>
                                <div className="card-body">
                                    <i className="fs-20">{getIcon(icon)}</i>
                                    <h5 className="fs-4 fw-bold text-reset mt-4 mb-1">{number}</h5>
                                    <div className="fs-12 text-reset fw-semibold">{title}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

ReportStatsCards.propTypes = {
    projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    nonce: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
}

// ── Main component ─────────────────────────────────────────────────────────────

const ProjectReportsContent = () => {
    const { projectId } = useParams()

    // ── PM-only RBAC gate ─────────────────────────────────────────────────────
    const [roleChecked, setRoleChecked] = useState(false)
    const [isPM,        setIsPM]        = useState(false)
    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                setIsPM(data?.my_role === 'project_manager')
            })
            .catch(() => setIsPM(false))
            .finally(() => setRoleChecked(true))
    }, [projectId])

    // Banner shown while a report is generating — cleared when poll sees it complete
    // Read from sessionStorage on mount (set by trigger button before navigation)
    const [generatingBanner, setGeneratingBanner] = useState(null)
    useEffect(() => {
        const key = `pendingReport_${projectId}`
        try {
            const raw = sessionStorage.getItem(key)
            if (raw) {
                sessionStorage.removeItem(key)
                setGeneratingBanner(JSON.parse(raw))
            }
        } catch (e) { void e }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const [reports, setReports]         = useState([])
    const [loading, setLoading]         = useState(true)
    const [statsOpen, setStatsOpen]     = useState(true)
    const [statsNonce, setStatsNonce]   = useState(0)
    const [activeFilter, setActiveFilter] = useState('all')
    const [resendingId, setResendingId]   = useState(null)
    const pollRef = useRef(null)

    // ── accordion open/close tracking ────────────────────────────────────────
    useEffect(() => {
        const el = document.getElementById('collapseReports')
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

    // ── data load ─────────────────────────────────────────────────────────────
    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true)
        try {
            const data = await apiGet(`/projects/${projectId}/reports?per_page=200&exclude_custom=true`)
            const fetched = data?.reports || []
            setReports(fetched)
            setStatsNonce(n => n + 1)
        } catch {
            if (!silent) topTostError('Failed to load delivery log.')
        } finally {
            if (!silent) setLoading(false)
        }
    }, [projectId])

    useEffect(() => { load() }, [projectId, load])

    // ── broadcast: refresh table ──────────────────────────────────────────────
    useEffect(() => {
        const unsub = onBroadcast('cs:report-delivery-refresh', () => load(true))
        return unsub
    }, [load])

    // ── broadcast: report just triggered — show banner + start poll ───────────
    useEffect(() => {
        const unsub = onBroadcast('cs:report-generating', (payload) => {
            if (payload) setGeneratingBanner(payload)
            load(true)
        })
        return unsub
    }, [load])

    // ── clear banner once the report reaches terminal state ───────────────────
    useEffect(() => {
        if (!generatingBanner) return
        const done = reports.find(r =>
            r.id === generatingBanner.report_id &&
            ['emailed', 'email_failed', 'failed'].includes(r.status)
        )
        if (done) setGeneratingBanner(null)
    }, [reports, generatingBanner])

    // ── poll only while Send Now banner is visible; otherwise rely on broadcast ─
    useEffect(() => {
        clearInterval(pollRef.current)
        if (!generatingBanner) return
        pollRef.current = setInterval(() => load(true), 5000)
        return () => clearInterval(pollRef.current)
    }, [load, generatingBanner])

    // ── actions ───────────────────────────────────────────────────────────────
    const fetchPdf = useCallback(async (reportId, inline = false) => {
        const token = window.sessionStorage.getItem('access_token')
        const url = `${API_BASE}/projects/${projectId}/reports/${reportId}/download${inline ? '?inline=true' : ''}`
        const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: 'include',
        })
        if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d?.detail || 'Failed.')
        }
        return res.blob()
    }, [projectId])

    const handleView = useCallback(async (report) => {
        try {
            const blob = await fetchPdf(report.id, true)
            const url = URL.createObjectURL(blob)
            window.open(url, '_blank')
            // Revoke after a short delay so the tab has time to load it
            setTimeout(() => URL.revokeObjectURL(url), 60000)
        } catch (err) {
            topTostError(err.message || 'Could not open PDF.')
        }
    }, [fetchPdf])

    const handleDownload = useCallback(async (report) => {
        try {
            const blob = await fetchPdf(report.id, false)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `PPE_Report_${formatPeriod(report.period_label) || report.id}.pdf`
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            topTostError(err.message || 'Download failed.')
        }
    }, [fetchPdf])

    const handleResend = useCallback(async (report) => {
        setResendingId(report.id)
        try {
            const res = await apiPost(`/projects/${projectId}/reports/${report.id}/resend`, {})
            topTostError(res?.message || 'Report resent successfully.', 'success')
            broadcastRefresh('cs:report-delivery-refresh')
        } catch (err) {
            let msg = 'Failed to resend report.'
            try { msg = JSON.parse(err.message)?.detail || msg } catch (e) { void e }
            topTostError(msg)
        } finally {
            setResendingId(null)
        }
    }, [projectId])

    // ── one row per report, recipients kept as array for stacked rendering ──────
    const flatRows = useMemo(() => {
        const TERMINAL = new Set(['emailed', 'email_failed', 'failed'])
        const terminal = reports.filter(r => TERMINAL.has(r.status))
        const filtered = activeFilter === 'all' ? terminal
            : activeFilter === 'scheduled' ? terminal.filter(r => r.triggered_by === 'scheduled')
            : activeFilter === 'manual'    ? terminal.filter(r => r.triggered_by === 'manual')
            : activeFilter === 'failed'    ? terminal.filter(r => r.status === 'email_failed' || r.status === 'failed')
            : terminal

        return filtered.map((report, ri) => ({
            ...report,
            _color:      GROUP_COLORS[ri % GROUP_COLORS.length],
            _recipients: report.recipients || [],
            _rowKey:     `${report.id}`,
        }))
    }, [reports, activeFilter])

    // ── columns ───────────────────────────────────────────────────────────────
    const columns = useMemo(() => [
        {
            id: 'group_bar',
            header: () => '',
            accessorKey: '_color',
            enableSorting: false,
            cell: (info) => (
                <div style={{ width: 4, minHeight: 44, background: info.row.original._color, borderRadius: '3px 0 0 3px' }} />
            ),
            meta: { headerClassName: 'width-30', className: 'p-0' },
        },
        {
            id: 'report',
            header: () => 'Report',
            accessorKey: 'report_type',
            cell: (info) => {
                const row = info.row.original
                const name = REPORT_TYPE_LABELS[row.report_type] || row.report_name || row.report_type || 'PPE Detection Report'
                return (
                    <span className="proj-meta d-inline-flex align-items-center gap-1">
                        <span className="proj-meta-text text-truncate-1-line" style={{ maxWidth: 260 }} title={name}>
                            {name}
                        </span>
                    </span>
                )
            },
            meta: { headerClassName: 'rpt-th rpt-col-report', className: 'rpt-td rpt-col-report' },
        },
        {
            id: 'triggered_by',
            header: () => 'Triggered By',
            accessorKey: 'triggered_by',
            cell: (info) => {
                const row = info.row.original
                return (
                    <span className="badge bg-soft-warning text-warning fs-11 fw-bold text-uppercase">
                        {row.triggered_by === 'scheduled' ? 'Scheduled' : 'Manual'}
                    </span>
                )
            },
            meta: { headerClassName: 'rpt-th rpt-col-trigger', className: 'rpt-td rpt-col-trigger' },
        },
        {
            id: 'dispatch_status',
            header: () => 'Dispatch Status',
            accessorKey: 'status',
            cell: (info) => {
                const map = {
                    generating:   { label: 'Generating',  cls: 'bg-soft-primary text-primary'     },
                    pending:      { label: 'Pending',      cls: 'bg-soft-secondary text-secondary' },
                    ready:        { label: 'Ready',        cls: 'bg-soft-success text-success'     },
                    emailed:      { label: 'Delivered',    cls: 'bg-soft-success text-success'     },
                    failed:       { label: 'Failed',       cls: 'bg-soft-danger text-danger'       },
                    email_failed: { label: 'Email Failed', cls: 'bg-soft-warning text-warning'     },
                }
                const m = map[info.row.original.status] || { label: info.row.original.status, cls: 'bg-soft-secondary text-secondary' }
                return <span className={`badge ${m.cls} fs-11 fw-bold text-uppercase`}>{m.label}</span>
            },
            meta: { headerClassName: 'rpt-th rpt-col-status', className: 'rpt-td rpt-col-status' },
        },
        {
            id: 'recipient',
            header: () => 'Recipients',
            accessorKey: '_recipients',
            enableSorting: false,
            cell: (info) => {
                const row = info.row.original
                const recs = row._recipients
                if (recs.length === 0) return (
                    <span className="text-muted fst-italic" style={{ fontSize: 12 }}>
                        {row.status === 'failed' ? 'Not delivered' : 'No recipients'}
                    </span>
                )
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {recs.map(rec => (
                            <span key={rec.id || rec.email} className="inv-meta" title={rec.full_name || rec.email}>
                                <FiUser size={12} className="opacity-75 flex-shrink-0" />
                                <span className="inv-meta-text">{rec.email}</span>
                            </span>
                        ))}
                    </div>
                )
            },
            meta: { searchable: false, headerClassName: 'rpt-th rpt-col-recipient', className: 'rpt-td rpt-col-recipient' },
        },
        {
            id: 'role',
            header: () => 'Role',
            accessorKey: '_recipients',
            enableSorting: false,
            cell: (info) => {
                const recs = info.row.original._recipients
                if (recs.length === 0) return null
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {recs.map(rec => (
                            <span key={rec.id || rec.email} className="badge bg-soft-info text-info fs-11 fw-bold">
                                {ROLE_LABELS[rec.role] || rec.role || '—'}
                            </span>
                        ))}
                    </div>
                )
            },
            meta: { headerClassName: 'rpt-th rpt-col-role', className: 'rpt-td rpt-col-role' },
        },
        {
            id: 'delivered_at',
            header: () => 'Delivered At',
            accessorKey: '_recipients',
            enableSorting: false,
            cell: (info) => {
                const recs = info.row.original._recipients
                if (recs.length === 0) return null
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {recs.map(rec => (
                            <span key={rec.id || rec.email} className="inv-meta rpt-one-line">
                                <FiClock size={12} className="opacity-75 flex-shrink-0" />
                                <span className="inv-meta-text">{rec.delivered_at ? formatDate(rec.delivered_at) : '—'}</span>
                            </span>
                        ))}
                    </div>
                )
            },
            meta: { headerClassName: 'rpt-th rpt-col-delivered', className: 'rpt-td rpt-col-delivered' },
        },
        {
            id: 'delivery',
            header: () => 'Delivery',
            accessorKey: '_recipients',
            enableSorting: false,
            cell: (info) => {
                const recs = info.row.original._recipients
                if (recs.length === 0) return null
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {recs.map(rec => (
                            <span key={rec.id || rec.email} className={`badge ${rec.delivered ? 'bg-soft-success text-success' : 'bg-soft-danger text-danger'} fs-11 fw-bold text-uppercase`}>
                                {rec.delivered ? 'Delivered' : 'Failed'}
                            </span>
                        ))}
                    </div>
                )
            },
            meta: { headerClassName: 'rpt-th rpt-col-delivery', className: 'rpt-td rpt-col-delivery' },
        },
        {
            id: 'actions',
            header: () => 'Actions',
            accessorKey: 'id',
            enableSorting: false,
            cell: (info) => {
                const row = info.row.original
                const canResend = ['emailed', 'email_failed', 'ready'].includes(row.status)

                const viewBtn = row.has_file ? (
                    <button
                        className="avatar-text avatar-md"
                        title="View PDF"
                        onClick={() => handleView(row)}
                    >
                        <FiEye size={15} />
                    </button>
                ) : null

                const menuItems = []
                if (row.has_file) {
                    menuItems.push({ label: 'Download', icon: <FiDownload />, onClick: () => handleDownload(row) })
                }
                if (canResend) {
                    menuItems.push({
                        label: 'Resend to All',
                        icon: <FiRefreshCw />,
                        loading: resendingId === row.id,
                        disabled: resendingId === row.id,
                        onClick: () => handleResend(row),
                    })
                }

                return (
                    <div className="hstack gap-2 justify-content-end">
                        {viewBtn}
                        {menuItems.length > 0 && <ActionsMenu items={menuItems} />}
                    </div>
                )
            },
            meta: { headerClassName: 'rpt-th rpt-col-actions text-end', className: 'rpt-td rpt-col-actions text-end', headerAlign: 'end' },
        },
    ], [handleDownload, handleResend, handleView, resendingId])

    // ── filter dropdown items ─────────────────────────────────────────────────
    const filterItems = [
        { label: 'All',          icon: <FiFileText /> },
        { label: 'Scheduled',    icon: <FiClock /> },
        { label: 'Manual',       icon: <FiUser /> },
        { label: 'Email Failed', icon: <FiAlertCircle /> },
    ]

    const filterMap = { all: 'All', scheduled: 'Scheduled', manual: 'Manual', failed: 'Email Failed' }
    const activeFilterLabel = filterMap[activeFilter] || 'All'

    const handleFilterClick = (label) => {
        const m = { 'All': 'all', 'Scheduled': 'scheduled', 'Manual': 'manual', 'Email Failed': 'failed' }
        setActiveFilter(m[label] || 'all')
    }

    if (!roleChecked) return <PageLoader minHeight="60vh" />

    if (!isPM) return (
        <>
            <PageHeader />
            <div className="main-content">
                <div className="card stretch stretch-full">
                    <div className="card-body d-flex flex-column align-items-center justify-content-center py-5 text-muted gap-3">
                        <FiBarChart size={40} className="opacity-25" />
                        <div className="text-center">
                            <div className="fw-semibold mb-1">Access Restricted</div>
                            <div className="fs-12">
                                The Report Delivery Log is only accessible to the Project Manager.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )

    if (loading) return <PageLoader minHeight="60vh" />

    return (
        <>
            <PageHeader>
                <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                    <button
                        type="button"
                        className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                        data-bs-toggle="collapse"
                        data-bs-target="#collapseReports"
                        aria-expanded={statsOpen}
                        aria-controls="collapseReports"
                    >
                        <FiBarChart size={16} />
                    </button>
                    <Dropdown
                        dropdownItems={filterItems}
                        triggerPosition="0, 12"
                        triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                        triggerClass="btn btn-icon btn-light-brand"
                        isAvatar={false}
                        onClick={handleFilterClick}
                        active={activeFilterLabel}
                        dataBsToggle=""
                    />
                </div>
            </PageHeader>

            <div className="px-3 pt-3">
                <ReportSchedulerBar projectId={projectId} myRole="project_manager" />
            </div>

            <ReportStatsCards projectId={projectId} nonce={statsNonce} />

            {generatingBanner && (
                <div className="mx-3 mt-3 px-3 py-2 rounded d-flex align-items-center gap-3"
                     style={{ background: 'rgba(91,141,238,0.08)', border: '1px solid rgba(91,141,238,0.2)', fontSize: 13 }}>
                    <div className="spinner-border spinner-border-sm text-primary flex-shrink-0" style={{ width: 14, height: 14, borderWidth: '2px' }} />
                    <div>
                        <span className="text-white fw-semibold">Generating report</span>
                        <span className="text-muted ms-2">{formatPeriod(generatingBanner.period_label)}</span>
                        {generatingBanner.expected_recipients?.length > 0 && (
                            <span className="text-muted ms-2">— emailing {generatingBanner.expected_recipients.length} recipient{generatingBanner.expected_recipients.length !== 1 ? 's' : ''}</span>
                        )}
                    </div>
                </div>
            )}

            <div className="main-content">
                <div className="row">
                    <style>{`
                        #reportDeliveryLog-${projectId} {
                            width: 100% !important;
                            min-width: 100% !important;
                            table-layout: fixed !important;
                        }
                        #reportDeliveryLog-${projectId} thead th {
                            text-transform: uppercase;
                            letter-spacing: 0.06em;
                            font-size: 11px;
                            font-weight: 700;
                        }
                        html.app-skin-dark #reportDeliveryLog-${projectId} thead th {
                            color: rgba(255,255,255,0.78);
                        }
                        #reportDeliveryLog-${projectId} thead th:last-child {
                            text-align: right;
                            padding-right: 10px !important;
                        }
                        #reportDeliveryLog-${projectId} tbody td {
                            font-size: 13px;
                            vertical-align: middle;
                            padding-top: 12px;
                            padding-bottom: 12px;
                            padding-left: 10px;
                            padding-right: 10px;
                        }
                        #reportDeliveryLog-${projectId} .rpt-one-line {
                            display: inline-block;
                            max-width: 100%;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            vertical-align: bottom;
                        }
                        #reportDeliveryLog-${projectId} .rpt-col-no       { width: 46px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-report   { width: 200px; }
                        #reportDeliveryLog-${projectId} .rpt-col-trigger  { width: 90px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-status   { width: 120px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-recipient { width: 190px; }
                        #reportDeliveryLog-${projectId} .rpt-col-role     { width: 110px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-delivered { width: 135px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-generated { width: 135px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-delivery { width: 100px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .rpt-col-actions  { width: 78px; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .inv-meta { display: inline-flex; align-items: center; gap: 6px; min-width: 0; width: 100%; }
                        #reportDeliveryLog-${projectId} .inv-meta-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                        #reportDeliveryLog-${projectId} .proj-meta { min-width: 0; }
                        #reportDeliveryLog-${projectId} .proj-meta-text { min-width: 0; }
                    `}</style>
                    <Table tableId={`reportDeliveryLog-${projectId}`} data={flatRows} columns={columns} />
                </div>
            </div>

            <Footer />
        </>
    )
}

export default ProjectReportsContent
