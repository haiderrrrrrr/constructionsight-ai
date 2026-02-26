import React, { useEffect, useState } from 'react'
import { FiActivity, FiAlertCircle, FiArchive, FiBarChart, FiCamera, FiCheckCircle, FiEdit3, FiEye, FiFilter, FiPaperclip, FiWifiOff } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypeExe, BsFiletypePdf, BsFiletypeTsx, BsFiletypeXml, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const filterItems = [
    { label: 'All',        icon: <FiEye /> },
    { label: 'Verified',   icon: <FiCheckCircle /> },
    { label: 'Draft',      icon: <FiEdit3 /> },
    { label: 'Healthy',    icon: <FiActivity /> },
    { label: 'Offline',    icon: <FiWifiOff /> },
    { label: 'Unassigned', icon: <FiAlertCircle /> },
]

const fileType = [
    { label: 'PDF',   icon: <BsFiletypePdf /> },
    { label: 'CSV',   icon: <BsFiletypeCsv /> },
    { label: 'XML',   icon: <BsFiletypeXml /> },
    { label: 'Text',  icon: <BsFiletypeTsx /> },
    { label: 'Excel', icon: <BsFiletypeExe /> },
    { label: 'Print', icon: <BsPrinter /> },
]

const ProjectCamerasHeader = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const [statsOpen, setStatsOpen] = useState(true)

    // Reset filter to 'all' on page mount
    useEffect(() => {
        const p = new URLSearchParams(location.search)
        if (!p.has('filter')) return
        p.delete('filter')
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
    }, [])

    useEffect(() => {
        const el = document.getElementById('collapseProjectCameras')
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

    const currentFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()
    const activeFilterLabel = filterItems.find(f => f.label.toLowerCase() === currentFilter)?.label || 'All'

    const setFilter = (label) => {
        const v = String(label || '').toLowerCase()
        const p = new URLSearchParams(location.search)
        if (!v || v === 'all') p.delete('filter')
        else p.set('filter', v)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    const handleFilterClick = (label) => {
        const v = String(label || '').toLowerCase()
        const allowed = new Set(filterItems.map(x => x.label.toLowerCase()))
        if (!allowed.has(v)) return
        setFilter(label)
    }

    const handleFileExport = (label) => {
        window.dispatchEvent(new CustomEvent('cs:project-cameras-export', { detail: { format: String(label).toLowerCase() } }))
    }

    const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
            <button
                type="button"
                className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                data-bs-toggle="collapse"
                data-bs-target="#collapseProjectCameras"
                aria-expanded={statsOpen ? 'true' : 'false'}
                aria-controls="collapseProjectCameras"
                onClick={closePanel}
            >
                <FiBarChart size={16} />
                <span className="d-inline d-md-none ms-2">Statistics</span>
            </button>
            <Dropdown
                dropdownItems={filterItems}
                triggerPosition="0, 12"
                triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                triggerClass="btn btn-icon btn-light-brand"
                triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
                isAvatar={false}
                onClick={(label) => { handleFilterClick(label); closePanel() }}
                active={activeFilterLabel}
                dataBsToggle=""
            />
            <Dropdown
                dropdownItems={fileType}
                triggerPosition="0, 12"
                triggerIcon={<FiPaperclip size={16} strokeWidth={1.6} />}
                triggerClass="btn btn-icon btn-light-brand"
                triggerText={<span className="d-inline d-md-none ms-2">Export</span>}
                iconStrokeWidth={0}
                isAvatar={false}
                onClick={(label) => { handleFileExport(label); closePanel() }}
                dataBsToggle=""
            />
        </div>
    )
}

export default ProjectCamerasHeader

export const ProjectCamerasHeaderContent = () => {
    const { projectId } = useParams()
    const [stats, setStats] = useState({ total: 0, verified: 0, healthy: 0, offline: 0 })
    const [useEventStats, setUseEventStats] = useState(false)

    useEffect(() => {
        const onStats = (payload) => {
            const d = payload || {}
            setStats({
                total: Number(d.total || 0),
                verified: Number(d.verified || 0),
                healthy: Number(d.healthy || 0),
                offline: Number(d.offline || 0),
            })
            setUseEventStats(true)
        }
        const unsubStats = onBroadcast('cs:project-cameras-stats', onStats)
        return () => { unsubStats() }
    }, [])

    useEffect(() => {
        if (useEventStats) return
        let active = true
        apiGet(`/projects/${projectId}/cameras`)
            .then(data => {
                if (!active) return
                const cameras = Array.isArray(data) ? data : []
                const normStatus = (s) => String(s?.content || s || '').toLowerCase()
                setStats({
                    total:      cameras.length,
                    verified:   cameras.filter(c => normStatus(c.registry_status) === 'verified').length,
                    healthy:    cameras.filter(c => String(c.latest_health_status?.value || c.latest_health_status || '').toLowerCase() === 'healthy').length,
                    offline:    cameras.filter(c => String(c.latest_health_status?.value || c.latest_health_status || '').toLowerCase() === 'offline').length,
                })
            })
            .catch(() => {})
        return () => { active = false }
    }, [projectId, useEventStats])

    const statisticsData = [
        { icon: 'feather-camera',        number: String(stats.total),      title: 'Total Cameras', color: 'primary' },
        { icon: 'feather-check-circle',  number: String(stats.verified),   title: 'Verified',      color: 'success' },
        { icon: 'feather-activity',      number: String(stats.healthy),    title: 'Healthy',       color: 'warning' },
        { icon: 'feather-alert-circle',  number: String(stats.offline),    title: 'Offline',       color: 'danger'  },
    ]

    return (
        <div id="collapseProjectCameras" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {statisticsData.map(({ icon, number, title, color }) => (
                        <div key={title} className="col-xxl-3 col-md-6">
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
