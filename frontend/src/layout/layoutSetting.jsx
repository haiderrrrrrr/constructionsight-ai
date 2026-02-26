import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import NavigationManu from '@/components/shared/navigationMenu/NavigationMenu'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import SettingSidebar from '@/components/setting/SettingSidebar'
import Header from '@/components/shared/header/Header'
import useAuthGuard from '@/hooks/useAuthGuard'


const LayoutSetting = () => {
    const { status, redirectTo } = useAuthGuard()
    const pathName = useLocation().pathname
    useBootstrapUtils(pathName)

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    return (
        <>
            <Header />
            <NavigationManu />
            <main className="nxl-container apps-container">
                <div className="nxl-content without-header nxl-full-content">
                    <div className='main-content d-flex'>
                        <SettingSidebar />
                        <Outlet />
                    </div>
                </div>
            </main>
        </>
    )
}

export default LayoutSetting