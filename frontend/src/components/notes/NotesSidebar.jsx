import React from 'react'
import { FiArchive, FiBriefcase, FiCast, FiCheckCircle, FiCommand, FiLayers, FiPlus, FiStar, FiTool, FiUser, FiX } from 'react-icons/fi'
import PerfectScrollbar from 'react-perfect-scrollbar'

const ALL_CATEGORIES = ['alls', 'tasks', 'work', 'team', 'archive', 'urgent', 'personal', 'client', 'important']

const NotesSidebar = ({ setSelectTab, selectTab, sidebarOpen, setSidebarOpen }) => {
    return (
        <div className={`content-sidebar content-sidebar-md ${sidebarOpen ? "app-sidebar-open" : ""}`}>
            <PerfectScrollbar>
                <div className="content-sidebar-header bg-white sticky-top hstack justify-content-between">
                    <h4 className="fw-bolder mb-0">Notes</h4>
                    <a href="#" className="app-sidebar-close-trigger d-flex" onClick={() => setSidebarOpen(false)}>
                        <FiX />
                    </a>
                </div>
                <div className="content-sidebar-header">
                    <button
                        type="button"
                        className="btn btn-primary w-100"
                        onClick={() => window.dispatchEvent(new Event('cs:open-add-note'))}
                    >
                        <FiPlus size={17} className='me-2' />
                        <span>Add Notes</span>
                    </button>
                </div>
                <div className="content-sidebar-body">
                    <ul className="nav d-flex flex-column nxl-content-sidebar-item">
                        {
                            ALL_CATEGORIES.map((category) => (
                                <li key={category} className="nav-item">
                                    <a
                                        href="#"
                                        className={`nav-link note-link text-capitalize ${selectTab === category ? "active" : ""}`}
                                        onClick={() => setSelectTab(category)}
                                    >
                                        {getIcon(category)}
                                        <span>{getCategoryLabel(category)}</span>
                                    </a>
                                </li>
                            ))
                        }
                    </ul>
                </div>
            </PerfectScrollbar>
        </div>
    )
}

export default NotesSidebar

const getCategoryLabel = (category) => {
    const labels = {
        alls:      'All Notes',
        tasks:     'Tasks',
        work:      'Work',
        team:      'Team',
        archive:   'Archive',
        urgent:    'Urgent',
        personal:  'Personal',
        client:    'Client',
        important: 'Important',
    }
    return labels[category] || category
}

const getIcon = (category) => {
    switch (category) {
        case "alls":      return <FiLayers size={16} />
        case "tasks":     return <FiCheckCircle size={16} />
        case "important": return <FiStar size={16} />
        case "work":      return <FiTool size={16} />
        case "client":    return <FiBriefcase size={16} />
        case "archive":   return <FiArchive size={16} />
        case "personal":  return <FiUser size={16} />
        case "urgent":    return <FiCommand size={16} />
        case "team":      return <FiCast size={16} />
        default:          return null
    }
}
