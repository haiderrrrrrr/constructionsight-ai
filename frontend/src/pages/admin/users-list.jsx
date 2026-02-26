import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import UsersHeader, { UsersHeaderContent } from '@/components/adminUsers/UsersHeader'
import UsersTable from '@/components/adminUsers/UsersTable'

const UsersList = () => {
    const navigate = useNavigate()

    useEffect(() => {
        navigate({ search: '' }, { replace: true })
    }, [])

    return (
        <>
            <PageHeader>
                <UsersHeader />
            </PageHeader>
            <UsersHeaderContent />
            <div className='main-content'>
                <div className='row'>
                    <UsersTable />
                </div>
            </div>
        </>
    )
}

export default UsersList
