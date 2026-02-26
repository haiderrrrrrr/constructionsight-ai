import RoleInviteTab from './RoleInviteTab';

const TabPMSafetyOfficers = ({ projectId, pendingMembers, setPendingMembers, tabError, onClearTabError, availableUsers, usersLoadError }) => (
  <RoleInviteTab
    projectId={projectId}
    role="safety_officer"
    roleLabel="Safety Officers"
    pendingMembers={pendingMembers}
    setPendingMembers={setPendingMembers}
    tabError={tabError}
    onClearTabError={onClearTabError}
    availableUsers={availableUsers}
    usersLoadError={usersLoadError}
  />
);

export default TabPMSafetyOfficers;
