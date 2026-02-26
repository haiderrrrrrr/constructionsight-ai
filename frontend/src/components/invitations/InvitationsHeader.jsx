import React, { useEffect, useState } from 'react'
import { FiBarChart, FiFilter, FiPaperclip, FiClock, FiCheckCircle, FiAlertCircle, FiXCircle, FiList } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypeExe, BsFiletypePdf, BsFiletypeTsx, BsFiletypeXml, BsPrinter } from 'react-icons/bs'
import ReactApexChart from 'react-apexcharts'
import Dropdown from '@/components/shared/Dropdown'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { estimateAreaChartOptions } from '@/utils/chartsLogic/estimateAreaChartOptions'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const InvitationsHeader = () => {
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
        const el = document.getElementById('collapseInvitations')
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
        window.dispatchEvent(new CustomEvent('cs:invitations-export', { detail: { page: 'list', format: v } }))
        closePanel()
    }

    return (
        <>
            <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                <button
                    type="button"
                    className={`btn btn-icon btn-light-brand d-inline-flex align-items-center gap-2 ${statsOpen ? 'active' : ''}`}
                    data-bs-toggle="collapse"
                    data-bs-target="#collapseInvitations"
                    aria-expanded={statsOpen ? 'true' : 'false'}
                    aria-controls="collapseInvitations"
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
                <Link to="/admin/projects/list" className="btn btn-light-brand d-inline-flex align-items-center gap-2" onClick={closePanel}>
                    <FiList size={16} strokeWidth={1.8} />
                    <span>Project List</span>
                </Link>
            </div>
        </>
    )
}

export default InvitationsHeader

export const InvitationsHeaderContent = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [stats, setStats] = useState({ pending: 0, accepted: 0, expired: 0, cancelled: 0 })
    const [useEventStats, setUseEventStats] = useState(false)
    const [statsNonce, setStatsNonce] = useState(0)
    const chartOption = estimateAreaChartOptions()
    const parseExpiresAtMs = (val) => {
        if (!val) return null
        if (val instanceof Date) {
            const ms = val.getTime()
            return Number.isFinite(ms) ? ms : null
        }
        const raw = String(val).trim()
        if (!raw) return null
        const direct = Date.parse(raw)
        if (Number.isFinite(direct)) return direct
        const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
        const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`
        const fallback = Date.parse(withTz)
        return Number.isFinite(fallback) ? fallback : null
    }
    const isExpiredAt = (expiresAt) => {
        const ms = parseExpiresAtMs(expiresAt)
        if (ms == null) return false
        return ms < Date.now()
    }

    useEffect(() => {
        const handler = () => setStatsNonce(v => v + 1)
        const onStats = (payload) => {
            const d = payload || {}
            const next = {
                pending: Number(d.pending || 0),
                accepted: Number(d.accepted || 0),
                expired: Number(d.expired || 0),
                cancelled: Number(d.cancelled || 0),
            }
            setStats(next)
            setUseEventStats(true)
        }
        window.addEventListener('cs:invitations-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:invitations-stats-refresh', handler)
        const unsubStats = onBroadcast('cs:invitations-stats', onStats)
        return () => {
            window.removeEventListener('cs:invitations-stats-refresh', handler)
            unsubBroadcast()
            unsubStats()
        }
    }, [])

    useEffect(() => {
        if (useEventStats) return
        let active = true
        apiGet('/admin/invitations')
            .then((rows) => {
                if (!active) return
                const next = { pending: 0, accepted: 0, expired: 0, cancelled: 0 }
                const list = Array.isArray(rows) ? rows : []
                for (const inv of list) {
                    const s = String(inv?.status || '').toLowerCase()
                    const timeExpired = s === 'pending' && isExpiredAt(inv?.expires_at)
                    if (s === 'cancelled') next.cancelled += 1
                    else if (s === 'accepted') next.accepted += 1
                    else if (s === 'expired' || timeExpired) next.expired += 1
                    else if (s === 'pending') next.pending += 1
                }
                setStats(next)
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
        const series = baseSpark.map(v => Math.max(6, Math.round(v * scale)))
        return {
            ...it,
            chartColor: chartColorMap[it.color] || '#93a9ff',
            series,
        }
    })

    return (
        <div id="collapseInvitations" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
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
                                        xaxis: { ...chartOption?.xaxis, crosshairs: { show: false } },
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
