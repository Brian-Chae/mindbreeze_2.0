# SDD-233 — 홈 상태 카드 위치 정리와 플로팅 하단 메뉴

## 결과
- 확정 B+라벨: #201427 바, #563365 활성 타원, 활성 채움 아이콘, 빨간 숫자 배지, aria-label/current·포커스. 모바일 <768px만 표시.
- 회원 비공개: 홈/내 클래스/대화/리포트/더보기. 공개: 홈/내 클래스/상담/리포트/더보기.
- 상담사·기관 비공개: 홈/클래스/리포트/대화/더보기. 공개: 홈/클래스/상담/대화/더보기.
- 플랫폼: 홈/가입 신청/사용자/대화/더보기. Drawer 대화·알림·설정 보강. 기존 메뉴·우상단 종 유지.
- 직접 탭과 더보기 배지 중복 및 알림 합산 제외. 상담·AI 공개 조건 유지.
- 회원 집계/콜백은 ClientHomePage에 유지, 클래스 섹션 슬롯을 카드 바로 다음에 출력. 로딩/오류에서도 클래스 영역 유지. 상담사 배치·링크 불변.
- HOME_CLASS_LIMIT=4를 두 홈에서 공유. 회원 정렬 함수가 없어 기존 순서로 자름. 상담사 기존 정렬 유지. 4초과 전체 보기(N)는 전체 총수. 전체 목록/API 제한 없음.
- 두 셸과 structure 실제 스크롤 소유자에100px+safe-area 예약. hideBottomTab/noBottomPad/noScroll 계약 유지.

## 변경 파일
제품 경로는 frontend/src/ 기준:
- 메뉴: components/client/BottomTabBar.tsx, components/layout/{BottomTabBar,SidebarNav,floating-bottom-nav}.tsx, floating-bottom-nav.css.
- 셸: components/client/ClientShell.tsx, components/layout/AppShell.tsx, components/class/structure/structure-shell.css.
- 홈: pages/client/{ClientHomePage,member-structure-home-page}.tsx, components/client/home/member-home-layout.css, lib/dashboard/counselor-home-model.ts.
- 관련 회귀 테스트8파일, spec/plan/verify/summary, capture.cjs와 screens/. 백엔드 변경0.

## 검증
- 구현 전 문서 fba1a844, 추가 요구 문서56286410. RED: 역할5건, 카드 DOM인접1건, 홈4개제한2건.
- `cd frontend && npx vitest run tests/sdd233-floating-nav.test.tsx tests/member-home-legacy-sections.test.tsx tests/sdd221-member-home-layout.test.tsx tests/sdd232-counselor-home.test.tsx tests/nav-labels-characterization.test.tsx tests/nav-badge-by-key.test.tsx tests/sdd219-counseling-closed.test.tsx tests/sdd220-ai-features.test.tsx tests/class-structure-navigation.test.ts tests/sdd219-report-tab.test.tsx tests/sdd221-home-components.test.tsx tests/sdd221-home-stats.test.ts tests/sdd232-class-card-copy.test.ts` →13파일268/268.
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json` →통과.
- 변경 제품TS/TSX9개+테스트8개 `npx eslint <변경 파일>` →통과. CI react-hooks/exhaustive-deps 활성. 미사용 테스트 helper 정리 후 재실행 통과.
- `cd frontend && npm run build` →통과. 기존 tokens.css import·큰 chunk·dynamic import 경고. origin/develop 동일 import 경로 확인, 범위 밖 제품 파일 변경 없음.
- `git diff --check` →통과. 독립 검증자8파일206건 재실행·tsc·diff·실제 번들 CSS 재확인, 차단 문제 없음.
- `node specs/sdd-233-home-stats-floating-nav/capture.cjs` →Chrome headless, 실제 React+합성API. 회원·상담사390/430/1440 총6화면, PNG18개. JS오류0/가로넘침0. 두홈6개→4카드·전체 보기(6) DOM assertion.
- 모바일 바66px/좌우16px/아래12px. 끝까지 스크롤한 마지막 요소와 바 간격 회원37.6px/상담사21.7px. safe-area34 모의에서도 동일. 1440 바숨김·카드4열. screens/results.json 원자료.
- 캡처는 빈 임시 envDir로 .env 로드 차단, 모든 API mock·외부 요청 차단. 개발 CSS import 문제는 캡처용 resolve.alias로 repo/design-system 연결. 제품 코드 변경 없음. 초기 HMR WebSocket 차단 오류는 Socket.IO만 차단하도록 좁혀 해결, 최종 JS오류0.
- 로컬 관련 테스트 실패 없음(의도한 구조/라벨/배지 기대 갱신 후 관련 전체 통과). 로컬 전체 프런트 스위트 미실행. 실iOS·실API·EEG·LiveKit, 별도 관리자 브라우저 캡처 미실행.
- 원본 node_modules 심링크만 사용 후 제거, 커밋 제외.

## dev 확인 시나리오
1. 회원·상담사 클래스5개 이상 홈: 4개/총수/전체목록 연결, 회원 카드4개→내 클래스 및 기존 링크 확인.
2. 회원·상담사·기관·플랫폼, 상담 공개/비공개에서5탭·배지·활성·더보기/햄버거·우상단 종을 실제API로 확인.
3. iOS390/430 회전·툴바·키보드·홈 인디케이터에서 마지막CTA 가림없음과 클래스진행/대화방 바숨김 확인. 데스크톱1440 사이드바 유지.

결정 필요 사항 없음. PR머지·develop push·배포는 수행하지 않으며 DEPLOY 창구 담당.

## PR CI 결과
- PR #50: https://github.com/Brian-Chae/mindbreeze_2.0/pull/50
- 구현 커밋85fb028b CI: https://github.com/Brian-Chae/mindbreeze_2.0/actions/runs/39767343702 — 성공. Type Check/Lint/Build 통과, 백엔드 변경 없어 skip.
- 전체 테스트 로그는218파일 중212통과/6실패, 2541건 중2530통과/11실패. workflow의 테스트는 비차단이므로 CI 성공과 전체 테스트 통과를 구분한다.
- 직전 SDD-232 PR CI https://github.com/Brian-Chae/mindbreeze_2.0/actions/runs/39763466182 와 실패 테스트 이름11개가 정확히 일치함을 대조했다(기준2515통과/11실패). 이번 추가 테스트15개는 통과.
- 기존 실패6파일: agent-counselor-page.test.tsx(2), chat-message-deeplink.test.ts(2), org-counselor-management-browser.test.cjs(1), org-management-browser.test.cjs(2), report-modal-pdf.test.cjs(2), report-server-pdf.test.cjs(2). 입력 요소 기대 불일치와 로컬5175 미실행/브라우저 timeout. 범위 밖 수정하지 않음.
