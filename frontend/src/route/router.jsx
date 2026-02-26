import { createBrowserRouter, Navigate } from "react-router-dom";
import RootAdminLayout from "../layout/rootAdmin";
import LayoutAdminApplications from "../layout/layoutAdminApplications";
import LayoutAdminSetting from "../layout/layoutAdminSetting";
import UserProjects from "../pages/user/user-projects";
import Landing from "../pages/user/landing";
import ReportsProject from "../pages/user/reports-project";
import WorkforceAnalytics from "../pages/user/workforce-analytics";
import ActivityAnalytics from "../pages/user/activity-analytics";
import EquipmentAnalytics from "../pages/user/equipment-analytics";
import SettingsEquipment from "../pages/user/settings-equipment";
import RiskAnalytics from "../pages/user/risk-analytics";
import BimWorkspacePage from "../pages/user/bim-workspace";
import ProjectReportsContent from "../components/projectWorkspace/ProjectReportsContent";
import ProjectLiveViewPage from "../pages/user/project-live-view";
import DevVideoTestPage from "../pages/user/dev-video-test";
import AppsChat from "../pages/user/apps-chat";
import LayoutProjectWorkspace from "../layout/layoutProjectWorkspace";
import LayoutProjectApplications from "../layout/layoutProjectApplications";
import AppsEmail from "../pages/user/apps-email";
import LoginCover from "../pages/user/login-cover";
import AppsTasks from "../pages/user/apps-tasks";
import AppsNotes from "../pages/user/apps-notes";
import AppsCalender from "../pages/user/apps-calender";
import AppsStorage from "../pages/user/apps-storage";
import Proposalist from "../pages/user/proposal-list";
import CustomersList from "../pages/user/customers-list";
import ProposalView from "../pages/user/proposal-view";
import ProposalEdit from "../pages/user/proposal-edit";
import LeadsList from "../pages/user/leadsList";
import CustomersView from "../pages/user/customers-view";
import CustomersCreate from "../pages/user/customers-create";
import ProposalCreate from "../pages/user/proposal-create";
import LeadsView from "../pages/user/leads-view";
import LeadsCreate from "../pages/user/leads-create";
import PaymentList from "../pages/user/payment-list";
import PaymentView from "../pages/user/payment-view/";
import PaymentCreate from "../pages/user/payment-create";
import ProjectInfoPage from "../pages/user/project-info";
import ProjectTasksView from "../pages/user/project-tasks";
import ProjectTasksCreate from "../pages/user/project-tasks-create";
import ProjectSetup from "../pages/user/project-setup";
import ProjectInvitationsPage from "../pages/user/project-invitations";
import ProjectMembersPage from "../pages/user/project-members";
import ProjectCamerasPage from "../pages/user/project-cameras";
import ProjectCameraDetailPage from "../pages/user/project-camera-detail";
import ProjectZonesPage from "../pages/user/project-zones";
import ProjectSettingsPPE from "../pages/user/project-settings-ppe";
import ProjectSettingsWorkforce from "../pages/user/project-settings-workforce";
import ProjectSettingsActivity from "../pages/user/project-settings-activity";
import ProjectSettingsReports from "../pages/user/project-settings-reports";
import ProjectSettingsGeneral from "../pages/user/project-settings-general";
import ProjectSettingsSEO from "../pages/user/project-settings-seo";
import ProjectSettingsEmail from "../pages/user/project-settings-email";
import ProjectSettingsTasks from "../pages/user/project-settings-tasks";
import ProjectSettingsOther from "../pages/user/project-settings-other";
import UserInvitations from "../pages/user/user-invitations";
import InviteAcceptPage from "../pages/user/invite-accept";
import ProfilePage from "../pages/user/profile";
import SettingsGaneral from "../pages/user/settings-ganeral";
import LayoutProjectSettings from "../layout/layoutProjectSettings";
import SettingsSeo from "../pages/user/settings-seo";
import SettingsTags from "../pages/user/settings-tags";
import SettingsEmail from "../pages/user/settings-email";
import SettingsTasks from "../pages/user/settings-tasks";
import SettingsLeads from "../pages/user/settings-leads";
import SettingsMiscellaneous from "../pages/user/settings-miscellaneous";
import SettingsRecaptcha from "../pages/user/settings-recaptcha";
import SettingsLocalization from "../pages/user/settings-localization";
import SettingsCustomers from "../pages/user/settings-customers";
import SettingsGateways from "../pages/user/settings-gateways";
import SettingsFinance from "../pages/user/settings-finance";
import SettingsSupport from "../pages/user/settings-support";
import LayoutAuth from "../layout/layoutAuth";
import LoginMinimal from "../pages/user/login-minimal";
import LoginCreative from "../pages/user/login-creative";
import RegisterCover from "../pages/user/register-cover";
import RegisterMinimal from "../pages/user/register-minimal";
import RegisterCreative from "../pages/user/register-creative";
import ResetCover from "../pages/user/reset-cover";
import ResetMinimal from "../pages/user/reset-minimal";
import ResetCreative from "../pages/user/reset-creative";
import ResetPasswordCover from "../pages/user/reset-password-cover";
import ErrorCover from "../pages/user/error-cover";
import ErrorCreative from "../pages/user/error-creative";
import ErrorMinimal from "../pages/user/error-minimal";
import OtpCover from "../pages/user/otp-cover";
import OtpMinimal from "../pages/user/otp-minimal";
import OtpCreative from "../pages/user/otp-creative";
import MaintenanceCover from "../pages/user/maintenance-cover";
import MaintenanceMinimal from "../pages/user/maintenance-minimal";
import MaintenanceCreative from "../pages/user/maintenance-creative";
import HelpKnowledgebase from "../pages/user/help-knowledgebase";
import WidgetsLists from "../pages/user/widgets-lists";
import WidgetsTables from "../pages/user/widgets-tables";
import WidgetsCharts from "../pages/user/widgets-charts";
import WidgetsStatistics from "../pages/user/widgets-statistics";
import WidgetsMiscellaneous from "../pages/user/widgets-miscellaneous";
import Logout from "../pages/user/logout";

// Admin page 
import AdminAnalytics from "../pages/admin/analytics";
import AdminReportsProject from "../pages/admin/reports-project";
import AdminAppsChat from "../pages/admin/apps-chat";
import AdminAppsEmail from "../pages/admin/apps-email";
import AdminAppsTasks from "../pages/admin/apps-tasks";
import AdminAppsNotes from "../pages/admin/apps-notes";
import AdminAppsCalender from "../pages/admin/apps-calender";
import AdminAppsStorage from "../pages/admin/apps-storage";
import AdminProposalist from "../pages/admin/proposal-list";
import AdminProposalView from "../pages/admin/proposal-view";
import AdminProposalEdit from "../pages/admin/proposal-edit";
import AdminProposalCreate from "../pages/admin/proposal-create";
import AdminPaymentList from "../pages/admin/payment-list";
import AdminPaymentView from "../pages/admin/payment-view";
import AdminPaymentCreate from "../pages/admin/payment-create";
import AdminCustomersList from "../pages/admin/customers-list";
import AdminCustomersView from "../pages/admin/customers-view";
import AdminCustomersCreate from "../pages/admin/customers-create";
import AdminLeadsList from "../pages/admin/leadsList";
import AdminLeadsView from "../pages/admin/leads-view";
import AdminLeadsCreate from "../pages/admin/leads-create";
import AdminProjectsList from "../pages/admin/projects-list";
import AdminProjectsCreate from "../pages/admin/projects-create";
import AdminProjectsView from "../pages/admin/projects-view";
import AdminInvitationsList from "../pages/admin/invitations-list";
import AdminUsersList from "../pages/admin/users-list";
import AdminHelpKnowledgebase from "../pages/admin/help-knowledgebase";
import AdminCamerasList from "../pages/admin/cameras-list";
import AdminCamerasAdd from "../pages/admin/cameras-add";
import AdminCamerasVerify from "../pages/admin/cameras-verify";
import AdminCamerasEdit from "../pages/admin/cameras-edit";
import AdminCamerasHealth from "../pages/admin/cameras-health";
import AdminCamerasSites from "../pages/admin/cameras-sites";
import AdminSmartQueryPage from "../pages/admin/smart-query";
import ProjectSmartQueryPage from "../pages/user/project-smart-query";

export const router = createBrowserRouter([
    {
        path: "/admin",
        element: <RootAdminLayout />,
        children: [
            {
                index: true,
                element: <Navigate to="/admin/dashboards/analytics" replace />
            },
            {
                path: "dashboards/analytics",
                element: <AdminAnalytics />
            },
            {
                path: "reports/ppe",
                element: <AdminReportsProject />
            },
            {
                path: "proposal/list",
                element: <AdminProposalist />
            },
            {
                path: "proposal/view",
                element: <AdminProposalView />
            },
            {
                path: "proposal/edit",
                element: <AdminProposalEdit />
            },
            {
                path: "proposal/create",
                element: <AdminProposalCreate />
            },
            {
                path: "payment/list",
                element: <AdminPaymentList />
            },
            {
                path: "payment/view",
                element: <AdminPaymentView />
            },
            {
                path: "payment/create",
                element: <AdminPaymentCreate />
            },
            {
                path: "customers/list",
                element: <AdminCustomersList />
            },
            {
                path: "customers/view",
                element: <AdminCustomersView />
            },
            {
                path: "customers/create",
                element: <AdminCustomersCreate />
            },
            {
                path: "leads/list",
                element: <AdminLeadsList />
            },
            {
                path: "leads/view",
                element: <AdminLeadsView />
            },
            {
                path: "leads/create",
                element: <AdminLeadsCreate />
            },
            {
                path: "projects/list",
                element: <AdminProjectsList />
            },
            {
                path: "projects/create",
                element: <AdminProjectsCreate />
            },
            {
                path: "projects/:id",
                element: <AdminProjectsView />
            },
            {
                path: "projects/:id/edit",
                element: <AdminProjectsCreate mode="edit" />
            },
            {
                path: "invitations/list",
                element: <AdminInvitationsList />
            },
            {
                path: "users/list",
                element: <AdminUsersList />
            },
            {
                path: "cameras/list",
                element: <AdminCamerasList />
            },
            {
                path: "cameras/add",
                element: <AdminCamerasAdd />
            },
            {
                path: "cameras/:id/verify",
                element: <AdminCamerasVerify />
            },
            {
                path: "cameras/:id/edit",
                element: <AdminCamerasEdit />
            },
            {
                path: "cameras/health",
                element: <AdminCamerasHealth />
            },
            {
                path: "cameras/sites",
                element: <AdminCamerasSites />
            },
            {
                path: "intelligence/smart-query",
                element: <AdminSmartQueryPage />
            },
            {
                path: "help/knowledgebase",
                element: <AdminHelpKnowledgebase />
            },
            {
                path: "profile",
                element: <ProfilePage />
            },
        ]
    },
    {
        path: "/admin",
        element: <LayoutAdminApplications />,
        children: [
            {
                path: "applications/chat",
                element: <AdminAppsChat />
            },
            {
                path: "applications/email",
                element: <AdminAppsEmail />
            },
            {
                path: "applications/tasks",
                element: <AdminAppsTasks />
            },
            {
                path: "applications/notes",
                element: <AdminAppsNotes />
            },
            {
                path: "applications/calender",
                element: <AdminAppsCalender />
            },
            {
                path: "applications/storage",
                element: <AdminAppsStorage />
            },
        ]
    },
    {
        path: "/admin",
        element: <LayoutAdminSetting />,
        children: [
            { path: "settings/general", element: <SettingsGaneral /> },
            { path: "settings/seo", element: <SettingsSeo /> },
            { path: "settings/tags", element: <SettingsTags /> },
            { path: "settings/email", element: <SettingsEmail /> },
            { path: "settings/tasks", element: <SettingsTasks /> },
            { path: "settings/leads", element: <SettingsLeads /> },
            { path: "settings/support", element: <SettingsSupport /> },
            { path: "settings/finance", element: <SettingsFinance /> },
            { path: "settings/gateways", element: <SettingsGateways /> },
            { path: "settings/customers", element: <SettingsCustomers /> },
            { path: "settings/localization", element: <SettingsLocalization /> },
            { path: "settings/recaptcha", element: <SettingsRecaptcha /> },
            { path: "settings/miscellaneous", element: <SettingsMiscellaneous /> },
            { path: "settings/equipment", element: <SettingsEquipment /> },
        ]
    },
    // ── Project workspace routes ──────────────────────────────────────────
    {
        path: "/projects/:projectId",
        element: <LayoutProjectWorkspace />,
        children: [
            { index: true, element: <Navigate to="info" replace /> },
            { path: "info", element: <ProjectInfoPage /> },
            { path: "setup", element: <ProjectSetup /> },
            { path: "members", element: <ProjectMembersPage /> },
            { path: "invitations", element: <ProjectInvitationsPage /> },
            { path: "tasks", element: <ProjectTasksView /> },
            { path: "tasks/create", element: <ProjectTasksCreate /> },
            { path: "cameras", element: <ProjectCamerasPage /> },
            { path: "cameras/:cameraId", element: <ProjectCameraDetailPage /> },
            { path: "zones", element: <ProjectZonesPage /> },
            {
                path: "settings",
                element: <LayoutProjectSettings />,
                children: [
                    { index: true, element: <ProjectSettingsPPE /> },
                    { path: "workforce", element: <ProjectSettingsWorkforce /> },
                    { path: "activity", element: <ProjectSettingsActivity /> },
                    { path: "general", element: <ProjectSettingsGeneral /> },
                    { path: "reports", element: <ProjectSettingsReports /> },
                    { path: "seo", element: <ProjectSettingsSEO /> },
                    { path: "email", element: <ProjectSettingsEmail /> },
                    { path: "tasks", element: <ProjectSettingsTasks /> },
                    { path: "tags", element: <ProjectSettingsOther settingType="tags" /> },
                    { path: "leads", element: <ProjectSettingsOther settingType="leads" /> },
                    { path: "support", element: <ProjectSettingsOther settingType="support" /> },
                    { path: "finance", element: <ProjectSettingsOther settingType="finance" /> },
                    { path: "gateways", element: <ProjectSettingsOther settingType="gateways" /> },
                    { path: "customers", element: <ProjectSettingsOther settingType="customers" /> },
                    { path: "localization", element: <ProjectSettingsOther settingType="localization" /> },
                    { path: "recaptcha", element: <ProjectSettingsOther settingType="recaptcha" /> },
                    { path: "miscellaneous", element: <ProjectSettingsOther settingType="miscellaneous" /> },
                ]
            },
            { path: "bim", element: <BimWorkspacePage /> },
            { path: "reports/ppe", element: <ReportsProject /> },
            { path: "reports/workforce", element: <WorkforceAnalytics /> },
            { path: "reports/activity", element: <ActivityAnalytics /> },
            { path: "reports/equipment", element: <EquipmentAnalytics /> },
            { path: "reports/risk", element: <RiskAnalytics /> },
            { path: "reports/safety", element: <ProjectReportsContent /> },
            { path: "feature-control", element: <ProjectLiveViewPage /> },
            { path: "video-test", element: <DevVideoTestPage /> },
            { path: "intelligence/smart-query", element: <ProjectSmartQueryPage /> },
            { path: "proposal/list", element: <Proposalist /> },
            { path: "proposal/view", element: <ProposalView /> },
            { path: "proposal/edit", element: <ProposalEdit /> },
            { path: "proposal/create", element: <ProposalCreate /> },
            { path: "payment/list", element: <PaymentList /> },
            { path: "payment/view", element: <PaymentView /> },
            { path: "payment/create", element: <PaymentCreate /> },
            { path: "customers/list", element: <CustomersList /> },
            { path: "customers/view", element: <CustomersView /> },
            { path: "customers/create", element: <CustomersCreate /> },
            { path: "leads/list", element: <LeadsList /> },
            { path: "leads/view", element: <LeadsView /> },
            { path: "leads/create", element: <LeadsCreate /> },
            { path: "widgets/lists", element: <WidgetsLists /> },
            { path: "widgets/tables", element: <WidgetsTables /> },
            { path: "widgets/charts", element: <WidgetsCharts /> },
            { path: "widgets/statistics", element: <WidgetsStatistics /> },
            { path: "widgets/miscellaneous", element: <WidgetsMiscellaneous /> },
            { path: "help/knowledgebase", element: <HelpKnowledgebase /> },
            { path: "profile", element: <ProfilePage /> },
        ]
    },
    {
        path: "/projects/:projectId",
        element: <LayoutProjectApplications />,
        children: [
            { path: "applications/chat", element: <AppsChat /> },
            { path: "applications/email", element: <AppsEmail /> },
            { path: "applications/tasks", element: <AppsTasks /> },
            { path: "applications/notes", element: <AppsNotes /> },
            { path: "applications/calender", element: <AppsCalender /> },
            { path: "applications/storage", element: <AppsStorage /> },
        ]
    },
    {
        path: "/",
        element: <LayoutAuth />,
        children: [
            {
                index: true,
                element: <Landing />
            },
            {
                path: "/logout",
                element: <Logout />
            },
            {
                path: "/projects/my",
                element: <UserProjects />
            },
            {
                path: "/projects/invitations",
                element: <UserInvitations />
            },
            {
                path: "/profile",
                element: <ProfilePage />
            },
            {
                path: "/invite/:token",
                element: <InviteAcceptPage />
            },
            {
                path: "/login",
                element: <LoginCover />
            },
            {
                path: "/authentication/login/minimal",
                element: <LoginMinimal />
            },
            {
                path: "/authentication/login/creative",
                element: <LoginCreative />
            },
            {
                path: "/signup",
                element: <RegisterCover />
            },
            {
                path: "/authentication/register/minimal",
                element: <RegisterMinimal />
            },
            {
                path: "/authentication/register/creative",
                element: <RegisterCreative />
            },
            {
                path: "/forgot-password",
                element: <ResetCover />
            },
            {
                path: "/authentication/reset/minimal",
                element: <ResetMinimal />
            },
            {
                path: "/authentication/reset/creative",
                element: <ResetCreative />
            },
            {
                path: "/authentication/404/cover",
                element: <ErrorCover />
            },
            {
                path: "/authentication/404/minimal",
                element: <ErrorMinimal />
            },
            {
                path: "/authentication/404/creative",
                element: <ErrorCreative />
            },
            {
                path: "/verify-reset-code",
                element: <OtpCover />
            },
            {
                path: "/authentication/verify/minimal",
                element: <OtpMinimal />
            },
            {
                path: "/authentication/verify/creative",
                element: <OtpCreative />
            },
            {
                path: "/reset-password",
                element: <ResetPasswordCover />
            },
            {
                path: "/authentication/maintenance/cover",
                element: <MaintenanceCover />
            },
            {
                path: "/authentication/maintenance/minimal",
                element: <MaintenanceMinimal />
            },
            {
                path: "/authentication/maintenance/creative",
                element: <MaintenanceCreative />
            },
        ]
    },
    {
        path: "*",
        element: <ErrorCover />
    }
])
