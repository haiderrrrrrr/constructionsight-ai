import React from 'react'
import { useParams } from 'react-router-dom'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import ProjectCreateContent from '@/components/projectsCreate/ProjectCreateContent'
import ProjectCreateHeader from '@/components/projectsCreate/ProjectCreateHeader'

const ProjectsCreate = ({ mode: propMode }) => {
    const { id } = useParams()
    const mode = propMode || "admin_shell"

    return (
        <>
            <PageHeader>
                <ProjectCreateHeader mode={mode} projectId={id} />
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    <ProjectCreateContent mode={mode} projectId={id} />
                </div>
            </div>

        </>
    )
}

export default ProjectsCreate
