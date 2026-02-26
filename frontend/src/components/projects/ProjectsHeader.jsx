import React, { useEffect, useState } from 'react'
import { FiArchive, FiBarChart, FiCheck, FiCheckCircle, FiEdit3, FiEye, FiFilter, FiPaperclip, FiPlus } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypeExe, BsFiletypePdf, BsFiletypeTsx, BsFiletypeXml, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const ProjectsHeader = () => {
    const navigate = useNavigate()
    const location = useLocation()
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

    const filterItems = [
        { label: 'All', icon: <FiEye /> },
        { label: 'Active', icon: <FiCheck /> },
        { label: 'Completed', icon: <FiCheckCircle /> },
        { label: 'Archived', icon: <FiArchive /> },
    ]

    const activeFilterLabel = (() => {
        const map = { all: 'All', active: 'Active', completed: 'Completed', archived: 'Archived' }
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

    const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

    const handleFilterClick = (label) => {
        const v = String(label || '').toLowerCase()
        const allowed = new Set(filterItems.map(x => String(x.label).toLowerCase()))
        if (!allowed.has(v)) return
        setFilter(v)
        closePanel()
    }

    const handleFileClick = (label) => {
        const v = String(label || '').toLowerCase()
        window.dispatchEvent(new CustomEvent('cs:projects-export', { detail: { page: 'list', format: v } }))
        closePanel()
    }

    return (
        <>
            <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                <button
                    type="button"
                    className={`btn btn-icon btn-light-brand d-inline-flex align-items-center gap-2 ${statsOpen ? 'active' : ''}`}
                    data-bs-toggle="collapse"
                    data-bs-target="#collapseOne"
                    aria-expanded={statsOpen ? 'true' : 'false'}
                    aria-controls="collapseOne"
                    onClick={closePanel}
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
                <Link to="/admin/projects/create" className="btn btn-primary" onClick={closePanel}>
                    <FiPlus size={16} className="me-2" strokeWidth={1.8} />
                    <span>Create Project</span>
                </Link>
            </div>
        </>
    )
}

export default ProjectsHeader

export const ProjectsHeaderContent = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, archived: 0 })
    const [useEventStats, setUseEventStats] = useState(false)
    const [statsNonce, setStatsNonce] = useState(0)

    useEffect(() => {
        const handler = () => setStatsNonce(v => v + 1)
        const onStats = (payload) => {
            const d = payload || {}
            const next = {
                total: Number(d.total || 0),
                active: Number(d.active || 0),
                completed: Number(d.completed || 0),
                archived: Number(d.archived || 0),
            }
            setStats(next)
            setUseEventStats(true)
        }
        window.addEventListener('cs:projects-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:projects-stats-refresh', handler)
        const unsubStats = onBroadcast('cs:projects-stats', onStats)
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', handler)
            unsubBroadcast()
            unsubStats()
        }
    }, [])

    useEffect(() => {
        if (useEventStats) return
        let active = true
        apiGet('/admin/projects')
            .then((data) => {
                if (!active) return
                const rows = Array.isArray(data) ? data : []
                const norm = (s) => String(s || '').toLowerCase()
                const counts = {
                    total: rows.length,
                    active: rows.filter(r => norm(r.status) === 'active').length,
                    completed: rows.filter(r => norm(r.status) === 'completed').length,
                    archived: rows.filter(r => norm(r.status) === 'archived').length,
                }
                setStats(counts)
            })
            .catch(() => {})
        return () => { active = false }
    }, [statsNonce])

    const setFilter = (next) => {
        const p = new URLSearchParams(location.search)
        const value = String(next || '').toLowerCase()
        if (!value || value === 'all') p.delete('filter')
        else p.set('filter', value)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    const total = Number(stats.total || 0)
    const cards = [
        { label: 'Total',    count: Number(stats.total || 0),    description: 'Total projects',    filter: 'all',       color: 'primary' },
        { label: 'Active',   count: Number(stats.active || 0),   description: 'Active Projects',   filter: 'active',   color: 'success' },
        { label: 'Archived', count: Number(stats.archived || 0), description: 'Archived Projects', filter: 'archived', color: 'danger' },
        { label: 'Completed', count: Number(stats.completed || 0), description: 'Completed Projects', filter: 'completed', color: 'warning' },
    ].map((c) => ({
        ...c,
        pct: c.label === 'Total' ? (total ? 100 : 0) : (total ? Math.round((c.count / total) * 100) : 0),
        amount: `${c.label === 'Total' ? (total ? 100 : 0) : (total ? Math.round((c.count / total) * 100) : 0)}% of total`,
    }))

    return (
        <div id="collapseOne" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {cards.map(({ label, count, description, amount, pct, color, filter }, index) => (
                        <div key={index} className="col-xxl-3 col-md-6">
                            <div className={`card bg-soft-${color} text-${color} border-${color} border-dashed cs-projects-stats-card`}>
                                <div className="card-body">
                                    <a href="#" className="fw-bold d-block text-reset" onClick={(e) => { e.preventDefault(); setFilter(filter) }}>
                                        <span className="d-block">{label}</span>
                                        <span className="fs-24 fw-bolder d-block">{String(count).padStart(2, '0')}</span>
                                    </a>
                                    <div className="pt-4">
                                        <div className="d-flex align-items-center justify-content-between">
                                            <a href="#" className="fs-12 fw-medium text-reset" onClick={(e) => { e.preventDefault(); setFilter(filter) }}>
                                                <span>{description}</span>
                                                <i className="feather-link-2 fs-10 ms-1" />
                                            </a>
                                            <div>
                                                <span className="fs-12 fw-semibold text-reset">{amount}</span>
                                            </div>
                                        </div>
                                        <div className="progress mt-2 ht-3">
                                            <div className={`progress-bar bg-${color}`} role="progressbar" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <style>{`
                    html.app-skin-dark .cs-projects-stats-card a { color: inherit !important; }
                    html.app-skin-dark .cs-projects-stats-card a.text-reset { color: inherit !important; }
                    html.app-skin-dark .cs-projects-stats-card .text-reset { color: inherit !important; }
                `}</style>
            </div>
        </div>
    )
}
