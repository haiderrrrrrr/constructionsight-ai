import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ProjectLiveView from '@/components/projectWorkspace/ProjectLiveView'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import ProjectLiveViewHeader from '@/components/projectWorkspace/ProjectLiveViewHeader'
import { apiGet } from '@/utils/api'
import topTostError from '@/utils/topTostError'

const ProjectLiveViewPage = () => {
    const { projectId } = useParams()
    const navigate = useNavigate()
    const [allowed, setAllowed] = useState(null) // null = loading

    useEffect(() => {
        apiGet(`/projects/${projectId}`)
            .then(data => {
                if (data.my_role === 'project_manager') {
                    setAllowed(true)
                } else {
                    topTostError('Feature Control is only accessible to the Project Manager.')
                    navigate(`/projects/${projectId}/info`, { replace: true })
                }
            })
            .catch(() => {
                navigate('/projects/my', { replace: true })
            })
    }, [projectId])

    if (allowed === null) return null

    return (
        <>
            <PageHeader>
                <ProjectLiveViewHeader />
            </PageHeader>
            <ProjectLiveView projectId={projectId} />
        </>
    )
}

export default ProjectLiveViewPage
