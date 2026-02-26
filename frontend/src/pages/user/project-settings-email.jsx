import React from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PerfectScrollbar from 'react-perfect-scrollbar'
import ProjectSettingsForm from '@/components/projectWorkspace/ProjectSettingsForm'

const ProjectSettingsEmail = () => {
    const sections = [
        {
            title: 'Email Configuration',
            fields: [
                { label: 'SMTP Server', placeholder: 'smtp.example.com', info: 'SMTP server address' },
                { label: 'SMTP Port', placeholder: '587', info: 'SMTP port number' },
                { label: 'Email Address', placeholder: 'noreply@example.com', info: 'Sender email address' },
                { label: 'Email Password', placeholder: '••••••••', info: 'SMTP authentication password' },
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
                                title="Email Settings"
                                description="Configure email notifications for this project"
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

export default ProjectSettingsEmail
