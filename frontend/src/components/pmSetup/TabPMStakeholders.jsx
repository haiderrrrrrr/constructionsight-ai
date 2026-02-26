import RoleInviteTab from './RoleInviteTab';

const TabPMStakeholders = ({ projectId, pendingMembers, setPendingMembers, tabError, onClearTabError, availableUsers, usersLoadError }) => (
  <RoleInviteTab
    projectId={projectId}
    role="stakeholder"
    roleLabel="Stakeholders"
    pendingMembers={pendingMembers}
    setPendingMembers={setPendingMembers}
    tabError={tabError}
    onClearTabError={onClearTabError}
    availableUsers={availableUsers}
    usersLoadError={usersLoadError}
  />
);

export default TabPMStakeholders;
