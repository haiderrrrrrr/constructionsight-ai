import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import NavigationManu from '@/components/shared/navigationMenu/NavigationMenu'
import Header from '@/components/shared/header/Header'
import useBootstrapUtils from '@/hooks/useBootstrapUtils'
import SupportDetails from '@/components/supportDetails'
import useAuthGuard from '@/hooks/useAuthGuard'

const RootLayout = () => {
    const { status, redirectTo } = useAuthGuard()
    const pathName = useLocation().pathname
    useBootstrapUtils(pathName)

    if (status === 'loading') return null
    if (status === 'fail') return <Navigate to={redirectTo} replace />

    return (
        <>
            <Header />
            <NavigationManu />
            <main className="nxl-container">
                <div className="nxl-content">
                    <Outlet />
                </div>
            </main>
            <SupportDetails />
        </>
    )
}

export default RootLayout
