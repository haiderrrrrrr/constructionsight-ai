import React, { useContext, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import PerfectScrollbar from "react-perfect-scrollbar";
import AdminMenus from './AdminMenus';
import { NavigationContext } from '../../../contentApi/navigationProvider';

const AdminNavigationMenu = () => {
    const { navigationOpen, setNavigationOpen } = useContext(NavigationContext)
    const pathName = useLocation().pathname
    useEffect(() => {
        setNavigationOpen(false)
    }, [pathName])
    return (
        <nav className={`nxl-navigation ${navigationOpen ? "mob-navigation-active" : ""}`}>
            <style>{`html.app-skin-dark .nxl-navigation .m-header .logo-lg { filter: invert(1); }`}</style>
            <div className="navbar-wrapper">
                <div className="m-header">
                    <Link to="/admin/dashboards/analytics" className="b-brand">
                        <img src="/images/logo-full.png" alt="logo" className="logo logo-lg" />
                        <img src="/images/logo-abbr.png" alt="logo" className="logo logo-sm" />
                    </Link>
                </div>

                <div className={`navbar-content`}>
                    <PerfectScrollbar>
                        <ul className="nxl-navbar">
                            <li className="nxl-item nxl-caption">
                                <label>Navigation</label>
                            </li>
                            <AdminMenus />
                        </ul>
                    </PerfectScrollbar>
                </div>
            </div>
            <div onClick={() => setNavigationOpen(false)} className={`${navigationOpen ? "nxl-menu-overlay" : ""}`}></div>
        </nav>
    )
}

export default AdminNavigationMenu
