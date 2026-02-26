import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import CameraTable from '@/components/cameras/CameraTable'
import CameraHeader, { CameraHeaderContent } from '@/components/cameras/CameraHeader'
import Footer from '@/components/shared/Footer'

const AdminCamerasList = () => {
    return (
        <>
            <PageHeader>
                <CameraHeader />
            </PageHeader>
            <CameraHeaderContent />
            <div className='main-content'>
                <div className='row'>
                    <CameraTable />
                </div>
            </div>
            <Footer />
        </>
    )
}

export default AdminCamerasList
