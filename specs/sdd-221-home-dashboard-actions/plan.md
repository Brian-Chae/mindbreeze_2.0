# SDD-221 Plan — 홈 화면 통계와 이동 동작 보완

- 상태: Stage ② Plan
- 선행: spec.md

## 1. 설계

### 1.1 수치 계산을 순수 함수로 분리
신규 `frontend/src/lib/dashboard/home-stats.ts` (순수 함수, DOM·시계 주입)
- `liveClasses(rows)`: `in_progress` + `open`
- `pendingReviewTotal(rows)`: `pending_review_count` 합 (상담 제외된 rows 입력)
- `todayRemaining(rows, now)`: 로컬 날짜가 오늘이고 `cancelled`·`completed` 가 아닌 회차
- `DashboardPage` 는 이 함수 결과를 타일에 쓴다. 서버 필드(`in_progress_classes` 등)는 타일에서 쓰지 않는다.

### 1.2 컴포넌트 분리 (220 충돌 최소화)
신규 `frontend/src/components/dashboard/`
- `stat-tile.tsx`: 링크형 타일. props `{ label, value, to, hint, tone }`. 전체가 `<Link>`, `aria-label` 로 "라벨 값, 이동 문구" 제공.
- `clickable-card.tsx`: 카드 전체 링크. 카드 루트에 `<Link>` 오버레이(`absolute inset-0`) + 내부 버튼은 `relative z-10` 로 위에 둔다(내부 버튼 클릭이 카드 이동으로 번지지 않음, 중첩 `<a>` 금지).
- `notification-row.tsx`: 알림 행. `button` 역할, 클릭 시 `markRead` → `resolveNotificationTarget` → `navigate`. 대상 없으면 읽음 처리만.
- 이동 경로 계산은 `lib/dashboard/home-links.ts` 의 순수 함수(`liveTileTarget(rows)`, `todayTileTarget()` 등)로 분리해 단위 테스트한다.

### 1.3 서버
- 원인 ④(팀 강사 회차 누락) 확인 전에는 변경 없음.
- 확인 방법: `dashboard_service.counselor_dashboard` 가 `Session.host_id == uid` 만 보는지 코드로 확정(확정됨) → 팀 강사(`ClassInstructor`)로만 속한 회차를 가진 계정으로 dev 비교. 누락이 실제 업무상 오류로 판정되면 `ClassInstructor.user_id == uid` 인 클래스의 회차를 합집합으로 포함하는 쿼리 변경 + 중복 제거 테스트.

## 2. Task

| T | 내용 | 파일 | 담당 |
|---|---|---|---|
| T1 | `home-stats.ts`, `home-links.ts` + 단위 테스트(경계: 자정, 취소·완료, open, 상담 제외) | lib/dashboard/* | 워커 A |
| T2 | `stat-tile`, `clickable-card`, `notification-row` + 컴포넌트 테스트 | components/dashboard/* | 워커 A |
| T3 | `DashboardPage` 호출부 교체(타일·일정 행·ClassCard·알림), 문구 `입장하기`→상황별 | pages/DashboardPage.tsx | 워커 B (T1·T2 후) |
| T4 | `OrgDashboardPage` 동일 증상 점검, 필요 시 같은 컴포넌트 적용 | pages/OrgDashboardPage.tsx | 워커 B |
| T5 | 팀 강사 회차 누락 재현(백엔드 테스트로 재현 + dev 실데이터 비교) → 필요 시 서버 수정 | backend/app/services/dashboard_service.py, tests | 워커 C(병렬) |
| T7a | 회원 홈 데스크톱 시안 HTML 3안 이내(1440px 기준) + 4뷰포트 측정 → Brian 승인 | designs/member-home-desktop/ | 워커 D(Codex 시안), 승인 게이트 |
| T7b | 시안 승인 후 구현: `ClientHomePage`·`member-structure-home-page`·`member-class-views` 스타일 통일, `내 클래스` 가로 스크롤 줄(스냅·키보드), 타일 격자 | pages/client/*, components/class/structure/member-class-views.tsx | 워커 E |
| T6 | dev 배포 후 실화면 검증, `summary.md` | specs | 지휘 |

병렬: A ∥ C ∥ D(시안). B 는 A 완료 후, E 는 시안 승인 후. 회원 홈 파일은 상담사 홈 파일과 겹치지 않는다.

## 3. 위험·롤백
- 카드 전체 링크로 내부 버튼 클릭이 막히거나 번지는 회귀 → 오버레이 구조 + 이벤트 테스트로 방지.
- 220 과 `DashboardPage.tsx` 충돌 → 호출부 최소 수정, 먼저 병합된 쪽 기준 rebase.
- 서버 변경은 조건부(T5)이며 마이그레이션 없음. 롤백은 PR revert.

## 4. 테스트 전략
- vitest: 순수 함수 경계값, 컴포넌트 클릭·키보드, 내부 버튼 격리, 알림 이동 경로.
- 백엔드: T5 수행 시 pytest 재현 테스트.
- `tsc -b`, `eslint src/`, 빌드 후 신규 Tailwind 클래스 생성 확인.
- dev 실측: 수치-목록 일치, 클릭 이동.
