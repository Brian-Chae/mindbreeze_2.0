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

## 2026-10-22 — 실제 앱 셸 카드 표현 회귀 수정

### 원인 확정
- `DashboardPage.tsx`는 `AppShell` 기본 variant를 직접 렌더한다. `.cs-structure`는 `StructureShell`이 생성하는 조상이며 상담사 `/dashboard`에는 없다. 회원 `/app`은 `StructureShell → ClientShell` 안이다.
- 이전 `counselor-home.css:2`의 `.cs-structure .ch-home`이 매칭되지 않아 `--ch-radius`, `--ch-line`, display/gap/max-width가 빠졌다. `MemberClassStyles`의 `.cs-structure .mc-*`도 상담사 카드에 적용되지 않았다.
- 실제 라우트 Chrome RED: 상담사 hero/tile/classCard radius0, hero→review gap0. 회원 대비 클래스 border·chip·progress까지 누락됐다. 기존 mock이 실제 셸의 선택자 전제까지 검사하지 못한 회귀다.

### 수정과 보존 범위
- `home-card-parity.css`에서 두 홈의 radius20/section24/border/shadow 및 hero/chip/CTA, 상태4개, 클래스, 패널 규격을 공유한다. 상담사 선택자는 `.cs-structure`에 의존하지 않는다.
- 회원 모바일에도 요청한 공통 규격을 적용: hero min240/padding24, 상태152/padding18, 클래스304/padding24. 하단 패널은 공통 최소높이200/padding24이며 내용이 많으면 자연스럽게 늘어난다. 실제 내용 높이를 고정하거나 잘라내지 않는다.
- 히어로 CTA는 양쪽48px·전체 폭, 타이틀24px. 검토배너 radius20/border/shadow, 모바일 버튼44px·내용 폭. 헤더3개는 390px에서 왼쪽 한 줄로 정렬한다.
- AppShell 여백과 홈 여백이 중복되지 않게 하며 콘텐츠 최대폭1200을 공유한다. 기존 >=1600 보조열352 보존, 768~1023 상담사 본문 패딩24로 회원과 일치.
- TSX는 CSS import와 헤더 식별 className만 변경. 문구·링크·순서·데이터·상태카드 위치·클래스4개 제한·플로팅 메뉴 기능은 유지.

### 실제 셸 브라우저 검증
- `node specs/sdd-233-home-stats-floating-nav/parity.cjs` 및 `--built` 실행. Chrome headless, API 합성 데이터만 응답하고 외부 네트워크 차단. Vite envDir는 빈 임시 디렉터리로 지정해 저장소 .env를 읽지 않는다.
- 최종 PNG/JSON은 npm build 산출물을 preview한 `--built` 결과. 실제 `/app`·`/dashboard`를 로드하며 셸을 mock하거나 `.cs-structure`를 주입하지 않는다.
- 상담사 structureAncestor=false, 회원=true. 390/1440 각각 상태4개·클래스4개 전부 및 회원4/상담사3개 패널의 규격 검사. panel 최소높이/스타일은 전체 비교, 내용에 따른 높이 차이는 허용한다(현재 fixture에서는 모든 패널200).
- `getComputedStyle` 측정: 아래 각 셀의 회원/상담사 차이0. 높이는 현재 합성 데이터 기준이며 hero min-height240, 패널 min-height200을 별도 검사한다.

| 항목 | 390 회원 / 상담사 | 1440 회원 / 상담사 |
|---|---|---|
| 히어로 폭 | 358 / 358 | 1120 / 1120 |
| 히어로 높이 | 263.188 / 263.188 | 263.188 / 263.188 |
| hero/tile/class/panel radius | 20 / 20 | 20 / 20 |
| hero/tile/class/panel padding | 24·18·24·24 / 동일 | 24·18·24·24 / 동일 |
| tile/class/panel 높이 | 152·304·200 / 동일 | 152·304·200 / 동일 |
| section gap / hero→review | 24 / 24 | 24 / 24 |
| 상태카드 간격 | 12 / 12 | 16 / 16 |

- tile/panel border1px #e8e3ec, class border1px #e8e2ed, shadow `0 2px 8px #35213f06` 양쪽 동일. chip/CTA radius·height·padding·border·shadow도 비교 통과.
- JS오류0, 페이지 가로 넘침0, 클래스4개 유지. `screens/parity-390.png`, `parity-1440.png`는 실제 화면 두 개를 나란히 배치. `parity-{폭}-{member|counselor}{|-classes|-panels}.png`는 홈 상단/클래스/패널 캡처. `screens/parity.json`은 전체 측정값.
- 독립 검증자 발견 사항(데스크톱 여백80px 중복, >=1600 열 덮어쓰기, 첫 카드만 측정)을 모두 수정 후 재리뷰에서 차단 이슈 없음 확인.

### 테스트·잔여 한계
- 관련 vitest: 10파일70건 통과(홈 component/layout/stats, 회원 overview/legacy, 상담사 홈, 카드·세션 navigation, class-flow-shell-home, floating-nav).
- `tsc -p tsconfig.app.json --noEmit`, 변경 TSX eslint, `node --check parity.cjs`, `git diff --check` 통과.
- `npm run build -- --config /tmp/sdd233-check-config.mts` 통과. 임시 config는 기존 vite config를 재사용하되 빈 envDir와 기존 캡처와 같은 design-system alias만 지정. 기존 dynamic import/큰 chunk 경고는 남음.
- 전체 vitest: 변경 후와 HEAD 제품 파일로 돌린 기준선 모두 **209통과/12실패 파일, 2513통과/4실패 테스트**로 동일. 이번 변경의 신규 실패 없음.
  - 실제 실패4: `agent-counselor-page.test.tsx`의 브리핑 CTA/입력창2건, `chat-message-deeplink.test.ts`의 missing/failure2건.
  - 별도 실행용 파일 수집 오류10: `e2e/class-fixture.test.mjs`, `e2e/class-structure/{read,visual}.spec.ts`, `tests/{login-role,narrative-sections,org-counselor-management-browser,org-management-api,org-management-browser,report-modal-pdf,report-server-pdf}.test.cjs`.
- 실제 iPhone/Safari·실 API·긴 실제 콘텐츠 검증은 하지 않았다. 빌드된 실제 앱 셸+mock Chrome 증거와 구분한다. 서버/DB/.env 접근·메일·머지·develop 푸시·배포 없음.
