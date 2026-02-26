import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import ProjectsHeader, { ProjectsHeaderContent } from '@/components/projects/ProjectsHeader'
import ProjectsTable from '@/components/projects/ProjectsTable'

const ProjectsList = () => {
    return (
        <>
            <PageHeader>
                <ProjectsHeader />
            </PageHeader>
            <ProjectsHeaderContent />
            <div className='main-content'>
                <div className='row'>
                    <ProjectsTable />
                </div>
            </div>
        </>
    )
}

export default ProjectsList
