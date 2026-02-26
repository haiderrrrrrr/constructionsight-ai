import React from 'react'
import { Outlet, useParams } from 'react-router-dom'
import ProjectSettingsSidebar from '@/components/projectWorkspace/ProjectSettingsSidebar'

const LayoutProjectSettings = () => {
    const { projectId } = useParams()

    return (
        <div className='main-content d-flex'>
            <ProjectSettingsSidebar projectId={projectId} />
            <Outlet />
        </div>
    )
}

export default LayoutProjectSettings
