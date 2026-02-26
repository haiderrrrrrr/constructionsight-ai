import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { apiGet } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import ProjectZonesContent from '@/components/projectWorkspace/ProjectZonesContent'
import ProjectZonesHeader, { ProjectZonesHeaderContent } from '@/components/projectWorkspace/ProjectZonesHeader'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const roleLabelMap = {
    project_manager: 'Project Manager',
    site_supervisor: 'Site Supervisor',
    safety_officer: 'Safety Officer',
    data_analyst: 'Data Analyst',
    stakeholder: 'Stakeholder',
}

const ProjectZonesPage = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const [project, setProject] = useState(null)
    const [loading, setLoading] = useState(true)

    // Reset filter to 'all' on page mount
    useEffect(() => {
        const p = new URLSearchParams(location.search)
        if (!p.has('filter')) return
        p.delete('filter')
        const search = p.toString()
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
    }, [])

    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                const role = data.my_role
                // Only PM and Safety Officer can access Zones
                if (role !== 'project_manager' && role !== 'safety_officer' && role !== 'site_supervisor' && role !== 'data_analyst') {
                    navigate(`/projects/${projectId}/cameras`, { replace: true })
                    return
                }
                // PM in draft/setup must complete setup first
                if (role === 'project_manager' && ['draft', 'setup_in_progress'].includes(data.status)) {
                    navigate(`/projects/${projectId}/setup`, { replace: true })
                    return
                }
                setProject(data)
            })
            .catch(() => navigate('/projects/my', { replace: true }))
            .finally(() => setLoading(false))
    }, [projectId, navigate])

    if (loading) return <PageLoader minHeight="60vh" />

    if (!project) return null

    const isArchived = project.status === 'archived'
    const isPM = project.my_role === 'project_manager'
    const canWrite = isPM && !isArchived

    return (
        <>
            <PageHeader>
                <ProjectZonesHeader canWrite={canWrite} />
            </PageHeader>
            <ProjectZonesHeaderContent />
            <div className="main-content">
                <div className="row">
                    <ProjectZonesContent
                        myRole={project.my_role}
                        isArchived={isArchived}
                    />
                </div>
            </div>
        </>
    )
}

export default ProjectZonesPage
