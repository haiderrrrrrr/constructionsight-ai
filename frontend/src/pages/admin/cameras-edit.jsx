import React from 'react'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import CameraAddContent from '@/components/cameras/CameraAddContent'
import { Link, useParams } from 'react-router-dom'
import { FiCheck, FiList } from 'react-icons/fi'

const AdminCamerasEdit = () => {
    const { id } = useParams()
    return (
        <>
            <PageHeader>
                <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
                    <Link to="/admin/cameras/list" className="btn btn-light-brand d-inline-flex align-items-center gap-2">
                        <FiList size={15} />
                        <span>Camera List</span>
                    </Link>
                    <button
                        type="button"
                        className="btn btn-primary d-inline-flex align-items-center gap-2"
                        onClick={() => document.getElementById('camera-edit-form')?.requestSubmit()}
                    >
                        <FiCheck size={15} strokeWidth={2} />
                        <span>Update Camera</span>
                    </button>
                </div>
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    <CameraAddContent mode="edit" cameraId={id} />
                </div>
            </div>
        </>
    )
}

export default AdminCamerasEdit
