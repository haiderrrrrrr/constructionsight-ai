import React from 'react'
import PageHeaderSetting from '@/components/shared/pageHeader/PageHeaderSetting'
import Footer from '@/components/shared/Footer'
import PerfectScrollbar from 'react-perfect-scrollbar'
import ProjectSettingsForm from '@/components/projectWorkspace/ProjectSettingsForm'

const ProjectSettingsOther = ({ settingType = 'general' }) => {
    const settingsConfig = {
        tags: {
            title: 'Tags Settings',
            description: 'Manage tags for this project',
            sections: [{
                title: 'Tag Configuration',
                fields: [
                    { label: 'Tag Name', placeholder: 'Enter tag', info: 'Create custom tags' },
                    { label: 'Tag Color', placeholder: '#000000', info: 'Tag display color' },
                ]
            }]
        },
        leads: {
            title: 'Leads Settings',
            description: 'Configure leads management for this project',
            sections: [{
                title: 'Lead Configuration',
                fields: [
                    { label: 'Lead Source', placeholder: 'Source', info: 'Default lead source' },
                    { label: 'Lead Status', placeholder: 'New', info: 'Default lead status' },
                ]
            }]
        },
        support: {
            title: 'Support Settings',
            description: 'Configure support settings for this project',
            sections: [{
                title: 'Support Configuration',
                fields: [
                    { label: 'Support Email', placeholder: 'support@example.com', info: 'Support contact email' },
                    { label: 'Support Phone', placeholder: '+1-800-000-0000', info: 'Support phone number' },
                ]
            }]
        },
        finance: {
            title: 'Finance Settings',
            description: 'Configure financial settings for this project',
            sections: [{
                title: 'Finance Configuration',
                fields: [
                    { label: 'Currency', placeholder: 'USD', info: 'Default currency' },
                    { label: 'Tax Rate', placeholder: '0%', info: 'Default tax rate' },
                ]
            }]
        },
        gateways: {
            title: 'Payment Gateways',
            description: 'Configure payment gateway settings for this project',
            sections: [{
                title: 'Gateway Configuration',
                fields: [
                    { label: 'Gateway Provider', placeholder: 'Select provider', info: 'Payment gateway provider' },
                    { label: 'API Key', placeholder: '••••••••', info: 'Gateway API key' },
                ]
            }]
        },
        customers: {
            title: 'Customers Settings',
            description: 'Configure customer settings for this project',
            sections: [{
                title: 'Customer Configuration',
                fields: [
                    { label: 'Customer Portal', placeholder: 'Enabled', info: 'Enable customer portal' },
                    { label: 'Auto-notify Customers', placeholder: 'Enabled', info: 'Auto-send notifications' },
                ]
            }]
        },
        localization: {
            title: 'Localization Settings',
            description: 'Configure language and regional settings for this project',
            sections: [{
                title: 'Localization Configuration',
                fields: [
                    { label: 'Language', placeholder: 'English', info: 'Default language' },
                    { label: 'Timezone', placeholder: 'UTC', info: 'Project timezone' },
                ]
            }]
        },
        recaptcha: {
            title: 'reCAPTCHA Settings',
            description: 'Configure reCAPTCHA protection for this project',
            sections: [{
                title: 'reCAPTCHA Configuration',
                fields: [
                    { label: 'Site Key', placeholder: '••••••••', info: 'reCAPTCHA site key' },
                    { label: 'Secret Key', placeholder: '••••••••', info: 'reCAPTCHA secret key' },
                ]
            }]
        },
        miscellaneous: {
            title: 'Miscellaneous Settings',
            description: 'Other configuration options for this project',
            sections: [{
                title: 'Other Settings',
                fields: [
                    { label: 'Setting Name', placeholder: 'Value', info: 'Custom setting' },
                ]
            }]
        }
    }

    const config = settingsConfig[settingType] || settingsConfig.general

    return (
        <div className="content-area">
            <PerfectScrollbar>
                <PageHeaderSetting />
                <div className="content-area-body">
                    <div className="card mb-0">
                        <div className="card-body">
                            <ProjectSettingsForm
                                title={config.title}
                                description={config.description}
                                sections={config.sections}
                            />
                        </div>
                    </div>
                </div>
                <Footer />
            </PerfectScrollbar>
        </div>
    )
}

export default ProjectSettingsOther
