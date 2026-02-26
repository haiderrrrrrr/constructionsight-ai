import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import CameraAddContent from '@/components/cameras/CameraAddContent'
import { Link } from 'react-router-dom'
import { FiCamera, FiList } from 'react-icons/fi'

const AdminCamerasAdd = () => {
    return (
        <>
            <PageHeader>
                <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                    <Link to="/admin/cameras/list" className="btn btn-light-brand d-inline-flex align-items-center gap-2">
                        <FiList size={15} />
                        <span>Camera Registry</span>
                    </Link>
                    <button
                        type="button"
                        className="btn btn-primary d-inline-flex align-items-center gap-2"
                        onClick={() => document.getElementById('camera-add-form')?.requestSubmit()}
                    >
                        <FiCamera size={15} strokeWidth={2} />
                        <span>Add Camera</span>
                    </button>
                </div>
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    <CameraAddContent />
                </div>
            </div>
        </>
    )
}

export default AdminCamerasAdd
