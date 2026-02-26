import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import useAuthGuard from '@/hooks/useAuthGuard'
import AdminNavigationMenu from '@/components/shared/navigationMenu/AdminNavigationMenu'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import SettingSidebar from '@/components/setting/SettingSidebar'
import Header from '@/components/shared/header/Header'
import { DashboardPrefixProvider } from '@/contentApi/dashboardPrefixContext'

const LayoutAdminSetting = () => {
    const { status, redirectTo } = useAuthGuard('admin')
    const pathName = useLocation().pathname
    useBootstrapUtils(pathName)

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    return (
        <DashboardPrefixProvider prefix="/admin">
            <Header />
            <AdminNavigationMenu />
            <main className="nxl-container apps-container">
                <div className="nxl-content without-header nxl-full-content">
                    <div className='main-content d-flex'>
                        <SettingSidebar />
                        <Outlet />
                    </div>
                </div>
            </main>
        </DashboardPrefixProvider>
    )
}

export default LayoutAdminSetting
