import React from 'react';
import InvitationsList from '../../components/invitations/InvitationsList';

const UserInvitations = () => {
    return (
        <div className="nxl-content-inner">
            <div className="page-header">
                <div className="page-header-left">
                    <h5 className="page-header-title fw-bold">My Invitations</h5>
                    <p className="text-muted mb-0 small">Project invitations sent to your account.</p>
                </div>
            </div>
            <InvitationsList />
        </div>
    );
};

export default UserInvitations;
