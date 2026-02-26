import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiGet } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import ProjectInvitationsHeader, { ProjectInvitationsHeaderContent } from '@/components/projectWorkspace/ProjectInvitationsHeader'
import ProjectInvitationsTable from '@/components/projectWorkspace/ProjectInvitationsTable'
import InviteMemberModal from '@/components/projectWorkspace/InviteMemberModal'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const ProjectInvitationsPage = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const [project, setProject] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        navigate({ search: '' }, { replace: true })
    }, [])

    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                if (data.my_role !== 'project_manager') {
                    navigate(`/projects/${projectId}/cameras`, { replace: true })
                    return
                }
                setProject(data)
            })
            .catch(() => navigate('/projects/my', { replace: true }))
            .finally(() => setLoading(false))
    }, [projectId, navigate])

    if (loading) return <PageLoader minHeight="60vh" />

    if (!project) return null

    return (
        <>
            <PageHeader>
                <ProjectInvitationsHeader projectId={parseInt(projectId, 10)} />
            </PageHeader>
            <ProjectInvitationsHeaderContent projectId={parseInt(projectId, 10)} />
            <div className='main-content'>
                <div className='row'>
                    <ProjectInvitationsTable projectId={parseInt(projectId, 10)} currentUserEmail={project?.my_email} />
                </div>
            </div>
            <InviteMemberModal projectId={parseInt(projectId, 10)} />
        </>
    )
}

export default ProjectInvitationsPage
