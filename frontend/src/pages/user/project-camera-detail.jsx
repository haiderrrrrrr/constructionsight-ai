import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { apiGet } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import PMCameraVerifyView from '@/components/projectWorkspace/PMCameraVerifyView'
import PageHeader from '@/components/shared/pageHeader/PageHeader'

const ProjectCameraDetailPage = () => {
    const { projectId, cameraId } = useParams()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Verify membership — redirect if camera not accessible
        apiGet(`/projects/${projectId}/cameras/${cameraId}`)
            .catch(() => navigate(`/projects/${projectId}/cameras`, { replace: true }))
            .finally(() => setLoading(false))
    }, [projectId, cameraId, navigate])

    if (loading) return <PageLoader minHeight="60vh" />

    return (
        <>
            <PageHeader />
            <div className="main-content">
                <div className="row">
                    <PMCameraVerifyView />
                </div>
            </div>
        </>
    )
}

export default ProjectCameraDetailPage
