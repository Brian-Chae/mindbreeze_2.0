# SDD-143 — 기능·성능·명백 버그 (13건) 요약

## 구현 결과

2개 그룹 병렬 구현 (백엔드 4건 + 프론트 9건).

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | PERF-03 | 리포트 메일 생성 Celery 위임 + 202 | `report_email_service.py` |
| 2 | RPT-02 | timeline 300포인트 다운샘플 | `report_task.py` |
| 3 | STT-02 | 파일 핸들 with 컨텍스트 + OSError | `stt_task.py` |
| 4 | PERF-01 | 관리자 목록 일괄 조회 + 검토 큐 DB화 | `admin_service.py` |
| 5 | UX-01 | 기관 링크 수정 + NotFoundPage catch-all | `OrgSearchPage.tsx` `App.tsx` `NotFoundPage.tsx` |
| 6 | PERF-01(FE) | 검색 300ms 디바운스 + requestSeq | `UserManagementPage.tsx` `ClientManagementPage.tsx` |
| 7 | API-01 | onboarding_completed 필드 제거 | `ClientEssentialsPage.tsx` |
| 8 | UX-04 | 로그인 탭 쿼리 파라미터 유지 | `LoginPage.tsx` |
| 9 | UX-05 | 알림 뱃지 렌더 | `SidebarNav.tsx` |
| 10 | UX-06 | counselors id 기준 upsert | `ClientOnboardingPage.tsx` |
| 11 | UX-07 | isOrgAdmin org_admin 만 | `OrgManagementPage.tsx` |
| 12 | FE-JOIN-002 | 연도 new Date().getFullYear() 기준 | `class-join-page.tsx` |
| 13 | FE-THEME-001 | system 테마 change/storage 구독 | `useTheme.ts` |

## 테스트

- 백엔드 `pytest -q` → **1009 passed / 12 skipped / 0 failed**
- 프론트 `vitest run` → **44 files / 318 tests**
- 프론트 `npm run build` → **0 errors**

## 배포

GitHub Actions Deploy Dev.
