import RoleInviteTab from './RoleInviteTab';

const TabPMDataAnalysts = ({ projectId, pendingMembers, setPendingMembers, tabError, onClearTabError, availableUsers, usersLoadError }) => (
  <RoleInviteTab
    projectId={projectId}
    role="data_analyst"
    roleLabel="Data Analysts"
    pendingMembers={pendingMembers}
    setPendingMembers={setPendingMembers}
    tabError={tabError}
    onClearTabError={onClearTabError}
    availableUsers={availableUsers}
    usersLoadError={usersLoadError}
  />
);

export default TabPMDataAnalysts;
