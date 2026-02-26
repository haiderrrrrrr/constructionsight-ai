import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiGet } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import ProjectMembersHeader, { ProjectMembersHeaderContent } from '@/components/projectWorkspace/ProjectMembersHeader'
import ProjectMembersTable from '@/components/projectWorkspace/ProjectMembersTable'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const ProjectMembersPage = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const [project, setProject] = useState(() => {
        try {
            const cached = sessionStorage.getItem(`cs:projectMeta:${projectId}`)
            if (cached) return JSON.parse(cached)
        } catch {}
        return null
    })
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
                try {
                    sessionStorage.setItem(`cs:projectMeta:${projectId}`, JSON.stringify({
                        name: data.name, my_role: data.my_role, status: data.status,
                        my_email: data.my_email, my_user_id: data.my_user_id,
                    }))
                } catch {}
                setProject(data)
            })
            .catch(() => navigate('/projects/my', { replace: true }))
            .finally(() => setLoading(false))
    }, [projectId, navigate])

    if (loading && !project) return <PageLoader minHeight="60vh" />

    if (!project) return null

    return (
        <>
            <PageHeader>
                <ProjectMembersHeader projectId={parseInt(projectId, 10)} myRole={project?.my_role} />
            </PageHeader>
            <ProjectMembersHeaderContent projectId={parseInt(projectId, 10)} />
            <div className='main-content'>
                <div className='row'>
                    <ProjectMembersTable projectId={parseInt(projectId, 10)} currentUserId={project?.my_user_id} myRole={project?.my_role} />
                </div>
            </div>
        </>
    )
}

export default ProjectMembersPage
