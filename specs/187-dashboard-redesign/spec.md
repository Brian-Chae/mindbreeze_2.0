# [SDD-187] 회원·상담사 대시보드 행동 중심 재설계

## Goal
정보 나열형인 회원(내담자) 홈과 상담사 대시보드를 "지금 해야 할 일 → 곧 할 일 → 둘러보기" 3단 위계의 행동 중심 화면으로 재설계한다. 디자인 목업(`designs/dashboard-redesign/`)은 Brian 승인 완료.

## Context
- 현재 두 화면 모두 "행동"이 아닌 "정보 나열"로 시작: 회원은 캘린더·피드가 최상단, 상담사는 통계·코드 배너가 최상단.
- 실제 사용 목적(다음 세션 입장 · 리포트 확인 · 오늘 할 일)이 스크롤 하단·테이블에 묻혀 있음.
- Phase 2 디자인(기획 + HTML 목업 + 3루프 반복)으로 방향 확정, Brian "개발 진행" 승인.

## Scope
### ✅ In-scope
- `frontend/src/pages/client/ClientHomePage.tsx` 전면 재작성 (회원 홈)
- `frontend/src/pages/DashboardPage.tsx` 전면 재작성 (상담사 대시보드)
- 반응형 4단 브레이크포인트(480/768/1024/1280) — Tailwind 클래스로 구현
- 브랜드 토큰 준수: 퍼플 `#5F0080`, 크림 `#F7F4F0`, 민트 `#01f0c8`(진행중 전용), Pretendard

### ❌ Out-of-scope
- 신규 백엔드 API (기존 `getCounselorDashboard`/`listSessions`/`listReports` 응답으로 파생 계산)
- 캘린더 월뷰 (회원 홈에서 제거 → "달력 보기" 링크로 기존 경로 이동)
- SessionListPage 등 타 화면

## Acceptance Criteria
- [ ] 회원 홈 최상단에 "다음 세션" 퍼플 히어로(입장 CTA·참여코드·카운트다운) 노출
- [ ] 상담사 최상단에 "지금 할 일"(진행중 입장 + 승인 대기) 노출
- [ ] 회원 리포트에서 `type=client`만 표시 (상담사용 노출 버그 제거)
- [ ] 모바일(390px)에서 컴포넌트 간 간격 24~32px, 히어로 제목 한 줄
- [ ] 480~767px 중간 크기에서 콘텐츠 max-width 560px 중앙 정렬
- [ ] 기존 기능 보존: 초대 수락, 리포트 생성중 배지, 상담사 코드 복사
- [ ] `npm run build` 0 errors

## Dependencies
- `frontend/src/lib/api/session.ts` (SessionDto), `reports.ts` (ReportDto), `dashboard.ts` (ClassSummary), `notifications.ts`, `chat.ts`
- 공용 컴포넌트: `AppShell`, `StatusBadge`, `SessionCard`, `InvitedSessionCard`, `MonthCalendar`
- 디자인 목업: `designs/dashboard-redesign/mockups/dashboard-mockup.html`

## Risks
- 기존 기능(초대·캘린더·리포트 상태) 회귀 → verify.md에 보존 시나리오 명시
- Tailwind 임의값(`bg-[#5F0080]`) 미생성 → 빌드 후 실제 클래스 생성 확인
- 두 화면 동시 재작성 규모 → 회원 → 상담사 순차 구현, 각 단계 빌드 검증
