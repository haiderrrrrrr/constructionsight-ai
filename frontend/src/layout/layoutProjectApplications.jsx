import React from 'react'
import Header from '@/components/shared/header/Header'
import ProjectSidebar from '@/components/projectWorkspace/ProjectSidebar'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import VoiceCall from '@/components/chats/VoiceCall'
import VideoCall from '@/components/chats/VideoCall'
import StorageDetails from '@/components/storage/StorageDetails'
import TasksDetails from '@/components/tasks/TasksDetails'
import AddTask from '@/components/tasks/AddTask'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import ChatProfileInfo from '@/components/chats/ChatProfileInfo'
import ComposeMailPopUp from '@/components/emails/ComposeMailPopup'
import useAuthGuard from '@/hooks/useAuthGuard'

const LayoutProjectApplications = () => {
    const { status, redirectTo } = useAuthGuard()
    const { projectId } = useParams()
    const pathName = useLocation().pathname
    useBootstrapUtils(pathName)

    const getClassName = (pathName) => {
        if (pathName.includes('/applications/email')) return 'apps-email'
        if (pathName.includes('/applications/chat')) return 'apps-chat'
        if (pathName.includes('/applications/tasks')) return 'apps-tasks'
        if (pathName.includes('/applications/notes')) return 'apps-notes'
        if (pathName.includes('/applications/calender')) return 'apps-calendar'
        if (pathName.includes('/applications/storage')) return 'apps-storage'
        if (pathName.includes('/tasks')) return 'apps-tasks'
        return null
    }

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    return (
        <>
            <Header />
            <ProjectSidebar projectId={projectId} />
            <main className={`nxl-container apps-container ${getClassName(pathName) || ''}`}>
                <div className="nxl-content without-header nxl-full-content">
                    <div className='main-content d-flex'>
                        <Outlet />
                    </div>
                </div>
            </main>
            <ChatProfileInfo />
            <VoiceCall />
            <VideoCall />
            <ComposeMailPopUp />
            <StorageDetails />
            <TasksDetails />
            <AddTask />
        </>
    )
}

export default LayoutProjectApplications
