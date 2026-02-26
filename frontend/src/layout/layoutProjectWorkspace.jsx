import React, { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import Header from '@/components/shared/header/Header'
import ProjectSidebar from '@/components/projectWorkspace/ProjectSidebar'
import topTostError from '@/utils/topTostError'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import useAuthGuard from '@/hooks/useAuthGuard'
import SupportDetails from '@/components/supportDetails'
import { apiGet, getCurrentUserId } from '@/utils/api'
import { onBroadcast } from '@/utils/broadcast'
import PPELiveAlertToasts from '@/components/projectWorkspace/PPELiveAlertToasts'
import WorkforceLiveAlertToasts from '@/components/projectWorkspace/WorkforceLiveAlertToasts'
import ActivityLiveAlertToasts from '@/components/projectWorkspace/ActivityLiveAlertToasts'
import LiveAlertsHub from '@/components/projectWorkspace/LiveAlertsHub'

const ALERT_ROLES = ['project_manager', 'site_supervisor', 'safety_officer']

const LayoutProjectWorkspace = () => {
    const { status, redirectTo } = useAuthGuard()
    const { projectId } = useParams()
    const pathName = useLocation().pathname
    const navigate = useNavigate()
    const setupLocked = pathName === `/projects/${projectId}/setup`
    const isSettings = pathName.includes('/settings')
    useBootstrapUtils(pathName)

    const roleKey = `cs_proj_role_${getCurrentUserId()}_${projectId}`
    const [myRole, setMyRole] = useState(() => sessionStorage.getItem(roleKey) || null)
    const canSeeAlerts = ALERT_ROLES.includes(myRole)

    // When a member is removed, ProjectMembersTable dispatches 'cs:project-members-refresh'.
    // The layout listens and re-checks membership — if 403, this user was removed → redirect.
    useEffect(() => {
        if (status !== 'ok' || !projectId) return

        const check = () => {
            apiGet(`/projects/${projectId}`)
                .then((data) => {
                    if (data?.my_role) {
                        sessionStorage.setItem(roleKey, data.my_role)
                        setMyRole(data.my_role)
                    }
                })
                .catch((err) => {
                    const code = err?.response?.status
                    if (code === 403 || code === 404) {
                        navigate('/projects/my', { replace: true })
                    }
                })
        }

        check() // verify membership on mount
        window.addEventListener('cs:project-members-refresh', check)
        const unsubBroadcast = onBroadcast('cs:project-members-refresh', check)
        return () => {
            window.removeEventListener('cs:project-members-refresh', check)
            unsubBroadcast()
        }
    }, [projectId, status, navigate, roleKey])

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    const onLockedClick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        topTostError('Complete project setup before accessing other sections.')
    }

    return (
        <>
            <Header setupLocked={setupLocked} onLockedClick={onLockedClick} />
            <ProjectSidebar projectId={projectId} setupLocked={setupLocked} onLockedClick={onLockedClick} />
            <main className={`nxl-container ${isSettings ? 'apps-container' : ''}`}>
                <div className={`nxl-content ${isSettings ? 'without-header nxl-full-content' : ''}`}>
                    <Outlet />
                </div>
            </main>
            <SupportDetails />
            {canSeeAlerts && (
                <>
                    <LiveAlertsHub projectId={projectId} />
                    <PPELiveAlertToasts projectId={projectId} />
                    <WorkforceLiveAlertToasts projectId={projectId} />
                    <ActivityLiveAlertToasts projectId={projectId} />
                </>
            )}
        </>
    )
}

export default LayoutProjectWorkspace
