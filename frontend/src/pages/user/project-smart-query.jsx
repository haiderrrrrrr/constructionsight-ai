import React from 'react'
import { useParams, Navigate } from 'react-router-dom'
import SmartQueryAssistant from '@/components/smartQuery/SmartQueryAssistant'

const ProjectSmartQueryPage = () => {
  const { projectId } = useParams()
  if (!projectId) return <Navigate to="/projects/my" replace />

  return (
    <SmartQueryAssistant scope="project" projectId={parseInt(projectId, 10)} />
  )
}

export default ProjectSmartQueryPage
