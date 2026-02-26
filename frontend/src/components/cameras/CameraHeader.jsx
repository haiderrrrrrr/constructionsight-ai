import React, { useEffect, useState } from 'react'
import { FiActivity, FiAlertCircle, FiArchive, FiBarChart, FiCamera, FiCheck, FiCheckCircle, FiEdit3, FiEye, FiFilter, FiPaperclip, FiUserCheck, FiUserMinus, FiWifiOff } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypeExe, BsFiletypePdf, BsFiletypeTsx, BsFiletypeXml, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const CameraHeader = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const isHealthPage = location.pathname.includes('/cameras/health')
    const isAddPage = location.pathname.endsWith('/cameras/add')
    const isVerifyPage = /\/cameras\/\d+\/verify$/.test(location.pathname)
    const [statsOpen, setStatsOpen] = useState(true)
    const currentFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    useEffect(() => {
        const p = new URLSearchParams(location.search)
        if (!p.has('filter')) return
        p.delete('filter')
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
    }, [])

    useEffect(() => {
        const el = document.getElementById('collapseOne')
        if (!el) return

        const onShown = () => setStatsOpen(true)
        const onHidden = () => setStatsOpen(false)
        el.addEventListener('shown.bs.collapse', onShown)
        el.addEventListener('hidden.bs.collapse', onHidden)

        setStatsOpen(el.classList.contains('show'))
        return () => {
            el.removeEventListener('shown.bs.collapse', onShown)
            el.removeEventListener('hidden.bs.collapse', onHidden)
        }
    }, [])

    const setFilter = (next) => {
        const p = new URLSearchParams(location.search)
        const value = String(next || '').toLowerCase()
        if (!value || value === 'all') p.delete('filter')
        else p.set('filter', value)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    const filterItems = isHealthPage
        ? [
            { label: 'All', icon: <FiEye /> },
            { label: 'Healthy', icon: <FiCheckCircle /> },
            { label: 'Degraded', icon: <FiAlertCircle /> },
            { label: 'Offline', icon: <FiWifiOff /> },
            { label: 'Maintenance', icon: <FiActivity /> },
        ]
        : [
            { label: 'All', icon: <FiEye /> },
            { label: 'Verified', icon: <FiCheckCircle /> },
            { label: 'Draft', icon: <FiEdit3 /> },
            { label: 'Archived', icon: <FiArchive /> },
            { label: 'Assigned', icon: <FiUserCheck /> },
            { label: 'Unassigned', icon: <FiUserMinus /> },
        ]

    const activeFilterLabel = (() => {
        const map = {
            all: 'All',
            healthy: 'Healthy',
            degraded: 'Degraded',
            offline: 'Offline',
            maintenance: 'Maintenance',
            verified: 'Verified',
            draft: 'Draft',
            archived: 'Archived',
            assigned: 'Assigned',
            unassigned: 'Unassigned',
        }
        return map[currentFilter] || 'All'
    })()

    const fileType = [
        { label: "PDF", icon: <BsFiletypePdf /> },
        { label: "CSV", icon: <BsFiletypeCsv /> },
        { label: "XML", icon: <BsFiletypeXml /> },
        { label: "Text", icon: <BsFiletypeTsx /> },
        { label: "Excel", icon: <BsFiletypeExe /> },
        { label: "Print", icon: <BsPrinter /> },
    ]

    const handleFilterClick = (label) => {
        const v = String(label || '').toLowerCase()
        const allowed = new Set(filterItems.map(x => String(x.label).toLowerCase()))
        if (!allowed.has(v)) return
        setFilter(v)
        window.dispatchEvent(new Event('cs:close-right-panel'))
    }

    const handleFileClick = (label) => {
        const v = String(label || '').toLowerCase()
        window.dispatchEvent(new CustomEvent('cs:cameras-export', { detail: { page: isHealthPage ? 'health' : 'list', format: v } }))
        window.dispatchEvent(new Event('cs:close-right-panel'))
    }

    return (
        <>
            <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                {!isVerifyPage ? (
                    <>
                        <button
                            type="button"
                            className={`btn btn-icon btn-light-brand d-inline-flex align-items-center gap-2 ${statsOpen ? 'active' : ''}`}
                            data-bs-toggle="collapse"
                            data-bs-target="#collapseOne"
                            aria-expanded={statsOpen ? 'true' : 'false'}
                            aria-controls="collapseOne"
                            onClick={() => window.dispatchEvent(new Event('cs:close-right-panel'))}
                        >
                            <FiBarChart size={16} />
                            <span className="d-inline d-md-none">Statistics</span>
                        </button>
                        <Dropdown
                            dropdownItems={filterItems}
                            triggerPosition={"0, 12"}
                            triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                            triggerClass='btn btn-icon btn-light-brand'
                            triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
                            isAvatar={false}
                            onClick={handleFilterClick}
                            active={activeFilterLabel}
                            dataBsToggle=""
                        />
                        <Dropdown
                            dropdownItems={fileType}
                            triggerPosition={"0, 12"}
                            triggerIcon={<FiPaperclip size={16} strokeWidth={1.6} />}
                            triggerClass='btn btn-icon btn-light-brand'
                            triggerText={<span className="d-inline d-md-none ms-2">Export</span>}
                            iconStrokeWidth={0}
                            isAvatar={false}
                            onClick={handleFileClick}
                            dataBsToggle=""
                        />
                    </>
                ) : null}
                {isAddPage ? (
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => { document.getElementById('camera-add-form')?.requestSubmit(); window.dispatchEvent(new Event('cs:close-right-panel')) }}
                    >
                        <FiCheck size={16} className="me-2" strokeWidth={1.8} />
                        <span>Save Camera</span>
                    </button>
                ) : (
                    <Link to="/admin/cameras/add" className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('cs:close-right-panel'))}>
                        <FiCamera size={16} className="me-2" strokeWidth={1.8} />
                        <span>Add Camera</span>
                    </Link>
                )}
            </div>
        </>
    )
}

export default CameraHeader

export const CameraHeaderContent = () => {
    const location = useLocation()
    const isHealthPage = location.pathname.includes('/cameras/health')
    const [summary, setSummary] = useState({ total: 0, healthy: 0, degraded: 0, offline: 0, maintenance: 0 })
    const [registry, setRegistry] = useState({ total: 0, verified: 0, draft: 0, archived: 0 })
    const [useEventRegistry, setUseEventRegistry] = useState(false)
    const [useEventHealth, setUseEventHealth] = useState(false)
    const [statsNonce, setStatsNonce] = useState(0)

    useEffect(() => {
        const handler = () => setStatsNonce(v => v + 1)
        const onStats = (payload) => {
            if (isHealthPage) return
            const d = payload || {}
            setRegistry({
                total: Number(d.total || 0),
                verified: Number(d.verified || 0),
                draft: Number(d.draft || 0),
                archived: Number(d.archived || 0),
            })
            setUseEventRegistry(true)
        }
        const onHealthStats = (payload) => {
            if (!isHealthPage) return
            const d = payload || {}
            setSummary({
                total: Number(d.total || 0),
                healthy: Number(d.healthy || 0),
                degraded: Number(d.degraded || 0),
                offline: Number(d.offline || 0),
                maintenance: Number(d.maintenance || 0),
            })
            setUseEventHealth(true)
        }
        window.addEventListener('cs:cameras-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:cameras-stats-refresh', handler)
        const unsubStats = onBroadcast('cs:cameras-stats', onStats)
        const unsubHealthStats = onBroadcast('cs:cameras-health-stats', onHealthStats)
        return () => {
            window.removeEventListener('cs:cameras-stats-refresh', handler)
            unsubBroadcast()
            unsubStats()
            unsubHealthStats()
        }
    }, [isHealthPage])

    useEffect(() => {
        let active = true
        if (isHealthPage) {
            if (useEventHealth) return () => { active = false }
            apiGet('/admin/cameras/health')
                .then(data => { if (active && data) setSummary(data) })
                .catch(() => {})
            return () => { active = false }
        }

        if (useEventRegistry) return () => { active = false }
        apiGet('/admin/cameras')
            .then((data) => {
                if (!active) return
                const cameras = Array.isArray(data) ? data : []
                const normStatus = (s) => String(s?.content || s || '').toLowerCase()
                const total = cameras.length
                const archived = cameras.filter(c => !!c.archived_at || normStatus(c.registry_status) === 'archived').length
                const verified = cameras.filter(c => normStatus(c.registry_status) === 'verified').length
                const draft = cameras.filter(c => normStatus(c.registry_status) === 'draft').length
                setRegistry({ total, verified, draft, archived })
            })
            .catch(() => {})

        return () => { active = false }
    }, [isHealthPage, statsNonce, useEventRegistry, useEventHealth])

    const statisticsData = isHealthPage
        ? [
            { icon: 'feather-camera', number: String(summary.total || 0), title: 'Total Cameras', color: 'primary' },
            { icon: 'feather-check-circle', number: String(summary.healthy || 0), title: 'Healthy', color: 'success' },
            { icon: 'feather-activity', number: String(summary.degraded || 0), title: 'Degraded Performance', color: 'warning' },
            { icon: 'feather-alert-circle', number: String(summary.offline || 0), title: 'Offline', color: 'danger' },
        ]
        : [
            { icon: 'feather-camera', number: String(registry.total || 0), title: 'Total Cameras', color: 'primary' },
            { icon: 'feather-check-circle', number: String(registry.verified || 0), title: 'Verified', color: 'success' },
            { icon: 'feather-edit', number: String(registry.draft || 0), title: 'Draft', color: 'warning' },
            { icon: 'feather-archive', number: String(registry.archived || 0), title: 'Archived', color: 'danger' },
        ]

    return (
        <div id="collapseOne" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {statisticsData.map(({ icon, number, title, color }, index) => (
                        <div key={index} className="col-xxl-3 col-md-6">
                            <div className={`card bg-${color} border-${color} text-white overflow-hidden`}>
                                <div className="card-body">
                                    <i className={`fs-20`}>{getIcon(icon)}</i>
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
