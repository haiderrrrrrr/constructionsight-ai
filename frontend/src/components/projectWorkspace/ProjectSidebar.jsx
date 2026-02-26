import { Fragment, useEffect, useState, useContext } from 'react'
import { FiChevronRight } from 'react-icons/fi'
import { Link, useLocation } from 'react-router-dom'
import PerfectScrollbar from 'react-perfect-scrollbar'
import { menuList } from '@/utils/fackData/menuList'
import getIcon from '@/utils/getIcon'
import { apiGet } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'
import { NavigationContext } from '@/contentApi/navigationProvider'
import { getProjectStatusMeta } from '@/utils/projectStatusMeta'
import PropTypes from 'prop-types'

// menuList IDs used in the project workspace nav (excluded from "Other" section)
const CLAIMED_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 999]

const buildProjectNav = (projectId) => [
    {
        id: 'ws-operations', name: 'operations', label: 'Operations',
        path: '#', icon: 'feather-layers',
        dropdownMenu: [
            { id: 'ws-tasks',     name: 'Tasks',     path: `/projects/${projectId}/tasks`,     subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor'] },
            { id: 'ws-live-view', name: 'Feature Control', path: `/projects/${projectId}/feature-control`, subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-cameras',   name: 'Cameras',   path: `/projects/${projectId}/cameras`,   subdropdownMenu: false },
            { id: 'ws-zones',     name: 'Zones',     path: `/projects/${projectId}/zones`,     subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
            { id: 'ws-rpt-delivery', name: 'Report Delivery Log', path: `/projects/${projectId}/reports/safety`, subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-bim',       name: 'BIM Model', path: `/projects/${projectId}/bim`,       subdropdownMenu: false },
        ]
    },
    {
        id: 'ws-team', name: 'team', label: 'Team',
        path: '#', icon: 'feather-users',
        dropdownMenu: [
            { id: 'ws-members',     name: 'Members',     path: `/projects/${projectId}/members`,     subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-invitations', name: 'Invitations', path: `/projects/${projectId}/invitations`, subdropdownMenu: false, roles: ['project_manager'] },
        ]
    },
    {
        id: 'ws-reports', name: 'ws-reports', label: 'Reports',
        path: '#', icon: 'feather-cast',
        dropdownMenu: [
            { id: 'ws-rpt-ppe',        name: 'PPE Detection',       path: `/projects/${projectId}/reports/ppe`,       subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
            { id: 'ws-rpt-workforce',  name: 'Workforce Analytics', path: `/projects/${projectId}/reports/workforce`, subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
            { id: 'ws-rpt-activity',   name: 'Activity Monitoring', path: `/projects/${projectId}/reports/activity`,  subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
            { id: 'ws-rpt-equipment',  name: 'Equipment Usage',     path: `/projects/${projectId}/reports/equipment`, subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
            { id: 'ws-rpt-equipment-upload', name: 'Equipment Upload Demo', path: `/projects/${projectId}/video-test`, subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-rpt-risk',       name: 'Risk Analytics',      path: `/projects/${projectId}/reports/risk`,       subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
        ]
    },
    {
        id: 'ws-settings', name: 'ws-settings', label: 'Settings',
        path: '#', icon: 'feather-settings',
        dropdownMenu: [
            { id: 'ws-set-ppe', name: 'PPE Detection', path: `/projects/${projectId}/settings`, subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-set-workforce', name: 'Workforce Analytics', path: `/projects/${projectId}/settings/workforce`, subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-set-activity', name: 'Activity Monitoring', path: `/projects/${projectId}/settings/activity`, subdropdownMenu: false, roles: ['project_manager'] },
            { id: 'ws-set-reports', name: 'Reports', path: `/projects/${projectId}/settings/reports`, subdropdownMenu: false, roles: ['project_manager'] },
        ]
    },
    {
        id: 'ws-project', name: 'ws-project', label: 'Project',
        path: '#', icon: 'feather-briefcase',
        dropdownMenu: [
            { id: 'ws-proj-info',   name: 'Project Info',   path: `/projects/${projectId}/info`, subdropdownMenu: false },
            { id: 'ws-proj-switch', name: 'Switch Project', path: '/projects/my',                subdropdownMenu: false },
        ]
    },
    {
        id: 'ws-workspace', name: 'workspace', label: 'Workspace',
        path: '#', icon: 'feather-grid',
        dropdownMenu: [
            { id: 'ws-notes', name: 'Notes', path: `/projects/${projectId}/applications/notes`, subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
        ]
    },
    {
        id: 'ws-intelligence', name: 'ws-intelligence', label: 'Intelligence Hub',
        path: '#', icon: 'feather-cpu',
        dropdownMenu: [
            {
                id: 'ws-smart-query',
                name: 'Smart Query Assistant',
                path: `/projects/${projectId}/intelligence/smart-query`,
                subdropdownMenu: false,
                roles: ['project_manager', 'site_supervisor', 'safety_officer', 'data_analyst'],
            },
        ]
    },
    {
        id: 'ws-help', name: 'ws-help', label: 'Help Center',
        path: '#', icon: 'feather-life-buoy',
        dropdownMenu: [
            { id: 'ws-help-kb',       name: 'KnowledgeBase', path: `/projects/${projectId}/help/knowledgebase`, subdropdownMenu: false, roles: ['project_manager', 'safety_officer', 'site_supervisor', 'data_analyst'] },
        ]
    },
]

const ProjectSidebar = ({ projectId, setupLocked = false, onLockedClick }) => {
    const [openDropdown, setOpenDropdown] = useState(null)
    const [openSubDropdown, setOpenSubDropdown] = useState(null)
    const [project, setProject] = useState(null)
    const pathName = useLocation().pathname
    const { navigationOpen, setNavigationOpen } = useContext(NavigationContext)

    const myRole = project?.my_role || null


    // Fetch project info for display
    useEffect(() => {
        if (!projectId) return
        try {
            const raw = window.sessionStorage.getItem(`cs:projectMeta:${projectId}`)
            if (raw) {
                const parsed = JSON.parse(raw)
                if (parsed && typeof parsed === 'object') setProject(prev => prev || parsed)
            }
        } catch (e) { void e }
        apiGet(`/projects/${projectId}`)
            .then(data => {
                setProject(data)
                try {
                    window.sessionStorage.setItem(
                        `cs:projectMeta:${projectId}`,
                        JSON.stringify({
                            name: data?.name,
                            my_role: data?.my_role,
                            status: data?.status,
                            my_email: data?.my_email,
                            my_user_id: data?.my_user_id,
                        })
                    )
                } catch (e) { void e }
            })
            .catch(() => setProject(null))
    }, [projectId])

    // Broadcast listener for project changes (name, status, etc)
    useEffect(() => {
        if (!projectId) return
        const loadProject = (payload = null) => {
            const payloadProjectId = payload?.projectId ?? payload?.project_id
            if (payload && payloadProjectId && String(payloadProjectId) !== String(projectId)) return
            if (payload?.status || payload?.name) {
                setProject(prev => {
                    const next = { ...(prev || {}), ...payload }
                    delete next.projectId
                    delete next.project_id
                    try {
                        window.sessionStorage.setItem(
                            `cs:projectMeta:${projectId}`,
                            JSON.stringify({
                                name: next?.name,
                                my_role: next?.my_role,
                                status: next?.status,
                                my_email: next?.my_email,
                                my_user_id: next?.my_user_id,
                            })
                        )
                    } catch (e) { void e }
                    return next
                })
            }
            try {
                const raw = window.sessionStorage.getItem(`cs:projectMeta:${projectId}`)
                if (raw) {
                    const parsed = JSON.parse(raw)
                    if (parsed && typeof parsed === 'object') setProject(prev => ({ ...(prev || {}), ...parsed }))
                }
            } catch (e) { void e }
            apiGet(`/projects/${projectId}`)
                .then(data => {
                    setProject(data)
                    try {
                        window.sessionStorage.setItem(
                            `cs:projectMeta:${projectId}`,
                            JSON.stringify({
                                name: data?.name,
                                my_role: data?.my_role,
                                status: data?.status,
                                my_email: data?.my_email,
                                my_user_id: data?.my_user_id,
                            })
                        )
                    } catch (e) { void e }
                })
                .catch(() => {})
        }
        window.addEventListener('cs:projects-stats-refresh', loadProject)
        window.addEventListener('cs:project-status-refresh', loadProject)
        const unsub = onBroadcast('cs:projects-stats-refresh', loadProject)
        const unsubStatus = onBroadcast('cs:project-status-refresh', loadProject)
        return () => {
            window.removeEventListener('cs:projects-stats-refresh', loadProject)
            window.removeEventListener('cs:project-status-refresh', loadProject)
            unsub()
            unsubStatus()
        }
    }, [projectId])

    // Visibility change listener
    useEffect(() => {
        if (!projectId) return
        const handler = () => {
            if (!document.hidden) {
                apiGet(`/projects/${projectId}`)
                    .then(data => setProject(data))
                    .catch(() => {})
            }
        }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }, [projectId])

    // Close mobile nav on route change
    useEffect(() => {
        setNavigationOpen(false)
    }, [pathName, setNavigationOpen])

    // prefixPath is only used for remaining global menuList items
    const prefixPath = (path) => {
        if (!path || path === '#') return path
        if (path.startsWith('http')) return path
        if (path === '/logout') return path
        if (path === '/projects/my') return path
        if (path === '/projects/invitations') return path
        if (path.startsWith('/authentication/')) return path
        if (path.startsWith('/projects/')) return path
        return `/projects/${projectId}${path}`
    }

    const handleMainMenu = (_e, name) => {
        setOpenDropdown(prev => prev === name ? null : name)
    }

    const handleDropdownMenu = (e, name) => {
        e.stopPropagation()
        setOpenSubDropdown(prev => prev === name ? null : name)
    }

    // Active state: check if current path matches any child item
    const isSectionActive = (items) =>
        items.some(item => item.path && pathName === item.path)

    const isSectionOpen = (sectionName, items) =>
        openDropdown === sectionName || isSectionActive(items)

    const projectNav = buildProjectNav(projectId)
    const logout = menuList.find(m => m.id === 999)
    const remainingMenu = menuList.filter(m => !CLAIMED_IDS.includes(m.id))

    // Render a section from the project workspace nav (paths are already absolute)
    const renderProjectSection = ({ id, name, label, path, icon, dropdownMenu }) => {
        // Filter items by role — items with a `roles` array are restricted
        const visibleItems = (dropdownMenu || []).filter(item =>
            !item.roles || !myRole || item.roles.includes(myRole)
        )
        if (visibleItems.length === 0) return null

        const active = isSectionActive(visibleItems)
        const open = isSectionOpen(name, visibleItems)
        const menuLabel = label ?? name
        return (
            <li
                key={id}
                onClick={(e) => handleMainMenu(e, name)}
                className={`nxl-item nxl-hasmenu ${active ? 'active nxl-trigger' : ''}`}
            >
                <Link to={path} className="nxl-link text-capitalize">
                    <span className="nxl-micon">{getIcon(icon)}</span>
                    <span className="nxl-mtext" style={{ paddingLeft: '2.5px' }}>{menuLabel}</span>
                    <span className="nxl-arrow fs-16"><FiChevronRight /></span>
                </Link>
                <ul className={`nxl-submenu ${open ? 'nxl-menu-visible' : 'nxl-menu-hidden'}`}>
                    {visibleItems.map(({ id: itemId, name: itemName, path: itemPath }) => (
                        <li key={itemId} className={`nxl-item ${pathName === itemPath ? 'active' : ''}`}>
                            <Link className="nxl-link" to={itemPath}>
                                {itemName}
                            </Link>
                        </li>
                    ))}
                </ul>
            </li>
        )
    }

    // Render a section from the global menuList (paths go through prefixPath, supports subdropdowns)
    const renderGlobalSection = ({ id, name, label, path, icon, dropdownMenu }) => {
        const menuLabel = label ?? name
        return (
            <li
                key={id}
                onClick={(e) => handleMainMenu(e, name)}
                className={`nxl-item nxl-hasmenu ${openDropdown === name ? 'active nxl-trigger' : ''}`}
            >
                <Link to={prefixPath(path)} className="nxl-link text-capitalize">
                    <span className="nxl-micon">{getIcon(icon)}</span>
                    <span className="nxl-mtext" style={{ paddingLeft: '2.5px' }}>{menuLabel}</span>
                    <span className="nxl-arrow fs-16"><FiChevronRight /></span>
                </Link>
                <ul className={`nxl-submenu ${openDropdown === name ? 'nxl-menu-visible' : 'nxl-menu-hidden'}`}>
                    {(dropdownMenu || []).map(({ id: itemId, name: itemName, path: itemPath, subdropdownMenu }) => {
                        const prefixed = prefixPath(itemPath)
                        return (
                            <Fragment key={itemId}>
                                {Array.isArray(subdropdownMenu) && subdropdownMenu.length ? (
                                    <li
                                        className={`nxl-item nxl-hasmenu ${openSubDropdown === itemName ? 'active' : ''}`}
                                        onClick={(e) => handleDropdownMenu(e, itemName)}
                                    >
                                        <Link to={prefixPath(itemPath)} className="nxl-link text-capitalize">
                                            <span className="nxl-mtext">{itemName}</span>
                                            <span className="nxl-arrow"><i><FiChevronRight /></i></span>
                                        </Link>
                                        {subdropdownMenu.map(({ id: subId, name: subName, path: subPath }) => (
                                            <ul
                                                key={subId}
                                                className={`nxl-submenu ${openSubDropdown === itemName ? 'nxl-menu-visible' : 'nxl-menu-hidden'}`}
                                            >
                                                <li className={`nxl-item ${pathName === prefixPath(subPath) ? 'active' : ''}`}>
                                                    <Link className="nxl-link text-capitalize" to={prefixPath(subPath)}>
                                                        {subName}
                                                    </Link>
                                                </li>
                                            </ul>
                                        ))}
                                    </li>
                                ) : (
                                    <li className={`nxl-item ${pathName === prefixed ? 'active' : ''}`}>
                                        <Link className="nxl-link" to={prefixed}>
                                            {itemName}
                                        </Link>
                                    </li>
                                )}
                            </Fragment>
                        )
                    })}
                </ul>
            </li>
        )
    }

    return (
        <nav className={`nxl-navigation ${navigationOpen ? 'mob-navigation-active' : ''}`}>
            <style>{`
                .cs-project-title { font-family: "Maven Pro", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 0.02em; line-height: 1.25; padding-left: 10px; border-left: 2px solid rgba(var(--bs-danger-rgb), 0.9); }
            `}</style>
            {setupLocked && (
                <div
                    onClick={onLockedClick}
                    style={{ position: 'absolute', inset: 0, zIndex: 999, cursor: 'not-allowed' }}
                    title="Complete project setup first"
                />
            )}
            <div className="navbar-wrapper">
                <div className="m-header">
                    <Link to="/projects/my" className="b-brand">
                        <img src="/images/logo-full.png" alt="logo" className="logo logo-lg" />
                        <img src="/images/logo-abbr.png" alt="logo" className="logo logo-sm" />
                    </Link>
                </div>

                <div className="navbar-content">
                    <PerfectScrollbar>
                        {/* Project info header */}
                        {project && (
                            <div className="px-3 py-2 border-bottom mb-1">
                                <div className="d-flex flex-column align-items-start gap-1">
                                    <div className="cs-project-title text-truncate">{project.name}</div>
                                    <span className={`badge ${getProjectStatusMeta(project.status).color} fs-11 fw-bold text-uppercase`}>
                                        {getProjectStatusMeta(project.status).label}
                                    </span>
                                </div>
                            </div>
                        )}

                        <ul className="nxl-navbar">
                            <li className="nxl-item nxl-caption">
                                <label>Navigation</label>
                            </li>

                            {/* === Project workspace sections (Dashboard → Help Center) === */}
                            {projectNav.map(renderProjectSection)}

                            {/* Logout */}
                            {logout && renderProjectSection(logout)}

                            {/* === Other — remaining global menuList items === */}
                            {remainingMenu.length > 0 && (
                                <li className="nxl-item nxl-caption">
                                    <label>Other</label>
                                </li>
                            )}
                            {remainingMenu.map(renderGlobalSection)}
                        </ul>
                    </PerfectScrollbar>
                </div>
            </div>
            <div
                onClick={() => setNavigationOpen(false)}
                className={`${navigationOpen ? 'nxl-menu-overlay' : ''}`}
            />
        </nav>
    )
}

export default ProjectSidebar

ProjectSidebar.propTypes = {
    projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    setupLocked: PropTypes.bool,
    onLockedClick: PropTypes.func,
}
