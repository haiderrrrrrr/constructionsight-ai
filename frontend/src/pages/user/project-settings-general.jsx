import React from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PerfectScrollbar from 'react-perfect-scrollbar'
import ProjectSettingsForm from '@/components/projectWorkspace/ProjectSettingsForm'

const ProjectSettingsGeneral = () => {
    const sections = [
        {
            title: 'Project Information',
            fields: [
                { label: 'Project Name', placeholder: 'Enter project name', info: 'The name of this project' },
                { label: 'Location', placeholder: 'Enter project location', info: 'Project site location' },
                { label: 'Client Name', placeholder: 'Enter client name', info: 'Primary client or company name' },
            ]
        },
        {
            title: 'Contact Details',
            fields: [
                { label: 'Phone', placeholder: 'Project phone number', info: 'Main project contact number' },
                { label: 'Email', placeholder: 'Project email', info: 'Project communication email' },
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
                                title="General Settings"
                                description="Configure general project information and contact details"
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

export default ProjectSettingsGeneral
