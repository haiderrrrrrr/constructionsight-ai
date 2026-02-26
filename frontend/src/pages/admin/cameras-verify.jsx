import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import CameraVerifyView from '@/components/cameras/CameraVerifyView'
import CameraHeader from '@/components/cameras/CameraHeader'

const AdminCamerasVerify = () => {
    return (
        <>
            <PageHeader>
                <CameraHeader />
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    <CameraVerifyView />
                </div>
            </div>
        </>
    )
}

export default AdminCamerasVerify
