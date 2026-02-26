# Frontend — ConstructionSight-AI

React 18 + Vite frontend for the ConstructionSight-AI platform. Provides the admin dashboard, project workspace, real-time PPE/workforce/risk dashboards, camera management, BIM workspace, and the full project/team lifecycle UI.

---

## Setup

```bash
cd frontend
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → dist/
npm run lint      # ESLint check
```

---

## Environment Variables (`frontend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE` | Backend REST API URL | `http://localhost:8000` |
| `VITE_STREAM_BASE` | Streaming / SSE server URL | `http://localhost:8001` |
| `VITE_DEFAULT_SKIN_THEME` | Default UI theme (`dark`/`light`) | `dark` |
| `VITE_DEFAULT_CAMERA_USERNAME` | Pre-filled camera username | `admin` |
| `VITE_DEFAULT_CAMERA_PASSWORD` | Pre-filled camera password | — |

---

## Project Structure

```
frontend/src/
├── pages/
│   ├── admin/              Admin-only pages (36 pages)
│   │   ├── analytics.jsx             Admin analytics dashboard
│   │   ├── projects-list.jsx         All projects table
│   │   ├── projects-create.jsx       Project creation wizard
│   │   ├── cameras-list.jsx          All cameras table
│   │   ├── cameras-add.jsx           Register new camera
│   │   ├── cameras-edit.jsx          Camera edit wizard (4 tabs)
│   │   ├── cameras-verify.jsx        Camera health-check view
│   │   ├── cameras-health.jsx        Platform camera health overview
│   │   ├── cameras-sites.jsx         Cameras grouped by site
│   │   ├── users-list.jsx            User management
│   │   ├── invitations-list.jsx      Platform invitation management
│   │   └── smart-query.jsx           Admin AI assistant
│   └── user/               PM and team member pages (101 pages)
│       ├── user-projects.jsx         My projects list
│       ├── invite-accept.jsx         Accept project invitation via token
│       ├── project-info.jsx          Project overview tab
│       ├── project-setup.jsx         PM setup wizard
│       ├── project-members.jsx       Team member management
│       ├── project-invitations.jsx   Send/manage invitations
│       ├── project-cameras.jsx       Project cameras list
│       ├── project-camera-detail.jsx Single camera details
│       ├── project-zones.jsx         Safety/work zone configuration
│       ├── project-tasks.jsx         Task list
│       ├── project-tasks-create.jsx  Create task
│       ├── project-smart-query.jsx   Project-scoped AI assistant
│       ├── project-live-view.jsx     Real-time camera feed
│       ├── bim-workspace.jsx         3D BIM visualization
│       ├── workforce-analytics.jsx   Workforce tracking dashboard
│       ├── activity-analytics.jsx    Activity detection dashboard
│       ├── equipment-analytics.jsx   Equipment usage dashboard
│       ├── risk-analytics.jsx        Risk assessment dashboard
│       ├── reports-project.jsx       PPE safety reports
│       ├── project-settings-ppe.jsx  PPE threshold configuration
│       ├── project-settings-workforce.jsx
│       ├── project-settings-activity.jsx
│       ├── project-settings-equipment.jsx
│       ├── project-settings-general.jsx
│       └── project-settings-reports.jsx
├── components/
│   ├── projectsCreate/           Project creation wizard
│   │   ├── ProjectCreateContent.jsx  Wizard shell (mode: admin_shell / pm_setup)
│   │   ├── TabProjectType.jsx
│   │   ├── TabProjectDetails.jsx
│   │   ├── TabProjectSettings.jsx
│   │   ├── TabProjectBudget.jsx
│   │   ├── TabProjectAssigned.jsx    PM selection (existing user or invite by email)
│   │   ├── TabProjectTarget.jsx
│   │   ├── TabAttachement.jsx
│   │   └── TabCompleted.jsx          Final tab with submit logic
│   ├── projectWorkspace/         Project-level feature components
│   │   ├── PPESafetyDashboard.jsx
│   │   ├── WorkforceDashboard.jsx
│   │   ├── ActivityDashboard.jsx
│   │   ├── EquipmentDashboard.jsx
│   │   ├── RiskDashboard.jsx
│   │   ├── LiveAlertsHub.jsx         Aggregated real-time alerts
│   │   ├── PPELiveAlertToasts.jsx
│   │   ├── WorkforceLiveAlertToasts.jsx
│   │   ├── ProjectMembersTable.jsx
│   │   ├── InviteMemberModal.jsx
│   │   ├── ProjectCamerasTable.jsx
│   │   ├── ProjectZonesContent.jsx
│   │   ├── PPEIncidentsTable.jsx
│   │   ├── ProjectReportsContent.jsx
│   │   ├── ReportExportModal.jsx
│   │   ├── StaffingHeatmap.jsx
│   │   ├── PPEZoneBreakdown.jsx
│   │   └── [30+ more workspace components]
│   ├── cameras/
│   │   ├── CameraEditContent.jsx     4-tab camera edit wizard
│   │   ├── CameraTable.jsx           Camera registry with real-time status
│   │   └── CameraVerifyView.jsx      Health check display (auto-polls 5s)
│   ├── adminProjects/            Admin project management
│   ├── adminUsers/               User management UI
│   ├── invitations/              Invitation flows
│   ├── authentication/           Login, register, reset forms
│   ├── shared/                   Reusable UI primitives
│   │   ├── PageHeader.jsx
│   │   ├── CardHeader.jsx
│   │   ├── ConfirmDialog.jsx
│   │   └── [pagination, inputs, dropdowns, loaders]
│   ├── bim/                      BIM 3D workspace
│   ├── smartQuery/               AI query interface
│   ├── chats/                    Team chat application
│   ├── emails/                   Email management UI
│   ├── calender/                 Calendar (FullCalendar integration)
│   └── [15+ more feature component directories]
├── route/
│   └── router.jsx                All routes, layout hierarchy, route guards
├── hooks/
│   ├── useAuthGuard.js           Token validation + silent refresh for protected routes
│   ├── useFormPersist.js         Persist wizard form state to sessionStorage
│   ├── usePPEStream.js           SSE hook — PPE real-time events
│   ├── useWorkforceStream.js     SSE hook — workforce real-time events
│   ├── useActivityStream.js      SSE hook — activity real-time events
│   ├── useEquipmentStream.js     SSE hook — equipment real-time events
│   ├── useRiskStream.js          SSE hook — risk real-time events
│   └── useBootstrapUtils.js      Bootstrap tooltip/popover init on DOM changes
├── utils/
│   ├── api.js                    Core API client (fetch + auto token refresh + cross-tab lock)
│   ├── errorHandler.js           Parse API errors, extract field-level validation errors
│   ├── broadcast.js              Cross-tab event broadcasting (BroadcastChannel)
│   ├── theme.js                  Dark/light theme sync from server + localStorage
│   ├── queryKeys.js              React Query key registry (QK object)
│   ├── topTost.jsx               Success toast (SweetAlert2, green, 3s)
│   ├── topTostError.jsx          Error/warning/info toast (SweetAlert2, color-coded)
│   ├── ppeCacheUtils.js          Direct React Query cache patching for PPE data
│   ├── workforceCacheUtils.js    Cache utils for workforce
│   ├── activityCacheUtils.js     Cache utils for activity
│   ├── equipmentCacheUtils.js    Cache utils for equipment
│   ├── projectValidation.js      Project form validation rules
│   ├── cameraValidation.js       Camera credential validation rules
│   ├── confirmDialog.jsx         Confirmation dialog wrapper
│   ├── confirmDelete.js          Delete confirmation utility
│   ├── projectStatusMeta.js      Project status display metadata (colors, labels)
│   └── options.jsx               Shared dropdown option definitions
├── contentApi/                   React Context providers
│   ├── navigationProvider.jsx    Mobile navigation drawer state
│   └── sideBarToggleProvider.jsx Sidebar visibility state
├── layout/                       Layout wrapper components
│   ├── rootAdmin.jsx             Admin dashboard (header + sidebar + content)
│   ├── layoutAuth.jsx            Public/auth pages (no sidebar)
│   ├── layoutProjectWorkspace.jsx Project workspace (project header + sidebar + live alert monitoring)
│   ├── layoutAdminApplications.jsx Admin apps (chat, email, tasks, notes, calendar, storage)
│   ├── layoutAdminSetting.jsx    Admin settings (settings sidebar)
│   ├── layoutProjectApplications.jsx Project apps layout
│   └── layoutProjectSettings.jsx Nested settings within project workspace
└── styles/                       Global CSS/SCSS
```

---

## Routing & Layouts

The router (`src/route/router.jsx`) uses React Router v6 `createBrowserRouter` with six distinct layout hierarchies:

| Layout | Prefix | Covers |
|--------|--------|--------|
| `LayoutAuth` | `/` | Landing, login, register, password reset (public) |
| `RootAdminLayout` | `/admin` | Admin dashboard, projects, cameras, users |
| `LayoutAdminApplications` | `/admin/applications` | Chat, email, tasks, notes, calendar, storage |
| `LayoutAdminSetting` | `/admin/settings` | Platform settings sidebar |
| `LayoutProjectWorkspace` | `/projects/:projectId` | All project-scoped pages |
| `LayoutProjectSettings` | `/projects/:projectId/settings` | Nested settings under project workspace |

**Route Guards:** `useAuthGuard(requiredRole)` validates the JWT and performs silent refresh before rendering protected layouts. Returns `status: 'loading' | 'ok' | 'fail'`.

---

## Key Patterns

### API Client (`utils/api.js`)

```js
import { apiGet, apiPost, apiPatch, apiDelete } from '@/utils/api'

// GET request
const data = await apiGet('/admin/projects')

// POST request
const result = await apiPost('/admin/projects', { name: 'Site Alpha' })

// PATCH request
await apiPatch(`/admin/cameras/${id}/credentials`, { rtsp_url, username, password })

// DELETE request
await apiDelete(`/admin/projects/${id}`)
```

All wrappers automatically:
- Inject `Authorization: Bearer <token>` header
- On 401 → call `refreshTokens()` → retry with new token
- Use Web Locks API + BroadcastChannel to ensure only one tab refreshes at a time
- Throw on non-2xx responses (catch in components for toast errors)

For unauthenticated calls (login, register): use `apiPublicPost(path, body)`.

### Toast Notifications

```js
import topTost from '@/utils/topTost'
import topTostError from '@/utils/topTostError'

topTost('Project created successfully')               // green, 3s
topTostError('Failed to save changes')                // red error
topTostError('Camera already exists', 'warning')      // orange warning
topTostError('Your session has expired', 'info')      // blue info
```

### Wizard Tabs Pattern

Used for project creation (`ProjectCreateContent`) and camera editing (`CameraEditContent`):

- Steps tracked by `currentIndex` (visible) and `maxReached` (furthest visited)
- Each tab validates before allowing forward navigation; flashes red border on invalid skip
- State (form data + position) persisted to sessionStorage via `useFormPersist` — survives page refresh
- Draft cleared on successful submit via `clearDraft()`
- Supports `mode="admin_shell"` (4 tabs, quick admin setup) and `mode="pm_setup"` (8 tabs, full PM configuration)

### Event-Driven Table Refresh

Instead of polling, components listen for custom events dispatched after mutations:

```js
import { broadcastRefresh, onBroadcast } from '@/utils/broadcast'

// In an action handler — after successful mutation:
broadcastRefresh('cs:cameras-stats-refresh')
broadcastRefresh('cs:projects-stats-refresh')

// In a table component — subscribe in useEffect:
useEffect(() => {
  return onBroadcast('cs:cameras-stats-refresh', loadData)
}, [])
```

Events fire on the local window AND across all tabs via BroadcastChannel.

### SSE Real-Time Updates

Each analytics feature has a dedicated SSE hook:

```js
import { usePPEStream } from '@/hooks/usePPEStream'

// Inside a dashboard component:
usePPEStream(projectId, queryClient, {
  onIncident: (incident) => { /* optional callback */ }
})
```

The hook:
- Connects to `/projects/{id}/ppe/stream` with the JWT in the query string
- Patches React Query cache directly on every event (zero-latency UI update)
- Auto-reconnects with exponential backoff on disconnect

### React Query Cache Keys

Use the centralized `QK` registry to ensure consistent cache invalidation:

```js
import { QK } from '@/utils/queryKeys'

// Fetch
const { data } = useQuery({ queryKey: QK.ppeSummary(projectId, dateRange), queryFn: ... })

// Invalidate after mutation
queryClient.invalidateQueries({ queryKey: QK.ppeSummary(projectId) })
```

### Error Handling

```js
import { parseApiError, extractFieldErrors } from '@/utils/errorHandler'

try {
  await apiPost('/admin/projects', formData)
} catch (err) {
  // User-friendly message from API response
  topTostError(parseApiError(err, 'Failed to create project'))

  // Field-level validation errors for inline form display
  setFieldErrors(extractFieldErrors(err))
}
```

### Role-Based UI

```js
import { getPlatformRole, getCurrentUserId } from '@/utils/api'

const role = getPlatformRole()  // 'admin' | 'user'

// Project role stored in sessionStorage after acceptance
const projectRole = sessionStorage.getItem(`cs_proj_role_${userId}_${projectId}`)
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview the production build locally |
| `npm run test` | Run Vitest unit tests once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:ui` | Vitest UI dashboard |
| `npm run test:coverage` | Generate coverage report |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:report` | Open last Playwright HTML report |

---

## Dependencies

| Category | Library | Version |
|----------|---------|---------|
| Core | react, react-dom | 18.3.1 |
| Routing | react-router-dom | 6.26.1 |
| Build | vite, @vitejs/plugin-react | 5.4.1 |
| Server State | @tanstack/react-query | 5.100.1 |
| Table | @tanstack/react-table | 8.20.5 |
| UI Framework | bootstrap | 5.3.3 |
| UI Components | @mui/material | 7.3.9 |
| Charts | apexcharts, react-apexcharts | 3.52.0 |
| Charts | recharts | 3.8.1 |
| Charts | @mui/x-charts | 8.28.2 |
| Charts | d3 | 7.9.0 |
| 3D / BIM | @babylonjs/core, @babylonjs/loaders | 9.6.0 |
| 3D | three, @react-three/fiber, @react-three/drei | 0.184.0 |
| Calendar | @fullcalendar/react + plugins | 6.1.20 |
| Date pickers | react-datepicker, @mui/x-date-pickers | — |
| Date utils | date-fns, dayjs, moment | — |
| Select | react-select | 5.8.1 |
| Rich text | react-quill, quill | 2.0.0 |
| Alerts | sweetalert2, sweetalert2-react-content | 5.0.7 |
| Animation | lottie-react | 2.4.1 |
| Auth | @react-oauth/google | 0.13.4 |
| Excel | xlsx | 0.18.5 |
| Markdown | react-markdown, remark-gfm | 10.1.0 |
| Testing | vitest | 2.1.0 |
| Testing | @playwright/test | 1.48.0 |
| Testing | @testing-library/react | — |
| Mocking | msw | 2.4.0 |
| Linting | eslint 9.9 + react plugins | — |
| Styles | sass | 1.69.7 |

---

## Path Aliases (vite.config.js)

| Alias | Resolves To |
|-------|------------|
| `@/components` | `src/components` |
| `@/utils` | `src/utils` |
| `@/hooks` | `src/hooks` |
| `@/contentApi` | `src/contentApi` |
| `@/styles` | `src/styles` |

---

## CORS Note

Vite is configured with `Cross-Origin-Opener-Policy: same-origin-allow-popups` to support OAuth popup windows and video call features.
