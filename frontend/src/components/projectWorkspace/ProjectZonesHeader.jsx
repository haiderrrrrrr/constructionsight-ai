import React, { useEffect, useState } from 'react'
import { FiBarChart, FiFilter, FiLayers, FiPaperclip, FiPlus } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypeExe, BsFiletypePdf, BsFiletypeTsx, BsFiletypeXml, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const filterItems = [
    { label: 'All' },
    { label: 'Scaffold' },
    { label: 'Entry' },
    { label: 'Storage' },
    { label: 'Perimeter' },
    { label: 'Other' },
]

const fileType = [
    { label: 'PDF',   icon: <BsFiletypePdf /> },
    { label: 'CSV',   icon: <BsFiletypeCsv /> },
    { label: 'XML',   icon: <BsFiletypeXml /> },
    { label: 'Text',  icon: <BsFiletypeTsx /> },
    { label: 'Excel', icon: <BsFiletypeExe /> },
    { label: 'Print', icon: <BsPrinter /> },
]

const ProjectZonesHeader = ({ canWrite }) => {
    const location = useLocation()
    const navigate = useNavigate()
    const [statsOpen, setStatsOpen] = useState(true)

    useEffect(() => {
        const el = document.getElementById('collapseProjectZones')
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

    const handleFilterClick = (label) => setFilter(label)

    const handleFileExport = (label) => {
        window.dispatchEvent(new CustomEvent('cs:zones-export', { detail: { format: String(label).toLowerCase() } }))
    }

    const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
            <button
                type="button"
                className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                data-bs-toggle="collapse"
                data-bs-target="#collapseProjectZones"
                aria-expanded={statsOpen ? 'true' : 'false'}
                aria-controls="collapseProjectZones"
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
            {canWrite && (
                <button
                    type="button"
                    className="btn btn-primary d-inline-flex align-items-center gap-2"
                    onClick={() => { window.dispatchEvent(new Event('cs:open-add-zone-modal')); closePanel() }}
                >
                    <FiPlus size={16} strokeWidth={1.8} />
                    <span>Create Zone</span>
                </button>
            )}
        </div>
    )
}

export default ProjectZonesHeader

export const ProjectZonesHeaderContent = () => {
    const { projectId } = useParams()
    const [stats, setStats] = useState({ total: 0, assigned: 0, offline: 0, cameras: 0 })
    const [useEventStats, setUseEventStats] = useState(false)

    useEffect(() => {
        const onStats = (payload) => {
            const d = payload || {}
            setStats({
                total: Number(d.total || 0),
                assigned: Number(d.assigned || 0),
                offline: Number(d.offline || 0),
                cameras: Number(d.cameras || 0),
            })
            setUseEventStats(true)
        }
        const unsubStats = onBroadcast('cs:project-zones-stats', onStats)
        return () => { unsubStats() }
    }, [])

    useEffect(() => {
        if (useEventStats) return
        let active = true
        Promise.all([
            apiGet(`/projects/${projectId}/zones`),
            apiGet(`/projects/${projectId}/cameras`),
        ]).then(([zones, cameras]) => {
            if (!active) return
            const zns = Array.isArray(zones) ? zones : []
            const cams = Array.isArray(cameras) ? cameras : []
            const assigned = cams.filter(c => c.zone_id != null).length
            const normHealth = (s) => String(s?.value || s || '').toLowerCase()
            setStats({
                total: zns.length,
                assigned,
                offline: cams.filter(c => normHealth(c.latest_health_status) === 'offline').length,
                cameras: cams.length,
            })
        }).catch(() => {})
        return () => { active = false }
    }, [projectId, useEventStats])

    const statisticsData = [
        { icon: 'feather-layers',        number: String(stats.total),    title: 'Total Zones',    color: 'primary' },
        { icon: 'feather-camera',        number: String(stats.cameras),  title: 'Total Cameras',  color: 'warning' },
        { icon: 'feather-check-circle',  number: String(stats.assigned), title: 'Cameras Assigned', color: 'success' },
        { icon: 'feather-alert-circle',  number: String(stats.offline),  title: 'Offline Cameras', color: 'danger' },
    ]

    return (
        <div id="collapseProjectZones" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
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
