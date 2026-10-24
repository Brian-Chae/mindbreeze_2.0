import { lazy, Suspense, useEffect, type ReactElement } from 'react';
import { CounselingGate } from './components/routing/counseling-gate';
import { isAiEnabled, isDesignRoutesEnabled } from './lib/feature-flags';
import { useStatusBar } from './lib/native/use-status-bar';
import { isNativeApp } from './lib/native/platform';
import { initNativeKeyboard } from './lib/native/keyboard';
// SDD-088: useBlocker(이탈 가드)는 데이터 라우터 전용 — createBrowserRouter 로 전환
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  useLocation,
} from 'react-router-dom';
import LandingPage from './pages/LandingPage';

import { useAuthStore } from './stores/authStore';
import { resolvePostLoginPath } from './lib/auth-routing';
import { RoleGuard } from './components/auth/RoleGuard';
import { LegacySessionRedirect } from './components/routing/legacy-session-redirect';

// 랜딩에서 사용하지 않는 화면과 분석 라이브러리는 해당 경로를 열 때 불러온다.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ClientLoginPage = lazy(() => import('./pages/ClientLoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const RegisterClientPage = lazy(() => import('./pages/register/RegisterClientPage'));
const RegisterCounselorPage = lazy(() => import('./pages/register/RegisterCounselorPage'));
const RegisterOrganizationPage = lazy(() => import('./pages/register/RegisterOrganizationPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const SetPasswordPage = lazy(() => import('./pages/SetPasswordPage'));
// SDD-079: 기존 상담사 소속 추가 초대 수락
const MembershipInvitePage = lazy(() => import('./pages/MembershipInvitePage'));
const CounselorOnboardingPage = lazy(() => import('./pages/onboarding/CounselorOnboardingPage'));
const ClientOnboardingPage = lazy(() => import('./pages/onboarding/ClientOnboardingPage'));
const ClientEssentialsPage = lazy(() => import('./pages/onboarding/ClientEssentialsPage'));
const ClientProfilePage = lazy(() => import('./pages/clients/ClientProfilePage'));
const ClientInvitePage = lazy(() => import('./pages/clients/ClientInvitePage'));
const InviteLandingPage = lazy(() => import('./pages/clients/InviteLandingPage'));
const OrgSearchPage = lazy(() => import('./pages/org/OrgSearchPage'));
const OrgManagementPage = lazy(() => import('./pages/org/OrgManagementPage'));
// SDD-082: 기관 관리자 상담사 관리 페이지
const OrgCounselorsPage = lazy(() => import('./pages/org/OrgCounselorsPage'));
const MyRequestsPage = lazy(() => import('./pages/org/MyRequestsPage'));
const CredentialDashboardPage = lazy(() => import('./pages/credentials/CredentialDashboardPage'));
const InstantClassPage = lazy(() => import('./pages/classes/instant-class-page').then((m) => ({ default: m.InstantClassPage })));
const ClassSchedulingWizard = lazy(() => import('./pages/classes/class-scheduling-wizard').then((m) => ({ default: m.ClassSchedulingWizard })));
const CreateWizardContainer = lazy(() => import('./components/class/flow/host/CreateWizardContainer').then((m) => ({ default: m.CreateWizardContainer })));
const SessionDetailPage = lazy(() => import('./pages/sessions/SessionDetailPage'));
const SessionLivePage = lazy(() => import('./pages/sessions/SessionLivePage'));
// SDD-088: 독립형 클래스 플레이어 (풀스크린, AppShell 밖)
const ClassPlayerPage = lazy(() => import('./pages/sessions/ClassPlayerPage'));
const SessionSummaryPage = lazy(() => import('./pages/sessions/session-summary-page'));
const ClassReportPage = lazy(() => import('./pages/sessions/class-report-page'));
const SessionRecordPage = lazy(() => import('./pages/records/SessionRecordPage'));
const DesignIndexPage = lazy(() => import('./pages/design/DesignIndexPage'));
const HomepagePage = lazy(() => import('./pages/design/HomepagePage'));
const OperatorAppPage = lazy(() => import('./pages/design/OperatorAppPage'));
const UserAppPage = lazy(() => import('./pages/design/UserAppPage'));
const ReportPage = lazy(() => import('./pages/design/ReportPage'));
const DocsPage = lazy(() => import('./pages/design/DocsPage'));
const ClassPlayerCasesPage = lazy(() => import('./pages/design/ClassPlayerCasesPage'));
const ClassFlowCasesPage = lazy(() => import('./pages/design/ClassFlowCasesPage'));
const ReportSamplePage = lazy(() => import('./pages/reports/ReportSamplePage'));
const ReportDetailPage = lazy(() => import('./pages/reports/ReportDetailPage'));
const ReportViewPage = lazy(() => import('./pages/reports/ReportViewPage'));
const DataCenterPage = lazy(() => import('./pages/data-center/data-center-page'));
const AdminReviewListPage = lazy(() => import('./pages/admin/AdminReviewListPage'));
const AdminReviewDetailPage = lazy(() => import('./pages/admin/AdminReviewDetailPage'));
const UserManagementPage = lazy(() => import('./pages/admin/UserManagementPage'));
const ClientManagementPage = lazy(() => import('./pages/admin/ClientManagementPage'));
const AdminOrgManagementPage = lazy(() => import('./pages/admin/OrgManagementPage'));
const SignupApplicationsPage = lazy(() => import('./pages/admin/SignupApplicationsPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
// SDD-220: 약관·위기 도움·측정 안내·계정 삭제 요청(공개 경로)
const TermsPage = lazy(() => import('./pages/terms-page').then((m) => ({ default: m.TermsPage })));
const CrisisHelpPage = lazy(() => import('./pages/crisis-help-page').then((m) => ({ default: m.CrisisHelpPage })));
const MeasurementGuidePage = lazy(() => import('./pages/measurement-guide-page').then((m) => ({ default: m.MeasurementGuidePage })));
const AccountDeletionPage = lazy(() => import('./pages/account-deletion-page'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const NotificationCenterPage = lazy(() => import('./pages/notifications/NotificationCenterPage'));
const ProfessionalProfilePage = lazy(() => import('./pages/settings/professional-profile-page'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ClientAppPage = lazy(() => import('./pages/client/ClientAppPage'));
const HostClassDetailPage = lazy(() => import('./pages/classes/host-class-detail-page').then((module) => ({ default: module.HostClassDetailPage })));
const MemberStructureHomePage = lazy(() => import('./pages/client/member-structure-home-page').then((module) => ({ default: module.MemberStructureHomePage })));
const GuestClassMembershipPage = lazy(() => import('./pages/client/guest-class-membership-page').then(module => ({ default: module.GuestClassMembershipPage })));
const MemberClassesPage = lazy(() => import('./pages/client/member-classes-page').then((module) => ({ default: module.MemberClassesPage })));
const MemberClassDetailPage = lazy(() => import('./pages/client/member-class-detail-page').then((module) => ({ default: module.MemberClassDetailPage })));
const CounselingListPage = lazy(() => import('./pages/counseling/counseling-list-page').then((module) => ({ default: module.CounselingListPage })));
const CounselingDetailPage = lazy(() => import('./pages/counseling/counseling-detail-page').then((module) => ({ default: module.CounselingDetailPage })));
const CodeEntryPage = lazy(() => import('./pages/class/CodeEntryPage'));
const ClassEntryPage = lazy(() => import('./pages/class/EntryPage'));
const OrgPublicPage = lazy(() => import('./pages/OrgPublicPage'));
const OrgDashboardPage = lazy(() => import('./pages/OrgDashboardPage'));
const PlaygroundPage = lazy(() => import('./pages/playground/PlaygroundPage'));

function buildLoginRedirect(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  return `/login?role=platform_admin&next=${encodeURIComponent(next)}`;
}

/** 로그인 후 역할에 따라 라우팅 */
function RoleRouter() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  if (!isInitialized) return null;

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={resolvePostLoginPath(user)} replace />;
}

/** 루트 진입: 네이티브 앱은 랜딩 없이 로그인(또는 로그인 상태면 역할별 홈)으로 바로 이동 */
/** 구 AI 대화 경로(/agent, 푸시 딥링크) → 채팅 목록의 루시(AI) 채널 */
function LegacyAgentRedirect() {
  const location = useLocation();
  // SDD-220: AI 비공개면 루시 채널 대신 채팅 목록으로 보낸다.
  if (!isAiEnabled()) return <Navigate to="/chat" replace />;
  return <Navigate to={`/chat/lucy${location.search}`} replace />;
}

function EntryRoute() {
  if (isNativeApp()) return <RoleRouter />;
  return <LandingPage />;
}

function PlatformAdminRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);

  if (!isInitialized) return null;

  if (!isAuthenticated || !user) {
    return <Navigate to={buildLoginRedirect(location.pathname, location.search)} replace />;
  }

  if (user.role !== 'platform_admin') {
    return <Navigate to="/role-redirect" replace />;
  }

  return children;
}

/** 데이터 라우터 루트 — 부가 화면의 Suspense 셸. 주요 목록은 라우터가 청크를 먼저 준비한다. */
function RootLayout() {
  useStatusBar();
  useEffect(() => { void initNativeKeyboard(); }, []);

  return (
    <Suspense fallback={<div role="status" className="flex min-h-screen items-center justify-center bg-[#FAF8FB] text-sm text-[#5F0080]">화면을 불러오는 중이에요.</div>}>
      <Outlet />
    </Suspense>
  );
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
        <Route path="/" element={<EntryRoute />} />
        <Route path="/join" element={<CodeEntryPage />} />
        <Route path="/class/:sessionId/enter" element={<ClassEntryPage />} />
        <Route path="/o/:org_code" element={<OrgPublicPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/crisis-help" element={<CrisisHelpPage />} />
        <Route path="/measurement-guide" element={<MeasurementGuidePage />} />
        <Route path="/account-deletion" element={<AccountDeletionPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/client" element={<ClientLoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/register/client" element={<RegisterClientPage />} />
        <Route path="/register/counselor" element={<RegisterCounselorPage />} />
        <Route path="/register/organization" element={<RegisterOrganizationPage />} />
        <Route path="/register/*" element={<Navigate to="/register" replace />} />
        <Route path="/role-redirect" element={<RoleRouter />} />
        {/* 상담사 미연결 회원도 새 읽기 화면에 진입하도록 기존 연결 분기보다 먼저 등록한다. */}
        <Route path="/app" element={<RoleGuard role="client"><MemberStructureHomePage /></RoleGuard>} />
        <Route path="/class-members/:classId" element={<GuestClassMembershipPage />} />
        <Route path="/app/classes" element={<RoleGuard role="client"><MemberClassesPage /></RoleGuard>} />
        <Route path="/app/classes/:classId" element={<RoleGuard role="client"><MemberClassDetailPage /></RoleGuard>} />
        <Route path="/app/counseling" element={<CounselingGate area="member"><RoleGuard role="client"><CounselingListPage role="member" /></RoleGuard></CounselingGate>} />
        <Route path="/app/counseling/:relationshipId" element={<CounselingGate area="member"><RoleGuard role="client"><CounselingDetailPage role="member" /></RoleGuard></CounselingGate>} />
        <Route path="/app/sessions" element={<RoleGuard role="client"><Navigate to="/app/classes" replace /></RoleGuard>} />
        <Route path="/app/*" element={<RoleGuard role="client"><ClientAppPage /></RoleGuard>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/membership-invite" element={<MembershipInvitePage />} />
        <Route path="/agent" element={<RoleGuard role="counselor"><LegacyAgentRedirect /></RoleGuard>} />
        <Route path="/dashboard" lazy={async () => {
          const module = await import('./pages/DashboardPage');
          return { element: <RoleGuard role="counselor"><module.default /></RoleGuard> };
        }} />
        <Route path="/dashboard/org" element={<RoleGuard role="org_admin"><OrgDashboardPage /></RoleGuard>} />
        <Route path="/onboarding/counselor" element={<CounselorOnboardingPage />} />
        <Route path="/onboarding/client" element={<ClientOnboardingPage />} />
        <Route path="/onboarding/client/essentials" element={<ClientEssentialsPage />} />
        <Route path="/clients" lazy={async () => {
          const module = await import('./pages/clients/ClientListPage');
          return { element: <RoleGuard role={['counselor', 'org_admin']}><module.default /></RoleGuard> };
        }} />
        <Route path="/clients/invite" element={<RoleGuard role={['counselor', 'org_admin']}><ClientInvitePage /></RoleGuard>} />
        <Route path="/clients/:id" element={<RoleGuard role={['counselor', 'org_admin']}><ClientProfilePage /></RoleGuard>} />
        <Route path="/invite/:token" element={<InviteLandingPage />} />
        <Route path="/report-view" element={<ReportViewPage />} />
        <Route path="/org/search" element={<OrgSearchPage />} />
        {/* SDD-073: /org/register 자가 등록 경로 제거 — 기관 가입 상담 신청으로 대체 */}
        <Route path="/org/register" element={<Navigate to="/register/organization" replace />} />
        <Route path="/org/requests" element={<RoleGuard><MyRequestsPage /></RoleGuard>} />
        {/* SDD-082: static 세그먼트가 :org_id 보다 우선 매칭됨 */}
        <Route path="/org/counselors" element={<RoleGuard role="org_admin"><OrgCounselorsPage /></RoleGuard>} />
        <Route path="/org/data-center" element={<RoleGuard role="org_admin"><DataCenterPage /></RoleGuard>} />
        <Route path="/admin/data-center" element={<PlatformAdminRoute><DataCenterPage /></PlatformAdminRoute>} />
        <Route path="/org/:org_id" element={<OrgManagementPage />} />
        <Route path="/credentials" element={<RoleGuard role={['counselor', 'org_admin']}><CredentialDashboardPage /></RoleGuard>} />
        <Route path="/sessions" element={<RoleGuard role={['counselor', 'org_admin']}><Navigate to="/classes" replace /></RoleGuard>} />
        <Route path="/sessions/new" element={<RoleGuard role={['counselor', 'org_admin']}><Navigate to="/classes/new" replace /></RoleGuard>} />
        <Route path="/sessions/:id" element={<RoleGuard role={['counselor', 'org_admin']}><LegacySessionRedirect /></RoleGuard>} />
        <Route path="/classes" lazy={async () => {
          const module = await import('./pages/classes/host-classes-page');
          return { element: <RoleGuard role={['counselor', 'org_admin']}><module.HostClassesPage /></RoleGuard> };
        }} />
        <Route path="/classes/now" element={<RoleGuard role={['counselor', 'org_admin']}><InstantClassPage /></RoleGuard>} />
        <Route path="/classes/new" element={<RoleGuard role={['counselor', 'org_admin']}><ClassSchedulingWizard /></RoleGuard>} />
        <Route path="/classes/:classId" element={<RoleGuard role={['counselor', 'org_admin']}><HostClassDetailPage /></RoleGuard>} />
        <Route path="/classes/:classId/sessions" element={<RoleGuard role={['counselor', 'org_admin']}><HostClassDetailPage /></RoleGuard>} />
        <Route path="/classes/:classId/members" element={<RoleGuard role={['counselor', 'org_admin']}><HostClassDetailPage /></RoleGuard>} />
        <Route path="/classes/:classId/settings" element={<RoleGuard role={['counselor', 'org_admin']}><HostClassDetailPage /></RoleGuard>} />
        <Route path="/classes/:classId/schedule" element={<RoleGuard role={['counselor', 'org_admin']}><HostClassDetailPage /></RoleGuard>} />
        {/* 기존 상세가 읽는 내부 파라미터 이름 id를 유지한다(값은 회차 식별자다). */}
        <Route path="/classes/:classId/sessions/:id" element={<RoleGuard role={['counselor', 'org_admin']}><SessionDetailPage /></RoleGuard>} />
        <Route path="/counseling" element={<CounselingGate area="host"><RoleGuard role={['counselor', 'org_admin']}><CounselingListPage role="host" /></RoleGuard></CounselingGate>} />
        <Route path="/counseling/new" element={<CounselingGate area="host"><RoleGuard role={['counselor', 'org_admin']}><CreateWizardContainer /></RoleGuard></CounselingGate>} />
        <Route path="/counseling/:relationshipId" element={<CounselingGate area="host"><RoleGuard role={['counselor', 'org_admin']}><CounselingDetailPage role="host" /></RoleGuard></CounselingGate>} />
        <Route path="/counseling/:relationshipId/sessions/:id" element={<CounselingGate area="host"><RoleGuard role={['counselor', 'org_admin']}><SessionDetailPage /></RoleGuard></CounselingGate>} />
        {/* SDD-088: /live 는 하위 호환 리다이렉트, 실제 화면은 /player */}
        <Route path="/sessions/:id/live" element={<SessionLivePage />} />
        <Route path="/sessions/:id/player" element={<ClassPlayerPage />} />
        <Route path="/sessions/:id/summary" element={<RoleGuard role={['counselor', 'org_admin']}><SessionSummaryPage /></RoleGuard>} />
        <Route path="/sessions/:id/class-report" element={<RoleGuard role={['counselor', 'org_admin']}><ClassReportPage /></RoleGuard>} />
        <Route path="/sessions/:id/record" element={<SessionRecordPage />} />
        <Route path="/chat" lazy={async () => {
          const module = await import('./pages/chat/ChatPage');
          return { element: <RoleGuard><module.default /></RoleGuard> };
        }} />
        <Route path="/chat/:roomId" lazy={async () => {
          const module = await import('./pages/chat/ChatPage');
          return { element: <RoleGuard><module.default /></RoleGuard> };
        }} />
        {/* SDD-220: 디자인 시안 경로는 운영 빌드에서 등록하지 않는다(심사 노출 방지). */}
        {isDesignRoutesEnabled() && (
          <>
            <Route path="/design" element={<DesignIndexPage />} />
            <Route path="/design/homepage" element={<HomepagePage />} />
            <Route path="/design/app" element={<OperatorAppPage />} />
            <Route path="/design/user-app" element={<UserAppPage />} />
            <Route path="/design/report" element={<ReportPage />} />
            <Route path="/design/docs" element={<DocsPage />} />
            <Route path="/design/class-player" element={<ClassPlayerCasesPage />} />
            <Route path="/design/class-flow" element={<ClassFlowCasesPage />} />
          </>
        )}
        <Route path="/admin" element={<PlatformAdminRoute><Navigate to="/admin/orgs" replace /></PlatformAdminRoute>} />
        <Route path="/reports" lazy={async () => {
          const module = await import('./pages/reports/ReportListPage');
          return { element: <RoleGuard role={['counselor', 'org_admin']}><module.default /></RoleGuard> };
        }} />
        <Route path="/reports/sample" element={<ReportSamplePage />} />
        <Route path="/reports/:id" element={<RoleGuard role={['counselor', 'org_admin']}><ReportDetailPage /></RoleGuard>} />
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
        <Route
          path="/admin/applications"
          element={(
            <PlatformAdminRoute>
              <SignupApplicationsPage />
            </PlatformAdminRoute>
          )}
        />
        <Route path="/notifications" element={<RoleGuard><NotificationCenterPage /></RoleGuard>} />
        <Route path="/settings" element={<RoleGuard><SettingsPage /></RoleGuard>} />
        <Route path="/profile/professional" element={<RoleGuard role={['counselor', 'org_admin']}><ProfessionalProfilePage /></RoleGuard>} />
        <Route path="/playground" element={<RoleGuard><PlaygroundPage /></RoleGuard>} />
        {/* 정의되지 않은 경로는 전역 404 화면으로 처리한다 */}
        <Route path="*" element={<NotFoundPage />} />
    </Route>,
  ),
);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
