import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import CameraHealthContent from '@/components/cameras/CameraHealthContent'
import CameraHeader, { CameraHeaderContent } from '@/components/cameras/CameraHeader'
import Footer from '@/components/shared/Footer'

const AdminCamerasHealth = () => {
    return (
        <>
            <PageHeader>
                <CameraHeader />
            </PageHeader>
            <CameraHeaderContent />
            <div className='main-content'>
                <div className='row'>
                    <CameraHealthContent />
                </div>
            </div>
            <Footer />
        </>
    )
}

export default AdminCamerasHealth
