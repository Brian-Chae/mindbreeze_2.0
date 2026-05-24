import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ClientLoginPage from './pages/ClientLoginPage';
import DashboardPage from './pages/DashboardPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CounselorOnboardingPage from './pages/onboarding/CounselorOnboardingPage';
import ClientOnboardingPage from './pages/onboarding/ClientOnboardingPage';
import ClientEssentialsPage from './pages/onboarding/ClientEssentialsPage';
import ClientListPage from './pages/clients/ClientListPage';
import ClientProfilePage from './pages/clients/ClientProfilePage';
import ClientInvitePage from './pages/clients/ClientInvitePage';
import InviteLandingPage from './pages/clients/InviteLandingPage';
import OrgSearchPage from './pages/org/OrgSearchPage';
import OrgRegisterPage from './pages/org/OrgRegisterPage';
import OrgManagementPage from './pages/org/OrgManagementPage';
import MyRequestsPage from './pages/org/MyRequestsPage';
import CredentialDashboardPage from './pages/credentials/CredentialDashboardPage';
import SessionListPage from './pages/sessions/SessionListPage';
import SessionCreatePage from './pages/sessions/SessionCreatePage';
import SessionDetailPage from './pages/sessions/SessionDetailPage';
import SessionLivePage from './pages/sessions/SessionLivePage';
import SessionRecordPage from './pages/records/SessionRecordPage';
import ChatPage from './pages/chat/ChatPage';
import DesignIndexPage from './pages/design/DesignIndexPage';
import HomepagePage from './pages/design/HomepagePage';
import OperatorAppPage from './pages/design/OperatorAppPage';
import UserAppPage from './pages/design/UserAppPage';
import ReportPage from './pages/design/ReportPage';
import DocsPage from './pages/design/DocsPage';
import ReportListPage from './pages/reports/ReportListPage';
import ReportDetailPage from './pages/reports/ReportDetailPage';
import AdminReviewListPage from './pages/admin/AdminReviewListPage';
import AdminReviewDetailPage from './pages/admin/AdminReviewDetailPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import NotificationCenterPage from './pages/notifications/NotificationCenterPage';
import SettingsPage from './pages/SettingsPage';
import ClientAppPage from './pages/client/ClientAppPage';
import { useAuthStore } from './stores/authStore';

/** 로그인 후 역할에 따라 라우팅 */
function RoleRouter() {
  const { user, isAuthenticated, isInitialized } = useAuthStore();

  if (!isInitialized) return null; // 초기화 중

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === 'client') {
    return <Navigate to="/app" replace />;
  }

  // counselor, org_admin, platform_admin → 대시보드
  return <Navigate to="/dashboard" replace />;
}

function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/client" element={<ClientLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/*" element={<Navigate to="/register" replace />} />
        <Route path="/role-redirect" element={<RoleRouter />} />
        <Route path="/app" element={<ClientAppPage />} />
        <Route path="/app/*" element={<ClientAppPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/onboarding/counselor" element={<CounselorOnboardingPage />} />
        <Route path="/onboarding/client" element={<ClientOnboardingPage />} />
        <Route path="/onboarding/client/essentials" element={<ClientEssentialsPage />} />
        <Route path="/clients" element={<ClientListPage />} />
        <Route path="/clients/invite" element={<ClientInvitePage />} />
        <Route path="/clients/:id" element={<ClientProfilePage />} />
        <Route path="/invite/:token" element={<InviteLandingPage />} />
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
        <Route path="/reports/:id" element={<ReportDetailPage />} />
        <Route path="/admin/reviews" element={<AdminReviewListPage />} />
        <Route path="/admin/reviews/:targetType/:id" element={<AdminReviewDetailPage />} />
        <Route path="/admin/users" element={<UserManagementPage />} />
        <Route path="/notifications" element={<NotificationCenterPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
