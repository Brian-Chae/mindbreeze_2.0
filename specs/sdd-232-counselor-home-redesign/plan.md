# SDD-232 Plan — 상담사 홈 화면을 회원 홈처럼 정리

Stage ② (2026-10-22). 입력: `spec.md`(확정 A/A/A), `designs/counselor-home/index.html`. 백엔드·API 변경 없음.

## 설계 요약
- `DashboardPage`는 `AppShell`을 유지한다(셸·알림·드로어·기관탈퇴 안내 보존). 본문만 재배치.
- 순서: 조건부 배너(루시 브리핑·오류·프로필) → 히어로 → 검토 배너 → 타일 4 → 내 클래스 캐러셀 → 하단(좌: 일정·지난 회차·상담사 코드 / 우: 최근 대화·새 알림).
- 폭: ≥1194 하단 2열(우 320px) / 768~1193 하단 1열 + 대화·알림 2열 / ≤767 1열, 타일 2×2.
- 내 클래스 카드는 부모 클래스 1장. 데이터는 `useClasses()`(`GET /classes`) + `adaptHostClass`. 실패는 해당 섹션 재시도(나머지 화면 유지).
- 히어로·타일·일정은 기존 `GET /dashboard/counselor` 행과 `home-stats` 집계를 그대로 사용.

## 태스크 · 파일 담당
| # | 태스크 | 파일 |
|---|---|---|
| T1 | 카드 빈 값 규칙 순수 함수(제목·진행·다음 회차·지도사) | 신규 `lib/class-structure/class-card-copy.ts` |
| T2 | `MemberClassCard`에 T1 적용 + `to` 선택 prop(기본 회원 경로 유지) | `components/class/structure/member-class-views.tsx` |
| T3 | `MemberClassStrip`에 `hrefFor` 선택 prop 추가(기본 동작 동일) | `components/client/home/member-class-strip.tsx` |
| T4 | 홈 모델 순수 함수: 히어로 선택, 클래스 정렬(최대 8), 진행 타일 목적지 | 신규 `lib/dashboard/counselor-home-model.ts` |
| T5 | 히어로·빈 히어로 표현 (`.sh-hero` 재사용) | 신규 `components/dashboard/counselor-home-hero.tsx` |
| T6 | 반응형 스타일(캐러셀·하단 2열·타일) | 신규 `components/dashboard/counselor-home.css` |
| T7 | `DashboardPage` 재배치(기존 기능 유지) | `pages/DashboardPage.tsx` |
| T8 | 테스트 신규·갱신 | `tests/sdd232-*.test.ts(x)`, `tests/dashboard-card-navigation.test.tsx` |

## 재사용
`AppShell`, `StatTile`, `ClickableCard/CardAction`, `NotificationRow`, `StatusBadge`, `OrgRemovedNoticeDialog`, `AiOnly`, `ReadStateView`, `heroBackdrop`, `shell-kit.css`(`.sh-hero`), `MemberClassStyles`, `home-stats`, `dashboardSessionPath`, `useClasses`, `adaptHostClass`.

## 어댑터/결정
- 히어로: 진행 중(in_progress/open) 우선, 없으면 가장 가까운 미래 예정(취소 제외). CTA 대상은 `dashboardSessionPath(row)`(회차 상세). 입장·시작 API 호출 없음.
- 진행 중 타일(Brian 10/22 변경): 기존 `liveTileTarget`/`liveTileHint` 그대로 사용 — 1개면 `/sessions/:id/player`, 2개 이상·0개는 `/classes`. 히어로만 회차 상세 경유.
- 회차 보조 기능(입장 코드 복사, 참여/게스트 수, 기록 보기)은 일정 행·지난 회차에서 유지. 입장은 상세 경유.
- 카드 진행률은 서버 `progress`만 사용(새 합산 없음). 참여자 수는 카드에서 생략.
- 스타일: 새 토큰 없음, 기존 색상 값 사용.

## 위험
- 공통 카드 변경이 회원 화면 영향 → 회원 테스트(member-class-structure, member-home-*, sdd221-member-home-layout) 회귀 실행.
- 기존 `dashboard-card-navigation` 테스트는 회차 카드 기준 → 새 구조에 맞게 갱신(기능 단언은 유지·이동).
