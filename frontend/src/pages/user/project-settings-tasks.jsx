import React from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PerfectScrollbar from 'react-perfect-scrollbar'
import ProjectSettingsForm from '@/components/projectWorkspace/ProjectSettingsForm'

const ProjectSettingsTasks = () => {
    const sections = [
        {
            title: 'Task Configuration',
            fields: [
                { label: 'Default Task Priority', placeholder: 'Medium', info: 'Default priority for new tasks' },
                { label: 'Task Workflow', placeholder: 'Standard', info: 'Task workflow type' },
                { label: 'Auto-assign Tasks', placeholder: 'Disabled', info: 'Enable auto-assignment rules' },
            ]
        }
    ]

    return (
        <div className="content-area">
            <PerfectScrollbar>
                <PageHeaderSetting />
                <div className="content-area-body">
                    <div className="card mb-0">
                        <div className="card-body">
                            <ProjectSettingsForm
                                title="Tasks Settings"
                                description="Configure task management settings for this project"
                                sections={sections}
                            />
                        </div>
                    </div>
                </div>
                <Footer />
            </PerfectScrollbar>
        </div>
    )
}

export default ProjectSettingsTasks
