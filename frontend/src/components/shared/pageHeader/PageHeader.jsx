import React, { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FiArrowLeft, FiMoreVertical } from 'react-icons/fi'
import { useDashboardPrefix } from '@/contentApi/dashboardPrefixContext'
import { adminMenuList } from '@/utils/fackData/adminMenuList'
import { menuList } from '@/utils/fackData/menuList'
import { apiGet } from '@/utils/api'

const _readProjectMetaCache = (projectId) => {
    try {
        const raw = window.sessionStorage.getItem(`cs:projectMeta:${projectId}`)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return null
        return parsed
    } catch {
        return null
    }
}

const PageHeader = ({ children, projectCrumbsKey, projectCrumbsLeaf, hideMobileToggle }) => {
    const [openSidebar, setOpenSidebar] = useState(false)

    useEffect(() => {
        const handler = () => setOpenSidebar(false)
        window.addEventListener('cs:close-right-panel', handler)
        return () => window.removeEventListener('cs:close-right-panel', handler)
    }, [])
    const pathName = useLocation().pathname
    const prefix = useDashboardPrefix()
    const [projectMeta, setProjectMeta] = useState(null)

    const labelByPath = useMemo(() => {
        const map = new Map()
        const walk = (items) => {
            items.forEach(item => {
                if (item?.path && (item?.label || item?.name)) map.set(item.path, item.label || item.name)
                if (Array.isArray(item?.dropdownMenu)) walk(item.dropdownMenu)
                if (Array.isArray(item?.subdropdownMenu)) walk(item.subdropdownMenu)
            })
        }
        walk(adminMenuList)
        walk(menuList)
        map.set('/admin/dashboards/analytics', 'Dashboard')
        map.set('/admin/reports/project', 'Project')
        map.set('/admin/help/knowledgebase', 'Knowledge Base')
        map.set('/dashboards/analytics', 'Dashboard')
        map.set('/reports/project', 'Project')
        map.set('/help/knowledgebase', 'Knowledge Base')
        return map
    }, [])

    const prettify = (value) => {
        const s = String(value || '').replace(/[_-]+/g, ' ').trim()
        if (!s) return ''
        return s.replace(/\b\w/g, c => c.toUpperCase())
    }

    const segments = useMemo(() => pathName.split('/').filter(Boolean), [pathName])
    const isAdmin = segments[0] === 'admin' || prefix === '/admin'
    const isProjectScoped = !isAdmin && segments[0] === 'projects' && /^\d+$/.test(segments[1] || '')
    const projectId = isProjectScoped ? parseInt(segments[1], 10) : null
    const cachedProjectMeta = useMemo(() => {
        if (!isProjectScoped || !projectId) return null
        return _readProjectMetaCache(projectId)
    }, [isProjectScoped, projectId])
    const effectiveProjectMeta = projectMeta || cachedProjectMeta

    useEffect(() => {
        if (!isProjectScoped || !projectId) {
            setProjectMeta(null)
            return
        }
        let cancelled = false
        const cached = _readProjectMetaCache(projectId)
        if (cached) setProjectMeta(cached)
        else setProjectMeta({ name: `Project ${projectId}`, my_role: null })
        apiGet(`/projects/${projectId}`)
            .then((data) => {
                if (cancelled) return
                setProjectMeta(data)
                try {
                    window.sessionStorage.setItem(`cs:projectMeta:${projectId}`, JSON.stringify({ name: data?.name, my_role: data?.my_role }))
                } catch {}
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [isProjectScoped, projectId])

    const roleLabelMap = {
        project_manager: 'Project Manager',
        site_supervisor: 'Site Supervisor',
        safety_officer: 'Safety Officer',
        data_analyst: 'Data Analyst',
        stakeholder: 'Stakeholder',
    }
    const userTitleMap = {
        dashboards: 'Dashboard',
        reports: 'Reports',
        proposal: 'Proposal',
        payment: 'Payment',
        customers: 'Customers',
        leads: 'Leads',
        projects: 'Projects',
        widgets: 'Widgets',
        settings: 'Settings',
        help: 'Help',
        applications: 'Applications',
        profile: 'Profile',
    }
    const projectRoleLabel = effectiveProjectMeta?.my_role ? (roleLabelMap[effectiveProjectMeta.my_role] || prettify(effectiveProjectMeta.my_role)) : null
    const title = isAdmin
        ? 'Admin'
        : (isProjectScoped ? (projectRoleLabel || 'Project') : (userTitleMap[segments[0]] || (segments[0] ? prettify(segments[0]) : 'Dashboard')))
    const homeHref = isAdmin ? '/admin/dashboards/analytics' : '/dashboards/analytics'

    const crumbs = useMemo(() => {
        const items = []

        if (isProjectScoped && projectId) {
            const projectName = effectiveProjectMeta?.name || `Project ${projectId}`
            items.push({ label: projectName, to: `/projects/${projectId}/info` })
            items.push({ label: 'Home', to: '/projects/my' })

            const after = segments.slice(2)
            const key = projectCrumbsKey ?? (after[0] || '')
            const leaf = projectCrumbsLeaf ?? (after[1] || '')
            if (key === 'info') {
                items.push({ label: 'Project Info', to: null })
                return items
            }
            if (key === 'bim') {
                items.push({ label: 'Operations', to: `/projects/${projectId}/tasks` })
                items.push({ label: 'BIM Model', to: null })
                return items
            }
            if (key === 'profile') {
                return [
                    { label: 'Home', to: homeHref },
                    { label: 'Profile', to: '/profile' },
                    { label: 'Account Settings', to: null },
                ]
            }
            const sectionLabelMap = {
                dashboards: 'Dashboard',
                reports: 'Reports',
                tasks: 'Operations',
                'feature-control': 'Operations',
                cameras: 'Operations',
                zones: 'Operations',
                members: 'Team',
                invitations: 'Team',
                info: 'Project',
                setup: 'Project',
                applications: 'Workspace',
                intelligence: 'Intelligence Hub',
                help: 'Help Center',
                profile: 'Profile',
            }
            const pageLabelMap = {
                dashboards: (leaf === 'analytics' ? 'Analytics' : prettify(leaf || 'Dashboard')),
                reports: (() => {
                    if (leaf === 'project') return 'Project'
                    if (leaf === 'ppe') return 'PPE Detection'
                    if (leaf === 'workforce') return 'Workforce Analytics'
                    if (leaf === 'activity') return 'Activity Monitoring'
                    if (leaf === 'equipment') return 'Equipment Usage'
                    if (leaf === 'risk') return 'Risk Analytics'
                    if (leaf === 'safety') return 'Report Delivery Log'
                    return leaf ? prettify(leaf) : 'Reports'
                })(),
                applications: (leaf ? prettify(leaf) : 'Applications'),
                tasks: 'Tasks',
                'feature-control': 'Feature Control',
                cameras: leaf && /^\d+$/.test(leaf) ? 'Camera Detail' : 'Cameras',
                zones: 'Zones',
                members: 'Members',
                invitations: 'Invitations',
                info: 'Project Info',
                setup: 'Setup',
                intelligence: (leaf === 'smart-query' ? 'Smart Query Assistant' : (leaf ? prettify(leaf) : 'Intelligence Hub')),
                help: leaf ? prettify(leaf) : 'Help',
                profile: 'Profile',
            }
            const sectionLabel = sectionLabelMap[key] || prettify(key)
            const pageLabel = pageLabelMap[key] || prettify(key)
            const sectionTo = (() => {
                if (key === 'dashboards') return `/projects/${projectId}/dashboards/analytics`
                if (key === 'reports') return `/projects/${projectId}/reports/ppe`
                if (['tasks', 'feature-control', 'cameras', 'zones'].includes(key)) return `/projects/${projectId}/tasks`
                if (['members', 'invitations'].includes(key)) return `/projects/${projectId}/members`
                if (['info', 'setup'].includes(key)) return `/projects/${projectId}/info`
                if (key === 'applications') return `/projects/${projectId}/applications/notes`
                if (key === 'intelligence') return `/projects/${projectId}/intelligence/smart-query`
                if (key === 'help') return `/projects/${projectId}/help/knowledgebase`
                if (key === 'profile') return `/projects/${projectId}/profile`
                return null
            })()
            if (sectionLabel) items.push({ label: sectionLabel, to: sectionTo })
            if (pageLabel && pageLabel !== sectionLabel) items.push({ label: pageLabel, to: null })
            return items
        }

        items.push({ label: 'Home', to: homeHref })

        if (isAdmin) {
            const group = segments[1]
            if (!group) return items

            const groupLabelMap = {
                dashboards: 'Dashboard',
                projects: 'Projects',
                users: 'Users',
                cameras: 'Cameras',
                intelligence: 'Intelligence Hub',
                reports: 'Reports',
                payment: 'Payment',
                customers: 'Customers',
                leads: 'Leads',
                proposal: 'Proposal',
                invitations: 'Invitations',
                settings: 'Settings',
                help: 'Help',
                applications: 'Applications',
                profile: 'Profile',
            }
            const groupLabel = groupLabelMap[group] || prettify(group)
            const groupToMap = {
                dashboards: '/admin/dashboards/analytics',
                reports: '/admin/reports/ppe',
                projects: '/admin/projects/list',
                users: '/admin/users/list',
                cameras: '/admin/cameras/list',
                intelligence: '/admin/intelligence/smart-query',
                payment: '/admin/payment/list',
                customers: '/admin/customers/list',
                leads: '/admin/leads/list',
                proposal: '/admin/proposal/list',
                invitations: '/admin/invitations/list',
                settings: '/admin/settings/general',
                help: '/admin/help/knowledgebase',
                applications: '/admin/applications/chat',
                profile: '/admin/profile',
            }
            const groupTo = groupToMap[group] || null

            const lastMeaningful = [...segments].reverse().find(s => !/^\d+$/.test(s)) || group
            const leafRaw = segments.length >= 3 ? lastMeaningful : group
            const leafLabelMap = {
                list: 'List',
                create: 'Create',
                add: 'Add',
                edit: 'Edit',
                verify: 'Verify',
                health: 'Health',
                analytics: 'Analytics',
                sales: 'Sales',
                leads: 'Leads',
                project: 'Project',
                timesheets: 'Timesheets',
                knowledgebase: 'Knowledge Base',
                recaptcha: 'reCAPTCHA',
                general: 'General',
            }
            const fromMap = labelByPath.get(pathName)
            const leafOverrideByPath = {
                '/admin/projects/list': 'Project List',
                '/admin/users/list': 'User List',
                '/admin/projects/create': 'Create Project',
                '/admin/cameras/list': 'Camera List',
                '/admin/cameras/add': 'Add Camera',
                '/admin/cameras/health': 'Camera Health',
                '/admin/intelligence/smart-query': 'Smart Query Assistant',
            }
            const leafLabel = (
                (group === 'cameras' && (/^\/admin\/cameras\/\d+\/verify$/.test(pathName) || /^\/admin\/cameras\/\d+\/edit$/.test(pathName)))
                    ? 'Camera Detail'
                    : (leafOverrideByPath[pathName] || leafLabelMap[leafRaw] || fromMap || prettify(leafRaw))
            )

            if (pathName === '/admin/invitations/list') {
                items.push({ label: 'Projects', to: '/admin/projects/list' })
                items.push({ label: 'Invitations', to: null })
                return items
            }

            if (pathName === '/admin/profile') {
                items.push({ label: groupLabel, to: groupTo })
                items.push({ label: 'Account Settings', to: null })
                return items
            }

            items.push({ label: groupLabel, to: groupTo })
            if (leafLabel && leafLabel !== groupLabel) items.push({ label: leafLabel, to: null })
            return items
        }

        const group = segments[0]
        if (!group) return items

        const groupLabelMap = {
            dashboards: 'Dashboard',
            reports: 'Reports',
            proposal: 'Proposal',
            payment: 'Payment',
            customers: 'Customers',
            leads: 'Leads',
            projects: 'Projects',
            widgets: 'Widgets',
            settings: 'Settings',
            help: 'Help',
            applications: 'Applications',
            profile: 'Profile',
        }
        const groupLabel = groupLabelMap[group] || prettify(group)
        const groupToMap = {
            dashboards: '/dashboards/analytics',
            reports: '/reports/ppe',
            proposal: '/proposal/list',
            payment: '/payment/list',
            customers: '/customers/list',
            leads: '/leads/list',
            projects: '/projects/my',
            widgets: '/widgets/lists',
            settings: '/settings/general',
            help: '/help/knowledgebase',
            applications: '/applications/chat',
            profile: '/profile',
        }
        const groupTo = groupToMap[group] || null

        const lastMeaningful = [...segments].reverse().find(s => !/^\d+$/.test(s)) || group
        const leafRaw = segments.length >= 2 ? lastMeaningful : group
        const leafLabelMap = {
            list: 'List',
            create: 'Create',
            add: 'Add',
            edit: 'Edit',
            view: 'View',
            my: 'My',
            analytics: 'Analytics',
            sales: 'Sales',
            leads: 'Leads',
            project: 'Project',
            timesheets: 'Timesheets',
            knowledgebase: 'Knowledge Base',
            recaptcha: 'reCAPTCHA',
            general: 'General',
            tasks: 'Tasks',
            email: 'Email',
            tags: 'Tags',
            seo: 'SEO',
            support: 'Support',
            finance: 'Finance',
            gateways: 'Gateways',
            customers: 'Customers',
            localization: 'Localization',
            miscellaneous: 'Miscellaneous',
        }
        const fromMap = labelByPath.get(pathName)
        const leafLabel = leafLabelMap[leafRaw] || fromMap || prettify(leafRaw)

        items.push({ label: groupLabel, to: groupTo })
        if (pathName === '/profile') {
            items.push({ label: 'Account Settings', to: null })
            return items
        }
        if (leafLabel && leafLabel !== groupLabel) items.push({ label: leafLabel, to: null })
        return items
    }, [effectiveProjectMeta?.name, homeHref, isAdmin, isProjectScoped, labelByPath, projectId, projectRoleLabel, segments])

    return (
        <div className="page-header">
            <style>{`
                .page-header .page-header-right-items-wrapper .btn,
                .page-header .page-header-right-items-wrapper a.btn {
                    height: 40px;
                    font-size: 10px !important;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                .page-header .page-header-right-items-wrapper .btn:not(.btn-icon):not(.btn-close),
                .page-header .page-header-right-items-wrapper a.btn:not(.btn-icon):not(.btn-close) {
                    padding-top: 0;
                    padding-bottom: 0;
                }
                .page-header .page-header-right-items-wrapper .btn.btn-icon,
                .page-header .page-header-right-items-wrapper a.btn.btn-icon {
                    width: 40px;
                    min-width: 40px;
                    padding: 0;
                }
            `}</style>
            {openSidebar && (
                <div
                    className="d-md-none"
                    onClick={() => setOpenSidebar(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 98, background: 'transparent' }}
                />
            )}
            <div className="page-header-left d-flex align-items-center">
                <div className="page-header-title">
                    <h5 className="m-b-10">{title}</h5>
                </div>
                <nav aria-label="breadcrumb" className="d-none d-md-block">
                    <ul className="breadcrumb">
                        {crumbs.map((c, idx) => (
                            <li key={`${c.label}-${idx}`} className="breadcrumb-item">
                                {c.to ? (
                                    <Link to={c.to} className="text-reset">
                                        {c.label}
                                    </Link>
                                ) : (
                                    <span aria-current="page" className={idx === crumbs.length - 1 ? 'text-muted' : 'text-reset'}>
                                        {c.label}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </nav>
            </div>
            <div className="page-header-right ms-auto">
                <div className={`page-header-right-items ${openSidebar ? "page-header-right-open" : ""}`}>
                    <div className="d-flex d-md-none">
                        <Link to="#" onClick={() => setOpenSidebar(false)} className="page-header-right-close-toggle">
                            <FiArrowLeft size={16} className="me-2" />
                            <span>Back</span>
                        </Link>
                    </div>
                    {children}
                </div>
                {!hideMobileToggle && (
                    <div className="d-md-none d-flex align-items-center">
                        <Link to="#" onClick={() => setOpenSidebar(true)} className="page-header-right-open-toggle">
                            <FiMoreVertical className="fs-20" />
                        </Link>
                    </div>
                )}
            </div>
        </div>
    )
}

export default PageHeader
