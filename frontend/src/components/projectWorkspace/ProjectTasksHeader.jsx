import React, { useEffect, useState } from 'react'
import { FiBarChart, FiFilter, FiList, FiClock, FiCheckCircle, FiPlus, FiPaperclip } from 'react-icons/fi'
import { BsFiletypePdf, BsFiletypeCsv, BsFiletypeXml, BsFiletypeTsx, BsFiletypeExe, BsPrinter } from 'react-icons/bs'
import Dropdown from '@/components/shared/Dropdown'
import { useLocation, useNavigate } from 'react-router-dom'
import ProjectTasksOverviewCharts from '@/components/projectWorkspace/ProjectTasksOverviewCharts'

const ProjectTasksHeader = ({ myRole }) => {
    const canCreate = ['project_manager', 'site_supervisor', 'safety_officer'].includes(myRole)
    const location = useLocation()
    const navigate = useNavigate()
    const [statsOpen, setStatsOpen] = useState(true)

    useEffect(() => {
        const el = document.getElementById('collapseProjectTasks')
        if (!el) return
        const onShown = () => setStatsOpen(true)
        const onHidden = () => setStatsOpen(false)
        el.addEventListener('shown.bs.collapse', onShown)
        el.addEventListener('hidden.bs.collapse', onHidden)
        setStatsOpen(el.classList.contains('show'))
        return () => {
            el.removeEventListener('shown.bs.collapse', onShown)
            el.removeEventListener('hidden.bs.collapse', onHidden)
        }
    }, [])

    const currentFilter = String(new URLSearchParams(location.search).get('filter') || 'all').toLowerCase()

    const setFilter = (next) => {
        const p = new URLSearchParams(location.search)
        const value = String(next || '').toLowerCase()
        if (!value || value === 'all') p.delete('filter')
        else p.set('filter', value)
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' })
    }

    const filterItems = [
        { label: 'All', icon: <FiList /> },
        { label: 'Pending', icon: <FiClock /> },
        { label: 'Completed', icon: <FiCheckCircle /> },
    ]

    const activeFilterLabel = { all: 'All', pending: 'Pending', completed: 'Completed' }[currentFilter] || 'All'

    const handleFilterClick = (label) => {
        const v = String(label || '').toLowerCase()
        if (!['all', 'pending', 'completed'].includes(v)) return
        setFilter(v)
    }

    const fileType = [
        { label: "PDF", icon: <BsFiletypePdf /> },
        { label: "CSV", icon: <BsFiletypeCsv /> },
        { label: "XML", icon: <BsFiletypeXml /> },
        { label: "Text", icon: <BsFiletypeTsx /> },
        { label: "Excel", icon: <BsFiletypeExe /> },
        { label: "Print", icon: <BsPrinter /> },
    ]

    const handleFileExport = (label) => {
        const v = String(label || '').toLowerCase()
        window.dispatchEvent(new CustomEvent('cs:tasks-export', { detail: { format: v } }))
    }

    const closePanel = () => window.dispatchEvent(new Event('cs:close-right-panel'))

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
            <button
                type="button"
                className={`btn btn-icon btn-light-brand ${statsOpen ? 'active' : ''}`}
                data-bs-toggle="collapse"
                data-bs-target="#collapseProjectTasks"
                aria-expanded={statsOpen ? 'true' : 'false'}
                aria-controls="collapseProjectTasks"
                onClick={closePanel}
            >
                <FiBarChart size={16} />
                <span className="d-inline d-md-none ms-2">Statistics</span>
            </button>
            <Dropdown
                dropdownItems={filterItems}
                triggerPosition={"0, 12"}
                triggerIcon={<FiFilter size={16} strokeWidth={1.6} />}
                triggerClass="btn btn-icon btn-light-brand"
                triggerText={<span className="d-inline d-md-none ms-2">Filter</span>}
                isAvatar={false}
                onClick={(label) => { handleFilterClick(label); closePanel() }}
                active={activeFilterLabel}
                dataBsToggle=""
            />
            <Dropdown
                dropdownItems={fileType}
                triggerPosition={"0, 12"}
                triggerIcon={<FiPaperclip size={16} strokeWidth={1.6} />}
                triggerClass='btn btn-icon btn-light-brand'
                triggerText={<span className="d-inline d-md-none ms-2">Export</span>}
                iconStrokeWidth={0}
                isAvatar={false}
                onClick={(label) => { handleFileExport(label); closePanel() }}
                dataBsToggle=""
            />
            {canCreate && (
                <button
                    type="button"
                    className="btn btn-primary d-inline-flex align-items-center gap-2"
                    onClick={() => { window.dispatchEvent(new Event('cs:open-add-task-modal')); closePanel() }}
                >
                    <FiPlus size={16} strokeWidth={1.8} />
                    <span>Add Task</span>
                </button>
            )}
        </div>
    )
}

export default ProjectTasksHeader

export const ProjectTasksHeaderContent = ({ tasks }) => {
    return (
        <div id="collapseProjectTasks" className="accordion-collapse collapse show page-header-collapse payment-header-accordion">
            <div className="accordion-body pb-2">
                <div className="row">
                    <ProjectTasksOverviewCharts tasks={tasks} />
                </div>
            </div>
        </div>
    )
}
