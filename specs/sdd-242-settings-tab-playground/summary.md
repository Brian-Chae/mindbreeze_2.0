# SDD-242 — 하단 메뉴 더보기를 설정으로 변경·링크밴드 플레이그라운드 진입

- 상태: 구현·로컬 검증 완료, Stage ⑦ 최종 Brian 리뷰 대기.
- 시작 HEAD: `5d1d0a0f` (사용자 기재 `023269cf` 이후 시안 아이콘 변경 포함). 작업 시작 전 `git fetch origin develop` + `git merge --no-edit origin/develop`: Already up to date.
- 구현 전 plan·verify 커밋: `dbe9bf6b`. Brian의 10/24 결정과 구현 지시를 승인으로 적용했고 추가 승인 질문 없이 진행했다.
- 백엔드·서버·DB·환경파일 변경0. 삭제·메일·네이티브 빌드·develop 푸시·PR 머지·배포 없음.

## 결과와 파일

- `frontend/src/lib/mobile-menu-swipe.ts`, 양쪽 `BottomTabBar`, `floating-bottom-nav`, 양 셸: 5번째 톱니바퀴 설정 탭, SDD-240 5탭 공통 순서. 미매칭 업무 경로 설정 오활성 제거. 선택된 설정 톱니바퀴의 중앙 구멍이 채워지지 않도록 윤곽 유지. 기존 Sidebar 업무 진입 유지, 기존 더보기 배지는 상단 전체 메뉴로 이관.
- `components/settings/settings-content.tsx`, `account-settings.tsx`, 두 설정 페이지: 상단 LINK BAND PLAYGROUND 카드, 접힌 5그룹, 하단 로그아웃. 계정 기본정보·플랫폼 읽기전용·기관 조회 실패 폴백 유지.
- `lib/notification-preference-groups.ts`, `components/settings/notification-groups.tsx`: 47종을 23/4/20 목적×2채널 6개로 집계. 최초 진입·펼침은 쓰기0, 혼합은 일부, 변경할 항목/채널을 확인한 뒤 해당 키만 PUT. 실패 복구·중복 요청 차단·계정 변경 이후 늦은 응답 무시.
- 표 밖 unknown/미래 키와 push는 그룹 변경에 포함하지 않음. 서버 카탈로그의 추가3종(schedule_change_request/agent_message/risk_signal)은 기존 응답에 있을 때만 별도 호환 상세에서 선택 유지. 부분 PUT을 사용해 legacy 전체 재전송422 방지. 백엔드 API/스키마 변경0.
- `settings-switch.tsx`, 선택동의·웹푸시·진행안내·프로필 재직중·리포트 자동승인/그룹핑: 공용52×32 스위치,44px 터치영역. true=켜짐, 일부=가운데 연보라. ARIA switch는 boolean으로 제공하고 일부는 aria-describedby로 설명.
- `pages/settings/professional-profile-page.tsx`, `participation-profile-page.tsx`, `App.tsx`, `ClientAppPage.tsx`: 전문10/참여4를 기존 편집 컴포넌트와 API 그대로 재사용. C/O* 전문 경로 역할·프로필 조건, 회원 미연결/조회 대기에도 설정·참여프로필 접근. 회원 `/settings`는 정규 `/app/profile`로 normalize.
- `pages/reports/ReportListPage.tsx`: `/reports?settings=operations`에 진행 기록 안내 받기(true=켜짐)·기존 자동승인 배치. 기관의 자동승인 저장권한은 신설하지 않고 기존 상담사 본인 정책을 안내.
- `PlaygroundPage.tsx`: 전 역할 기존 기능 유지, 회원 ClientShell과 역할별 설정 복귀. DEV 관리자 NormalizationPanel 조건 유지.
- `ClientInvitePage.tsx`: 설정에서 이관된 고정 상담사 초대코드 표시·복사. 내 계정의 회원 초대 링크와 기존 이메일 초대링크 생성 기능 보존.

## 역할별 설정 수

독립 변경 가능한 최상위 제어 기준, 링크/조회값/명령 제외. 첫 화면은 전 역할 5그룹이며 접혀 있어 스위치를 한꺼번에 나열하지 않는다.

- 회원: 10→13 (기본4 + 목적 알림6 + 기기권한1 + 선택동의2). 참여프로필4는 별도 화면.
- 상담사: 112→13. 전문10과 진행안내는 별도 업무 화면.
- 기관관리자(정상): 102→13, 상담사 프로필 보유 기관관리자112→13. 전문10은 보유 계정에만 별도 진입.
- 기관 프로필 조회 실패 폴백: 기본2이므로11. 정상13과 구분한다.
- 플랫폼관리자: 97→9 (알림6 + 기기권한1 + 선택동의2), 계정 수정권한 추가0.
- 기기권한1은 환경에 따라 안내로 대체되며 스위치가 비활성/미표시될 수 있다. 추가3종의 기존 저장키가 있는 계정은 별도 호환 상세이며 위 기준 개수와 구분한다.

## 검증

- 의존성: 기존 Storybook8–Vite8 peer 충돌로 일반 npm ci 실패. `npm ci --legacy-peer-deps` 성공. package.json/lockfile 변경0.
- RED→GREEN: 메뉴13실패 확인 후 통과. 알림 helper·설정 공용 컴포넌트는 미구현 import 실패 확인 후 구현. 추가 Playwright Link 도입으로 기존 체험 테스트에 실제와 같은 MemoryRouter 제공, 기존 동작·검증문 유지.
- 변경 관련 vitest: 18파일271개 통과.
- 전체 vitest: 변경 전244파일2774개(2757통과/17실패) → 변경 후252파일2808개(2791통과/17실패). 동일8파일·동일17실패, 신규 실패0, skip0. 개별 목록은 `test-results.json`.
- tsc -b 통과, npm run build 통과. 기존 번들 크기/동적 import 경고 존재.
- 변경43개 TS/TSX 파일 eslint 통과. 전체 eslint는 기존9오류와 정규화 로그가 완전히 동일, 신규 오류0. 기존 파일: agent-page(2), sdd217-presence-socket(1), sdd222-use-background-session(4), use-eeg-raw-upload(1), use-media-check(1). 정확한 목록은 test-results.json의 lint 기록 참조.
- `python3 specs/sdd-242-settings-tab-playground/verify-notification-contract.py` 통과. ORM을 import하거나 DB에 연결하지 않고 실제 backend 함수 AST만 추출해 기본47키·그룹23/4/20·부분PUT의 legacy/push/이전응답 불변성을 독립 검증.
- `node specs/sdd-242-settings-tab-playground/serve-fixture.mjs` 실행 후 별도 터미널에서 `node specs/sdd-242-settings-tab-playground/capture.cjs`: 로컬 Vite5182 + 합성 API, 외부 연결 차단. Vite envDir:false/envFile:false로 환경파일 로드 비활성. 4역할×390/1440에서 설정8·알림8·플레이그라운드8 + 상담사 운영2 = PNG26장. 페이지 오류0, 가로넘침0. 5그룹/6스위치/모바일5탭/초기저장0/52×32·44px/프로필·운영 라우트/체험왕복 확인.
- PNG26장 직접 확인. 제목 대비(전역 h2 색상)와 회원 이중 여백을 수정하고 재캡처. 스위치 이동 애니메이션 완료 후 촬영해 상태와 손잡이 위치 일치 확인.
- 독립 검증자 리뷰: Critical0, Important1(고정초대코드 미이관) 보완 후 재리뷰 잔여0. 감독이 diff·전체 테스트·이미지로 재검증.
- 전체 테스트의 기존 SDD-234 측정 테스트가 재생성한 자기 산출물은 시작 시 깨끗했던 HEAD 내용으로 원복하고 이번 커밋에서 제외한다.

## 기존 실패와 남은 위험

전체 테스트의 기존 실패8파일: agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf, sdd220-native-release, sdd234-a-mobile-home. 브라우저·네이티브 버전·기존 레이아웃 기대 등 기준선 실패를 이 범위에서 수정하거나 skip하지 않았다.

실제 로그인/백엔드 저장/운영 알림 발송·수신/동의철회·계정삭제 실행/BLE 실기기/네이티브/운영 배포는 검증하지 않았다. 캡처는 실제 제품 React 화면이지만 데이터·권한 응답은 합성이다. 관리자 실제 API 거부는 기존 가드 소스 보존이며 이번 실행 증명이 아니다. 기관 자동승인 권한도 확대하지 않았다. 이용약관은 기존 공개페이지가 없어 별도 URL을 꾸며내지 않고 필수동의 조회와 기존 개인정보처리방침·도움말 연결을 제공한다.
