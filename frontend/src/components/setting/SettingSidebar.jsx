import React, { useContext } from 'react'
import { FiX } from 'react-icons/fi'
import { Link, useLocation } from 'react-router-dom'
import PerfectScrollbar from 'react-perfect-scrollbar'
import { SidebarContext } from '../../contentApi/sideBarToggleProvider'
import getIcon from '@/utils/getIcon'

const navItems = [
    { label: "General", path: "/admin/settings/general", icon: "feather-airplay" },
    { label: "PPE Detection", path: "/admin/settings/ppe", icon: "feather-alert-circle" },
    { label: "SEO", path: "/admin/settings/seo", icon: "feather-search" },
    { label: "Tags", path: "/admin/settings/tags", icon: "feather-tag" },
    { label: "Email", path: "/admin/settings/email", icon: "feather-mail" },
    { label: "Tasks", path: "/admin/settings/tasks", icon: "feather-check-circle" },
    { label: "Leads", path: "/admin/settings/leads", icon: "feather-crosshair" },
    { label: "Support", path: "/admin/settings/support", icon: "feather-life-buoy" },
    { label: "Finance", path: "/admin/settings/finance", icon: "feather-dollar-sign" },
    { label: "Gateways", path: "/admin/settings/gateways", icon: "feather-git-branch" },
    { label: "Customers", path: "/admin/settings/customers", icon: "feather-users" },
    { label: "Localization", path: "/admin/settings/localization", icon: "feather-globe" },
    { label: "reCaptcha", path: "/admin/settings/recaptcha", icon: "feather-shield" },
    { label: "Miscellaneous", path: "/admin/settings/miscellaneous", icon: "feather-cast" },
]
const SettingSidebar = () => {
    const { sidebarOpen, setSidebarOpen } = useContext(SidebarContext)
    const pathName = useLocation().pathname
    return (
        <div className={`content-sidebar content-sidebar-md ${sidebarOpen ? "app-sidebar-open" : ""} `}>
            <PerfectScrollbar>
                <div className="content-sidebar-header bg-white sticky-top hstack justify-content-between">
                    <h4 className="fw-bolder mb-0">Settings</h4>
                    <a href="#" className="app-sidebar-close-trigger d-flex" onClick={()=>setSidebarOpen(false)}>
                        <FiX size={16} />
                    </a>
                </div>
                <div className="content-sidebar-body">
                    <ul className="nav flex-column nxl-content-sidebar-item">
                        {
                            navItems.map(({ label, path, icon }, index) => (
                                <li key={index} className="nav-item">
                                    <Link className={`nav-link ${pathName === path ? "active" : ""} `} to={path}>
                                        <i className='lh-1 fs-16'>{getIcon(icon)} </i>
                                        <span>{label}</span>
                                    </Link>
                                </li>
                            ))
                        }
                    </ul>
                </div>
            </PerfectScrollbar>
        </div>

    )
}

export default SettingSidebar
