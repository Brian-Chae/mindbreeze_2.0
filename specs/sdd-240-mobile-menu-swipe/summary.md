# SDD-240 — 모바일 메뉴 좌우 스와이프 구현 결과

- 기준: Brian 2026-10-24 A안·3역할·모바일 웹/앱·보호 우선 승인. 구현 전 plan/verify 커밋·push `c6a3b42f`.
- 코드: `05c1dad1` 구현, `8d9e84fe` 메뉴/플래그/방문 화면 스타일 회귀 보완, `7023ff8d` 본문 패딩 터치 보완, `2ba50a9a` 안내 본문 대비 보완.
- 상태: Stage ②~⑥ 완료, PR 리뷰 대기. 머지·develop push·배포·앱 빌드는 실행하지 않았다.

## 동작과 상태 정책

- 회원·상담사·기관관리자의 현재 표시된 4개 하단 메뉴만 SSOT 순서로 이동. 상담 공개/비공개 모두 검사. 더보기·플랫폼관리자·상세·768px 이상·마우스 제외.
- 12px/500ms 방향 잠금, 수평 1.5배, 거리 max(64px,20%) 또는 40px+최근80ms·최소16ms·0.5px/ms 플릭, 양끝22%/최대32px 저항. 완료240ms·복귀160ms. 1:1 transform만 갱신하고 프레임별 React render·레이아웃 속성 애니메이션을 만들지 않는다.
- 드래그/취소 중 기존 화면 DOM·데이터·입력·필터·스크롤을 유지한다. 완료는 기존 탭 클릭과 동일한 루트 URL로 1회 push한다. 전환 후 데이터는 기존 store/API 캐시·화면 재조회 정책, 스크롤은 기존 탭 재진입 정책을 따른다. **탭별 독립 스택·keep-alive·새 스크롤 복원은 추가하지 않았다.**
- 재방문 이웃은 최대4개 계정·역할별 inert DOM/스크롤 시각 사본이다. id·실행 요소·포커스·상호작용을 제거하고 접근성 트리에서 제외한다. 계정 전환/로그아웃 시 즉시 폐기. **첫 방문 이웃은 제목·로딩 안내**이며 드래그 중 실데이터 선조회·숨은 React 화면/소켓을 만들지 않는다. 오래된 시각 사본은 전환 후 실제 라우트의 최신 데이터로 대체된다.
- 입력/IME/선택/키보드, DOM 시트·모달·서랍·미전송 값, useLeaveGuard의 미저장 콜백, 실제 수업 active·녹음/녹화 recording/paused/업로드 중·LiveKit 연결·밴드 collecting·리포트 저장 상태를 차단한다. 도중 보호·cancel·다중터치·resize·blur·계정 전환도 취소한다.
- 가로 레일 조상은 native 가로 스크롤을 위해 touch-action:auto, 나머지 안전 본문 subtree는 pan-y pinch-zoom이다. 빈 패딩의 수평 pan은 **단일 터치·수평 잠금·보호 없음**일 때만 비수동 touchmove에서 preventDefault한다. 세로·레일·핀치는 차단하지 않는다.
- 기존 메뉴 버튼·배지·권한 유지. 처음 한 번 닫을 수 있는 안내, 목적지 제목 포커스, live 이동 안내. 움직임 줄이기에서는 transform/스냅 애니메이션을 생략한다.

## 검증 근거

- 신규 단위: **25개 통과**. 기존 메뉴·상담 게이트 46개를 포함한 focused **71개/5파일 통과**.
- RED: 미구현 모듈, 숨긴 조상 입력 오인, 패딩용 touchmove 기본 동작 차단 누락을 각각 실패로 확인한 뒤 수정했다.
- tsc: `cd frontend && npx tsc --noEmit -p tsconfig.app.json`, 변경 TS/TSX eslint 통과. E2E 스크립트 node --check 통과.
- 웹 번들: 빈 envDir와 로컬 API 주소를 주입한 Vite QA 빌드. 앱 빌드/Capacitor sync 없음. 기존 큰 청크·정적/동적 import 혼용·tokens.css 경로 경고는 유지되며 빌드는 성공했다.
- 전체 Vitest: 작업 브랜치 **2,673개 중 2,658 통과·기존 실패15개**, `origin/develop` (`431fe625`) **2,749개 중 2,732 통과·17실패**. 파일+테스트 이름 비교 **새 실패0개**. 두 브랜치 구성이 달라 develop에만101개, 작업 브랜치 신규25개가 존재한다. 최신 로직 `7023ff8d` 전체 실행 후 CSS1줄 `2ba50a9a`는 Chrome 계산 대비·캡처로 추가 확인했다. 기존 assertion/skip/스냅샷을 수정하지 않았다.
- 유지 실패 파일: agent-counselor-page(2), chat-message-deeplink(2), org-counselor-management-browser(1), org-management-browser(2), report-modal-pdf(2), report-server-pdf(2), sdd234-a-mobile-home(4). 브라우저 서버 연결/기존 계약 실패이며 전체를 green으로 보고하지 않는다. develop의 sdd220-native-release 2실패는 이 작업 브랜치에서는 재현되지 않았다. 상세 실패 이름·오류는 vitest-comparison.json에 보관.
- Chrome 155.0.8059.85 터치: 비공개 **84개**, 공개 **49개**, 별도 패딩 **2개** 확인 통과. JS 실행 오류0, 미등록 fixture API0. 실행 파일 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, hasTouch/isMobile, 390×844. 외부 네트워크·소켓 차단, 모든 API는 합성 fixture.
- 실제 앱 라우트: 3역할×공개/비공개, 좌/우·짧은 복귀·빠른 플릭·120px 추종·방문 이웃·이력1회·제목 포커스/live 안내·첫/마지막·더보기·입력/blur값 보전·클래스 상세·세로 스크롤·실제 홈 레일/끝·24px·취소·움직임 줄이기·360/767/768px·마우스·키보드·44px 버튼·가로 넘침.
- 수업/녹음/통화/측정/미저장/저장 중은 **QA 빌드에만 삽입한 공유 보호 콜백 fixture**로 터치 차단·도중 취소를 확인한다. 표/차트/슬라이더도 실제 라우트 안 합성 조작 영역으로 검사한다. 실제 활동 훅 연결은 독립 diff/단위 검증이며 실수업·마이크·BLE·영상 서버 검증이 아니다.
- 육안 캡처: 회원 패딩 드래그·상담사 클래스·기관 드래그·입력 보호를 직접 확인했다. 발견한 안내 본문 대비 문제는 `color:inherit;margin:0`으로 수정했고 Chrome 계산 대비 **12.65:1**(흰색/#34332f)로 4.5:1 기준을 통과했다. 양 플래그·3역할 home/drag/classes 캡처를 최종 CSS로 갱신했다.
- 독립 검토자: 초기 본문 overflow:auto 오인·숨긴 조상 입력·방문 사본 스타일 침범·제목 포커스 문제를 확인하고 수정 후 scoped 재검토. 최종 신규25개 독립 통과, 추가 결함 없음. 감독은 별도 실제 앱 터치·전체 테스트 비교를 수행했다.

## 디버깅 기록

1. `overflow-y:auto`의 계산 overflow-x:auto를 가로 영역으로 오인 → 실제 가로 overflow/명시적 x-scroll 기준과 본문 page 제외.
2. 숨긴 조상 안 입력/모달 오인 → 조상 스타일·checkVisibility 반영.
3. 상담사 클래스 본문 공백 좌표가 링크 끝7px 근처여서 Chrome touch target이 인접 Link로 보정 → 실제 pointerdown=A를 독립 재현. E2E는 y±10px 주변 hit-test로 조작 요소를 피한다. 제품의 링크 출발 제외를 완화하지 않았다.
4. 방문 사본의 h2/p에 loading 스타일 침범 → loading kind 직접 자식만 적용.
5. 본문 패딩에서 `pointerdown page(auto) → move → pointercancel` 확인 → 제한된 비수동 touchmove 보조. 실제 패딩120px 1:1·세로/레일 회귀를 재검증했다.
6. 전체 테스트가 기존 SDD-234 캡처18개를 덮어쓰는 부수효과 → 초기 clean 확인 후 해당 파일만 HEAD 원본 바이트로 복구. 기존 테스트 산출물을 이번 변경에 포함하지 않는다.

## 캡처와 재현

- `captures/*-home*.png`, `*-drag*.png`, `*-classes*.png`: 3역할, 상담 공개/비공개.
- `captures/client-padding-drag.png`, `client-drawer-protected.png`, `client-input-protected.png`, `client-reduced-motion.png`.
- `captures/debug-failure.png`: 터치 타깃 보정 조사 당시 진단 캡처이며 최종 UI 검증 캡처가 아니다.
- `captures/touch-results.json`, `touch-results-counseling.json`, `touch-results-padding.json`, `vitest-comparison.json`.
- 재현: `cd frontend && node e2e/mobile-menu-swipe.mjs`, `node e2e/mobile-menu-swipe.mjs --counseling`. 로컬 포트5442 사용, 종료 시 자체 서버/브라우저 정리. 이 스크립트의 보호 콜백 주입은 /tmp QA 빌드에만 존재한다.
- node_modules는 원본 저장소 심링크를 잠시 사용했으며 최종 작업에서 그 심링크만 해제한다. 패키지 설치/lock 변경 없음.

## 실기기 확인 절차와 남은 한계

1. 다음 승인된 iOS/Android 앱 빌드에 이 JS 번들을 포함한다. 현재 설치 앱에는 웹 배포만으로 반영되지 않는다. 이번에는 네이티브 변경·앱 빌드·배포를 하지 않았다.
2. iPhone WKWebView/Safari, Android WebView/Chrome에서 3역할로 본문·빈 패딩 좌/우·짧게 복귀·빠른 플릭·세로·레일 중간/끝을 확인한다.
3. 키보드/한글 IME·미전송/미저장·저장 중·시트/모달·실제 수업 대기/진행·녹음·통화·측정 상태에서 우발 이동 0 확인. OS 가장자리 back은 기존 동작을 유지하는지 별도 확인한다.
4. iOS 좌우 가장자리 및 Android 제스처/3버튼, VoiceOver/TalkBack, OS 움직임 줄이기를 확인한다. 에뮬레이션의 접근성 DOM/키보드 검사를 실제 스크린리더 증거로 해석하지 않는다.

## 변경 파일

- `frontend/src/components/client/BottomTabBar.tsx`
- `frontend/src/components/client/ClientShell.tsx`
- `frontend/src/components/layout/AppShell.tsx`
- `frontend/src/components/layout/BottomTabBar.tsx`
- `frontend/src/components/layout/mobile-menu-swipe.css`
- `frontend/src/hooks/use-mobile-menu-swipe.ts`
- `frontend/src/hooks/use-mobile-swipe-protection.ts`
- `frontend/src/hooks/useAudioRecorder.ts`
- `frontend/src/hooks/useBackgroundSession.ts`
- `frontend/src/hooks/useBand.ts`
- `frontend/src/hooks/useLeaveGuard.ts`
- `frontend/src/hooks/useLiveKit.ts`
- `frontend/src/hooks/useMemberLiveKit.ts`
- `frontend/src/hooks/useVideoRecorder.ts`
- `frontend/src/lib/mobile-menu-swipe-preview.ts`
- `frontend/src/lib/mobile-menu-swipe-protection.ts`
- `frontend/src/lib/mobile-menu-swipe.ts`
- `frontend/src/pages/client/ClientReportListPage.tsx`
- `frontend/src/pages/reports/ReportListPage.tsx`
- `frontend/tests/mobile-menu-swipe-hook.test.tsx`
- `frontend/tests/mobile-menu-swipe-preview.test.ts`
- `frontend/tests/mobile-menu-swipe.test.ts`
- `frontend/e2e/mobile-menu-swipe.mjs`

추가 문서: 본 summary와 같은 디렉토리의 spec·plan·verify 및 captures 검증 산출물.
