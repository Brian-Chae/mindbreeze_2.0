import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LandingPage from './pages/LandingPage';

import { useAuthStore } from './stores/authStore';

// 랜딩에서 사용하지 않는 화면과 분석 라이브러리는 해당 경로를 열 때 불러온다.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ClientLoginPage = lazy(() => import('./pages/ClientLoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage'));
const CounselorOnboardingPage = lazy(() => import('./pages/onboarding/CounselorOnboardingPage'));
const ClientOnboardingPage = lazy(() => import('./pages/onboarding/ClientOnboardingPage'));
const ClientEssentialsPage = lazy(() => import('./pages/onboarding/ClientEssentialsPage'));
const ClientListPage = lazy(() => import('./pages/clients/ClientListPage'));
const ClientProfilePage = lazy(() => import('./pages/clients/ClientProfilePage'));
const ClientInvitePage = lazy(() => import('./pages/clients/ClientInvitePage'));
const InviteLandingPage = lazy(() => import('./pages/clients/InviteLandingPage'));
const OrgSearchPage = lazy(() => import('./pages/org/OrgSearchPage'));
const OrgRegisterPage = lazy(() => import('./pages/org/OrgRegisterPage'));
const OrgManagementPage = lazy(() => import('./pages/org/OrgManagementPage'));
const MyRequestsPage = lazy(() => import('./pages/org/MyRequestsPage'));
const CredentialDashboardPage = lazy(() => import('./pages/credentials/CredentialDashboardPage'));
const SessionListPage = lazy(() => import('./pages/sessions/SessionListPage'));
const SessionCreatePage = lazy(() => import('./pages/sessions/SessionCreatePage'));
const SessionDetailPage = lazy(() => import('./pages/sessions/SessionDetailPage'));
const SessionLivePage = lazy(() => import('./pages/sessions/SessionLivePage'));
const SessionRecordPage = lazy(() => import('./pages/records/SessionRecordPage'));
const ChatPage = lazy(() => import('./pages/chat/ChatPage'));
const DesignIndexPage = lazy(() => import('./pages/design/DesignIndexPage'));
const HomepagePage = lazy(() => import('./pages/design/HomepagePage'));
const OperatorAppPage = lazy(() => import('./pages/design/OperatorAppPage'));
const UserAppPage = lazy(() => import('./pages/design/UserAppPage'));
const ReportPage = lazy(() => import('./pages/design/ReportPage'));
const DocsPage = lazy(() => import('./pages/design/DocsPage'));
const ReportListPage = lazy(() => import('./pages/reports/ReportListPage'));
const ReportSamplePage = lazy(() => import('./pages/reports/ReportSamplePage'));
const ReportDetailPage = lazy(() => import('./pages/reports/ReportDetailPage'));
const ReportViewPage = lazy(() => import('./pages/reports/ReportViewPage'));
const AdminReviewListPage = lazy(() => import('./pages/admin/AdminReviewListPage'));
const AdminReviewDetailPage = lazy(() => import('./pages/admin/AdminReviewDetailPage'));
const UserManagementPage = lazy(() => import('./pages/admin/UserManagementPage'));
const ClientManagementPage = lazy(() => import('./pages/admin/ClientManagementPage'));
const AdminOrgManagementPage = lazy(() => import('./pages/admin/OrgManagementPage'));
const NotificationCenterPage = lazy(() => import('./pages/notifications/NotificationCenterPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ClientAppPage = lazy(() => import('./pages/client/ClientAppPage'));
const ClassJoinPage = lazy(() => import('./pages/class-join-page'));
const OrgPublicPage = lazy(() => import('./pages/OrgPublicPage'));
const OrgDashboardPage = lazy(() => import('./pages/OrgDashboardPage'));
const PlaygroundPage = lazy(() => import('./pages/playground/PlaygroundPage'));

function buildLoginRedirect(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  return `/login?role=platform_admin&next=${encodeURIComponent(next)}`;
}

/** 로그인 후 역할에 따라 라우팅 */
function RoleRouter() {
  const { user, isAuthenticated, isInitialized } = useAuthStore();

  if (!isInitialized) return null;

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'client') {
    return <Navigate to="/app" replace />;
  }

  if (user.role === 'org_admin') {
    return <Navigate to="/dashboard/org" replace />;
  }

  if (user.role === 'platform_admin') {
    return <Navigate to="/admin/orgs" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}

function PlatformAdminRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const { user, isAuthenticated, isInitialized } = useAuthStore();

  if (!isInitialized) return null;

  if (!isAuthenticated || !user) {
    return <Navigate to={buildLoginRedirect(location.pathname, location.search)} replace />;
  }

  if (user.role !== 'platform_admin') {
    return <Navigate to="/role-redirect" replace />;
  }

  return children;
}

function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Suspense fallback={<div role="status" className="flex min-h-screen items-center justify-center bg-[#FAF8FB] text-sm text-[#5F0080]">화면을 불러오는 중이에요.</div>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/join" element={<ClassJoinPage />} />
        <Route path="/o/:org_code" element={<OrgPublicPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/client" element={<ClientLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/*" element={<Navigate to="/register" replace />} />
        <Route path="/role-redirect" element={<RoleRouter />} />
        <Route path="/app" element={<ClientAppPage />} />
        <Route path="/app/*" element={<ClientAppPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/org" element={<OrgDashboardPage />} />
        <Route path="/onboarding/counselor" element={<CounselorOnboardingPage />} />
        <Route path="/onboarding/client" element={<ClientOnboardingPage />} />
        <Route path="/onboarding/client/essentials" element={<ClientEssentialsPage />} />
        <Route path="/clients" element={<ClientListPage />} />
        <Route path="/clients/invite" element={<ClientInvitePage />} />
        <Route path="/clients/:id" element={<ClientProfilePage />} />
        <Route path="/invite/:token" element={<InviteLandingPage />} />
        <Route path="/report-view" element={<ReportViewPage />} />
        <Route path="/org/search" element={<OrgSearchPage />} />
        <Route path="/org/register" element={<OrgRegisterPage />} />
        <Route path="/org/requests" element={<MyRequestsPage />} />
        <Route path="/org/:org_id" element={<OrgManagementPage />} />
        <Route path="/credentials" element={<CredentialDashboardPage />} />
        <Route path="/sessions" element={<SessionListPage />} />
        <Route path="/sessions/new" element={<SessionCreatePage />} />
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
        <Route path="/sessions/:id/live" element={<SessionLivePage />} />
        <Route path="/sessions/:id/record" element={<SessionRecordPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:roomId" element={<ChatPage />} />
        <Route path="/design" element={<DesignIndexPage />} />
        <Route path="/design/homepage" element={<HomepagePage />} />
        <Route path="/design/app" element={<OperatorAppPage />} />
        <Route path="/design/user-app" element={<UserAppPage />} />
        <Route path="/design/report" element={<ReportPage />} />
        <Route path="/design/docs" element={<DocsPage />} />
        <Route path="/reports" element={<ReportListPage />} />
        <Route path="/reports/sample" element={<ReportSamplePage />} />
        <Route path="/reports/:id" element={<ReportDetailPage />} />
        <Route
          path="/admin/reviews"
          element={(
            <PlatformAdminRoute>
              <AdminReviewListPage />
            </PlatformAdminRoute>
          )}
        />
        <Route
          path="/admin/reviews/:targetType/:id"
          element={(
            <PlatformAdminRoute>
              <AdminReviewDetailPage />
            </PlatformAdminRoute>
          )}
        />
        <Route
          path="/admin/users"
          element={(
            <PlatformAdminRoute>
              <UserManagementPage />
            </PlatformAdminRoute>
          )}
        />
        <Route
          path="/admin/clients"
          element={(
            <PlatformAdminRoute>
              <ClientManagementPage />
            </PlatformAdminRoute>
          )}
        />
        <Route
          path="/admin/orgs"
          element={(
            <PlatformAdminRoute>
              <AdminOrgManagementPage />
            </PlatformAdminRoute>
          )}
        />
        <Route path="/notifications" element={<NotificationCenterPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
