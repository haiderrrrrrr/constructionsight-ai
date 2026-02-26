import React, { useContext } from 'react'
import { FiX } from 'react-icons/fi'
import { Link, useLocation } from 'react-router-dom'
import PerfectScrollbar from 'react-perfect-scrollbar'
import { SidebarContext } from '../../contentApi/sideBarToggleProvider'
import getIcon from '@/utils/getIcon'

const buildNavItems = (projectId) => [
    { label: "PPE Detection", path: `/projects/${projectId}/settings`, icon: "feather-alert-circle" },
    { label: "Workforce Analytics", path: `/projects/${projectId}/settings/workforce`, icon: "feather-users" },
    { label: "Activity Monitoring", path: `/projects/${projectId}/settings/activity`, icon: "feather-activity" },
    { label: "Reports", path: `/projects/${projectId}/settings/reports`, icon: "feather-file-text" },
]

const ProjectSettingsSidebar = ({ projectId }) => {
    const { sidebarOpen, setSidebarOpen } = useContext(SidebarContext)
    const pathName = useLocation().pathname
    const navItems = buildNavItems(projectId)

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

export default ProjectSettingsSidebar
