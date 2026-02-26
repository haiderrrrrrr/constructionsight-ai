import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/pageHeader/PageHeader'
import InvitationsHeader, { InvitationsHeaderContent } from '@/components/invitations/InvitationsHeader'
import InvitationsTable from '@/components/invitations/InvitationsTable'

const InvitationsList = () => {
    const navigate = useNavigate()

    useEffect(() => {
        navigate({ search: '' }, { replace: true })
    }, [])

    return (
        <>
            <PageHeader>
                <InvitationsHeader />
            </PageHeader>
            <InvitationsHeaderContent />
            <div className='main-content'>
                <div className='row'>
                    <InvitationsTable />
                </div>
            </div>
        </>
    )
}

export default InvitationsList
