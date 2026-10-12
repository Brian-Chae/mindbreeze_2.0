# [SDD-187] — Implementation Plan

**Goal:** 회원·상담사 대시보드를 행동 중심 3단 위계로 재설계 (목업 `designs/dashboard-redesign/mockups/dashboard-mockup.html` 이식)

**Architecture:** 기존 페이지 파일을 전면 재작성. 신규 컴포넌트는 페이지 파일 내 지역 함수로 두고, 기존 공용 컴포넌트(AppShell/StatusBadge/InvitedSessionCard)는 재사용.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS 3

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Rewrite | `frontend/src/pages/client/ClientHomePage.tsx` | 회원 홈 행동 중심 재설계 |
| Rewrite | `frontend/src/pages/DashboardPage.tsx` | 상담사 대시보드 행동 중심 재설계 |

## 회원 홈 구조 (위→아래)
1. **다음 세션 히어로**(퍼플) — 진행중/오픈/ready 즉시 세션 최우선, 없으면 가장 임박한 예약. 제목·날짜·상담사·참여코드(복사)·카운트다운·입장하기 CTA
2. **초대된 클래스**(조건부) — 기존 `sessionInvites` 로직 보존
3. **내 리포트** — `type=client`만, NEW/생성중 배지
4. **이번 주 일정** — 이번 주 예약 세션 리스트(3~5건), "달력 보기" 링크
5. **요약 타일 2×2** — 다음 세션까지 D-N / 새 리포트 / 이번 주 세션 / 연속 출석
6. **담당 상담사** — `user.counselors[0]` 아바타·이름·전문분야
7. **최근 대화 + 새 알림** — 채팅/알림 API 미리보기

## 상담사 대시보드 구조 (위→아래)
1. **지금 할 일(Action Queue)** — 진행중/오픈 클래스 카드(입장 CTA·코드 복사) + 승인 대기 리포트 배너(리포트 검토)
2. **오늘·다가오는 일정** — `scheduled_at` 시간순 타임라인, 30분 임박 강조
3. **요약 타일** — 진행중 / 승인 대기 / 오늘 예정 / 총 참여자
4. **내 클래스** — 그룹 헤더(진행중·오픈 / 예정 / 지난 세션) + 카드(제목·유형·상태·참여자·액션)
5. **최근 대화 + 새 알림**
6. **상담사 코드 접이식**

## Tasks

### Task 1: 회원 홈 재작성
**Objective:** `ClientHomePage.tsx`를 히어로·리포트·일정·타일·상담사·대화/알림 구조로 재작성. 기존 초대·리포트 상태 로직 보존.
**Files:** `frontend/src/pages/client/ClientHomePage.tsx`
**Estimate:** 40min

### Task 2: 상담사 대시보드 재작성
**Objective:** `DashboardPage.tsx`를 액션큐·일정·타일·클래스·대화/알림·코드접이식 구조로 재작성.
**Files:** `frontend/src/pages/DashboardPage.tsx`
**Estimate:** 40min

### Task 3: 빌드·타입 검증
**Objective:** `npm run build` 0 error + Tailwind 클래스 생성 확인 + 반응형 스크린샷 검증
**Files:** —
**Estimate:** 15min

## Testing Strategy
- `cd frontend && npm run build` — 프로덕션 빌드
- `npx tsc -b --noEmit` — 타입 체크
- Chrome headless 스크린샷(390/640/1280)으로 반응형 검증
