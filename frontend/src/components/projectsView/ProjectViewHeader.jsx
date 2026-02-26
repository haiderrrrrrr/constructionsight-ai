import React from 'react'
import { FiMoreVertical, FiEdit2, FiRotateCcw } from 'react-icons/fi'
import getIcon from '@/utils/getIcon'

const ProjectViewHeader = ({ project, isPinned, onPin, onMarkComplete, onUnmarkComplete, onEditDetails, showPin = true }) => {
    const isCompleted = project?.status === 'completed'

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
            <div className="filter-dropdown">
                <a className="btn btn-icon btn-light-brand" data-bs-toggle="dropdown" data-bs-offset="0, 10" data-bs-auto-close="outside">
                    <i className='lh-1'><FiMoreVertical /></i>
                </a>
                <div className="dropdown-menu dropdown-menu-end">
                    {onEditDetails && (
                        <>
                            <li>
                                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onEditDetails() }}>
                                    <i className='me-3'><FiEdit2 size={15} /></i>
                                    <span>Edit Details</span>
                                </a>
                            </li>
                            <li className="dropdown-divider" />
                        </>
                    )}

                    {/* Pin / Unpin — always available regardless of status */}
                    {showPin && (
                        <>
                            <li>
                                <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onPin?.() }}>
                                    <i className='me-3'>{getIcon('feather-map-pin')}</i>
                                    <span>{isPinned ? 'Unpin Project' : 'Pin Project'}</span>
                                </a>
                            </li>
                            {(onEditDetails || onMarkComplete || onUnmarkComplete) && (
                                <li className="dropdown-divider" />
                            )}
                        </>
                    )}

                    {onMarkComplete && !isCompleted && (
                        <li>
                            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onMarkComplete() }}>
                                <i className='me-3'>{getIcon('feather-check-circle')}</i>
                                <span>Mark as Complete</span>
                            </a>
                        </li>
                    )}

                    {onUnmarkComplete && isCompleted && (
                        <li>
                            <a href="#" className="dropdown-item" onClick={(e) => { e.preventDefault(); onUnmarkComplete() }}>
                                <i className='me-3'><FiRotateCcw size={15} /></i>
                                <span>Unmark as Complete</span>
                            </a>
                        </li>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ProjectViewHeader
