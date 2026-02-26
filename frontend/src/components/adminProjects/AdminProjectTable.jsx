import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiArchive, FiEye, FiMoreHorizontal, FiMapPin, FiBriefcase, FiCalendar, FiRefreshCw } from 'react-icons/fi'
import Dropdown from '@/components/shared/Dropdown'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { apiGet, apiPatch } from '@/utils/api'
import { broadcastRefresh } from '@/utils/broadcast'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import Table from '@/components/shared/table/Table'

const STATUS_BADGE = {
    draft:              { cls: 'bg-soft-secondary text-muted', label: 'Draft' },
    setup_in_progress:  { cls: 'bg-soft-warning text-warning', label: 'Setup' },
    active:             { cls: 'bg-soft-success text-success', label: 'Active' },
    archived:           { cls: 'bg-soft-dark text-dark',       label: 'Archived' },
}

const StatusBadge = ({ status }) => {
    const key = String(status || 'draft').toLowerCase().replace(/\s+/g, '_')
    const map = {
        draft:              { cls: 'bg-soft-secondary text-muted', label: 'Draft' },
        setup_in_progress:  { cls: 'bg-soft-warning text-warning', label: 'Setup' },
        active:             { cls: 'bg-soft-success text-success', label: 'Active' },
        archived:           { cls: 'bg-soft-dark text-dark',       label: 'Archived' },
    }
    const cfg = map[key] || map.draft
    return (
        <span className={`badge ${cfg.cls} fs-11 fw-bold text-uppercase`}>
            {cfg.label}
        </span>
    )
}

const AdminProjectTable = () => {
    const [projects, setProjects] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)
    const [archivingId, setArchivingId] = useState(null)
    const [confirm, setConfirm] = useState(null)

    const load = useCallback(() => {
        setLoading(true)
        setFetchError(null)
        apiGet('/admin/projects')
            .then(data => setProjects(data || []))
            .catch(() => setFetchError('Failed to load projects.'))
            .finally(() => setLoading(false))
    }, [])

    useEffect(() => { load() }, [load])

    const handleArchive = async (projectId, projectName) => {
        setArchivingId(projectId)
        try {
            await apiPatch(`/admin/projects/${projectId}/status`, { status: 'archived' })
            setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'archived' } : p))
            broadcastRefresh('cs:projects-stats-refresh')
            topTost(`Project "${projectName}" archived.`)
            setConfirm(null)
        } catch (err) {
            topTostError(parseApiError(err, 'Failed to archive project'))
        } finally {
            setArchivingId(null)
        }
    }

    const askArchive = (projectId, projectName) => {
        setConfirm({
            variant: 'archive',
            projectId,
            projectName,
            title: 'Archive Project',
            message: `"${projectName}" will be archived and removed from active use. You can restore it later.`,
        })
    }

    const getActions = (p) => {
        const items = [
            { label: 'View Details', icon: <FiEye />, onClick: () => {} },
        ]
        if (p.status === 'active') {
            items.push({ type: 'divider' })
            items.push({ label: archivingId === p.id ? 'Archiving...' : 'Archive', icon: <FiArchive />, onClick: () => askArchive(p.id, p.name) })
        }
        return items
    }

    const columns = [
        {
            accessorKey: 'id',
            header: ({ table }) => {
                const checkboxRef = useRef(null)
                useEffect(() => {
                    if (checkboxRef.current) checkboxRef.current.indeterminate = table.getIsSomeRowsSelected()
                }, [table.getIsSomeRowsSelected()])
                return (
                    <input type="checkbox" className="custom-table-checkbox"
                        ref={checkboxRef}
                        checked={table.getIsAllRowsSelected()}
                        onChange={table.getToggleAllRowsSelectedHandler()} />
                )
            },
            cell: ({ row }) => (
                <input type="checkbox" className="custom-table-checkbox"
                    checked={row.getIsSelected()}
                    disabled={!row.getCanSelect()}
                    onChange={row.getToggleSelectedHandler()} />
            ),
            meta: { headerClassName: 'width-30' },
            enableSorting: false,
        },
        {
            accessorKey: 'name',
            header: () => 'Project Name',
            cell: ({ row }) => {
                const p = row.original
                return (
                    <Link to={`/admin/projects/${p.id}`} className="hstack gap-3 text-decoration-none">
                        <div className="flex-shrink-0 proj-logo-circle"
                            style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img
                                src={p.logo_url || '/images/icons/project-icon.png'}
                                alt={p.name}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }}
                            />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <span className="d-block fw-semibold text-truncate-1-line">{p.name || 'Untitled'}</span>
                            {p.description && (
                                <small className="fs-12 fw-normal text-muted d-block text-truncate-1-line" style={{ maxWidth: 340 }}>
                                    {p.description}
                                </small>
                            )}
                        </div>
                    </Link>
                )
            },
            meta: { className: 'project-name-td', searchable: true }
        },
        {
            accessorKey: 'location',
            header: () => 'Location',
            cell: ({ getValue }) => (
                <span className="d-inline-flex align-items-center gap-1 fs-12" style={{ color: 'var(--bs-secondary-color)' }}>
                    <FiMapPin size={12} className="opacity-75" />
                    <span className="text-truncate-1-line" style={{ maxWidth: 220 }}>{getValue()}</span>
                </span>
            ),
            meta: { searchable: true }
        },
        {
            accessorKey: 'client_name',
            header: () => 'Client',
            cell: ({ getValue }) => {
                const v = getValue()
                return v ? <span className="fs-12 fw-semibold" style={{ color: 'var(--bs-body-color)' }}>{v}</span> : <span className="text-muted fst-italic fs-12">—</span>
            },
            meta: { searchable: true }
        },
        {
            accessorKey: 'status',
            header: () => 'Status',
            cell: ({ getValue }) => <StatusBadge status={getValue()} />,
        },
        {
            accessorKey: 'start_date',
            header: () => 'Start Date',
            cell: ({ getValue }) => {
                const v = getValue()
                if (!v) return <span className="text-muted fs-12">—</span>
                return (
                    <span className="d-inline-flex align-items-center gap-1 fs-12" style={{ color: 'var(--bs-secondary-color)' }}>
                        <FiCalendar size={11} className="opacity-75" />
                        {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                )
            },
        },
        {
            accessorKey: 'end_date',
            header: () => 'Finish Date',
            cell: ({ getValue }) => {
                const v = getValue()
                if (!v) return <span className="text-muted fs-12">—</span>
                return (
                    <span className="d-inline-flex align-items-center gap-1 fs-12" style={{ color: 'var(--bs-secondary-color)' }}>
                        <FiCalendar size={11} className="opacity-75" />
                        {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                )
            },
        },
        {
            accessorKey: 'created_at',
            header: () => 'Created',
            cell: ({ getValue }) => {
                const v = getValue()
                if (!v) return '—'
                return (
                    <span className="d-inline-flex align-items-center gap-1 fs-12" style={{ color: 'var(--bs-secondary-color)' }}>
                        <FiCalendar size={11} className="opacity-75" />
                        {new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                )
            },
        },
        {
            accessorKey: 'actions',
            header: () => 'Actions',
            cell: ({ row }) => {
                const p = row.original
                return (
                    <div className="hstack gap-2 justify-content-end">
                        <Link to={`/admin/projects/${p.id}`} className="avatar-text avatar-md" title="View">
                            <FiEye size={16} />
                        </Link>
                        <Dropdown
                            dropdownItems={getActions(p)}
                            triggerPosition={"0,21"}
                            triggerIcon={<FiMoreHorizontal />}
                            triggerClass="avatar-md"
                            onClick={(label) => {
                                const item = getActions(p).find(a => a.label === label)
                                if (item?.onClick) item.onClick()
                            }}
                        />
                    </div>
                )
            },
            meta: { headerClassName: 'text-end' },
            enableSorting: false,
        },
    ]

    if (loading) return <PageLoader />

    if (fetchError) {
        return (
            <div className="col-lg-12">
                <div className="card stretch stretch-full">
                    <div className="card-body text-center py-5">
                        <div className="text-danger mb-3"><FiBriefcase size={40} opacity={0.3} /></div>
                        <p className="text-muted mb-3">{fetchError}</p>
                        <button className="btn btn-sm btn-outline-primary" onClick={load}>
                            <FiRefreshCw size={14} className="me-1" /> Retry
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (projects.length === 0) {
        return (
            <div className="col-lg-12">
                <div className="card stretch stretch-full">
                    <div className="card-body text-center py-5">
                        <div className="mb-3"><FiBriefcase size={48} className="text-muted" opacity={0.25} /></div>
                        <h6 className="fw-bold mb-1">No Projects Yet</h6>
                        <p className="fs-13 text-muted mb-3">Create your first project to get started.</p>
                        <Link to="/admin/projects/create" className="btn btn-primary">
                            Create First Project
                        </Link>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="col-lg-12">
                <div className="card stretch stretch-full function-table">
                    <div className="card-body p-0">
                        <div className="table-responsive">
                            <div className="dataTables_wrapper dt-bootstrap5 no-footer">
                                <Table data={projects} columns={columns} />
                            </div>
                            <style>{`
                                .proj-logo-circle { background: var(--bs-secondary-bg); }
                                html.app-skin-dark .proj-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }
                            `}</style>
                        </div>
                    </div>
                </div>
            </div>
            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant}
                title={confirm?.title}
                message={confirm?.message}
                loading={archivingId === confirm?.projectId}
                onClose={() => setConfirm(null)}
                onConfirm={() => handleArchive(confirm.projectId, confirm.projectName)}
            />
        </>
    )
}

export default AdminProjectTable
