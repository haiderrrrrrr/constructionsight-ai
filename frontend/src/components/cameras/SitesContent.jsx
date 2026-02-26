import React, { useEffect, useMemo, useState } from 'react'
import { FiMapPin, FiPlus, FiTrash2 } from 'react-icons/fi'
import PageLoader from '@/components/shared/PageLoader'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Table from '@/components/shared/table/Table'
import { apiGet, apiPost, apiDelete } from '@/utils/api'
import { parseApiError } from '@/utils/errorHandler'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'

const SitesContent = () => {
    const [sites, setSites] = useState([])
    const [loading, setLoading] = useState(true)
    const [form, setForm] = useState({ name: '', location: '' })
    const [saving, setSaving] = useState(false)
    const [confirm, setConfirm] = useState(null)
    const [deletingId, setDeletingId] = useState(null)

    const load = () => {
        setLoading(true)
        apiGet('/admin/sites')
            .then(data => setSites(Array.isArray(data) ? data : []))
            .catch(() => topTostError('Failed to load sites.'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { load() }, [])

    const handleAdd = async (e) => {
        e.preventDefault()
        if (!form.name.trim()) return topTostError('Site name is required.')
        setSaving(true)
        try {
            await apiPost('/admin/sites', { name: form.name.trim(), location: form.location.trim() || undefined })
            topTost('Site created.')
            setForm({ name: '', location: '' })
            load()
        } catch (err) {
            topTostError(parseApiError(err))
        } finally {
            setSaving(false)
        }
    }

    const askDelete = (site) => {
        setConfirm({
            variant: 'delete',
            site,
            title: 'Delete Site',
            message: `"${site.name}" will be permanently deleted. This cannot be undone.`,
        })
    }

    const handleDelete = async (site) => {
        setDeletingId(site.id)
        try {
            await apiDelete(`/admin/sites/${site.id}`)
            topTost(`Site "${site.name}" deleted.`)
            load()
        } catch (err) {
            topTostError(parseApiError(err))
        } finally {
            setDeletingId(null)
            setConfirm(null)
        }
    }

    const columns = useMemo(() => ([
        {
            accessorKey: 'name',
            header: () => 'Site Name',
            cell: (info) => (
                <span className="fw-semibold">
                    <FiMapPin size={12} className="me-1 text-muted" />
                    {info.getValue()}
                </span>
            ),
        },
        {
            accessorKey: 'location',
            header: () => 'Location / Address',
            cell: (info) => <span className="text-muted fs-12">{info.getValue() || '—'}</span>,
        },
        {
            accessorKey: 'created_at',
            header: () => 'Created',
            cell: (info) => <span className="text-muted fs-12">{info.getValue() ? new Date(info.getValue()).toLocaleDateString() : '—'}</span>,
        },
        {
            accessorKey: 'actions',
            header: () => 'Action',
            cell: (info) => {
                const site = info.row.original
                const busy = deletingId === site.id
                return (
                    <div className="d-flex justify-content-end">
                        <button
                            className="btn btn-xs btn-light-brand text-danger"
                            onClick={() => askDelete(site)}
                            title="Delete site"
                            disabled={busy}
                        >
                            {busy ? <span className="spinner-border spinner-border-sm" role="status" /> : <FiTrash2 size={12} />}
                        </button>
                    </div>
                )
            },
            enableSorting: false,
            meta: { headerClassName: 'text-end sites-col-actions', className: 'text-end sites-col-actions', headerAlign: 'end' },
        },
    ]), [deletingId])

    return (
        <>
            <div className="row g-4">
                <div className="col-xl-4">
                    <div className="card stretch stretch-full">
                        <div className="card-header">
                            <h5 className="mb-0">Add Construction Site</h5>
                        </div>
                        <div className="card-body">
                            <p className="fs-12 text-muted mb-4">
                                Construction sites are physical locations where cameras are deployed and projects are run. Create a site here, then link it when adding cameras or creating projects.
                            </p>
                            <form onSubmit={handleAdd}>
                                <div className="mb-3">
                                    <label className="form-label">Site Name <span className="text-danger">*</span></label>
                                    <div className="input-group">
                                        <div className="input-group-text"><FiMapPin size={14} /></div>
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="e.g. Downtown Tower A"
                                            value={form.name}
                                            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                                            maxLength={300}
                                        />
                                    </div>
                                </div>
                                <div className="mb-4">
                                    <label className="form-label">Location / Address</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="e.g. Sector H-13, Islamabad"
                                        value={form.location}
                                        onChange={e => setForm(p => ({ ...p, location: e.target.value }))}
                                        maxLength={500}
                                    />
                                </div>
                                <button type="submit" className="btn btn-primary w-100" disabled={saving}>
                                    {saving
                                        ? <><span className="spinner-border spinner-border-sm me-2" role="status" />Saving...</>
                                        : <><FiPlus size={14} className="me-1" />Add Site</>
                                    }
                                </button>
                            </form>
                        </div>
                    </div>
                </div>

                <div className="col-xl-8">
                    <div className="card stretch stretch-full">
                        <div className="card-header">
                            <h5 className="mb-0">Construction Sites</h5>
                            <span className="badge badge-soft-primary">{sites.length} site{sites.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="card-body p-0">
                            {loading ? (
                                <PageLoader />
                            ) : sites.length === 0 ? (
                                <div className="text-center py-5 text-muted">
                                    <FiMapPin size={32} className="mb-2 opacity-40" />
                                    <p className="fs-12 mb-0">No sites yet. Add your first construction site.</p>
                                </div>
                            ) : (
                                <div style={{ padding: '16px 0' }}>
                                    <style>{`
                                        #cameraSitesList { table-layout: auto; min-width: 100%; }
                                        #cameraSitesList .sites-col-actions { min-width: 90px; }
                                    `}</style>
                                    <Table
                                        data={sites}
                                        columns={columns}
                                        searchKeys={['name', 'location', 'created_at']}
                                        disableDefaultSorting={true}
                                        tableId="cameraSitesList"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmDialog
                open={!!confirm}
                variant={confirm?.variant}
                title={confirm?.title}
                message={confirm?.message}
                loading={deletingId === confirm?.site?.id}
                onClose={() => setConfirm(null)}
                onConfirm={() => handleDelete(confirm.site)}
            />
        </>
    )
}

export default SitesContent
