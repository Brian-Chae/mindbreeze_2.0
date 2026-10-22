# SDD-233 구현 계획

> 실행: superpowers:subagent-driven-development. 구현자와 검증자 분리, 같은 워크트리에서 순차 실행.

목표: 확정 B+라벨 모바일 메뉴와 회원 상태 카드 위치를 적용한다.
구조: 두 BottomTabBar는 공통 표현을 재사용한다. 회원 홈 집계는 ClientHomePage에 유지하고 ReactNode 슬롯으로 클래스 앞에 카드를 출력한다. 조회·계산 복제 없음.
기술: React/TypeScript/CSS, vitest, Playwright Chrome.
스펙: spec.md §9 및 designs/home-stats-floating-nav/index.html, nav-B-labels-*.

## 제약
- 기존 md:hidden(<768), safe-area, hideBottomTab/noBottomPad/noScroll 보존.
- 좌우16px, 아래12px+safe-area, 높이66px, 콘텐츠100px+safe-area.
- 제품 백엔드·API·권한·계산·링크 변경 금지. 상담사 홈 배치 유지.

## 담당 파일
- 구현 워커: frontend/src/components/{client,layout}/BottomTabBar.tsx, 공통 floating nav 표현/CSS, ClientShell.tsx, AppShell.tsx, SidebarNav.tsx, pages/client/{ClientHomePage,member-structure-home-page}.tsx, member-home-layout.css 및 관련 테스트.
- 감독: specs/sdd-233-home-stats-floating-nav 문서, 캡처 스크립트·screens. 최종 diff·검증·커밋·PR.
- 독립 검증자: 읽기 전용 리뷰. 구현자 종료 후 순차 실행.

## 검토 초점
- 역할/상담 플래그별 정확히 5개와 권한 있는 경로.
- 하위 경로 활성 중복, 쿼리 필터, 배지 중복.
- 숨김 화면 여백, 실제 스크롤 소유자 마지막 요소.
- 로딩/부분 실패 카드 데이터 및 원래 링크.
- 데스크톱 상담 공개 시 grid 충돌.

## Task 1 메뉴·셸
- [ ] 역할별 5탭, 활성·배지·Drawer 접근·숨김 테스트를 먼저 추가/갱신하고 RED 확인.
- [ ] 공통 pill 표현(aria-label/current, 포커스, 채워진 활성 아이콘) 구현.
- [ ] 직접 탭 배지를 더보기에서 제외, 알림 합산 제외, 기존 초대 의미 보존.
- [ ] 모든 셸 실제 스크롤 소유자 하단 예약 및 플랫폼 Drawer 접근 보강.
- [ ] 관련 vitest GREEN, diff 검토.

## Task 2 회원 카드
- [ ] 카드→내 클래스 DOM 인접 및 값/링크 보존 회귀 테스트 RED.
- [ ] ClientHomePage에 클래스/상담 슬롯을 전달해 기존 summaryTiles 다음에 렌더. 기존 fallback 유지.
- [ ] 데스크톱 grid 배치 충돌 제거, 상담사 원본 불변 확인.
- [ ] 관련 홈/셸 회귀 GREEN.

## Task 3 검증·인계
- [ ] 관련 vitest, tsc, 변경 파일 eslint(CI react-hooks), build.
- [ ] API mock Chrome 회원·상담사 390/430/1440 캡처 및 nav 확대, 실제 가림/색상/탭 검사.
- [ ] 독립 검증자가 diff·테스트 재확인. 문제 수정 후 재검증.
- [ ] summary 작성, 임시 심링크 제거, feat(sdd-233) 커밋, 브랜치 push, PR 생성·CI 확인. 머지·배포 금지.
