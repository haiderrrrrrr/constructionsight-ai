import React, { useEffect, useState } from 'react'
import { FiBarChart, FiFilter, FiPaperclip, FiUserCheck, FiUserX, FiClock, FiShield, FiList, FiCheckCircle } from 'react-icons/fi'
import { BsFiletypeCsv, BsFiletypeExe, BsFiletypePdf, BsFiletypeTsx, BsFiletypeXml, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'

const UsersHeader = () => {
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
        const el = document.getElementById('collapseUsers')
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
        { label: 'All', icon: <FiUserCheck /> },
        { label: 'Active', icon: <FiUserCheck /> },
        { label: 'Inactive', icon: <FiUserX /> },
        { label: 'Pending', icon: <FiClock /> },
        { label: 'Approved', icon: <FiCheckCircle /> },
        { label: 'Admins', icon: <FiShield /> },
    ]

    const activeFilterLabel = (() => {
        const map = { all: 'All', active: 'Active', inactive: 'Inactive', pending: 'Pending', approved: 'Approved', admins: 'Admins' }
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
        window.dispatchEvent(new CustomEvent('cs:users-export', { detail: { page: 'list', format: v } }))
        closePanel()
    }

    return (
        <>
            <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                <button
                    type="button"
                    className={`btn btn-icon btn-light-brand d-inline-flex align-items-center gap-2 ${statsOpen ? 'active' : ''}`}
                    data-bs-toggle="collapse"
                    data-bs-target="#collapseUsers"
                    aria-expanded={statsOpen ? 'true' : 'false'}
                    aria-controls="collapseUsers"
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
                <Link to="/admin/invitations/list" className="btn btn-light-brand d-inline-flex align-items-center gap-2" onClick={closePanel}>
                    <FiList size={16} strokeWidth={1.8} />
                    <span>Project Invitations</span>
                </Link>
            </div>
        </>
    )
}

export default UsersHeader

export const UsersHeaderContent = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const [stats, setStats] = useState({ active: 0, inactive: 0, pending: 0, approved: 0, admins: 0 })
    const [useEventStats, setUseEventStats] = useState(false)
    const [statsNonce, setStatsNonce] = useState(0)

    useEffect(() => {
        const handler = () => setStatsNonce(v => v + 1)
        const onStats = (payload) => {
            const d = payload || {}
            const next = {
                active: Number(d.active || 0),
                inactive: Number(d.inactive || 0),
                pending: Number(d.pending || 0),
                approved: Number(d.approved || 0),
                admins: Number(d.admins || 0),
            }
            setStats(next)
            setUseEventStats(true)
        }
        window.addEventListener('cs:users-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:users-stats-refresh', handler)
        const unsubStats = onBroadcast('cs:users-stats', onStats)
        return () => {
            window.removeEventListener('cs:users-stats-refresh', handler)
            unsubBroadcast()
            unsubStats()
        }
    }, [])

    useEffect(() => {
        if (useEventStats) return
        let active = true
        const getApprovalStatus = (u) => {
            const raw = u?.approval_status ?? u?.approvalStatus
            if (typeof raw === 'string' && raw.trim()) return raw.toLowerCase()
            if (u?.is_approved === true) return 'approved'
            if (u?.is_approved === false) return 'pending'
            return 'approved'
        }

        const computeStatsFromUsers = (users) => {
            const list = Array.isArray(users) ? users : []
            const activeCount = list.filter(u => u?.is_active === true).length
            const inactiveCount = list.filter(u => u?.is_active === false).length
            const pendingCount = list.filter(u => getApprovalStatus(u) === 'pending').length
            const approvedCount = list.filter(u => getApprovalStatus(u) === 'approved').length
            const adminCount = list.filter(u => String(u?.platform_role || '').toLowerCase() === 'admin').length
            return { active: activeCount, inactive: inactiveCount, pending: pendingCount, approved: approvedCount, admins: adminCount }
        }

        apiGet('/admin/users')
            .then((users) => {
                if (!active) return
                setStats(computeStatsFromUsers(users))
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

    const totalUsers = Number(stats.active || 0) + Number(stats.inactive || 0)

    const cards = [
        { icon: 'feather-users', title: 'Total Users', count: totalUsers.toLocaleString(), color: 'primary', filter: 'all' },
        { icon: 'feather-user-check', title: 'Active Users', count: Number(stats.active || 0).toLocaleString(), color: 'success', filter: 'active' },
        { icon: 'feather-check-circle', title: 'Approved Users', count: Number(stats.approved || 0).toLocaleString(), color: 'teal', filter: 'approved' },
        { icon: 'feather-user-minus', title: 'Inactive Users', count: Number(stats.inactive || 0).toLocaleString(), color: 'danger', filter: 'inactive' },
    ]

    return (
        <>
            <style>{`
                html:not(.app-skin-dark) #collapseUsers .customer-header-card .card {
                    border: 1px solid rgba(15, 23, 42, 0.1);
                    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
                }
            `}</style>
            <div id="collapseUsers" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    {cards.map(({ color, count, icon, title, filter }, index) => (
                        <div key={index} className="col-xxl-3 col-md-6 customer-header-card">
                            <a
                                href="#"
                                className="card stretch stretch-full text-decoration-none"
                                onClick={(e) => {
                                    e.preventDefault()
                                    setFilter(filter)
                                }}
                            >
                                <div className="card-body">
                                    <div className="d-flex align-items-center justify-content-between">
                                        <div className="d-flex align-items-center gap-3">
                                            <div className={`avatar-text avatar-xl rounded text-white bg-${color}`}>
                                                {React.cloneElement(getIcon(icon), { size: 17 })}
                                            </div>
                                            <span className="fw-bold d-block">
                                                <span className="text-truncate-1-line">{title}</span>
                                                <span className="fs-24 fw-bolder d-block">{count}</span>
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
        </>
    )
}
