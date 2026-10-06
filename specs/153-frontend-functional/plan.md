# SDD-153 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | ClassPlayerPage.tsx | 순수 함수 + ref 분리 |
| 2 | class-join-page.tsx | cancelled → code |
| 3 | useSessionLiveSocket.ts | snapshotRef 단조 병합 |
| 4 | SessionCreatePage.tsx | applyTemplate trim |
| 5 | auth-routing.ts, ClientEssentialsPage.tsx | essentials 라우팅 |
| 6 | ClientListPage.tsx, ClientProfilePage.tsx, useAuth.ts | org_admin 허용 |
| 7 | ReportListPage.tsx | 전체 로드 |
| 8 | ClientReportListPage.tsx | 검색 병합 |
| 9 | ClientOnboardingPage.tsx | 재시도 버튼 |
| 10 | narrative.ts, resolve-narrative.ts | 부분 서사 |
| 11 | ClientSessionDetailPage.tsx | null 비활성화 |

## 테스트

- npm run build(0) + npx vitest run(44/318).
