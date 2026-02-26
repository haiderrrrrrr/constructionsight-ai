import React from 'react'
import { FiBarChart, FiFilter, FiPlus } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import Dropdown from '@/components/shared/Dropdown'
import AdminProjectsStatistics from './AdminProjectsStatistics'

const filterOptions = [
    { label: "All", color: "bg-primary" },
    { label: "Draft", color: "bg-secondary" },
    { label: "Setup", color: "bg-warning" },
    { label: "Active", color: "bg-success" },
    { label: "Archived", color: "bg-dark" },
]

const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

const AdminProjectsHeader = () => {
    return (
        <>
            <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                <a href="#" className="btn btn-icon btn-light-brand d-inline-flex align-items-center gap-2" data-bs-toggle="collapse" data-bs-target="#projectStatsCollapse" onClick={closePanel}>
                    <FiBarChart size={16} />
                    <span className="d-inline d-md-none">Statistics</span>
                </a>
                <Dropdown
                    dropdownItems={filterOptions}
                    triggerPosition={"0, 10"}
                    triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                    triggerClass="btn btn-icon btn-light-brand"
                    triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
                    isAvatar={false}
                    dropdownAutoClose={"outside"}
                    isItemIcon={false}
                    onClick={closePanel}
                />
                <Link to="/admin/projects/create" className="btn btn-primary" onClick={closePanel}>
                    <FiPlus size={16} className="me-2" />
                    <span>Create Project</span>
                </Link>
            </div>
            <div id="projectStatsCollapse" className="accordion-collapse collapse page-header-collapse">
                <div className="accordion-body pb-2">
                    <div className="row">
                        <AdminProjectsStatistics />
                    </div>
                </div>
            </div>
        </>
    )
}

export default AdminProjectsHeader
