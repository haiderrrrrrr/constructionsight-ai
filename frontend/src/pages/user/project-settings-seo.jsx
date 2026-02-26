import React from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PerfectScrollbar from 'react-perfect-scrollbar'
import ProjectSettingsForm from '@/components/projectWorkspace/ProjectSettingsForm'

const ProjectSettingsSEO = () => {
    const sections = [
        {
            title: 'Project SEO',
            fields: [
                { label: 'Meta Title', placeholder: 'Project meta title', info: 'SEO meta title for project' },
                { label: 'Meta Description', placeholder: 'Meta description', info: 'SEO meta description' },
                { label: 'Keywords', placeholder: 'Project keywords', info: 'Comma-separated keywords' },
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
                                title="SEO Settings"
                                description="Configure search engine optimization settings for this project"
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

export default ProjectSettingsSEO
