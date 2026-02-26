import React from 'react'
import Header from '@/components/shared/header/Header'
import AdminNavigationMenu from '@/components/shared/navigationMenu/AdminNavigationMenu'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import useAuthGuard from '@/hooks/useAuthGuard'
import VoiceCall from '@/components/chats/VoiceCall'
import VideoCall from '@/components/chats/VideoCall'
import StorageDetails from '@/components/storage/StorageDetails'
import TasksDetails from '@/components/tasks/TasksDetails'
import AddTask from '@/components/tasks/AddTask'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import ChatProfileInfo from '@/components/chats/ChatProfileInfo'
import ComposeMailPopUp from '@/components/emails/ComposeMailPopup'
import { DashboardPrefixProvider } from '@/contentApi/dashboardPrefixContext'

const LayoutAdminApplications = () => {
    const { status, redirectTo } = useAuthGuard('admin')
    const pathName = useLocation().pathname
    useBootstrapUtils(pathName)

    const getClassName = (pathName) => {
        switch (pathName) {
            case "/admin/applications/email":
                return "apps-email"
            case "/admin/applications/chat":
                return "apps-chat"
            case "/admin/applications/tasks":
                return "apps-tasks"
            case "/admin/applications/notes":
                return "apps-notes"
            case "/admin/applications/calender":
                return "apps-calendar"
            case "/admin/applications/storage":
                return "apps-storage"
            default:
                return null
        }
    }

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    return (
        <DashboardPrefixProvider prefix="/admin">
            <Header />
            <AdminNavigationMenu />
            <main className={`nxl-container apps-container ${getClassName(pathName)}`}>
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
        </DashboardPrefixProvider>
    )
}

export default LayoutAdminApplications
