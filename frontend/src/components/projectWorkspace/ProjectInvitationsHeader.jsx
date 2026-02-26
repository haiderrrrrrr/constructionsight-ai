import React, { useEffect, useState } from 'react'
import { FiBarChart, FiFilter, FiMail, FiClock, FiCheckCircle, FiAlertCircle, FiXCircle, FiPaperclip } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypePdf, BsFiletypeXml, BsFiletypeTsx, BsFiletypeExe, BsPrinter } from 'react-icons/bs'
import ReactApexChart from 'react-apexcharts'
import Dropdown from '@/components/shared/Dropdown'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { estimateAreaChartOptions } from '@/utils/chartsLogic/estimateAreaChartOptions'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const ProjectInvitationsHeader = ({ projectId }) => {
    const navigate = useNavigate()
    const location = useLocation()
    const { projectId: paramProjectId } = useParams()
    const id = projectId || parseInt(paramProjectId, 10)
    const [statsOpen, setStatsOpen] = useState(true)
    const currentFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    useEffect(() => {
        const el = document.getElementById('collapseProjectInvitations')
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

    const filterItems = [
        { label: 'All', icon: <FiCheckCircle /> },
        { label: 'Pending', icon: <FiClock /> },
        { label: 'Accepted', icon: <FiCheckCircle /> },
        { label: 'Expired', icon: <FiAlertCircle /> },
        { label: 'Cancelled', icon: <FiXCircle /> },
    ]

    const activeFilterLabel = (() => {
        const map = { all: 'All', pending: 'Pending', accepted: 'Accepted', expired: 'Expired', cancelled: 'Cancelled' }
        return map[currentFilter] || 'All'
    })()

    const handleFilterClick = (label) => {
        const v = String(label || '').toLowerCase()
        const allowed = new Set(filterItems.map(x => String(x.label).toLowerCase()))
        if (!allowed.has(v)) return
        setFilter(v)
    }

    const handleInviteClick = () => {
        window.dispatchEvent(new Event('cs:open-invite-modal'))
    }

    const fileType = [
        { label: "PDF", icon: <BsFiletypePdf /> },
        { label: "CSV", icon: <BsFiletypeCsv /> },
        { label: "XML", icon: <BsFiletypeXml /> },
        { label: "Text", icon: <BsFiletypeTsx /> },
        { label: "Excel", icon: <BsFiletypeExe /> },
        { label: "Print", icon: <BsPrinter /> },
    ]

    const handleFileExport = (label) => {
        const v = String(label || '').toLowerCase()
        window.dispatchEvent(new CustomEvent('cs:invitations-export', { detail: { format: v } }))
    }

    const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

    return (
        <>
            <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                <button
                    type="button"
                    className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                    data-bs-toggle="collapse"
                    data-bs-target="#collapseProjectInvitations"
                    aria-expanded={statsOpen ? 'true' : 'false'}
                    aria-controls="collapseProjectInvitations"
                    onClick={closePanel}
                >
                    <FiBarChart size={16} />
                    <span className="d-inline d-md-none ms-2">Statistics</span>
                </button>
                <Dropdown
                    dropdownItems={filterItems}
                    triggerPosition={"0, 12"}
                    triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                    triggerClass='btn btn-icon btn-light-brand'
                    triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
                    isAvatar={false}
                    onClick={(label) => { handleFilterClick(label); closePanel() }}
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
                    onClick={(label) => { handleFileExport(label); closePanel() }}
                    dataBsToggle=""
                />
                <button
                    type="button"
                    className="btn btn-primary d-inline-flex align-items-center gap-2"
                    onClick={() => { handleInviteClick(); closePanel() }}
                >
                    <FiMail size={16} strokeWidth={1.8} />
                    <span>Invite Member</span>
                </button>
            </div>
        </>
    )
}

export default ProjectInvitationsHeader

export const ProjectInvitationsHeaderContent = ({ projectId }) => {
    const location = useLocation()
    const navigate = useNavigate()
    const { projectId: paramProjectId } = useParams()
    const id = projectId || parseInt(paramProjectId, 10)
    const [stats, setStats] = useState({ pending: 0, accepted: 0, expired: 0, cancelled: 0 })
    const [useEventStats, setUseEventStats] = useState(false)
    const chartOption = estimateAreaChartOptions()

    useEffect(() => {
        const onStats = (payload) => {
            const d = payload || {}
            setStats({
                pending: Number(d.pending || 0),
                accepted: Number(d.accepted || 0),
                expired: Number(d.expired || 0),
                cancelled: Number(d.cancelled || 0),
            })
            setUseEventStats(true)
        }
        const unsubStats = onBroadcast('cs:project-invitations-stats', onStats)
        return () => { unsubStats() }
    }, [])

    useEffect(() => {
        if (useEventStats) return
        let active = true
        apiGet(`/projects/${id}/invitations/stats`)
            .then((data) => {
                if (!active) return
                setStats(data || { pending: 0, accepted: 0, expired: 0, cancelled: 0 })
            })
            .catch(() => {})
        return () => { active = false }
    }, [id, useEventStats])

    const setFilter = (next) => {
        const p = new URLSearchParams(location.search)
        const value = String(next || '').toLowerCase()
        if (!value || value === 'all') p.delete('filter')
        else p.set('filter', value)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    const total = (stats.pending || 0) + (stats.accepted || 0) + (stats.expired || 0) + (stats.cancelled || 0)
    const chartColorMap = {
        primary: '#93a9ff',
        danger: '#ff9999',
        success: '#64ffaa',
        warning: '#ffca7d',
    }
    const baseSpark = [20, 10, 18, 12, 25, 10, 20]

    const statisticsData = [
        { key: 'pending', number: Number(stats.pending || 0), title: 'Pending', color: 'warning' },
        { key: 'accepted', number: Number(stats.accepted || 0), title: 'Accepted', color: 'success' },
        { key: 'expired', number: Number(stats.expired || 0), title: 'Expired', color: 'danger' },
        { key: 'cancelled', number: Number(stats.cancelled || 0), title: 'Cancelled', color: 'primary' },
    ].map((it) => {
        const pct = total > 0 ? Math.round((it.number / total) * 100) : 0
        const scale = 0.85 + 0.35 * (pct / 100)
        const data = baseSpark.map(v => Math.max(6, Math.round(v * scale)))
        return {
            ...it,
            chartColor: chartColorMap[it.color] || '#93a9ff',
            series: data,
        }
    })

    return (
        <div id="collapseProjectInvitations" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {statisticsData.map(({ key, number, title, color, chartColor, series }) => (
                        <div key={key} className="col-xxl-3 col-md-6">
                            <a
                                href="#"
                                className={`card bg-${color} text-white overflow-hidden text-decoration-none`}
                                onClick={(e) => {
                                    e.preventDefault()
                                    setFilter(title.toLowerCase())
                                }}
                            >
                                <div className="card-body">
                                    <div className="text-start">
                                        <h4 className="text-reset">{number.toLocaleString()}</h4>
                                        <p className="text-reset m-0">{title}</p>
                                    </div>
                                </div>
                                <ReactApexChart
                                    options={{
                                        ...chartOption,
                                        colors: [chartColor],
                                        tooltip: { enabled: false },
                                        markers: { size: 0 },
                                        states: {
                                            hover: { filter: { type: 'none' } },
                                            active: { filter: { type: 'none' } },
                                        },
                                        yaxis: { ...chartOption?.yaxis, show: false },
                                    }}
                                    series={[{ name: title, data: series }]}
                                    type="area"
                                    height={100}
                                />
                            </a>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
