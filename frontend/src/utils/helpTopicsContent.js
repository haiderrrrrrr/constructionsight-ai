// Keyed by topic title — used by SupportDetails offcanvas to render dynamic answers
const helpTopicsContent = {

    // ─── Trending Questions ────────────────────────────────────────────────────

    'How do I invite a Project Manager to a project?': {
        category: 'Team & Roles',
        intro: 'Every project in ConstructionSight AI requires a designated Project Manager who oversees the setup wizard and day-to-day site coordination. Here is how to invite one.',
        steps: [
            'Go to Admin Panel and open the Projects List.',
            'Find the project in DRAFT status and open its details.',
            'Navigate to the Assigned tab inside the project form.',
            'Enter the PM\'s email address in the invitation field.',
            'If the user already has an account, they are linked directly and notified.',
            'If the user has no account, an invitation email is sent with a secure 7-day link.',
            'The PM must click the link and accept to gain project access.',
            'You can monitor invitation status from the Invitations section of the project.',
            'If the invitation expires before the PM accepts, use the Resend button to issue a fresh one.',
        ],
        note: 'Only one active invitation per project per email is allowed at a time. Resending invalidates the old token automatically.',
    },

    'Why is my camera showing as offline or unreachable?': {
        category: 'Troubleshooting',
        intro: 'A camera is marked offline when the system\'s health check cannot establish a connection to it via the configured RTSP or ONVIF endpoint. Work through the following checks to diagnose the issue.',
        steps: [
            'Verify the camera is powered on and physically connected to the network.',
            'Confirm the camera\'s IP address and port are correctly entered in the Connection tab.',
            'Check that the RTSP URL format is valid: rtsp://username:password@host:port/stream',
            'Ensure the ONVIF host, port, and credentials match what is configured on the camera itself.',
            'Run a manual health check from Admin > Cameras > Verify to get a specific error message.',
            'If the camera is on a private network or behind a VPN, ensure the ConstructionSight server can reach it.',
            'Check if any firewall rules are blocking the RTSP or ONVIF port on the camera or network.',
            'If the issue persists, try accessing the camera\'s own admin web panel to confirm it is functional.',
        ],
        note: 'The scheduler auto-checks all cameras every 5 minutes by default. After fixing credentials or network issues, wait one cycle or trigger a manual verify to confirm the camera is back online.',
    },

    'How do I move a project from DRAFT to ACTIVE?': {
        category: 'Project Management',
        intro: 'Projects in ConstructionSight AI follow a structured four-stage lifecycle. The transition from DRAFT to ACTIVE is driven by the Project Manager completing the setup wizard.',
        steps: [
            'Admin creates the project — it starts in DRAFT status.',
            'Admin invites a PM via the Assigned tab using the PM\'s email.',
            'The PM receives the invitation email and clicks the acceptance link.',
            'Project status moves to SETUP_IN_PROGRESS automatically.',
            'The PM logs in and navigates to their assigned project.',
            'The PM works through all 8 tabs of the setup wizard (site details, cameras, zones, team, etc.).',
            'On the final wizard tab, the PM reviews and submits the setup.',
            'The project status transitions to ACTIVE — all team members gain full access.',
        ],
        note: 'If the project is stuck in SETUP_IN_PROGRESS, check that the PM has accepted the invitation and is progressing through the wizard. Admins cannot force-activate a project; the PM must complete setup.',
    },

    'How do I resend an expired PM invitation?': {
        category: 'Team & Roles',
        intro: 'PM invitations are valid for 7 days. If a PM does not accept within that window, the invitation expires and must be reissued.',
        steps: [
            'Go to Admin Panel > Projects List and open the relevant project.',
            'Navigate to the Invitations section within the project details.',
            'Locate the invitation showing EXPIRED status.',
            'Click the Resend button next to the expired invitation.',
            'A new 7-day invitation is generated and emailed to the PM automatically.',
            'The old token is invalidated immediately — the PM\'s previous link will no longer work.',
            'The PM will receive a fresh email with a new secure invitation link.',
        ],
        note: 'If the PM reports not receiving the email, ask them to check their spam folder. The email is sent from constructionsightai@gmail.com.',
    },

    'Can I delete a project that is already ACTIVE?': {
        category: 'Project Management',
        intro: 'No. Permanent deletion is only allowed for projects in DRAFT status. Once a project becomes ACTIVE, it can only be archived.',
        points: [
            'DRAFT projects can be permanently deleted — this also removes the associated construction site.',
            'ACTIVE projects cannot be deleted to protect audit records, camera links, and team data.',
            'To stop work on an ACTIVE project, use the Archive action instead.',
            'Archived projects are read-only — no edits, new cameras, or team changes are allowed.',
            'Archived projects can be unarchived and restored to ACTIVE status if needed.',
            'If permanent removal of an ACTIVE project is required, contact your system administrator.',
        ],
        note: 'Archiving is reversible. Deletion is not. Always prefer archiving over deletion for any project that has had real activity.',
    },

    'How do I configure RTSP credentials for a camera?': {
        category: 'Camera Management',
        intro: 'Camera connections in ConstructionSight AI use RTSP for video streaming and ONVIF for device management. Both require credentials to be configured correctly.',
        steps: [
            'Go to Admin Panel > Cameras List.',
            'Find the camera you want to configure and click Edit.',
            'In the camera edit wizard, navigate to the Connection tab.',
            'Enter the full RTSP stream URL in the format: rtsp://username:password@host:port/stream',
            'Enter the ONVIF host (usually the camera\'s IP address).',
            'Enter the ONVIF port (default is 80, but varies by manufacturer).',
            'Enter the ONVIF username and password — these may differ from the RTSP credentials.',
            'Save the Connection tab.',
            'Navigate to the Verify tab and run a health check to confirm the connection.',
        ],
        note: 'If the health check fails after entering correct credentials, check that the camera\'s ONVIF service is enabled. This is usually a setting in the camera\'s own admin panel.',
    },

    'Why can\'t I edit my project details anymore?': {
        category: 'Project Management',
        intro: 'Project details are editable only while the project is in DRAFT status. Once the PM accepts the invitation and setup begins, core project fields are locked.',
        points: [
            'In DRAFT status: all fields (name, location, type, PM assignment) can be freely edited.',
            'In SETUP_IN_PROGRESS: core fields are locked — the PM has already begun building on them.',
            'In ACTIVE status: the project is fully locked for edits to protect integrity.',
            'In ARCHIVED status: the project is fully read-only.',
            'Fields like project name, location, and construction type cannot be changed after DRAFT.',
            'If a correction is genuinely necessary, contact your system administrator for a direct assessment.',
        ],
        note: 'This restriction is intentional. Changing core project details mid-setup or mid-operation would invalidate the PM\'s work and cause data inconsistencies.',
    },

    // ─── Getting Started ───────────────────────────────────────────────────────

    'Creating your first project': {
        category: 'Getting Started',
        intro: 'Creating a project is the first step in setting up a construction site in ConstructionSight AI. Only admins can create projects.',
        steps: [
            'Log in as an Admin and go to Admin Panel > Projects.',
            'Click the Create Project button in the top right.',
            'Fill in the project name and construction site location.',
            'Select the project type (residential, commercial, infrastructure, etc.).',
            'On the Assigned tab, optionally invite a Project Manager by email.',
            'Complete the Completed tab to submit the project.',
            'The project is created in DRAFT status — you can edit it further before activating.',
            'Once a PM accepts their invitation, the project moves forward automatically.',
        ],
        note: 'A project in DRAFT can be freely edited or deleted. Once a PM accepts, it enters SETUP_IN_PROGRESS and changes are locked.',
    },

    'Inviting a Project Manager': {
        category: 'Getting Started',
        intro: 'The Project Manager is responsible for completing the project setup and managing day-to-day operations on site. Inviting them is done from the admin project form.',
        steps: [
            'Open the project in DRAFT status from Admin > Projects List.',
            'Navigate to the Assigned tab.',
            'Enter the PM\'s email address in the invitation field.',
            'If the user exists in the system, they are linked directly.',
            'If the user does not exist, an invitation email is dispatched.',
            'The PM has 7 days to accept before the invitation expires.',
            'Monitor the invitation status from the project\'s Invitations section.',
        ],
        note: 'The PM does not have admin-level access. They can only manage projects they are assigned to.',
    },

    'Accepting a PM invitation': {
        category: 'Getting Started',
        intro: 'When an admin invites you as a Project Manager, you will receive an email with a secure invitation link. Here is what to do next.',
        steps: [
            'Check your email inbox for a message from constructionsightai@gmail.com.',
            'Click the Accept Invitation button in the email.',
            'You will be redirected to the ConstructionSight AI login or registration page.',
            'Log in with your existing account or register if you are new.',
            'After logging in, you will be taken directly to the project setup wizard.',
            'Work through the wizard tabs to configure the project.',
            'Once all tabs are completed and submitted, the project becomes ACTIVE.',
        ],
        note: 'The invitation link is valid for 7 days. If it has expired, ask the admin to resend it from the project\'s Invitations section.',
    },

    'Understanding the setup wizard': {
        category: 'Getting Started',
        intro: 'The PM setup wizard guides the Project Manager through all configuration steps required to activate a project. It consists of 8 structured tabs.',
        points: [
            'Tab 1 — Project Type: Confirm or set the type of construction project.',
            'Tab 2 — Project Details: Name, location, description, and key dates.',
            'Tab 3 — Site Configuration: Define the physical construction site parameters.',
            'Tab 4 — Camera Setup: Add and configure cameras for the site.',
            'Tab 5 — Zones: Define monitoring zones within the site.',
            'Tab 6 — Team: Review and confirm team membership.',
            'Tab 7 — Settings: Configure notifications, reports, and preferences.',
            'Tab 8 — Completed: Final review and submission to activate the project.',
        ],
        note: 'You can navigate back to previously completed tabs by clicking them. You cannot skip forward past the current tab until it is fully valid.',
    },

    'Project lifecycle overview': {
        category: 'Getting Started',
        intro: 'Every project in ConstructionSight AI moves through four distinct statuses. Understanding these statuses is essential for managing your workflow.',
        points: [
            'DRAFT — Created by admin. Fully editable. No PM access yet. Can be deleted.',
            'SETUP_IN_PROGRESS — PM has accepted invitation and is working through the setup wizard. Core fields are locked.',
            'ACTIVE — Setup is complete. Full team access. All site features are live. Cannot be deleted, only archived.',
            'ARCHIVED — Read-only. No edits, no new cameras or team changes. Can be unarchived back to ACTIVE.',
        ],
        note: 'The lifecycle is linear from DRAFT to ACTIVE. ARCHIVED is reversible. Only DRAFT projects can be permanently deleted.',
    },

    // ─── Camera Management ─────────────────────────────────────────────────────

    'Registering a new camera': {
        category: 'Camera Management',
        intro: 'Cameras must be registered in the system before they can be assigned to a site or project. Only admins can register cameras.',
        steps: [
            'Go to Admin Panel > Cameras List.',
            'Click the Add Camera button.',
            'Enter the camera name, vendor, model, and serial number on the Identity tab.',
            'On the Connection tab, enter the RTSP stream URL and ONVIF credentials.',
            'On the ONVIF tab, configure the ONVIF-specific settings if required by the camera model.',
            'Complete the wizard on the Completed tab.',
            'The camera appears in the Cameras List and can now be assigned to a project or site.',
            'Run a health check from the camera\'s Verify page to confirm it is reachable.',
        ],
        note: 'Make sure the camera is on a network that the ConstructionSight AI server can reach before registering.',
    },

    'Configuring RTSP credentials': {
        category: 'Camera Management',
        intro: 'RTSP (Real Time Streaming Protocol) credentials allow ConstructionSight AI to pull the live video feed from your camera.',
        steps: [
            'Open the camera from Admin > Cameras List and click Edit.',
            'Navigate to the Connection tab.',
            'Enter the RTSP URL in the format: rtsp://username:password@camera-ip:port/stream-path',
            'The stream path varies by camera manufacturer — check your camera\'s manual.',
            'Common default RTSP ports are 554 (standard) or 8554 (alternative).',
            'Save and then run a health check from the Verify tab to confirm the stream is accessible.',
        ],
        note: 'RTSP credentials can be updated at any time without affecting the project or site. Run a health check after any credential change.',
    },

    'Setting up ONVIF connection': {
        category: 'Camera Management',
        intro: 'ONVIF is a standard protocol used to communicate with IP cameras for configuration, PTZ control, and event detection. It runs separately from RTSP.',
        steps: [
            'In the camera edit wizard, go to the Connection tab.',
            'Enter the ONVIF Host — this is usually the camera\'s IP address.',
            'Enter the ONVIF Port — default is 80 for HTTP or 443 for HTTPS.',
            'Enter the ONVIF Username and Password — these may differ from RTSP credentials.',
            'On the ONVIF tab, configure any advanced ONVIF settings such as media profiles.',
            'Save the settings and run a health check to verify ONVIF connectivity.',
        ],
        note: 'ONVIF must be enabled on the camera itself. Check the camera\'s admin panel under Network or Integration settings to enable ONVIF support.',
    },

    'Running a camera health check': {
        category: 'Camera Management',
        intro: 'Health checks verify that ConstructionSight AI can reach and communicate with a camera. They run automatically on a schedule and can also be triggered manually.',
        steps: [
            'Go to Admin Panel > Cameras List.',
            'Click on the camera you want to check.',
            'Navigate to the Verify page for that camera.',
            'Click the Run Health Check button.',
            'The system will attempt to connect via RTSP and ONVIF.',
            'Results show the connection status, response time, and any error details.',
            'A green status means the camera is reachable and streaming correctly.',
            'A red status shows the specific error — use it to diagnose credential or network issues.',
        ],
        note: 'The camera scheduler runs automated health checks every 5 minutes by default. You can adjust the interval from Admin > Cameras > Scheduler Config.',
    },

    'Archiving and restoring cameras': {
        category: 'Camera Management',
        intro: 'Cameras that are no longer active can be archived to keep the system clean without permanently deleting them.',
        steps: [
            'Go to Admin Panel > Cameras List.',
            'Find the camera you want to archive.',
            'Click the Archive action from the camera\'s action menu.',
            'The camera is marked as archived and removed from active monitoring.',
            'Archived cameras do not receive health checks or appear in live monitoring.',
            'To restore a camera, find it in the Cameras List (use the archived filter).',
            'Click Unarchive — the camera returns to active status immediately.',
        ],
        note: 'Archiving a camera does not delete its historical health check data or event logs. All history is preserved.',
    },

    // ─── Project Management ────────────────────────────────────────────────────

    'Moving project from DRAFT to ACTIVE': {
        category: 'Project Management',
        intro: 'The DRAFT to ACTIVE transition is automatic and driven by the PM completing the setup wizard. Here is the full flow.',
        steps: [
            'Admin creates the project — status is DRAFT.',
            'Admin invites a PM by email from the Assigned tab.',
            'PM receives the email and accepts the invitation.',
            'Status changes to SETUP_IN_PROGRESS automatically.',
            'PM completes all 8 wizard tabs.',
            'PM submits on the final Completed tab.',
            'Status changes to ACTIVE — site is live and all features are unlocked.',
        ],
        note: 'Admins cannot manually force a project to ACTIVE. The PM must complete the wizard. If the PM is stuck, check that all tabs are fully valid before submission.',
    },

    'Editing project details': {
        category: 'Project Management',
        intro: 'Project details can be edited by the admin while the project is in DRAFT status. Once a PM accepts the invitation, most fields lock.',
        points: [
            'In DRAFT: name, location, type, PM assignment are all editable.',
            'In SETUP_IN_PROGRESS: admin cannot edit core fields; PM can edit via the setup wizard.',
            'In ACTIVE: projects are locked for admin edits. The PM manages site-level settings.',
            'In ARCHIVED: fully read-only — no edits from any role.',
        ],
        note: 'If a field correction is needed on an ACTIVE project, contact the system administrator. Some fields may require a direct database correction.',
    },

    'Archiving and unarchiving a project': {
        category: 'Project Management',
        intro: 'Archiving an ACTIVE project puts it into a read-only state. This is the correct action when a project is complete or needs to be paused indefinitely.',
        steps: [
            'Go to Admin Panel > Projects List.',
            'Find the ACTIVE project you want to archive.',
            'Click the Archive action from the project\'s action menu.',
            'The project status changes to ARCHIVED immediately.',
            'All team members lose write access. The project becomes read-only.',
            'To restore it, find the archived project in the list (use the archived filter).',
            'Click Unarchive — the project returns to ACTIVE status.',
        ],
        note: 'Cameras and site data associated with an archived project are preserved. Unarchiving fully restores the project and all its associated resources.',
    },

    'Deleting a DRAFT project': {
        category: 'Project Management',
        intro: 'Deletion is only available for projects in DRAFT status. It permanently removes the project and its associated construction site.',
        steps: [
            'Go to Admin Panel > Projects List.',
            'Find the project in DRAFT status.',
            'Click the Delete action from the project\'s action menu.',
            'Confirm the deletion in the prompt.',
            'The project record is deleted.',
            'The associated construction site is also deleted automatically (cascade).',
            'Any pending invitations for this project are also removed.',
        ],
        note: 'Deletion is permanent and cannot be undone. If there is any chance the project may be needed later, archive it instead. Only delete if you are certain the project was created in error.',
    },

    'Understanding project status rules': {
        category: 'Project Management',
        intro: 'Each project status controls what actions are allowed. Understanding these rules prevents confusion when an action appears greyed out or blocked.',
        points: [
            'DRAFT: Create, edit all fields, delete, invite PM. Cannot be activated manually.',
            'SETUP_IN_PROGRESS: No admin edits. PM works through wizard. Cannot archive or delete.',
            'ACTIVE: Full team access. Can be archived. Cannot be deleted or edited (core fields).',
            'ARCHIVED: Read-only. Can be unarchived. No new cameras, members, or edits allowed.',
        ],
        note: 'Any mutation attempt on an ARCHIVED project returns a 400 error. This is enforced at the API level — it cannot be bypassed from the UI.',
    },

    // ─── Team & Roles ──────────────────────────────────────────────────────────

    'Admin vs Project Manager roles': {
        category: 'Team & Roles',
        intro: 'ConstructionSight AI has two platform roles: Admin and Project Manager (PM). They have distinct responsibilities and access levels.',
        points: [
            'Admin — Full system access. Can create projects, manage all cameras, invite PMs, manage all users.',
            'Admin — Can view all projects across the platform regardless of assignment.',
            'Admin — Can archive, unarchive, and delete projects.',
            'Project Manager — Access is scoped to assigned projects only.',
            'Project Manager — Responsible for completing the setup wizard and managing site operations.',
            'Project Manager — Cannot create new projects, register cameras, or manage platform users.',
            'Project Manager — Can manage team members, zones, and settings within their assigned project.',
        ],
        note: 'Role assignment is set at account creation. Contact your system administrator to change a user\'s platform role.',
    },

    'Inviting team members by email': {
        category: 'Team & Roles',
        intro: 'Project Managers are invited to projects via email. The invitation flow is secure and time-limited.',
        steps: [
            'Admin opens the project from the Projects List.',
            'Goes to the Assigned tab and enters the PM\'s email.',
            'The system checks if the email belongs to an existing user.',
            'If the user exists, a ProjectMembership is created and the PM is notified.',
            'If the user does not exist, a ProjectInvitation is created and an email is sent.',
            'The invitation email contains a secure one-time link valid for 7 days.',
            'The PM clicks the link, registers or logs in, and accepts the invitation.',
            'A ProjectMembership is created with ACTIVE status.',
        ],
        note: 'Memberships are always either ACTIVE or REMOVED — there is no PENDING membership state. The invitation itself holds the pending state until accepted.',
    },

    'Resending an expired invitation': {
        category: 'Team & Roles',
        intro: 'If a PM does not accept within 7 days, their invitation expires. Resending is straightforward from the admin panel.',
        steps: [
            'Open the project from Admin > Projects List.',
            'Go to the Invitations section of the project.',
            'Find the invitation with EXPIRED status.',
            'Click Resend.',
            'A new invitation with a fresh 7-day expiry is generated and emailed.',
            'The previous link is invalidated immediately.',
        ],
        note: 'Only one active invitation per project per email is allowed. Resending replaces the old one automatically.',
    },

    'Removing a team member': {
        category: 'Team & Roles',
        intro: 'Project Managers can be removed from a project by the admin. Removal updates the membership status without deleting any project data.',
        steps: [
            'Go to Admin Panel and open the project.',
            'Navigate to the Team or Members section.',
            'Find the team member you want to remove.',
            'Click Remove from the action menu.',
            'The membership status is updated to REMOVED.',
            'The user loses access to the project immediately.',
            'Their previous contributions and activity logs are preserved.',
        ],
        note: 'Removed members can be re-invited to the same project if needed. Their history is not deleted.',
    },

    'Managing project memberships': {
        category: 'Team & Roles',
        intro: 'Project memberships define who has access to a project and in what capacity. ConstructionSight AI uses a simple two-state membership model.',
        points: [
            'ACTIVE membership — the user has full access to the project per their role.',
            'REMOVED membership — the user is locked out of the project.',
            'There is no PENDING membership — pending state is managed by the ProjectInvitation table.',
            'Once an invitation is accepted, a membership is created immediately as ACTIVE.',
            'Memberships are project-scoped — a user can be active on one project and removed from another.',
            'Admins can view and manage all memberships from the project\'s Team section.',
        ],
        note: 'Deleting a project (DRAFT only) also removes all associated memberships and invitations automatically.',
    },

    // ─── Live Monitoring ───────────────────────────────────────────────────────

    'Viewing live camera feeds': {
        category: 'Live Monitoring',
        intro: 'ConstructionSight AI provides live camera feed access for monitoring active construction sites in real time.',
        steps: [
            'Navigate to the project from your dashboard.',
            'Open the Cameras section of the project.',
            'Click on a camera to open its detail view.',
            'Select the Live View tab.',
            'The live RTSP stream loads in the viewer.',
            'Use the controls to adjust the view, zoom, or switch between cameras on the site.',
        ],
        note: 'Live view requires the camera to be online and reachable. If the stream does not load, run a health check first to verify the camera status.',
    },

    'Camera health check scheduler': {
        category: 'Live Monitoring',
        intro: 'The camera scheduler is a background service that automatically checks the health of all registered cameras at a configurable interval.',
        points: [
            'Runs continuously in the background as part of the ConstructionSight AI backend.',
            'Polls every camera via RTSP and ONVIF to verify reachability.',
            'Updates the camera\'s health status in the database after each check.',
            'Default interval is 5 minutes — configurable without restarting the server.',
            'Can be toggled on or off from the Scheduler Config page in the admin panel.',
            'Results are visible in the Camera Health page and individual camera Verify pages.',
        ],
        note: 'The scheduler runs on the server side. It does not require any browser or user action to function.',
    },

    'Configuring scheduler interval': {
        category: 'Live Monitoring',
        intro: 'The health check interval determines how frequently the system polls cameras. It can be adjusted to match your monitoring requirements.',
        steps: [
            'Go to Admin Panel > Cameras.',
            'Open the Scheduler Config section.',
            'Set the desired interval in minutes.',
            'Toggle the scheduler on or off if needed.',
            'Save the configuration.',
            'The new interval takes effect immediately — no server restart required.',
        ],
        note: 'Setting the interval too low (under 1 minute) may increase server load, especially with many cameras. A 5-minute interval is recommended for most sites.',
    },

    'Monitoring camera sites': {
        category: 'Live Monitoring',
        intro: 'Each project in ConstructionSight AI is associated with a construction site. Cameras are linked to sites and provide coverage of the physical location.',
        points: [
            'A site is automatically created when a project is created.',
            'Cameras are assigned to a site during the PM setup wizard or via admin camera registration.',
            'Multiple cameras can cover a single site from different angles or zones.',
            'Site-level health is summarized from the collective health of its cameras.',
            'Archiving a project makes the site read-only — no new cameras can be added.',
            'Deleting a DRAFT project also deletes its site (cascade).',
        ],
        note: 'Sites are managed implicitly through projects. You do not create or delete sites directly — they follow the project lifecycle.',
    },

    'Understanding health check results': {
        category: 'Live Monitoring',
        intro: 'Each camera health check returns a status that reflects the result of the connection attempt. Here is how to interpret them.',
        points: [
            'Online — Camera is reachable via both RTSP and ONVIF. Stream is accessible.',
            'Offline — System could not connect. Check network, credentials, or camera power.',
            'Degraded — Partial connectivity. RTSP may be up but ONVIF is failing, or vice versa.',
            'Unknown — No health check has been run yet for this camera.',
            'Timeout — Connection attempt exceeded the allowed time. Camera may be slow or unreachable.',
            'Auth Failed — Credentials were rejected. Update the RTSP or ONVIF credentials.',
        ],
        note: 'After fixing an issue, run a manual health check from the camera\'s Verify page to immediately get an updated status rather than waiting for the next scheduled check.',
    },

    // ─── Troubleshooting ──────────────────────────────────────────────────────

    'Camera showing as offline': {
        category: 'Troubleshooting',
        intro: 'If a camera appears offline in the system, follow these diagnostic steps to identify and resolve the issue.',
        steps: [
            'Confirm the camera is powered on and physically connected to the network.',
            'Access the camera\'s own admin panel via a browser to verify it is functional.',
            'Check the RTSP URL — ensure the IP, port, username, and password are correct.',
            'Check the ONVIF credentials in the Connection tab of the camera edit wizard.',
            'Run a manual health check from the camera\'s Verify page.',
            'Read the specific error message returned — it indicates whether it is a network, credential, or timeout issue.',
            'If behind a firewall, ensure ports 554 (RTSP) and 80/443 (ONVIF) are open.',
            'Restart the camera if all settings appear correct but it is still unreachable.',
        ],
        note: 'After resolving the issue, the scheduler will pick it up in the next cycle (default 5 minutes). Trigger a manual verify to confirm immediately.',
    },

    'Invitation link expired or invalid': {
        category: 'Troubleshooting',
        intro: 'Invitation links are valid for 7 days. If a PM clicks an expired or already-used link, they will see an error. Here is how to handle it.',
        steps: [
            'Go to Admin Panel > Projects List and open the relevant project.',
            'Navigate to the Invitations section.',
            'Check the invitation status — if it shows EXPIRED, resend it.',
            'Click Resend to generate a fresh 7-day invitation email to the PM.',
            'If the invitation shows ACCEPTED but the PM cannot access the project, check their membership status in the Team section.',
            'If the invitation is PENDING but the PM cannot find the email, ask them to check their spam folder.',
        ],
        note: 'Each invitation link can only be used once. Once accepted, it is invalidated. Resending generates a completely new token.',
    },

    'Project stuck in SETUP_IN_PROGRESS': {
        category: 'Troubleshooting',
        intro: 'A project enters SETUP_IN_PROGRESS when the PM accepts the invitation. If it stays in this status for too long, check the following.',
        steps: [
            'Confirm the PM has accepted the invitation — check invitation status in the project\'s Invitations section.',
            'Ask the PM to log in and navigate to their project setup wizard.',
            'Check which wizard tab the PM is currently on — each tab must be fully valid to proceed.',
            'Common blockers: missing required fields, no cameras added, zones not configured.',
            'The PM must reach and submit the final Completed tab to activate the project.',
            'If the PM is unable to proceed, have them share a screenshot of the wizard tab showing the validation error.',
        ],
        note: 'Admins cannot force-activate a project. The PM must complete the wizard themselves. If the PM is unavailable, consider cancelling the invitation and re-inviting a replacement PM.',
    },

    '401 Unauthorized errors explained': {
        category: 'Troubleshooting',
        intro: 'A 401 Unauthorized error means the system could not verify your identity for the requested action. This is usually caused by an expired or invalid session token.',
        points: [
            'JWT access tokens expire after a set duration. The system automatically refreshes them using a secure httponly refresh cookie.',
            'If the refresh token is also expired, you will be logged out and redirected to the login page.',
            'A 401 on a specific API call means your token does not have permission for that action (e.g. accessing an admin endpoint as a regular user).',
            'Clearing browser cookies and logging back in resolves most 401 issues.',
            'If 401 errors persist after logging in, contact your administrator — your account may need to be re-approved.',
        ],
        note: 'ConstructionSight AI uses token family revocation. Logging in on a new device invalidates all sessions from previous devices as a security measure.',
    },

    'Cannot edit or delete a project': {
        category: 'Troubleshooting',
        intro: 'Edit and delete actions on projects are status-dependent. If these options appear greyed out or return an error, the project status is the reason.',
        points: [
            'Edit is only available in DRAFT status. Any other status locks core project fields.',
            'Delete is only available in DRAFT status. ACTIVE and ARCHIVED projects cannot be deleted.',
            'Archive is only available for ACTIVE projects.',
            'Unarchive is only available for ARCHIVED projects.',
            'If the button is disabled with a tooltip, the tooltip text explains exactly why the action is blocked.',
            'If an API call returns a 400 error on write, the project is likely ARCHIVED (all writes blocked).',
        ],
        note: 'These restrictions are enforced at the API level in addition to the UI. They cannot be bypassed by calling the API directly without the correct project status.',
    },

};

export default helpTopicsContent;
