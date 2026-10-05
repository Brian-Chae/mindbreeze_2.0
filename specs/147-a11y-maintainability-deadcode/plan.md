# SDD-147 — 구현 계획

| # | 변경 | 파일 |
|---|---|---|
| 1 | 모달 role=dialog+aria-modal+Escape+포커스 | UserManagementPage, ClientManagementPage |
| 2 | tr role=button+tabIndex+onKeyDown | SignupApplicationsPage, OrgManagementPage |
| 3 | select/input aria-label | SignupApplicationsPage, UserManagementPage, ClientManagementPage |
| 4 | autoComplete=new-password | ResetPasswordPage, RegisterClientPage |
| 5 | password.ts 삭제 | lib/api/password.ts |
| 6 | BandGuidePanel.tsx 삭제 | components/class/BandGuidePanel.tsx |
| 7 | alert→토스트 | ClientReportViewer |
| 8 | useRequireAuth JSDoc 명확화 | hooks/useAuth.ts |
| 9 | padEnd 제거 | components/auth/OtpInput.tsx |
| 10 | console.log DEV 게이트 | hooks/useNotificationSocket.ts |
| 11 | 개별 selector 구독 | App.tsx, LandingPage, ClientListPage |

## 테스트

- 프론트 vitest 44/318 + build 0 errors.
