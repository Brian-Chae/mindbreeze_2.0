# SDD-245 코드 감사

> 2026-10-25 · 구현 변경 없음. 정적 소스 감사이며 브라우저 실측과 구별한다. 모든 발생 위치와 className은 code-counts.json에 보존했다.

## 결론

- 디자인 토큰은 이미 존재하지만 앱 전역 Button/Card/Input/Select/Tabs 정본은 없다. 기존 토큰을 통합하고 도메인별 raw JSX를 공용화하는 방향이다.
- 비테스트 TS/TSX/CSS 742개, 페이지 폴더 99개(helper/CSS 포함). raw button 선언 894개 중 고정 className 599개에서 **374개 패턴**. 동적 className 185개/86종, className 없는 버튼 110개.
- 문자열 패턴 변종은 시각적 불일치 개수가 아니다. 동적 표현식 런타임 확장, 링크 CTA, 도메인 래퍼는 raw button 변종 수에 포함하지 않았다.

## 정본·공용화 현황

| 항목 | 확인 결과 / 파일:행 |
|---|---|
| Tailwind | frontend/tailwind.config.cjs:2 preset 사용, :13 sm=15px/22px override |
| 토큰 원본 | design-system/tokens/ui/button.json:1, card.json:1, input.json:1, system/spacing.json:1, system/radius.json:1 |
| CSS 진입 | frontend/src/main.tsx:5 index.css, :6 mb-tokens.css; frontend/src/index.css:1 generated tokens import |
| 별도 변수 | frontend/src/mb-tokens.css:15 :root, generated CSS와 별도 mb 변수 계열 |
| 모바일 입력 | frontend/src/index.css:11 input/select/textarea 16px, min-height mobile-touch-control=48px !important |
| 기존 모바일 토큰 | design-system/build/outputs/css/tokens.base.css:154 touch 44/48px; :156 spacing 8/12/16/24px |
| 기존 버튼 토큰 | design-system/build/outputs/css/tokens.base.css:173 sm/md/lg 36/44/56px; :259 pill radius |
| radius 이름 차이 | design-system/build/outputs/css/tokens.base.css:104 radius-lg=20px; design-system/build/outputs/tailwind/preset.cjs:325 mb-lg=16px |
| 기본 셸 | frontend/src/components/layout/AppShell.tsx:37, frontend/src/components/client/ClientShell.tsx:43 px-4 / md:px-8 / lg:px-10 동일, contentPad override 가능 |
| 전역 UI primitive | frontend/src/components/ui/ 없음. Button/Card/Input/Select/Tabs 이름의 전역 구현 없음 |
| 도메인 primitive | frontend/src/components/class/flow/shared/flow-primitives.tsx:43 FlowCard, :57 FlowButton; flow-shared.css:20/:32/:40에 .pz-root 범위 CSS |
| 별도 CTA | frontend/src/components/landing/landing-ui.tsx:3 primary, :4 secondary; frontend/src/components/client/code-entry-button.tsx:12 variant |
| 별도 카드 | frontend/src/components/dashboard/clickable-card.tsx:15; frontend/src/components/class/flow/shell/ClassCard.tsx:37 |
| 중복 inset 후보 | frontend/src/pages/settings/participation-profile-page.tsx:11 내부 px-4 md:px-8 + ClientShell. 실제 차이는 실측 확인 |
| 별도 폭 후보 | frontend/src/pages/chat/ChatPage.tsx:148 contentPad 빈 문자열; frontend/src/pages/credentials/CredentialDashboardPage.tsx:124 max-w-[800px]; frontend/src/pages/OrgPublicPage.tsx:191 max-w-[960px] |

## 집계 정의

- 소스 문자열 출현 수(주석 포함). 대상은 rg --files frontend/src의 ts/tsx/css, __tests__/ 및 __mocks__/ 및 .test./.spec./.stories. 제외. 페이지는 pages/ prefix로 한정하므로 컴포넌트 전이 사용은 별도이다.
- px_arbitrary=px-[…], rounded_arbitrary=rounded-[…] 및 방향형, height_arbitrary=h-[…], hex=# 이후 3~8자리 16진수. height_arbitrary는 min-h-[…] 안 h 부분도 포함한다. hex는 해당 문자열 형태 출현이며 색상 토큰 위반 확정 수가 아니다.
- 자체 CSS import는 해당 파일의 직접 import 수. 컴포넌트 전이 CSS는 그 컴포넌트 JSON record에 보존.
- TypeScript AST의 소문자 button JSX opening/self-closing만 센다. 고정 className 공백 분리→토큰 정렬→중복 제거. 동적 표현식은 소스 공백 정규화 후 별도 중복 제거.

| 범위 | px 임의값 | radius 임의값 | h 임의값 | #hex |
|---|---:|---:|---:|---:|
| 전체 | 5 | 28 | 134 | 4780 |
| 페이지 폴더 | 1 | 19 | 69 | 2238 |

## 페이지 파일별 집계

| 파일 | px | radius | h | hex | CSS import | 첫 근거 행 |
|---|---:|---:|---:|---:|---:|---|
| frontend/src/pages/ClientLoginPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/ClientLoginPage.tsx:1 |
| frontend/src/pages/DashboardPage.tsx | 1 | 0 | 6 | 65 | 4 | frontend/src/pages/DashboardPage.tsx:24 |
| frontend/src/pages/ForgotPasswordPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/ForgotPasswordPage.tsx:1 |
| frontend/src/pages/LandingPage.tsx | 0 | 0 | 4 | 33 | 0 | frontend/src/pages/LandingPage.tsx:34 |
| frontend/src/pages/LoginPage.tsx | 0 | 1 | 4 | 20 | 0 | frontend/src/pages/LoginPage.tsx:200 |
| frontend/src/pages/MembershipInvitePage.tsx | 0 | 0 | 2 | 6 | 0 | frontend/src/pages/MembershipInvitePage.tsx:93 |
| frontend/src/pages/NotFoundPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/NotFoundPage.tsx:1 |
| frontend/src/pages/OrgDashboardPage.tsx | 0 | 0 | 1 | 151 | 0 | frontend/src/pages/OrgDashboardPage.tsx:31 |
| frontend/src/pages/OrgPublicPage.tsx | 0 | 0 | 1 | 59 | 0 | frontend/src/pages/OrgPublicPage.tsx:18 |
| frontend/src/pages/PrivacyPolicyPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/PrivacyPolicyPage.tsx:1 |
| frontend/src/pages/RegisterPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/RegisterPage.tsx:1 |
| frontend/src/pages/ResetPasswordPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/ResetPasswordPage.tsx:1 |
| frontend/src/pages/SetPasswordPage.tsx | 0 | 0 | 3 | 13 | 0 | frontend/src/pages/SetPasswordPage.tsx:190 |
| frontend/src/pages/SettingsPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/SettingsPage.tsx:1 |
| frontend/src/pages/account-deletion-page.tsx | 0 | 0 | 0 | 7 | 0 | frontend/src/pages/account-deletion-page.tsx:38 |
| frontend/src/pages/admin/AdminReviewDetailPage.tsx | 0 | 0 | 0 | 59 | 0 | frontend/src/pages/admin/AdminReviewDetailPage.tsx:40 |
| frontend/src/pages/admin/AdminReviewListPage.tsx | 0 | 0 | 0 | 28 | 0 | frontend/src/pages/admin/AdminReviewListPage.tsx:48 |
| frontend/src/pages/admin/ClientManagementPage.tsx | 0 | 0 | 8 | 102 | 0 | frontend/src/pages/admin/ClientManagementPage.tsx:23 |
| frontend/src/pages/admin/OrgManagementPage.tsx | 0 | 0 | 0 | 63 | 0 | frontend/src/pages/admin/OrgManagementPage.tsx:31 |
| frontend/src/pages/admin/SignupApplicationsPage.tsx | 0 | 0 | 0 | 80 | 0 | frontend/src/pages/admin/SignupApplicationsPage.tsx:37 |
| frontend/src/pages/admin/UserManagementPage.tsx | 0 | 0 | 6 | 56 | 0 | frontend/src/pages/admin/UserManagementPage.tsx:21 |
| frontend/src/pages/agent/briefing-settings-sheet.tsx | 0 | 0 | 0 | 2 | 0 | frontend/src/pages/agent/briefing-settings-sheet.tsx:24 |
| frontend/src/pages/agent/counselor-agent-page.tsx | 0 | 0 | 0 | 15 | 0 | frontend/src/pages/agent/counselor-agent-page.tsx:86 |
| frontend/src/pages/agent/counselor-agent-utils.ts | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/agent/counselor-agent-utils.ts:1 |
| frontend/src/pages/agent/risk-signals.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/agent/risk-signals.tsx:1 |
| frontend/src/pages/chat/ChatPage.tsx | 0 | 0 | 2 | 30 | 0 | frontend/src/pages/chat/ChatPage.tsx:152 |
| frontend/src/pages/class/CodeEntryPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/class/CodeEntryPage.tsx:1 |
| frontend/src/pages/class/EntryPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/class/EntryPage.tsx:1 |
| frontend/src/pages/classes/class-instant-invite-status.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/classes/class-instant-invite-status.tsx:1 |
| frontend/src/pages/classes/class-scheduling-wizard.tsx | 0 | 0 | 0 | 0 | 1 | frontend/src/pages/classes/class-scheduling-wizard.tsx:13 |
| frontend/src/pages/classes/class-scheduling.css | 0 | 0 | 0 | 28 | 0 | frontend/src/pages/classes/class-scheduling.css:8 |
| frontend/src/pages/classes/host-class-detail-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/classes/host-class-detail-page.tsx:1 |
| frontend/src/pages/classes/host-classes-page.tsx | 0 | 1 | 0 | 0 | 0 | frontend/src/pages/classes/host-classes-page.tsx:22 |
| frontend/src/pages/classes/instant-class-page.tsx | 0 | 0 | 0 | 0 | 2 | frontend/src/pages/classes/instant-class-page.tsx:14 |
| frontend/src/pages/classes/instant-class-share.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/classes/instant-class-share.tsx:1 |
| frontend/src/pages/classes/instant-class.css | 0 | 0 | 0 | 5 | 0 | frontend/src/pages/classes/instant-class.css:1 |
| frontend/src/pages/classes/instant-invite-sheet.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/classes/instant-invite-sheet.tsx:1 |
| frontend/src/pages/classes/wizard-visual-components.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/classes/wizard-visual-components.tsx:1 |
| frontend/src/pages/client/ClientAppPage.tsx | 0 | 0 | 0 | 18 | 0 | frontend/src/pages/client/ClientAppPage.tsx:153 |
| frontend/src/pages/client/ClientChatPage.tsx | 0 | 0 | 3 | 30 | 0 | frontend/src/pages/client/ClientChatPage.tsx:155 |
| frontend/src/pages/client/ClientHomePage.tsx | 0 | 0 | 3 | 58 | 1 | frontend/src/pages/client/ClientHomePage.tsx:17 |
| frontend/src/pages/client/ClientNotificationPage.tsx | 0 | 0 | 0 | 2 | 0 | frontend/src/pages/client/ClientNotificationPage.tsx:71 |
| frontend/src/pages/client/ClientReportDetailModal.tsx | 0 | 0 | 0 | 5 | 1 | frontend/src/pages/client/ClientReportDetailModal.tsx:13 |
| frontend/src/pages/client/ClientReportListPage.tsx | 0 | 0 | 0 | 66 | 0 | frontend/src/pages/client/ClientReportListPage.tsx:29 |
| frontend/src/pages/client/ClientSessionDetailPage.tsx | 0 | 0 | 2 | 4 | 1 | frontend/src/pages/client/ClientSessionDetailPage.tsx:19 |
| frontend/src/pages/client/ClientSessionListPage.tsx | 0 | 0 | 0 | 2 | 1 | frontend/src/pages/client/ClientSessionListPage.tsx:16 |
| frontend/src/pages/client/ai-agent-page.tsx | 0 | 0 | 0 | 11 | 0 | frontend/src/pages/client/ai-agent-page.tsx:198 |
| frontend/src/pages/client/guest-class-membership-page.tsx | 0 | 0 | 0 | 1 | 1 | frontend/src/pages/client/guest-class-membership-page.tsx:13 |
| frontend/src/pages/client/member-class-detail-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/client/member-class-detail-page.tsx:1 |
| frontend/src/pages/client/member-classes-page.tsx | 0 | 0 | 1 | 1 | 0 | frontend/src/pages/client/member-classes-page.tsx:32 |
| frontend/src/pages/client/member-structure-home-page.tsx | 0 | 0 | 0 | 0 | 3 | frontend/src/pages/client/member-structure-home-page.tsx:3 |
| frontend/src/pages/client/use-class-apply.tsx | 0 | 0 | 0 | 1 | 1 | frontend/src/pages/client/use-class-apply.tsx:5 |
| frontend/src/pages/clients/ClientInvitePage.tsx | 0 | 0 | 0 | 14 | 0 | frontend/src/pages/clients/ClientInvitePage.tsx:55 |
| frontend/src/pages/clients/ClientListPage.tsx | 0 | 8 | 5 | 61 | 0 | frontend/src/pages/clients/ClientListPage.tsx:28 |
| frontend/src/pages/clients/ClientProfilePage.tsx | 0 | 6 | 4 | 58 | 0 | frontend/src/pages/clients/ClientProfilePage.tsx:31 |
| frontend/src/pages/clients/InviteLandingPage.tsx | 0 | 0 | 0 | 22 | 0 | frontend/src/pages/clients/InviteLandingPage.tsx:71 |
| frontend/src/pages/counseling/counseling-detail-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/counseling/counseling-detail-page.tsx:1 |
| frontend/src/pages/counseling/counseling-list-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/counseling/counseling-list-page.tsx:1 |
| frontend/src/pages/credentials/CredentialDashboardPage.tsx | 0 | 0 | 0 | 3 | 0 | frontend/src/pages/credentials/CredentialDashboardPage.tsx:244 |
| frontend/src/pages/crisis-help-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/crisis-help-page.tsx:1 |
| frontend/src/pages/data-center/data-center-page.tsx | 0 | 0 | 0 | 0 | 1 | frontend/src/pages/data-center/data-center-page.tsx:28 |
| frontend/src/pages/data-center/data-center.css | 0 | 0 | 0 | 19 | 1 | frontend/src/pages/data-center/data-center.css:1 |
| frontend/src/pages/design/ClassFlowCasesPage.tsx | 0 | 0 | 0 | 4 | 0 | frontend/src/pages/design/ClassFlowCasesPage.tsx:28 |
| frontend/src/pages/design/ClassPlayerCasesPage.tsx | 0 | 0 | 0 | 3 | 0 | frontend/src/pages/design/ClassPlayerCasesPage.tsx:32 |
| frontend/src/pages/design/DesignIndexPage.tsx | 0 | 0 | 0 | 1 | 0 | frontend/src/pages/design/DesignIndexPage.tsx:52 |
| frontend/src/pages/design/DocsPage.tsx | 0 | 0 | 0 | 84 | 0 | frontend/src/pages/design/DocsPage.tsx:5 |
| frontend/src/pages/design/HomepagePage.tsx | 0 | 0 | 0 | 42 | 0 | frontend/src/pages/design/HomepagePage.tsx:16 |
| frontend/src/pages/design/OperatorAppPage.tsx | 0 | 0 | 0 | 277 | 0 | frontend/src/pages/design/OperatorAppPage.tsx:41 |
| frontend/src/pages/design/ReportPage.tsx | 0 | 0 | 0 | 60 | 0 | frontend/src/pages/design/ReportPage.tsx:11 |
| frontend/src/pages/design/UserAppPage.tsx | 0 | 0 | 0 | 136 | 0 | frontend/src/pages/design/UserAppPage.tsx:23 |
| frontend/src/pages/measurement-guide-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/measurement-guide-page.tsx:1 |
| frontend/src/pages/notifications/NotificationCenterPage.tsx | 0 | 0 | 0 | 22 | 0 | frontend/src/pages/notifications/NotificationCenterPage.tsx:127 |
| frontend/src/pages/onboarding/ClientEssentialsPage.tsx | 0 | 0 | 0 | 24 | 0 | frontend/src/pages/onboarding/ClientEssentialsPage.tsx:109 |
| frontend/src/pages/onboarding/ClientOnboardingPage.tsx | 0 | 1 | 11 | 35 | 0 | frontend/src/pages/onboarding/ClientOnboardingPage.tsx:84 |
| frontend/src/pages/onboarding/CounselorOnboardingPage.tsx | 0 | 2 | 0 | 36 | 0 | frontend/src/pages/onboarding/CounselorOnboardingPage.tsx:55 |
| frontend/src/pages/org/MyRequestsPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/org/MyRequestsPage.tsx:1 |
| frontend/src/pages/org/OrgCounselorsPage.tsx | 0 | 0 | 0 | 93 | 0 | frontend/src/pages/org/OrgCounselorsPage.tsx:62 |
| frontend/src/pages/org/OrgManagementPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/org/OrgManagementPage.tsx:1 |
| frontend/src/pages/org/OrgSearchPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/org/OrgSearchPage.tsx:1 |
| frontend/src/pages/playground/PlaygroundPage.tsx | 0 | 0 | 0 | 5 | 0 | frontend/src/pages/playground/PlaygroundPage.tsx:133 |
| frontend/src/pages/records/SessionRecordPage.tsx | 0 | 0 | 0 | 45 | 0 | frontend/src/pages/records/SessionRecordPage.tsx:27 |
| frontend/src/pages/register/RegisterClientPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/register/RegisterClientPage.tsx:1 |
| frontend/src/pages/register/RegisterCounselorPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/register/RegisterCounselorPage.tsx:1 |
| frontend/src/pages/register/RegisterOrganizationPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/register/RegisterOrganizationPage.tsx:1 |
| frontend/src/pages/reports/ReportDetailModal.tsx | 0 | 0 | 0 | 2 | 1 | frontend/src/pages/reports/ReportDetailModal.tsx:8 |
| frontend/src/pages/reports/ReportDetailPage.tsx | 0 | 0 | 0 | 1 | 0 | frontend/src/pages/reports/ReportDetailPage.tsx:33 |
| frontend/src/pages/reports/ReportListPage.tsx | 0 | 0 | 0 | 97 | 0 | frontend/src/pages/reports/ReportListPage.tsx:86 |
| frontend/src/pages/reports/ReportSamplePage.tsx | 0 | 0 | 1 | 5 | 0 | frontend/src/pages/reports/ReportSamplePage.tsx:75 |
| frontend/src/pages/reports/ReportViewPage.tsx | 0 | 0 | 1 | 18 | 0 | frontend/src/pages/reports/ReportViewPage.tsx:85 |
| frontend/src/pages/sessions/ClassPlayerPage.tsx | 0 | 0 | 1 | 38 | 1 | frontend/src/pages/sessions/ClassPlayerPage.tsx:72 |
| frontend/src/pages/sessions/SessionDetailPage.tsx | 0 | 0 | 0 | 6 | 1 | frontend/src/pages/sessions/SessionDetailPage.tsx:32 |
| frontend/src/pages/sessions/SessionListPage.tsx | 0 | 0 | 0 | 2 | 1 | frontend/src/pages/sessions/SessionListPage.tsx:14 |
| frontend/src/pages/sessions/SessionLivePage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/sessions/SessionLivePage.tsx:1 |
| frontend/src/pages/sessions/class-report-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/sessions/class-report-page.tsx:1 |
| frontend/src/pages/sessions/session-summary-page.tsx | 0 | 0 | 0 | 0 | 1 | frontend/src/pages/sessions/session-summary-page.tsx:14 |
| frontend/src/pages/settings/ClientSettingsPage.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/settings/ClientSettingsPage.tsx:1 |
| frontend/src/pages/settings/participation-profile-page.tsx | 0 | 0 | 0 | 2 | 0 | frontend/src/pages/settings/participation-profile-page.tsx:11 |
| frontend/src/pages/settings/professional-profile-page.tsx | 0 | 0 | 0 | 2 | 0 | frontend/src/pages/settings/professional-profile-page.tsx:16 |
| frontend/src/pages/terms-page.tsx | 0 | 0 | 0 | 0 | 0 | frontend/src/pages/terms-page.tsx:1 |

## 자체 CSS 파일 전체

- frontend/src/components/chat/chat-room.css:1
- frontend/src/components/class-report/class-report.css:1
- frontend/src/components/class/flow/host/host-flow-base.css:1
- frontend/src/components/class/flow/host/host-flow-create.css:1
- frontend/src/components/class/flow/host/host-flow-live.css:1
- frontend/src/components/class/flow/member/member-flow.css:1
- frontend/src/components/class/flow/member/notice-step.css:1
- frontend/src/components/class/flow/shared/flow-shared.css:1
- frontend/src/components/class/flow/shell/shell-kit.css:1
- frontend/src/components/class/host-class-player.css:1
- frontend/src/components/class/player/host/host-player.css:1
- frontend/src/components/class/player/member/member-player.css:1
- frontend/src/components/class/player/shared/player-shared.css:1
- frontend/src/components/class/player/shared/player-tokens.css:1
- frontend/src/components/class/structure/class-operations.css:1
- frontend/src/components/class/structure/class-schedule-editor.css:1
- frontend/src/components/class/structure/structure-shell.css:1
- frontend/src/components/class/waiting-room-readiness-panel.css:1
- frontend/src/components/client/home/home-card-parity.css:1
- frontend/src/components/client/home/member-home-layout.css:1
- frontend/src/components/dashboard/counselor-home.css:1
- frontend/src/components/data-center/controls.css:1
- frontend/src/components/data-center/export.css:1
- frontend/src/components/data-center/measurement-detail.css:1
- frontend/src/components/forms/birth-year-month-wheel.css:1
- frontend/src/components/layout/floating-bottom-nav.css:1
- frontend/src/components/layout/mobile-menu-swipe.css:1
- frontend/src/components/reports/narrative-sections.css:1
- frontend/src/components/session-summary/session-summary.css:1
- frontend/src/index.css:1
- frontend/src/lib/report/report-print.css:1
- frontend/src/mb-tokens.css:1
- frontend/src/mobile-foundation.css:1
- frontend/src/pages/classes/class-scheduling.css:1
- frontend/src/pages/classes/instant-class.css:1
- frontend/src/pages/data-center/data-center.css:1

## 라우터 인벤토리

App.tsx path 선언 **94개**. 리다이렉트/wildcard/design flag도 포함한 선언 수. 같은 URL의 역할별 차이는 별도 실측 대상으로 본다. 홈은 회원 /app, 상담사 /dashboard, 기관관리자 /dashboard/org, 플랫폼관리자 /admin/orgs (frontend/src/lib/auth-routing.ts:3).

| path | 파일:행 |
|---|---|
| / | frontend/src/App.tsx:168 |
| /join | frontend/src/App.tsx:169 |
| /class/:sessionId/enter | frontend/src/App.tsx:170 |
| /o/:org_code | frontend/src/App.tsx:171 |
| /privacy | frontend/src/App.tsx:172 |
| /terms | frontend/src/App.tsx:173 |
| /crisis-help | frontend/src/App.tsx:174 |
| /measurement-guide | frontend/src/App.tsx:175 |
| /account-deletion | frontend/src/App.tsx:176 |
| /login | frontend/src/App.tsx:177 |
| /login/client | frontend/src/App.tsx:178 |
| /register | frontend/src/App.tsx:179 |
| /register/client | frontend/src/App.tsx:180 |
| /register/counselor | frontend/src/App.tsx:181 |
| /register/organization | frontend/src/App.tsx:182 |
| /register/* | frontend/src/App.tsx:183 |
| /role-redirect | frontend/src/App.tsx:184 |
| /app | frontend/src/App.tsx:186 |
| /class-members/:classId | frontend/src/App.tsx:187 |
| /app/classes | frontend/src/App.tsx:188 |
| /app/classes/:classId | frontend/src/App.tsx:189 |
| /app/counseling | frontend/src/App.tsx:190 |
| /app/counseling/:relationshipId | frontend/src/App.tsx:191 |
| /app/sessions | frontend/src/App.tsx:192 |
| /app/* | frontend/src/App.tsx:193 |
| /forgot-password | frontend/src/App.tsx:194 |
| /reset-password | frontend/src/App.tsx:195 |
| /set-password | frontend/src/App.tsx:196 |
| /membership-invite | frontend/src/App.tsx:197 |
| /agent | frontend/src/App.tsx:198 |
| /dashboard | frontend/src/App.tsx:199 |
| /dashboard/org | frontend/src/App.tsx:203 |
| /onboarding/counselor | frontend/src/App.tsx:204 |
| /onboarding/client | frontend/src/App.tsx:205 |
| /onboarding/client/essentials | frontend/src/App.tsx:206 |
| /clients | frontend/src/App.tsx:207 |
| /clients/invite | frontend/src/App.tsx:211 |
| /clients/:id | frontend/src/App.tsx:212 |
| /invite/:token | frontend/src/App.tsx:213 |
| /report-view | frontend/src/App.tsx:214 |
| /org/search | frontend/src/App.tsx:215 |
| /org/register | frontend/src/App.tsx:217 |
| /org/requests | frontend/src/App.tsx:218 |
| /org/counselors | frontend/src/App.tsx:220 |
| /org/data-center | frontend/src/App.tsx:221 |
| /admin/data-center | frontend/src/App.tsx:222 |
| /org/:org_id | frontend/src/App.tsx:223 |
| /credentials | frontend/src/App.tsx:224 |
| /sessions | frontend/src/App.tsx:225 |
| /sessions/new | frontend/src/App.tsx:226 |
| /sessions/:id | frontend/src/App.tsx:227 |
| /classes | frontend/src/App.tsx:228 |
| /classes/now | frontend/src/App.tsx:232 |
| /classes/new | frontend/src/App.tsx:233 |
| /classes/:classId | frontend/src/App.tsx:234 |
| /classes/:classId/sessions | frontend/src/App.tsx:235 |
| /classes/:classId/members | frontend/src/App.tsx:236 |
| /classes/:classId/settings | frontend/src/App.tsx:237 |
| /classes/:classId/schedule | frontend/src/App.tsx:238 |
| /classes/:classId/sessions/:id | frontend/src/App.tsx:240 |
| /counseling | frontend/src/App.tsx:241 |
| /counseling/new | frontend/src/App.tsx:242 |
| /counseling/:relationshipId | frontend/src/App.tsx:243 |
| /counseling/:relationshipId/sessions/:id | frontend/src/App.tsx:244 |
| /sessions/:id/live | frontend/src/App.tsx:246 |
| /sessions/:id/player | frontend/src/App.tsx:247 |
| /sessions/:id/summary | frontend/src/App.tsx:248 |
| /sessions/:id/class-report | frontend/src/App.tsx:249 |
| /sessions/:id/record | frontend/src/App.tsx:250 |
| /chat | frontend/src/App.tsx:251 |
| /chat/:roomId | frontend/src/App.tsx:255 |
| /design | frontend/src/App.tsx:262 |
| /design/homepage | frontend/src/App.tsx:263 |
| /design/app | frontend/src/App.tsx:264 |
| /design/user-app | frontend/src/App.tsx:265 |
| /design/report | frontend/src/App.tsx:266 |
| /design/docs | frontend/src/App.tsx:267 |
| /design/class-player | frontend/src/App.tsx:268 |
| /design/class-flow | frontend/src/App.tsx:269 |
| /admin | frontend/src/App.tsx:272 |
| /reports | frontend/src/App.tsx:273 |
| /reports/sample | frontend/src/App.tsx:277 |
| /reports/:id | frontend/src/App.tsx:278 |
| /admin/reviews | frontend/src/App.tsx:280 |
| /admin/reviews/:targetType/:id | frontend/src/App.tsx:288 |
| /admin/users | frontend/src/App.tsx:296 |
| /admin/clients | frontend/src/App.tsx:304 |
| /admin/orgs | frontend/src/App.tsx:312 |
| /admin/applications | frontend/src/App.tsx:320 |
| /notifications | frontend/src/App.tsx:327 |
| /settings | frontend/src/App.tsx:328 |
| /profile/professional | frontend/src/App.tsx:329 |
| /playground | frontend/src/App.tsx:330 |
| * | frontend/src/App.tsx:332 |

### /app/* 수동 분기 누락 방지

frontend/src/pages/client/ClientAppPage.tsx의 pathname 분기도 포함해야 한다.

- /app/chat, /app/chat/:roomId, /app/chat/lucy: ClientChatPage (`frontend/src/pages/client/ClientAppPage.tsx:262`). AI flag에 따라 lucy→chat.
- /app/ai, /app/ai/: chat 또는 chat/lucy 리다이렉트.
- /app/profile: ClientShell + ClientSettingsPage (`frontend/src/pages/client/ClientAppPage.tsx:265`).
- /app/participation-profile: ClientShell + ParticipationProfilePage (`frontend/src/pages/client/ClientAppPage.tsx:268`).
- /app/sessions/:id: ClientSessionDetailPage (`frontend/src/pages/client/ClientAppPage.tsx:313`). 상담사 연결 gate 이후.
- /app/reports: ClientReportListPage (`frontend/src/pages/client/ClientAppPage.tsx:344`). 상담사 연결 gate 이후.
- /app/notifications: ClientNotificationPage (`frontend/src/pages/client/ClientAppPage.tsx:347`). gate 예외.

/app/sessions 목록은 App.tsx가 /app/classes로 리다이렉트한다. ClientSessionListPage 분기와 ClientHomePage fallback 존재만으로 활성 독립 페이지로 세지 않는다. /app/*의 미지 경로 fallback도 별도 고유 화면이 아니다. 정확한 분기 행은 아래 재현 grep으로 검증한다.

CounselingGate, design flag, AI flag, 동적 상세 데이터의 성공/빈 상태는 실측 manifest에서 구분한다. 로그인은 감사만 하고 fix/mobile-login-header의 소유권을 침범하지 않는다.

## 재현 명령

아래 문자열 매치 명령과 JSON patterns/records를 대조한다. 버튼 재집계 AST 코드는 이어서 제공한다.

```bash
rg -n -o '\bpx-\[[^\]\r\n]+\]|\brounded(-[a-z]+)?-\[[^\]\r\n]+\]|\bh-\[[^\]\r\n]+\]|#[0-9a-fA-F]{3,8}\b' frontend/src/pages --glob '*.tsx' --glob '*.ts' --glob '*.css' --glob '!*.test.*' --glob '!*.spec.*' --glob '!*.stories.*' --glob '!**/__tests__/**' --glob '!**/__mocks__/**'
rg --files frontend/src | rg '\.css$'
rg -n 'path=|pathname.*(===|startsWith|match)' frontend/src/App.tsx frontend/src/pages/client/ClientAppPage.tsx
```

저장소 루트에서 node stdin으로 실행:

```javascript
const fs = require('fs'), cp = require('child_process');
const ts = require('./frontend/node_modules/typescript');
const variants = { literal: new Set(), expression: new Set() };
const count = { literal: 0, expression: 0, absent: 0 };
const files = cp.execFileSync('rg', ['--files', 'frontend/src'], {encoding:'utf8'}).trim().split('\n')
 .filter(f => /\.tsx$/.test(f) && !/(^|\/)(__tests__|__mocks__)\/|\.(test|spec|stories)\./.test(f));
for (const file of files) {
 const sf = ts.createSourceFile(file, fs.readFileSync(file,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
 function walk(n) {
  if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === 'button') {
   const a = n.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className');
   const i = a?.initializer;
   const kind = !i ? 'absent' : ts.isStringLiteral(i) ? 'literal' : 'expression'; count[kind]++;
   if (i) variants[kind].add(kind === 'literal' ? i.text.trim().split(/\s+/).sort().join(' ') : i.getText(sf).replace(/\s+/g,' ').trim());
  }
  ts.forEachChild(n, walk);
 } walk(sf);
}
console.log(count, {literalVariants: variants.literal.size, expressionVariants: variants.expression.size});
```
