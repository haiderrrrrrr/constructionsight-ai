import React from 'react'
import { FiBarChart, FiFilter, FiPaperclip, FiPlus } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import Dropdown from '@/components/shared/Dropdown'
import { fileType } from '../leads/LeadsHeader'
import ProjectsStatistics from '../widgetsStatistics/ProjectsStatistics'
import { useDashboardPrefix } from '@/contentApi/dashboardPrefixContext';

const options = [
  { label: "Alls", color: "bg-primary" },
  { label: "On Hold", color: "bg-indigo" },
  { label: "Pending", color: "bg-warning" },
  { label: "Finished", color: "bg-success" },
  { label: "Declined", color: "bg-danger" },
  { label: "In Progress", color: "bg-teal" },
  { label: "Not Started", color: "bg-success" },
  { label: "My Projects", color: "bg-warning" }
];

const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

const ProjectsListHeader = () => {
  const prefix = useDashboardPrefix();
  return (
    <>
      <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
        <a href="#" className="btn btn-icon btn-light-brand d-inline-flex align-items-center gap-2" data-bs-toggle="collapse" data-bs-target="#collapseOne" onClick={closePanel}>
          <FiBarChart size={16} />
          <span className="d-inline d-md-none">Statistics</span>
        </a>
        <Dropdown
          dropdownItems={options}
          triggerPosition={"0, 10"}
          triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
          triggerClass='btn btn-icon btn-light-brand'
          triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
          isAvatar={false}
          dropdownAutoClose={"outside"}
          isItemIcon={false}
          onClick={closePanel}
        />
        <Dropdown
          dropdownItems={fileType}
          triggerPosition={"0, 12"}
          triggerIcon={<FiPaperclip size={16} strokeWidth={1.6} />}
          triggerClass='btn btn-icon btn-light-brand'
          triggerText={<span className="d-inline d-md-none ms-2">Export</span>}
          isAvatar={false}
          iconStrokeWidth={0}
          onClick={closePanel}
        />
        <Link to={prefix + "/projects/create"} className="btn btn-primary" onClick={closePanel}>
          <FiPlus size={16} className='me-2' />
          <span>Create Project</span>
        </Link>
      </div>
      <div id="collapseOne" className="accordion-collapse collapse page-header-collapse">
        <div className="accordion-body pb-2">
          <div className="row">
            <ProjectsStatistics />
          </div>
        </div>
      </div>
    </>
  )
}

export default ProjectsListHeader
