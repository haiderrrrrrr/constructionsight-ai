import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import AdminNavigationMenu from '@/components/shared/navigationMenu/AdminNavigationMenu'
import Header from '@/components/shared/header/Header'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import SupportDetails from '@/components/supportDetails'
import { DashboardPrefixProvider } from '@/contentApi/dashboardPrefixContext'
import useAuthGuard from '@/hooks/useAuthGuard'

const RootAdminLayout = () => {
    const { status, redirectTo } = useAuthGuard('admin')
    const pathName = useLocation().pathname
    useBootstrapUtils(pathName)

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    return (
        <DashboardPrefixProvider prefix="/admin">
            <Header />
            <AdminNavigationMenu />
            <main className="nxl-container">
                <div className="nxl-content">
                    <Outlet />
                </div>
            </main>
            <SupportDetails />
        </DashboardPrefixProvider>
    )
}

export default RootAdminLayout
