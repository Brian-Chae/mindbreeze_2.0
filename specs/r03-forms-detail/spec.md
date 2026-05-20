# SDD-R03 — 폼·상세 페이지 모바일 대응

> 상위 기획: `.hermes/plans/2026-05-20_responsive-mobile.md`
> 선행 조건: R01 (AppShell 반응형) 완료 후

## 대상 페이지 (9개)

| 페이지 | 파일 | 주요 문제 |
|---|---|---|
| SessionCreatePage | `pages/sessions/SessionCreatePage.tsx` | 폼 필드 가로 overflow |
| SessionDetailPage | `pages/sessions/SessionDetailPage.tsx` | 상세 정보 + 상태 액션 버튼 |
| ClientProfilePage | `pages/clients/ClientProfilePage.tsx` | `md:grid-cols-2` → 모바일 1열 |
| ClientInvitePage | `pages/clients/ClientInvitePage.tsx` | 초대 폼 |
| InviteLandingPage | `pages/clients/InviteLandingPage.tsx` | 랜딩 카드 |
| OrgSearchPage | `pages/org/OrgSearchPage.tsx` | 검색 폼 `sm:flex-row` |
| OrgRegisterPage | `pages/org/OrgRegisterPage.tsx` | 등록 폼 |
| OrgManagementPage | `pages/org/OrgManagementPage.tsx` | 센터 정보 |
| MyRequestsPage | `pages/org/MyRequestsPage.tsx` | 요청 목록 |

## 작업 내용

### 1. 폼 페이지 (SessionCreate, ClientInvite, OrgRegister)
- 모든 input/select/textarea: `w-full` 보장 + `max-w-lg` 정도로 제한
- 폼 그룹: `flex flex-col` (세로 스택 유지)
- 제출 버튼: `w-full sm:w-auto`

### 2. 상세 페이지 (SessionDetail, ClientProfile, OrgManagement)
- `md:grid-cols-2` → `grid-cols-1 md:grid-cols-2`
- dt/dd 쌍: 모바일에서 세로 스택 (dd가 dt 아래로)
- 액션 버튼 그룹: `flex flex-wrap gap-2`

### 3. 검색 페이지 (OrgSearchPage)
- 검색 폼: `flex-col sm:flex-row` → 모바일에서 input+버튼 세로 배치

### 4. InviteLandingPage
- 카드: `max-w-md mx-auto` 중앙 정렬 (이미 그럴 가능성 높음)

### 5. MyRequestsPage
- 목록 아이템: 모바일에서 내용 줄바꿈 허용, 버튼 최소 너비

## 주의
- 기존 폼 로직/상태 관리 변경 금지
- 레이아웃 클래스만 수정
- `w-full` 과다 사용 주의 → `max-w-lg`로 읽기 편한 폭 유지
- `cd frontend && npm run build` 검증
