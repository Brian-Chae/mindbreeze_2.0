# SDD-R02 — 카드 그리드 페이지 모바일 대응

> 상위 기획: `.hermes/plans/2026-05-20_responsive-mobile.md`
> 선행 조건: R01 (AppShell 반응형) 완료 후

## 현재 상태
- 카드 그리드 페이지들은 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`로 이미 반응형 breakpoint 사용 중
- AppShell 고정 사이드바 때문에 모바일에서 깨질 뿐, AppShell만 고치면 자연스럽게 대응됨

## 대상 페이지 (5개)

| 페이지 | 파일 | 현재 그리드 | 변경 |
|---|---|---|---|
| SessionListPage | `pages/sessions/SessionListPage.tsx` | `grid-cols-1 md:grid-cols-2` | ✅ 변화 없음 |
| ClientListPage | `pages/clients/ClientListPage.tsx` | `grid-cols-1 md:grid-cols-2` | ✅ 변화 없음 |
| ReportListPage | `pages/reports/ReportListPage.tsx` | `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` | ✅ 변화 없음 |
| AdminReviewListPage | `pages/admin/AdminReviewListPage.tsx` | `grid-cols-1 md:grid-cols-2` | 필터 row → 모바일에서 세로 스택 |
| CredentialDashboardPage | `pages/credentials/CredentialDashboardPage.tsx` | 직접 확인 필요 | 점검 |

## 작업 내용

### 1. AdminReviewListPage 필터 수직화
현재: `<div className="flex items-center gap-3">` (select + 텍스트)
변경: `<div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">`

### 2. CredentialDashboardPage 점검
- 현재 구조 확인 후 필요 시 `grid-cols-1 md:grid-cols-2` 추가

### 3. 모바일 패딩 조정
- AppShell contentPad 기본값 `px-8 py-6` → 모바일에서 `px-4 py-4`

## 주의
- 기존 카드 컴포넌트(SessionCard 등) 내부 로직 변경 금지
- 모바일에서 카드가 너무 길어지지 않도록 max-w 제한 불필요 (grid가 알아서 조정)
- `cd frontend && npm run build` 검증
