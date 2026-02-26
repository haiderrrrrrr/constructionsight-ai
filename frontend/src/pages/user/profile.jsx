import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet } from '@/utils/api'
import PageLoader from '@/components/shared/PageLoader'
import useAuthGuard from '@/hooks/useAuthGuard'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import ProfileHeader from '@/components/profile/ProfileHeader'
import ProfileContent from '@/components/profile/ProfileContent'

const ProfilePage = () => {
    const { status } = useAuthGuard()
    const navigate = useNavigate()
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isEditing, setIsEditing] = useState(false)

    useEffect(() => {
        apiGet('/users/me')
            .then(data => setUser(data))
            .catch(() => navigate('/login', { replace: true }))
            .finally(() => setLoading(false))
    }, [navigate])

    if (loading) return <PageLoader minHeight="60vh" />

    if (!user) return null

    return (
        <>
            <PageHeader>
                <ProfileHeader isEditing={isEditing} setIsEditing={setIsEditing} />
            </PageHeader>
            <div className='main-content'>
                <div className='row'>
                    <ProfileContent user={user} setUser={setUser} isEditing={isEditing} setIsEditing={setIsEditing} />
                </div>
            </div>
        </>
    )
}

export default ProfilePage
