import React from 'react'
import { FiEdit } from 'react-icons/fi'

const ProfileHeader = ({ isEditing, setIsEditing }) => {
    const handleEditClick = () => {
        setIsEditing(!isEditing)
        window.dispatchEvent(new Event('cs:close-right-panel'))
    }

    return (
        <div className="d-flex align-items-center gap-2 page-header-right-items-wrapper">
            <button
                type="button"
                className="btn btn-primary d-inline-flex align-items-center gap-2"
                onClick={handleEditClick}
                disabled={isEditing}
            >
                <FiEdit size={15} strokeWidth={1.8} />
                Edit Profile
            </button>
        </div>
    )
}

export default ProfileHeader
