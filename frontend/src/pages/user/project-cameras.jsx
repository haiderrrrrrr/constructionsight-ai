import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiGet } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import ProjectCamerasTable from '@/components/projectWorkspace/ProjectCamerasTable'
import ProjectCamerasHeader, { ProjectCamerasHeaderContent } from '@/components/projectWorkspace/ProjectCamerasHeader'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const roleLabelMap = {
    project_manager: 'Project Manager',
    site_supervisor: 'Site Supervisor',
    safety_officer: 'Safety Officer',
    data_analyst: 'Data Analyst',
    stakeholder: 'Stakeholder',
}

const ProjectCamerasPage = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const [project, setProject] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                setProject(data)
                if (
                    data.my_role === 'project_manager' &&
                    ['draft', 'setup_in_progress'].includes(data.status)
                ) {
                    navigate(`/projects/${projectId}/setup`, { replace: true })
                }
            })
            .catch(() => navigate('/projects/my', { replace: true }))
            .finally(() => setLoading(false))
    }, [projectId, navigate])

    if (loading) return <PageLoader minHeight="60vh" />

    if (!project) return null

    return (
        <>
            <PageHeader>
                <ProjectCamerasHeader />
            </PageHeader>
            <ProjectCamerasHeaderContent />
            <div className="main-content">
                <div className="row">
                    <ProjectCamerasTable
                        myRole={project.my_role}
                        projectStatus={project.status}
                        isArchived={project.status === 'archived'}
                    />
                </div>
            </div>
        </>
    )
}

export default ProjectCamerasPage
