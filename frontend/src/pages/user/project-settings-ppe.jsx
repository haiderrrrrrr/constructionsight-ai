import React from 'react'
import { useParams } from 'react-router-dom'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PerfectScrollbar from 'react-perfect-scrollbar'
import ProjectPPESettingsForm from '@/components/projectWorkspace/ProjectPPESettingsForm'

const ProjectSettingsPPE = () => {
    const { projectId } = useParams()
    return (
        <div className="content-area">
            <PerfectScrollbar>
                <PageHeaderSetting showActions={false} />
                <div className="content-area-body">
                    <div className="card mb-0">
                        <div className="card-body">
                            <ProjectPPESettingsForm projectId={projectId} />
                        </div>
                    </div>
                </div>
                <Footer />
            </PerfectScrollbar>
        </div>
    )
}

export default ProjectSettingsPPE
