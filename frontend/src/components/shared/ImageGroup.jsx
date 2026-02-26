import React from 'react'
import { FiMoreHorizontal } from 'react-icons/fi'
import { Link } from 'react-router-dom'

const ImageGroup = ({ data = [], avatarSize = "avatar-sm", avatarMore, avatarStyle = '', avatarImageStyle = '' }) => {
    return (
        <>
            {data.map(({ user_name, user_img, id }, index) => (
                <Link
                    key={index}
                    href="#"
                    className={['avatar-image', avatarSize, avatarImageStyle].filter(Boolean).join(' ')}
                    data-bs-toggle="tooltip"
                    data-bs-trigger="hover"
                    title={user_name}
                >
                    <img src={user_img} className="img-fluid" alt="image" />
                </Link>
            ))}
            <Link
                href="#"
                className={['avatar-text', avatarSize, avatarStyle].filter(Boolean).join(' ')}
                data-bs-toggle="tooltip"
                data-bs-trigger="hover"
                title="Explore More"
            >
                {avatarMore || <FiMoreHorizontal />}
            </Link>
        </>
    )
}

export default ImageGroup
