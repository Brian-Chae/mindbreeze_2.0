# SDD-232 Summary — 상담사 홈 화면을 회원 홈처럼 정리

Stage ⑥ (2026-10-22). 결정: 배치 A / 빈 값 공통 적용 A / 히어로 [회차 상세 보기] A (Brian 10/22 확정).

## 구현
- 상담사 홈 순서: 사진 히어로 → 검토 배너(>0) → 타일 4(데스크톱·태블릿 4열, 모바일 2×2) → 내 클래스 캐러셀 → 하단(좌: 일정·지난 회차·상담사 코드 / 우: 최근 대화·새 알림). ≥1194 하단 2열(우 320px), 768~1193 하단 1열+대화·알림 2열, ≤767 1열.
- 히어로: 진행 중 우선, 없으면 가장 가까운 예정. 버튼은 링크만(회차 상세). 일정 없으면 [지금 바로 시작]. 홈에서 열기·시작 API 호출 없음.
- 내 클래스: 부모 클래스 1장=1카드(`GET /classes`, 최대 8장 + 전체 보기). 조회 실패는 해당 섹션만 오류+재시도.
- 기존 기능 유지: 헤더 [클래스 목록]·[지금 바로 시작]·[새 클래스], 검토 대기, 일정(입장 코드 복사·참여/게스트 수·기록 보기), 대화, 알림, 상담사 코드, 루시 브리핑(AiOnly), 오류·프로필·기관탈퇴 안내, 상담 비공개 필터.
- 공통 카드 빈 값(회원·상담사): '이름 없는 클래스', '모든 회차를 마쳤어요', '열린 회차가 있어요', '다음 일정이 아직 없어요', '다음 일정 확인 중', 0/0 진행 막대 생략, 지도사 없으면 줄 생략. 전역 `ReadField` 불변.
- 진행 중 타일: 1개면 회차 상세, 복수면 `/classes` (player 직행 제거).

## 변경 파일
- 신규: `lib/class-structure/class-card-copy.ts`, `lib/dashboard/counselor-home-model.ts`, `components/dashboard/counselor-home-hero.tsx`, `components/dashboard/counselor-home.css`, tests `sdd232-*.test.ts(x)`
- 수정: `pages/DashboardPage.tsx`, `components/class/structure/member-class-views.tsx`(카드 빈 값·`href` 선택 prop), `components/client/home/member-class-strip.tsx`(`hrefFor` 선택 prop), `tests/dashboard-card-navigation.test.tsx`
- backend 변경 0.

## 의도된 동작 변경
- 회차 카드(2열)가 사라지고 클래스 카드로 대체. 회차 단위 코드·기록은 일정/지난 회차 행으로 이동.
- 진행 중 회차 직접 [입장] 버튼 제거 → 회차 상세 경유(결정 3).
- 총 참여자 타일 값에 '명' 단위 표시, 타일 라벨에 '회차/리포트' 단위 명시.

## 검증 결과
verify.md 항목 기준 — 단위/통합 테스트와 Chrome headless(API mock) 확인. 상세 수치는 최종 보고 참조. 스크린샷: `screens/` (normal/long/empty × 390·834·1194·1440).

## 기존 실패(변경 전에도 동일)
agent-counselor-page(2), chat-message-deeplink(2), org-counselor-management-browser(1), org-management-browser(2), report-modal-pdf(2), report-server-pdf(2) = 11건. 이번 변경과 무관(stash 후 동일 재현).

## 한계
실제 dev 서버·실계정·실제 API 응답은 확인하지 않았다(mock). 진행 중·팀 지도사 권한 흐름은 상세 화면 기존 로직에 의존.
