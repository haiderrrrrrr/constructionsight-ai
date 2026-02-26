import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import Footer from '@/components/shared/Footer'
import SitesContent from '@/components/cameras/SitesContent'

const AdminCamerasSites = () => {
    return (
        <>
            <PageHeader currentPageIcon="feather-map-pin" currentPageText="Construction Sites" />
            <div className='main-content'>
                <SitesContent />
            </div>
            <Footer />
        </>
    )
}

export default AdminCamerasSites
