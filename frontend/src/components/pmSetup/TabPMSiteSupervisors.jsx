import RoleInviteTab from './RoleInviteTab';

const TabPMSiteSupervisors = ({ projectId, pendingMembers, setPendingMembers, tabError, onClearTabError, availableUsers, usersLoadError }) => (
  <RoleInviteTab
    projectId={projectId}
    role="site_supervisor"
    roleLabel="Site Supervisors"
    pendingMembers={pendingMembers}
    setPendingMembers={setPendingMembers}
    tabError={tabError}
    onClearTabError={onClearTabError}
    availableUsers={availableUsers}
    usersLoadError={usersLoadError}
  />
);

export default TabPMSiteSupervisors;
