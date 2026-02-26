import React, { useEffect, useState, useCallback } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import PageLoader from '@/components/shared/PageLoader'
import { FiMail, FiLayers, FiLogOut, FiMoon, FiSun, FiMaximize, FiMinimize, FiCheck, FiCheckCircle, FiMoreVertical, FiArrowRight, FiX, FiStar, FiUser, FiCalendar } from 'react-icons/fi'
import { BsArrowLeft, BsArrowRight, BsDot, BsPinAngle } from 'react-icons/bs'
import { apiGet, apiPost, apiDelete, apiPatch } from '@/utils/api'
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'
import useAuthGuard from '@/hooks/useAuthGuard'
import getIcon from '@/utils/getIcon'
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'
import { getProjectStatusMeta } from '@/utils/projectStatusMeta'

const UserProjects = () => {
    const { status, redirectTo } = useAuthGuard()
    const navigate = useNavigate()
    const [projects, setProjects] = useState([])
    const [invitations, setInvitations] = useState([])
    const [loading, setLoading] = useState(true)
    const [projectsPage, setProjectsPage] = useState(1)
    const [projectsExpanded, setProjectsExpanded] = useState(false)
    const [inboxExpanded, setInboxExpanded] = useState(false)
    const projectsPerPage = 5
    const [inboxPage, setInboxPage] = useState(1)
    const inboxPerPage = 5
    const [inviteAction, setInviteAction] = useState({ id: null, type: null })
    const [taskProgress, setTaskProgress] = useState({})
    const [skinTheme, setSkinTheme] = useState(() => {
        const v = localStorage.getItem('skinTheme')
        return v === 'light' ? 'light' : 'dark'
    })

    const applyTheme = useCallback((type) => {
        const root = document.documentElement
        if (type === 'dark') {
            root.classList.add('app-skin-dark')
            root.classList.add('app-navigation-dark')
            root.classList.add('app-header-dark')
            localStorage.setItem('skinTheme', 'dark')
            setSkinTheme('dark')
        } else {
            root.classList.remove('app-skin-dark')
            root.classList.remove('app-navigation-dark')
            root.classList.remove('app-header-dark')
            localStorage.setItem('skinTheme', 'light')
            setSkinTheme('light')
        }
    }, [])

    const persistTheme = useCallback((type) => {
        applyTheme(type)
        apiPatch('/users/me/theme', { theme_skin: type }).catch(() => {})
        broadcastRefresh('cs:theme-skin-change')
    }, [applyTheme])

    const fetchTaskProgress = async (projectsList) => {
        const entries = await Promise.all(
            projectsList.map(async (p) => {
                try {
                    const tasks = await apiGet(`/projects/${p.id}/tasks`)
                    if (Array.isArray(tasks) && tasks.length > 0) {
                        return [p.id, Math.round((tasks.filter(t => t.is_done).length / tasks.length) * 100)]
                    }
                    return [p.id, 0]
                } catch {
                    return [p.id, 0]
                }
            })
        )
        setTaskProgress(Object.fromEntries(entries))
    }

    const fetchData = useCallback(() => {
        setLoading(true)
        Promise.allSettled([
            apiGet('/projects'),
            apiGet('/invitations/me'),
        ]).then(([projectsRes, invitesRes]) => {
            console.log('Fetch projects result:', projectsRes)
            console.log('Fetch invitations result:', invitesRes)

            if (projectsRes.status === 'fulfilled') {
                const projList = Array.isArray(projectsRes.value) ? projectsRes.value : []
                setProjects(projList)
                fetchTaskProgress(projList)
                try {
                    const allowed = new Set(projList.map(p => String(p.id)))
                    const keys = Object.keys(window.sessionStorage)
                    keys.forEach(k => {
                        if (!k.startsWith('cs:projectMeta:')) return
                        const id = k.split(':').pop()
                        if (id && !allowed.has(String(id))) window.sessionStorage.removeItem(k)
                    })
                } catch {}
            } else {
                console.error('Projects fetch failed:', projectsRes.reason)
                topTostError('Failed to load projects')
            }

            if (invitesRes.status === 'fulfilled') {
                setInvitations(Array.isArray(invitesRes.value) ? invitesRes.value : [])
            } else {
                console.error('Invitations fetch failed:', invitesRes.reason)
            }
        }).catch((err) => {
            console.error('Fetch error:', err)
            topTostError('Error loading projects')
        }).finally(() => {
            console.log('Setting loading to false')
            setLoading(false)
        })
    }, [])


    useEffect(() => {
        // Apply saved theme on mount
        const skin = localStorage.getItem('skinTheme') || 'dark'
        applyTheme(skin === 'light' ? 'light' : 'dark')
        fetchData()
    }, [fetchData, applyTheme])

    // Listen for theme changes from other tabs
    useEffect(() => {
        const handler = () => {
            const skin = localStorage.getItem('skinTheme') || 'dark'
            applyTheme(skin === 'light' ? 'light' : 'dark')
        }
        window.addEventListener('cs:theme-skin-change', handler)
        const unsubTheme = onBroadcast('cs:theme-skin-change', handler)
        return () => {
            window.removeEventListener('cs:theme-skin-change', handler)
            unsubTheme()
        }
    }, [applyTheme])

    useEffect(() => {
        const handler = () => fetchData()
        window.addEventListener('cs:projects-stats-refresh', handler)
        const unsubBroadcast = onBroadcast('cs:projects-stats-refresh', () => fetchData())
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', handler)
            unsubBroadcast()
        }
    }, [fetchData])

    useEffect(() => {
        const handler = () => { if (!document.hidden) fetchData() }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [fetchData])

    useEffect(() => {
        const handler = () => {
            if (projects.length > 0) {
                fetchTaskProgress(projects)
            }
        }
        window.addEventListener('cs:project-tasks-refresh', handler)
        return () => window.removeEventListener('cs:project-tasks-refresh', handler)
    }, [projects])

    useEffect(() => {
        const total = Math.max(1, Math.ceil(projects.length / projectsPerPage))
        setProjectsPage((p) => Math.min(Math.max(1, p), total))
    }, [projects.length, projectsPerPage])

    useEffect(() => {
        const total = Math.max(1, Math.ceil(invitations.length / inboxPerPage))
        setInboxPage((p) => Math.min(Math.max(1, p), total))
    }, [invitations.length, inboxPerPage])

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    const handleAccepted = () => { fetchData() }
    const handleRejected = (invitationId) => {
        setInvitations(prev => prev.filter(inv => inv.id !== invitationId))
    }

    const activeCount = projects.filter(p => p.status === 'active').length
    const completedCount = projects.filter(p => p.status === 'completed').length
    // Sort projects: pinned first, then by creation date
    const sortedProjects = [...projects].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1
        return new Date(b.created_at) - new Date(a.created_at)
    })
    const projectsTotalPages = Math.max(1, Math.ceil(sortedProjects.length / projectsPerPage))
    const projectsPageStart = (projectsPage - 1) * projectsPerPage
    const pageProjects = sortedProjects.slice(projectsPageStart, projectsPageStart + projectsPerPage)
    const inboxTotalPages = Math.max(1, Math.ceil(invitations.length / inboxPerPage))
    const inboxPageStart = (inboxPage - 1) * inboxPerPage
    const pageInvitations = invitations.slice(inboxPageStart, inboxPageStart + inboxPerPage)

    const projectPaginationItems = () => {
        const total = projectsTotalPages
        const current = projectsPage
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

        const items = new Set([1, total, current, current - 1, current + 1])
        const normalized = [...items].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)

        const out = []
        for (let i = 0; i < normalized.length; i++) {
            const n = normalized[i]
            out.push(n)
            const next = normalized[i + 1]
            if (next && next - n > 1) out.push('dots')
        }
        return out
    }

    const ProjectsPagination = () => {
        if (projectsTotalPages <= 1) return null
        const items = projectPaginationItems()
        const prevDisabled = projectsPage <= 1
        const nextDisabled = projectsPage >= projectsTotalPages
        return (
            <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style">
                <li style={prevDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                    <Link
                        to="#"
                        onClick={(e) => {
                            e.preventDefault()
                            setProjectsPage((p) => Math.max(1, p - 1))
                        }}
                    >
                        <BsArrowLeft size={16} />
                    </Link>
                </li>
                {items.map((it, idx) => {
                    if (it === 'dots') {
                        return (
                            <li key={`dots-${idx}`}>
                                <Link to="#" onClick={(e) => e.preventDefault()}>
                                    <BsDot size={16} />
                                </Link>
                            </li>
                        )
                    }
                    const page = it
                    return (
                        <li key={page}>
                            <Link
                                to="#"
                                className={page === projectsPage ? 'active' : ''}
                                onClick={(e) => {
                                    e.preventDefault()
                                    setProjectsPage(page)
                                }}
                            >
                                {page}
                            </Link>
                        </li>
                    )
                })}
                <li style={nextDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                    <Link
                        to="#"
                        onClick={(e) => {
                            e.preventDefault()
                            setProjectsPage((p) => Math.min(projectsTotalPages, p + 1))
                        }}
                    >
                        <BsArrowRight size={16} />
                    </Link>
                </li>
            </ul>
        )
    }

    const InboxPagination = () => {
        if (inboxTotalPages <= 1) return null
        const total = inboxTotalPages
        const current = inboxPage
        let items
        if (total <= 7) {
            items = Array.from({ length: total }, (_, i) => i + 1)
        } else {
            const set = new Set([1, total, current, current - 1, current + 1])
            const normalized = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
            const out = []
            for (let i = 0; i < normalized.length; i++) {
                const n = normalized[i]
                out.push(n)
                const next = normalized[i + 1]
                if (next && next - n > 1) out.push('dots')
            }
            items = out
        }

        const prevDisabled = inboxPage <= 1
        const nextDisabled = inboxPage >= inboxTotalPages

        return (
            <ul className="list-unstyled d-flex align-items-center gap-2 mb-0 pagination-common-style">
                <li style={prevDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                    <Link
                        to="#"
                        onClick={(e) => {
                            e.preventDefault()
                            setInboxPage((p) => Math.max(1, p - 1))
                        }}
                    >
                        <BsArrowLeft size={16} />
                    </Link>
                </li>
                {items.map((it, idx) => {
                    if (it === 'dots') {
                        return (
                            <li key={`dots-${idx}`}>
                                <Link to="#" onClick={(e) => e.preventDefault()}>
                                    <BsDot size={16} />
                                </Link>
                            </li>
                        )
                    }
                    const page = it
                    return (
                        <li key={page}>
                            <Link
                                to="#"
                                className={page === inboxPage ? 'active' : ''}
                                onClick={(e) => {
                                    e.preventDefault()
                                    setInboxPage(page)
                                }}
                            >
                                {page}
                            </Link>
                        </li>
                    )
                })}
                <li style={nextDisabled ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                    <Link
                        to="#"
                        onClick={(e) => {
                            e.preventDefault()
                            setInboxPage((p) => Math.min(inboxTotalPages, p + 1))
                        }}
                    >
                        <BsArrowRight size={16} />
                    </Link>
                </li>
            </ul>
        )
    }
    const topStats = [
        { icon: 'feather-layers', number: String(projects.length), title: 'Total Projects', color: 'primary' },
        { icon: 'feather-check-circle', number: String(activeCount), title: 'Active', color: 'success' },
        { icon: 'feather-mail', number: String(invitations.length), title: 'Pending Invitations', color: 'warning' },
        { icon: 'feather-award', number: String(completedCount), title: 'Completed', color: 'info' },
    ]
    const openProject = (project) => {
        try {
            window.sessionStorage.setItem(
                `cs:projectMeta:${project.id}`,
                JSON.stringify({
                    name: project.name,
                    my_role: project.my_role,
                    status: project.status,
                    my_email: project.my_email,
                    my_user_id: project.my_user_id,
                })
            )
        } catch {}
        const needsSetup = (
            project.my_role === 'project_manager' &&
            (project.status === 'draft' || project.status === 'setup_in_progress')
        )
        navigate(needsSetup ? `/projects/${project.id}/setup` : `/projects/${project.id}/info`)
    }

    const acceptInvitation = async (inv) => {
        setInviteAction({ id: inv.id, type: 'accept' })
        try {
            await apiPost(`/invitations/${inv.token}/accept`, {})
            setInboxPage(1)
            fetchData()
            topTost('Invitation accepted')
        } catch (err) {
            let msg = 'Failed to accept invitation.'
            try { msg = JSON.parse(err.message)?.detail || msg } catch {}
            topTostError(msg)
        } finally {
            setInviteAction({ id: null, type: null })
        }
    }

    const rejectInvitation = async (inv) => {
        setInviteAction({ id: inv.id, type: 'reject' })
        try {
            await apiPost(`/invitations/${inv.token}/reject`, {})
            setInboxPage(1)
            fetchData()
            topTost('Invitation declined')
        } catch (err) {
            let msg = 'Failed to decline invitation.'
            try { msg = JSON.parse(err.message)?.detail || msg } catch {}
            topTostError(msg)
        } finally {
            setInviteAction({ id: null, type: null })
        }
    }

    const handleTogglePin = async (projectId, isPinned) => {
        setProjects(prev => prev.map(p =>
            p.id === projectId ? { ...p, is_pinned: !isPinned } : p
        ))
        try {
            if (isPinned) {
                await apiDelete(`/projects/${projectId}/pin`)
            } else {
                await apiPost(`/projects/${projectId}/pin`, {})
            }
        } catch (err) {
            setProjects(prev => prev.map(p =>
                p.id === projectId ? { ...p, is_pinned: isPinned } : p
            ))
            topTostError(isPinned ? 'Failed to unpin project' : 'Failed to pin project')
        }
    }

    const roleMeta = {
        project_manager: { label: 'Project Manager', color: 'bg-soft-success text-success' },
        site_supervisor: { label: 'Site Supervisor', color: 'bg-soft-primary text-primary' },
        safety_officer: { label: 'Safety Officer', color: 'bg-soft-danger text-danger' },
        data_analyst: { label: 'Data Analyst', color: 'bg-soft-warning text-warning' },
        stakeholder: { label: 'Stakeholder', color: 'bg-soft-info text-info' },
    }

    return (
        <>
            <style>{`
                /* ─── Keyframes ─────────────────────────────────────── */
                @keyframes up-float {
                    0%,100% { transform:translateY(0) rotate(0deg); }
                    33%     { transform:translateY(-10px) rotate(.4deg); }
                    66%     { transform:translateY(-6px)  rotate(-.3deg); }
                }
                @keyframes up-ring-pulse {
                    0%,100% { transform:scale(1);    opacity:.22; }
                    50%     { transform:scale(1.13); opacity:.05; }
                }
                @keyframes up-fade-up {
                    from { opacity:0; transform:translateY(14px); }
                    to   { opacity:1; transform:translateY(0); }
                }
                @keyframes up-chip-dot {
                    0%,100% { box-shadow:0 0 0 0   rgba(var(--bs-primary-rgb,52,84,209),.55); }
                    50%     { box-shadow:0 0 0 5px rgba(var(--bs-primary-rgb,52,84,209),0); }
                }

                /* ─── Root layout ───────────────────────────────────── */
                .up-root { height:100vh; display:flex; flex-direction:column; overflow:hidden; }
                .up-root .nxl-header { flex-shrink:0; position:relative; left:0; width:100%; }
                .up-root .nxl-header .header-wrapper { padding:0 30px 0 0; }
                .up-content-area { flex:1; overflow-y:auto; min-height:0; }
                .up-content-area .main-content { padding:24px; }
                
                .up-action-arrow {
                    transition: all .2s ease;
                    color: var(--bs-body-color);
                }
                .up-action-arrow:hover {
                    background: rgba(var(--bs-primary-rgb), 0.12) !important;
                    color: var(--bs-primary) !important;
                }
                .up-action-arrow:hover i,
                .up-action-arrow:hover svg {
                    color: var(--bs-primary) !important;
                }
                .up-action-arrow i { display:flex; }

                .up-inv-action {
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    border: none;
                    color: #fff;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: all .2s ease;
                }
                .up-inv-action:hover { transform: translateY(-1px); filter: brightness(1.06); }
                .up-inv-action:disabled { opacity: .5; cursor: not-allowed; transform: none; }
                .up-inv-accept { background: var(--bs-success); }
                .up-inv-reject { background: var(--bs-danger); }

                .up-col-project { min-width: 300px; }
                .up-col-project .d-block { max-width: 280px; }
                .up-col-project .text-truncate-1-line,
                .up-col-project .text-truncate-2-line { max-width: 280px; }

                /* ─── Stat cards ────────────────────────────────────── */
                .up-stat-icon { width:28px; height:28px; border-radius:7px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.06); color:rgba(2,6,23,0.78); }
                html.app-skin-dark .up-stat-icon { background:rgba(255,255,255,0.08) !important; color:rgba(255,255,255,0.75) !important; }
                .up-stat-val { font-size:20px; font-weight:800; letter-spacing:-.5px; color:var(--bs-primary,#3454d1); line-height:1; }
                .up-stat-lbl { font-size:9.5px; font-weight:600; letter-spacing:.9px; text-transform:uppercase; color:#64748b; margin-top:4px; }
                html.app-skin-dark .up-stat-lbl { color:#64748b; }

                /* ─── Chip badge ────────────────────────────────────── */
                .up-chip {
                    display:inline-flex; align-items:center; gap:8px;
                    font-size:10.5px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;
                    padding:5px 14px 5px 10px; border-radius:100px;
                    background:rgba(var(--bs-primary-rgb,52,84,209),.08);
                    color:var(--bs-primary,#3454d1);
                    border:1px solid rgba(var(--bs-primary-rgb,52,84,209),.18);
                    width:fit-content; margin-bottom:16px;
                    animation:up-fade-up .5s ease both .08s;
                }
                .up-chip-dot {
                    width:7px; height:7px; border-radius:50%;
                    background:var(--bs-primary,#3454d1);
                    animation:up-chip-dot 2.6s ease-in-out infinite;
                }

                /* ─── Metric strip ──────────────────────────────────── */
                .up-metrics {
                    display:flex; border-radius:16px; overflow:hidden;
                    border:1px solid rgba(var(--bs-primary-rgb,52,84,209),.13);
                    background:rgba(var(--bs-primary-rgb,52,84,209),.045);
                    margin-bottom:20px;
                    animation:up-fade-up .5s ease both .14s;
                }
                .up-metric { flex:1; padding:16px 18px; text-align:center; position:relative; }
                .up-metric+.up-metric::before {
                    content:''; position:absolute; left:0; top:22%; bottom:22%;
                    width:1px; background:rgba(var(--bs-primary-rgb,52,84,209),.16);
                }
                .up-metric-val { font-size:22px; font-weight:800; letter-spacing:-.6px; color:var(--bs-primary,#3454d1); line-height:1; }
                .up-metric-lbl { font-size:9.5px; font-weight:600; letter-spacing:.9px; text-transform:uppercase; color:#64748b; margin-top:5px; }

                /* ─── Animated ring stage ───────────────────────────── */
                .up-stage {
                    position:relative; width:96px; height:96px;
                    display:flex; align-items:center; justify-content:center;
                    margin:0 auto 16px;
                    animation:up-fade-up .5s ease both .2s;
                }
                .up-ring {
                    position:absolute; border-radius:50%;
                    border:1px solid rgba(var(--bs-primary-rgb,52,84,209),.26);
                    background:transparent;
                }
                .up-ring-1 { width:96px; height:96px; animation:up-ring-pulse 4.4s ease-in-out infinite; }
                .up-ring-2 { width:72px; height:72px; animation:up-ring-pulse 4.4s ease-in-out 1.46s infinite; }
                .up-ring-3 { width:50px;  height:50px;  animation:up-ring-pulse 4.4s ease-in-out .73s infinite; }
                .up-core {
                    width:40px; height:40px; border-radius:14px;
                    display:flex; align-items:center; justify-content:center;
                    background:linear-gradient(145deg, var(--bs-primary,#3454d1) 0%, rgba(var(--bs-primary-rgb,52,84,209),.6) 100%);
                    box-shadow:0 8px 30px rgba(var(--bs-primary-rgb,52,84,209),.52), inset 0 1px 0 rgba(255,255,255,.22);
                    z-index:2; animation:up-float 5.8s ease-in-out infinite;
                }

                /* ─── Headline + subtext ────────────────────────────── */
                .up-headline {
                    font-size:clamp(20px,2.1vw,30px); font-weight:800; letter-spacing:-.8px;
                    line-height:1.14; margin:0 0 10px;
                    animation:up-fade-up .5s ease both .26s;
                }
                .up-sub {
                    font-size:13px; line-height:1.88; max-width:288px;
                    margin:0 0 18px; color:#64748b;
                    animation:up-fade-up .5s ease both .32s;
                }

                /* ─── Steps guide ───────────────────────────────────── */
                .up-steps { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:20px; animation:up-fade-up .5s ease both .38s; }
                .up-step {
                    display:flex; align-items:flex-start; gap:16px;
                    padding:20px 22px; border-radius:14px;
                    background:rgba(var(--bs-primary-rgb,52,84,209),.04);
                    border:1px solid rgba(var(--bs-primary-rgb,52,84,209),.12);
                    transition:all .28s ease; cursor:default;
                }
                .up-step:hover {
                    background:rgba(var(--bs-primary-rgb,52,84,209),.08);
                    border-color:rgba(var(--bs-primary-rgb,52,84,209),.25);
                    transform:translateX(6px);
                    box-shadow:0 4px 16px rgba(var(--bs-primary-rgb,52,84,209),.12);
                }
                .up-step-num {
                    width:36px; height:36px; border-radius:10px; flex-shrink:0;
                    display:flex; align-items:center; justify-content:center;
                    color:#fff;
                    font-size:12px; font-weight:800; letter-spacing:.8px;
                }
                .up-step:nth-child(1) .up-step-num { background:linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
                .up-step:nth-child(2) .up-step-num { background:linear-gradient(135deg, #ffa21d 0%, #ff9500 100%); }
                .up-step:nth-child(3) .up-step-num { background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); }
                html.app-skin-dark .up-step:nth-child(1) .up-step-num { background:linear-gradient(135deg, #22c55e 0%, #16a34a 100%); }
                html.app-skin-dark .up-step:nth-child(2) .up-step-num { background:linear-gradient(135deg, #ffa21d 0%, #ff9500 100%); }
                html.app-skin-dark .up-step:nth-child(3) .up-step-num { background:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); }
                .up-step-title { font-size:13.5px; font-weight:700; margin-bottom:6px; line-height:1.4; }
                .up-step-desc  { font-size:12.5px; color:#64748b; line-height:1.6; margin:0; }

                /* ─── Project cards ─────────────────────────────────── */
                .pl-card {
                    display:flex; align-items:stretch; width:100%;
                    background:transparent; border:none; text-align:left;
                    border-radius:14px; overflow:hidden; padding:0; cursor:pointer;
                    position:relative;
                    border:1px solid var(--bs-border-color,rgba(0,0,0,.08));
                    transition:all .22s ease;
                    animation:up-fade-up .4s ease both;
                    margin-bottom:10px;
                }
                .pl-card:last-child { margin-bottom:0; }
                .pl-card:hover {
                    border-color:rgba(52,84,209,.28); background:rgba(52,84,209,.04);
                    box-shadow:0 4px 20px rgba(52,84,209,.15);
                }
                .pl-card-bg {
                    position:absolute; inset:0; opacity:0; transition:opacity .22s ease; pointer-events:none;
                }
                .pl-accent { height:4px; width:100%; display:block; }
                .pl-card-body {
                    display:flex; align-items:center; gap:14px; padding:14px 16px;
                    flex:1; min-width:0; position:relative; z-index:1;
                }
                .pl-icon {
                    width:42px; height:42px; border-radius:11px; object-fit:cover; flex-shrink:0;
                    border:1px solid rgba(0,0,0,.08);
                }
                .pl-info { flex:1; min-width:0; }
                .pl-name {
                    font-size:13.5px; font-weight:700; letter-spacing:-.2px;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                }
                .pl-desc {
                    font-size:11px; color:#64748b;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                    margin-top:2px;
                }
                .pl-location {
                    font-size:11px; color:#64748b;
                    display:flex; align-items:center; gap:6px; margin-top:4px;
                }
                .pl-meta { display:flex; align-items:center; gap:8px; flex-shrink:0; }
                .pl-status-pill {
                    display:inline-flex; align-items:center; gap:5px;
                    font-size:10px; font-weight:700; padding:3px 9px; border-radius:100px;
                }
                .pl-role-chip {
                    display:inline-flex; align-items:center; gap:3px;
                    font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase;
                    padding:3px 8px; border-radius:6px;
                }
                .pl-chevron { opacity:0; transform:translateX(-4px); transition:all .22s ease; }
                .pl-card:hover .pl-chevron { opacity:1; transform:translateX(0); }

                /* ─── Invitation cards ──────────────────────────────── */
                .inv-card {
                    display:flex; flex-direction:column; border-radius:14px; overflow:hidden;
                    border:1px solid var(--bs-border-color,rgba(0,0,0,.08));
                    transition:all .22s ease; cursor:default; margin-bottom:12px;
                }
                .inv-card:last-child { margin-bottom:0; }
                .inv-card.inv-expired { opacity:.55; }
                .inv-card:hover:not(.inv-expired) {
                    border-color:rgba(52,84,209,.28); background:rgba(52,84,209,.04);
                    box-shadow:0 4px 20px rgba(52,84,209,.15);
                }
                .inv-accent-bar { height:3px; width:100%; display:block; }
                .inv-row {
                    display:flex; align-items:center; gap:14px;
                    padding:14px 16px;
                }
                .inv-logo {
                    width:42px; height:42px; border-radius:11px; object-fit:cover; flex-shrink:0;
                    border:1px solid rgba(0,0,0,.07);
                }
                .inv-content { flex:1; min-width:0; }
                .inv-line1 {
                    display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;
                }
                .inv-project-name {
                    font-size:13.5px; font-weight:700; letter-spacing:-.2px;
                    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
                }
                .inv-role-badge {
                    display:inline-flex; align-items:center; gap:4px;
                    font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase;
                    padding:2px 9px; border-radius:100px; flex-shrink:0;
                    border:1px solid transparent;
                }
                .inv-line2 {
                    display:flex; align-items:center; gap:5px; flex-wrap:wrap;
                    font-size:11px; color:#64748b;
                }
                .inv-line2-sep { opacity:.4; }
                .inv-expiry-soon { color:var(--bs-warning,#ffc107) !important; font-weight:600; }
                .inv-actions {
                    display:flex; align-items:center; gap:8px; flex-shrink:0;
                }
                .inv-btn-accept {
                    padding:8px 16px; border-radius:9px; border:none; cursor:pointer;
                    font-size:11px; font-weight:700; letter-spacing:.6px; text-transform:uppercase;
                    background:var(--bs-primary,#3454d1); color:#fff;
                    transition:all .2s ease; white-space:nowrap;
                }
                .inv-btn-accept:hover { filter:brightness(1.12); transform:translateY(-1px); box-shadow:0 4px 16px rgba(52,84,209,.4); }
                .inv-btn-accept:disabled { opacity:.5; cursor:not-allowed; transform:none; filter:none; box-shadow:none; }
                .inv-btn-decline {
                    width:34px; height:34px; border-radius:9px; cursor:pointer; flex-shrink:0;
                    display:flex; align-items:center; justify-content:center;
                    background:transparent;
                    border:1px solid var(--bs-border-color,rgba(0,0,0,.12));
                    color:#64748b; transition:all .2s ease;
                }
                .inv-btn-decline:hover { background:rgba(239,68,68,.07); border-color:rgba(239,68,68,.35); color:#ef4444; }
                .inv-btn-decline:disabled { opacity:.4; cursor:not-allowed; }

                /* ─── Empty states ──────────────────────────────────── */
                .up-empty-wrap {
                    display:flex; flex-direction:column; align-items:center; justify-content:center;
                    text-align:center; min-height:260px; padding:28px 18px;
                }
                .up-empty-projects { align-items:stretch; text-align:left; }
                .up-empty-projects .up-empty-head { display:flex; align-items:center; gap:18px; width:100%; margin-bottom:14px; }
                .up-empty-projects .up-stage { margin:0; flex:0 0 auto; }
                .up-empty-block { width:100%; }
                .up-empty-eyebrow {
                    font-size:12px; font-weight:700; letter-spacing:.5px; text-transform:uppercase;
                    color:var(--bs-secondary-color, #64748b);
                    margin-bottom:10px;
                }
                .up-empty-title {
                    font-size:22px; font-weight:800; line-height:1.3; letter-spacing:-.5px;
                    margin:0 0 10px;
                }
                .up-empty-title-sm {
                    font-size:18px; font-weight:800; letter-spacing:-.3px;
                    margin:0 0 10px;
                }
                .up-empty-desc {
                    font-size:13px; line-height:1.75;
                    color:var(--bs-secondary-color, #64748b);
                    margin:0;
                }
                .up-empty-desc-wide { max-width:420px; margin-left:auto; margin-right:auto; }
                .up-empty-inbox { min-height:240px; }
                .up-empty-icon-box {
                    width:60px; height:60px; border-radius:20px;
                    display:flex; align-items:center; justify-content:center;
                    background:rgba(var(--bs-success-rgb,34,197,94),.07);
                    border:1px solid rgba(var(--bs-success-rgb,34,197,94),.16);
                    color:var(--bs-success,#22c55e); margin-bottom:14px;
                    box-shadow:0 8px 32px rgba(var(--bs-success-rgb,34,197,94),.12);
                }
                .up-empty-wrap h6 { font-size:15px; font-weight:700; margin:0 0 8px; letter-spacing:-.2px; }
                .up-empty-wrap p  { font-size:12.5px; color:#64748b; line-height:1.7; max-width:360px; margin:0 auto; }

                /* ─── Dark mode overrides ────────────────────────────── */
                html.app-skin-dark .pl-card           { border-color:#1b2436; background:transparent; }
                html.app-skin-dark .pl-card:hover     { border-color:rgba(52,84,209,.4); background:#1e2840; box-shadow:0 4px 20px rgba(0,0,0,.3); }
                html.app-skin-dark .pl-name           { color:#c8d0e0; }
                html.app-skin-dark .pl-desc           { color:#64748b; }
                html.app-skin-dark .pl-location       { color:#64748b; }
                html.app-skin-dark .inv-card          { background:transparent; border-color:#1b2436; }
                html.app-skin-dark .inv-card:hover:not(.inv-expired) { background:#1e2840; border-color:rgba(52,84,209,.4); box-shadow:0 4px 20px rgba(0,0,0,.3); }
                html.app-skin-dark .inv-project-name  { color:#c8d0e0; }
                html.app-skin-dark .inv-line2         { color:#64748b; }
                html.app-skin-dark .inv-btn-decline   { border-color:#1b2436; color:#64748b; background:transparent; }
                html.app-skin-dark .up-step           { background:#1c2438; border-color:#1b2436; }
                html.app-skin-dark .up-step:hover     { background:#1e2840; border-color:rgba(52,84,209,.3); }
                html.app-skin-dark .up-step-num       { background:rgba(52,84,209,.18); }
                html.app-skin-dark .up-metrics        { background:#1c2438; border-color:#1b2436; }
                html.app-skin-dark .up-metric+.up-metric::before { background:#1b2436; }
                html.app-skin-dark .up-chip           { background:rgba(52,84,209,.18); border-color:rgba(52,84,209,.3); }
                html.app-skin-dark .up-headline       { color:#e2e8f0; }
                html.app-skin-dark .up-sub            { color:#8b95aa; }
                html.app-skin-dark .up-step-title     { color:#b1b4c0; }
                html.app-skin-dark .up-step-desc      { color:#64748b; }
                html.app-skin-dark .up-empty-wrap h6  { color:#b1b4c0; }
                html.app-skin-dark .up-empty-wrap p   { color:#64748b; }
                html.app-skin-dark .up-empty-title { color:rgba(255,255,255,0.92) !important; }
                html.app-skin-dark .up-empty-desc { color:#64748b !important; }
                html.app-skin-dark .logo-container img { filter:invert(1) brightness(2); }

                /* ─── Logo circle background ────────────────────────── */
                .cam-logo-circle { background: var(--bs-secondary-bg); }
                html.app-skin-dark .cam-logo-circle { background: rgba(255,255,255,0.08); border: 0 !important; }

                /* ─── Responsive ────────────────────────────────────── */
                @media(max-width:992px) {
                    .up-content-area .main-content { padding:20px; }
                }
                @media(max-width:768px) {
                    .up-content-area .main-content { padding:16px; }
                    .pl-card-body { padding:12px; gap:10px; }
                    .inv-row { padding:12px; gap:10px; }
                    .up-empty-projects .up-empty-head { flex-direction:column; align-items:flex-start; }
                }
            `}</style>

            <div className="up-root">
                {/* ── Header (unchanged) ─────────────────────────────── */}
                <header className="nxl-header">
                    <div className="header-wrapper">
                        <div className="header-left d-flex align-items-center">
                            <div className="logo-container" style={{ width:280, paddingLeft:30, paddingRight:30, flexShrink:0, display:'flex', alignItems:'center' }}>
                                <Link to="/" className="b-brand">
                                    <img src="/images/logo-full.png" alt="logo" className="logo logo-lg" style={{ maxWidth:'100%', height:'auto' }} />
                                </Link>
                            </div>
                        </div>
                        <div className="header-right ms-auto">
                            <div className="d-flex align-items-center">
                                <div className="nxl-h-item d-none d-sm-flex">
                                    <div className="full-screen-switcher">
                                        <span className="nxl-head-link me-0">
                                            <FiMaximize size={20} className="maximize" onClick={() => {
                                                document.documentElement.requestFullscreen?.()
                                                document.documentElement.classList.add('fsh-infullscreen')
                                            }} />
                                            <FiMinimize size={20} className="minimize" onClick={() => {
                                                document.exitFullscreen?.()
                                                document.documentElement.classList.remove('fsh-infullscreen')
                                            }} />
                                        </span>
                                    </div>
                                </div>
                                <div className="nxl-h-item dark-light-theme">
                                    {skinTheme === 'dark' ? (
                                        <div className="nxl-head-link me-0 light-button" onClick={() => persistTheme('light')}>
                                            <FiSun size={20} />
                                        </div>
                                    ) : (
                                        <div className="nxl-head-link me-0 dark-button" onClick={() => persistTheme('dark')}>
                                            <FiMoon size={20} />
                                        </div>
                                    )}
                                </div>
                                <div className="nxl-h-item">
                                    <span className="nxl-head-link" onClick={() => navigate('/logout')} style={{ cursor:'pointer' }} title="Logout">
                                        <FiLogOut size={20} />
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {/* ── Main content area ──────────────────────────────── */}
                <div className="up-content-area">
                    <div className="main-content">
                        {/* ── Stats strip (top row) ──────────────────── */}
                        <div className="row g-3 mb-4">
                            {topStats.map(({ icon, number, title, color }, index) => (
                                <div key={index} className="col-xxl-3 col-lg-3 col-md-6">
                                    <div className={`card bg-${color} border-${color} text-white overflow-hidden`}>
                                        <div className="card-body">
                                            <i className="fs-20">{getIcon(icon)}</i>
                                            <h5 className="fs-4 text-reset mt-4 mb-1">{number}</h5>
                                            <div className="fs-12 text-reset fw-normal">{title}</div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ── Main grid: Projects (8) + Inbox (4) ────── */}
                        <div className="row g-3">
                            {/* ── Projects section ─────────────────────── */}
                            <div className="col-xxl-6 col-xl-6">
                                <div className={`card stretch stretch-full ${projectsExpanded ? 'card-expand' : ''}`}>
                                    <div className="card-header">
                                        <h5 className="mb-0">Project Hub</h5>
                                        <div className="card-header-action">
                                            <div className="card-header-btn">
                                                <div data-bs-toggle="tooltip" title="Delete">
                                                    <span className="avatar-text avatar-xs bg-danger" data-bs-toggle="remove" style={{ opacity: 0.45, pointerEvents: 'none', cursor: 'not-allowed' }}> </span>
                                                </div>
                                                <div data-bs-toggle="tooltip" title="Refresh" onClick={() => { setProjectsPage(1); fetchData() }}>
                                                    <span className="avatar-text avatar-xs bg-warning" data-bs-toggle="refresh"> </span>
                                                </div>
                                                <div data-bs-toggle="tooltip" title="Maximize/Minimize" onClick={() => setProjectsExpanded(v => !v)}>
                                                    <span className="avatar-text avatar-xs bg-success" data-bs-toggle="expand"> </span>
                                                </div>
                                            </div>
                                            <div className="filter-dropdown">
                                                <div className="avatar-text avatar-sm" data-bs-toggle="dropdown" data-bs-offset="25, 25">
                                                    <div data-bs-toggle="tooltip" title="Options" className="lh-1">
                                                        <FiMoreVertical />
                                                    </div>
                                                </div>
                                                <div className="dropdown-menu dropdown-menu-end">
                                                    <Link to="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); fetchData() }}>Refresh</Link>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="card-body custom-card-action p-0">
                                        {loading ? (
                                            <PageLoader />
                                        ) : projects.length > 0 ? (
                                            <div className="table-responsive">
                                                <table className="table table-hover mb-0">
                                                    <thead>
                                                        <tr className="border-b">
                                                            <th scope="row" className="up-col-project">Project</th>
                                                            <th>Project Status</th>
                                                            <th>PROJECT ROLE</th>
                                                            <th className="wd-250">Progress</th>
                                                            <th className="text-end">Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pageProjects.map((p) => {
                                                            const raw = String(p.status || '')
                                                            const sm = getProjectStatusMeta(raw)
                                                            const rm = roleMeta[p.my_role] || { label: p.my_role, color: 'bg-soft-secondary text-secondary' }
                                                            const realProgress = taskProgress[p.id] ?? 0

                                                            // Dynamic progress color based on completion percentage
                                                            let progressColorClass = 'bg-danger'
                                                            if (realProgress >= 67) {
                                                              progressColorClass = 'bg-success'
                                                            } else if (realProgress >= 34) {
                                                              progressColorClass = 'bg-warning'
                                                            }
                                                            const progressTextClass = progressColorClass.replace('bg-', 'text-')

                                                            return (
                                                                <tr key={p.id}>
                                                                    <td>
                                                                        <div className="d-flex align-items-center gap-3">
                                                                            <div style={{ position: 'relative', flexShrink: 0 }}>
                                                                                <div className="cam-logo-circle"
                                                                                    style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                    <img src={p.logo_url || '/images/icons/project-icon.png'} alt=""
                                                                                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
                                                                                </div>
                                                                                {p.is_pinned && (
                                                                                    <span style={{ position: 'absolute', top: -7, right: -7, width: 18, height: 18, borderRadius: '50%', background: 'var(--bs-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                        <BsPinAngle size={10} color="#fff" />
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <Link
                                                                                to="#"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault()
                                                                                    openProject(p)
                                                                                }}
                                                                            >
                                                                                <span className="d-flex align-items-center gap-2">
                                                                                    <span>{p.name}</span>
                                                                                </span>
                                                                                {p.location && (
                                                                                    <span className="fs-12 d-block fw-normal text-muted">{p.location}</span>
                                                                                )}
                                                                            </Link>
                                                                        </div>
                                                                    </td>
                                                                    <td>
                                                                        <span className={`badge ${sm.color} fs-11 fw-bold text-uppercase`}>{sm.label}</span>
                                                                    </td>
                                                                    <td>
                                                                        <span className={`badge ${rm.color} fs-11 fw-bold text-uppercase`}>{rm.label}</span>
                                                                    </td>
                                                                    <td>
                                                                        <div className="d-flex align-items-center gap-2">
                                                                            <div className="progress flex-grow-1 ht-3" style={{ minWidth: '80px' }}>
                                                                                <div className={`progress-bar ${progressColorClass}`} role="progressbar" style={{ width: `${realProgress}%` }} aria-valuenow={realProgress} aria-valuemin={0} aria-valuemax={100} />
                                                                            </div>
                                                                            <span className={`fs-12 fw-semibold ${progressTextClass}`} style={{ minWidth: '40px', textAlign: 'right' }}>{realProgress}%</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="text-end">
                                                                        <div className="d-flex align-items-center justify-content-end gap-2">
                                                                            <Link
                                                                                to="#"
                                                                                className="avatar-text avatar-md up-action-arrow"
                                                                                onClick={(e) => {
                                                                                    e.preventDefault()
                                                                                    openProject(p)
                                                                                }}
                                                                            >
                                                                                <i><FiArrowRight /></i>
                                                                            </Link>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '400px', padding: '60px 32px' }}>
                                                <div className="up-empty-wrap up-empty-projects text-center" style={{ width: '100%', maxWidth: '900px' }}>
                                                    <div className="up-empty-head" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', marginBottom: '40px' }}>
                                                        <div className="up-stage" style={{ width: '80px', height: '80px' }}>
                                                            <div className="up-ring up-ring-1" />
                                                            <div className="up-ring up-ring-2" />
                                                            <div className="up-ring up-ring-3" />
                                                            <div className="up-core"><FiLayers size={24} color="#fff" /></div>
                                                        </div>
                                                        <div className="up-empty-block" style={{ marginLeft: 'auto', marginRight: 'auto' }}>
                                                            <h5 className="mb-0">No Active Project Assignments</h5>
                                                            <p className="up-empty-desc fs-13" style={{ color: '#64748b', lineHeight: '1.6', margin: '0 auto', maxWidth: '340px' }}>
                                                                Accept a project invitation to access your assigned workspace, site activity and collaboration tools
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="up-steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', justifyItems: 'center' }}>
                                                        <div className="up-step" style={{ maxWidth: '320px' }}>
                                                            <div className="up-step-num">01</div>
                                                            <div>
                                                                <div className="up-step-title">Review your inbox</div>
                                                                <p className="up-step-desc">Project invitations from your project manager will appear here for review</p>
                                                            </div>
                                                        </div>
                                                        <div className="up-step" style={{ maxWidth: '320px' }}>
                                                            <div className="up-step-num">02</div>
                                                            <div>
                                                                <div className="up-step-title">Accept your assignment</div>
                                                                <p className="up-step-desc">Confirm your role and join the project workspace</p>
                                                            </div>
                                                        </div>
                                                        <div className="up-step" style={{ maxWidth: '320px', gridColumn: '1 / -1', justifySelf: 'center' }}>
                                                            <div className="up-step-num">03</div>
                                                            <div>
                                                                <div className="up-step-title">Access your workspace</div>
                                                                <p className="up-step-desc">Your assigned project will appear here once your invitation is accepted</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {projects.length > 0 && !loading && (
                                        <div className="card-footer">
                                            <ProjectsPagination />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Inbox section ──────────────────────────── */}
                            <div className="col-xxl-6 col-xl-6">
                                <div className={`card stretch stretch-full ${inboxExpanded ? 'card-expand' : ''}`}>
                                    <div className="card-header">
                                        <h5 className="mb-0">Inbox</h5>
                                        <div className="card-header-action">
                                            <div className="card-header-btn">
                                                <div data-bs-toggle="tooltip" title="Delete">
                                                    <span className="avatar-text avatar-xs bg-danger" data-bs-toggle="remove" style={{ opacity: 0.45, pointerEvents: 'none', cursor: 'not-allowed' }}> </span>
                                                </div>
                                                <div data-bs-toggle="tooltip" title="Refresh" onClick={() => { setInboxPage(1); fetchData() }}>
                                                    <span className="avatar-text avatar-xs bg-warning" data-bs-toggle="refresh"> </span>
                                                </div>
                                                <div data-bs-toggle="tooltip" title="Maximize/Minimize" onClick={() => setInboxExpanded(v => !v)}>
                                                    <span className="avatar-text avatar-xs bg-success" data-bs-toggle="expand"> </span>
                                                </div>
                                            </div>
                                            <div className="filter-dropdown">
                                                <div className="avatar-text avatar-sm" data-bs-toggle="dropdown" data-bs-offset="25, 25">
                                                    <div data-bs-toggle="tooltip" title="Options" className="lh-1">
                                                        <FiMoreVertical />
                                                    </div>
                                                </div>
                                                <div className="dropdown-menu dropdown-menu-end">
                                                    <Link to="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); setInboxPage(1); fetchData() }}>Refresh</Link>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="card-body custom-card-action p-0">
                                        {loading ? (
                                            <div className="d-flex justify-content-center py-5">
                                                <div className="spinner-border spinner-border-sm text-primary" role="status" />
                                            </div>
                                        ) : invitations.length > 0 ? (
                                            <>
                                                <div className="table-responsive">
                                                    <table className="table table-hover mb-0">
                                                        <thead>
                                                            <tr className="border-b">
                                                                <th scope="row" className="up-col-project">Project</th>
                                                                <th>Sent By</th>
                                                                <th>Project Role</th>
                                                                <th>Expires At</th>
                                                                <th className="text-end">Actions</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {pageInvitations.map((inv) => {
                                                                const expiresAt = new Date(inv.expires_at)
                                                                const expiryStr = isNaN(expiresAt.getTime())
                                                                    ? '—'
                                                                    : expiresAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                                                                const rm = roleMeta[inv.role] || { label: inv.role, color: 'bg-soft-secondary text-secondary' }
                                                                const accepting = inviteAction.id === inv.id && inviteAction.type === 'accept'
                                                                const rejecting = inviteAction.id === inv.id && inviteAction.type === 'reject'
                                                                const busy = accepting || rejecting
                                                                return (
                                                                    <tr key={inv.id}>
                                                                        <td>
                                                                            <div className="d-flex align-items-center gap-3">
                                                                                <div className="cam-logo-circle"
                                                                                    style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--bs-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                    <img src={inv.project_logo_url || '/images/icons/project-icon.png'} alt=""
                                                                                        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
                                                                                </div>
                                                                                <Link to="#" onClick={(e) => e.preventDefault()}>
                                                                                    <span className="d-block">{inv.project_name || '—'}</span>
                                                                                    {inv.project_location && (
                                                                                        <span className="fs-12 d-block fw-normal text-muted">{inv.project_location}</span>
                                                                                    )}
                                                                                </Link>
                                                                            </div>
                                                                        </td>
                                                                        <td>
                                                                            <span className="d-flex align-items-center gap-2">
                                                                                <FiUser size={12} className="opacity-75" />
                                                                                <span className="text-truncate-1-line">{inv.invited_by_name || 'System Admin'}</span>
                                                                            </span>
                                                                        </td>
                                                                        <td>
                                                                            <span className={`badge ${rm.color} fs-11 fw-bold text-uppercase`}>{rm.label}</span>
                                                                        </td>
                                                                        <td>
                                                                            <span className="d-flex align-items-center gap-2">
                                                                                <FiCalendar size={12} className="opacity-75" />
                                                                                <span>{expiryStr}</span>
                                                                            </span>
                                                                        </td>
                                                                        <td className="text-end">
                                                                            <div className="hstack gap-2 justify-content-end">
                                                                                <button
                                                                                    type="button"
                                                                                    className="up-inv-action up-inv-accept"
                                                                                    onClick={() => acceptInvitation(inv)}
                                                                                    disabled={busy}
                                                                                    title="Accept"
                                                                                >
                                                                                    <FiCheck size={14} />
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    className="up-inv-action up-inv-reject"
                                                                                    onClick={() => rejectInvitation(inv)}
                                                                                    disabled={busy}
                                                                                    title="Reject"
                                                                                >
                                                                                    <FiX size={14} />
                                                                                </button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                <div className="card-footer">
                                                    <InboxPagination />
                                                </div>
                                            </>
                                        ) : (
                                            <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '300px', padding: '40px 32px' }}>
                                                <div className="up-empty-wrap up-empty-inbox text-center" style={{ width: '100%' }}>
                                                    <div className="up-empty-head" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
                                                        <div className="up-stage" style={{ width: '80px', height: '80px' }}>
                                                            <div className="up-ring up-ring-1" />
                                                            <div className="up-ring up-ring-2" />
                                                            <div className="up-ring up-ring-3" />
                                                            <div className="up-core"><FiMail size={24} color="#fff" /></div>
                                                        </div>
                                                        <div className="up-empty-block">
                                                            <h5 className="mb-0">All Caught Up</h5>
                                                            <p className="up-empty-desc fs-13" style={{ color: '#64748b', lineHeight: '1.6', margin: 0, maxWidth: '300px' }}>
                                                                New project invitations will appear here when they are shared with you for review and acceptance
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default UserProjects
