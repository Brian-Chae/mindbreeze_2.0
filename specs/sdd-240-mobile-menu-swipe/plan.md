# SDD-240 — 모바일 메뉴 좌우 스와이프 구현 계획

> 작업자: superpowers:subagent-driven-development와 TDD를 적용한다. Brian은 2026-10-24 Stage ②~⑥ 연속 실행을 승인했다.

**목표:** 767px 이하 터치 본문에서 현재 보이는 이웃 하단 메뉴로 1:1 추종·스냅 이동한다.
**설계:** 하단 메뉴 정의를 공유하고 AppShell/ClientShell 본문에 제스처 훅을 연결한다. 드래그 프레임은 React state 대신 ref와 transform으로 처리하며 완료 후 기존 navigate를 한 번 호출한다.
**기술:** React·TypeScript·Pointer Events·Web Animations·Vitest·Playwright Chrome.
**기준:** spec.md §4~7, designs/mobile-menu-swipe/index.html, DESIGN.md.

## 제약과 파일 책임

- frontend만 구현. backend·ios/android·서버·DB·.env·앱 빌드·배포 변경 없음.
- `frontend/src/lib/mobile-menu-swipe.ts`: 역할/플래그별 탭 순서 SSOT, 거리/속도/방향/루트 판정 순수 함수.
- `frontend/src/hooks/use-mobile-menu-swipe.ts`: 본문 ref 연결, 터치 수명주기·transform·미리보기·접근성 안내·보호 재평가.
- `frontend/src/lib/mobile-menu-swipe-protection.ts`: 입력/선택/오버레이/가로 영역 판정 및 작업 보호 등록. 필요하면 전용 store로 분리.
- `frontend/src/components/layout/mobile-menu-swipe.css`: 모바일만 touch-action, 전환 레이어, 가로 콘텐츠 예외.
- `frontend/src/components/layout/AppShell.tsx`, `components/client/ClientShell.tsx`: 본문만 ref 연결, drawer/hideBottomTab 전달.
- `frontend/src/components/layout/BottomTabBar.tsx`, `components/client/BottomTabBar.tsx`: 같은 탭 정의의 순서/경로를 사용, 배지·아이콘 유지.
- `frontend/src/hooks/useLeaveGuard.ts` 및 활동 훅: 기존 가드 콜백을 보호 판정에 등록. 클래스 플레이어/녹음·측정·통화의 실제 수명주기에서 필요한 보호 등록(실제 소스 확인 후 최소 연결).
- `frontend/tests/mobile-menu-swipe*.test.*`: 순수 판정·DOM 보호·수명주기 단위 테스트.
- `frontend/e2e/mobile-menu-swipe.mjs`: 실제 앱 라우트+로컬 fixture API, CDP 터치, 캡처/JSON.

## 역할별 순서

- 회원 비공개: /app → /app/classes → /app/chat → /app/reports.
- 회원 공개: /app → /app/classes → /app/counseling → /app/reports.
- 상담사/기관 비공개: /dashboard(기관 /dashboard/org) → /classes → /reports → /chat.
- 상담사/기관 공개: 같은 홈 → /classes → /counseling → /chat.
- 플랫폼관리자는 제외. 더보기는 스와이프 대상 아님. 순환 없음.

## 상태 보전과 미리보기

- 이동·취소 드래그 동안 현재 React 화면을 재마운트하지 않는다. 로컬 입력·필터·데이터·스크롤은 그대로다.
- 완료 후 기존 Link와 동일하게 루트 URL로 한 번 push한다. Zustand/API GET 캐시는 기존 수명주기를 따른다. 탭별 독립 스택/스크롤 기억을 신설하지 않는다(spec §4.1). 돌아온 목록의 로컬 state·스크롤 복원은 기존 탭 클릭과 동일하며 전체 화면 keep-alive를 약속하지 않는다.
- 이웃은 inert/aria-hidden인 미리보기 레이어다. 방문 화면의 비활성 시각 스냅샷 또는 처음 방문할 메뉴의 정직한 제목·로딩 미리보기를 사용한다. 미방문 화면의 실데이터를 조작하거나 드래그만으로 API/소켓을 미리 열지 않는다. 스냅샷은 계정/역할 변경 및 언마운트 시 폐기하고 id/상호작용을 제거한다.
- 12px 방향 잠금 전 화면 정지, 잠금 후 dx 1:1. 완료 240ms/복귀 160ms, 끝 22%·최대32px. 움직임 줄이기는 transform·애니메이션 생략.
- 레이아웃 속성 애니메이션 금지. 너비/대상 영역 측정은 시작 때, 프레임은 transform만 갱신. 레이어는 드래그 수명 동안만 유지.

## 보호 판정 소스

- 정확한 루트 허용 목록 + 역할 + 실제 표시 pill + (max-width:767px) + pointerType touch.
- Shell drawerOpen, DOM의 dialog/aria-modal/시트(현재 구현의 실제 selector 확인), document.activeElement 폼/contenteditable, selection, composition, visualViewport 키보드 변화.
- 출발 target의 button/a/input/select/textarea/contenteditable/range/차트/recharts/canvas/table 및 조상 overflow-x auto/scroll·data-no-swipe. 가로 콘텐츠에는 touch-action:auto를 적용해 자체 스크롤 우선.
- useLeaveGuard의 실시간 콜백을 공유 등록해 미저장·수업/저장 중 차단. 클래스 플레이어의 실제 마운트/세션 상태, 오디오·영상 recording/paused, 측정·통화의 지속 활동은 기존 훅의 상태에서 등록한다. 서버의 ‘예정 수업 있음’을 ‘본인 수업 참여 중’으로 혼동하지 않는다.
- pointerdown/move/up에서 재평가. 두 손가락·cancel·blur·resize·visibility·경로/보호 변경 시 취소. 캡처 이동으로 발생한 자식 lostpointercapture는 무시. 제스처 종료 잔여 click 억제.

## 검토 초점

1. 레일 끝에서 부모로 인계되지 않으며 실제 레일 스크롤이 된다.
2. 도중 모달/미저장/수업 상태 전환 시 진행 중 전환도 취소된다.
3. 빠른 왕복·역방향 속도·취소·이력 back에 중복 이동이 없다.
4. 쿼리/끝 슬래시·다른 역할·플래그 순서가 pill과 일치한다.
5. 접근성 트리와 포커스에 미리보기 중복이 없고 reduced motion에도 버튼/안내가 유지된다.

## Task 1 — 판정과 연결 (구현자)

- [ ] 거리 78px(390px), 40px+0.5px/ms/최근80ms/최소16ms, 방향1.5, 12px·500ms, 양끝·역방향·취소·역할/플래그·보호 테스트 작성.
- [ ] `cd frontend && npx vitest run tests/mobile-menu-swipe*.test.*` 실패(RED) 확인.
- [ ] 순수 판정·보호 등록·제스처 훅·CSS·Shell·탭 SSOT 구현.
- [ ] 같은 테스트 GREEN, tsc 및 변경 파일 eslint. 구현 한글 feat(sdd-240) 커밋 및 중간 push.

## Task 2 — 독립 검증 (감독·검토자)

- [ ] 로컬 Vite 빌드(envDir 빈 디렉토리, 실 API 금지) + fixture 응답으로 실제 앱 라우트 구동.
- [ ] Chrome executablePath 지정, hasTouch 390x844, 회원·상담사·기관관리자 실제 터치와 verify 전 시나리오 검증. 360/767/768 경계·데스크톱·접근성 포함.
- [ ] origin/develop를 임시 경로에 git archive로 읽기 전용 추출, 같은 node_modules 심링크 및 동일 러너로 전체 Vitest JSON 실패 목록 비교. 기존 파일/테스트 수정·skip 없이 신규 실패 0 확인.
- [ ] 독립 diff 리뷰 후 문제 수정·해당 테스트 재실행. summary.md에 정확한 결과·캡처·실기기 미확인 범위 기록.
- [ ] 최종 커밋/push, develop 대상 PR 생성. 생성한 node_modules 심링크만 명시 승인대로 해제. 머지/배포 없음.
