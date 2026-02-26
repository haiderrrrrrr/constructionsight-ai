import React, { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FiList } from 'react-icons/fi'
import { useDashboardPrefix } from '@/contentApi/dashboardPrefixContext'
import { onBroadcast } from '@/utils/broadcast'

const ProjectCreateHeader = ({ mode = 'admin_shell', projectId = null }) => {
    const navigate = useNavigate()
    const location = useLocation()
    const prefix = useDashboardPrefix()
    const isAdmin = location.pathname.startsWith('/admin') || prefix === '/admin'
    const [hideCancel, setHideCancel] = useState(false)

    const listHref = isAdmin ? '/admin/projects/list' : '/projects/my'
    const persistKey = mode === 'pm_setup' && projectId
        ? `cs:draft:pm-setup:${projectId}`
        : `cs:draft:project-create`

    const onCancel = (e) => {
        e.preventDefault()
        try { sessionStorage.removeItem(persistKey) } catch {}
        navigate(listHref)
    }

    useEffect(() => {
        const unsubDone = onBroadcast('cs:project-create:success', () => setHideCancel(true))
        const unsubReset = onBroadcast('cs:project-create:reset', () => setHideCancel(false))
        return () => {
            unsubDone()
            unsubReset()
        }
    }, [])

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper" aria-label="Project create actions">
            <style>{`
                .cs-create-header-btn:focus,
                .cs-create-header-btn:focus-visible,
                .cs-create-header-btn:active {
                    box-shadow: none !important;
                    outline: none !important;
                }
            `}</style>
            {!hideCancel ? (
                <button
                    type="button"
                    className="btn btn-danger d-none d-md-inline-flex align-items-center cs-create-header-btn"
                    style={{ fontWeight: 600, transition: 'none' }}
                    onClick={onCancel}
                >
                    Cancel
                </button>
            ) : null}
            <Link to={listHref} className="btn btn-light-brand d-inline-flex align-items-center justify-content-center gap-2 cs-create-header-btn" onClick={() => window.dispatchEvent(new Event('cs:close-right-panel'))}>
                <FiList size={15} />
                <span>{isAdmin ? 'Project List' : 'My Projects'}</span>
            </Link>
        </div>
    )
}

export default ProjectCreateHeader
