# SDD-099 루프4 — 최종 통합 검증 결과

2026-10-03. 기존 루프1~3 작업을 보존하고 잔여 수정·검증을 수행했다. 사용자 요청으로 이번 수정 수행이 승인되었으며, 사전 체크는 `loop4-verify.md`에 기록했다.

## 항목별 최종 일치성

- **상세 전체 높이·스크롤:** 목업 최종 cascade와 동일한 `min(578px, 100dvh - 142px)` / 모바일 `min(690px, 100dvh - 120px)` 유지. 이전 72px 몸 지표 압축 override를 88px, 그래프 56px를 64px, 데스크톱 본문 패딩을 8×16px로 복원했다. flex 자식 축소를 방지하고 sticky 헤더·내부 세로 스크롤로 닫기와 끝 범례에 접근한다. 실측 데스크톱 외곽 578px / 내부 576px / 내용 640px, 모바일 외곽 690px / 내부·내용 688px. 내부 가로 넘침 없음.
- **그룹 링:** 목업과 실제 computed 크기를 대조하여 데스크톱 68×68px, 모바일 30×30px 일치. 불필요한 크기 변경 없음.
- **카드 정렬:** 이름·성별/나이·우측 밴드 dot, 현재값·증감 baseline 정렬 유지. 데스크톱 174×152px·5열, 모바일 183×96px·2열 실측. 한 명이어도 첫 칸 너비를 유지한다. 중간 폭의 `minmax(174px,1fr)`를 고정 174px 칼럼으로 바꿔 불필요한 확장도 방지했다.
- **푸터 컨트롤:** 기존 진행/종료/채팅 설정 버튼을 헤더에서 작업판 하단 푸터로 이동했다. 기존 이벤트 핸들러·disabled·종료 확인 플로우를 그대로 사용한다. 모바일에서도 버튼 라벨을 표시하며 줄바꿈을 허용한다. 시연용 버튼을 복제하지 않았다.
- **0명:** role=status 빈 상태 안내. 모두를 눌러도 빈 테이블 헤더를 렌더하지 않는다.
- **전원 밴드 미사용:** 유효 표본 0명에 “표본 없음”과 수신 대기를 표시하고 그룹 링·막대를 숨긴다. 일부 표본 부족 시 기존 최소 표본 가드를 유지한다.
- **신호 0건:** 미확인 pill은 DOM에 없고 3개 중공 숫자 배지는 남는다. 중공 배지 숫자를 muted 토큰으로 변경해 배경 #231531 대비 **8.18:1**, 테두리를 #8a7897로 변경해 **4.26:1** 확보했다. 이 부분은 접근성을 위해 정본보다 대비를 높였다.
- **상세 접근성:** aria-modal/라벨, 닫기·Esc·백드롭, Tab/Shift+Tab 유지. 카드뿐 아니라 테이블 수치 클릭도 해당 참가자 버튼으로 포커스를 돌린다. 참가자 퇴장으로 버튼이 없어지면 툴바로 복귀한다. 상세가 열려 있는 동안 플레이어 배경 전체를 inert 처리하고 닫을 때 원래 상태로 복구한다.

## 검증 결과

- **빌드:** `cd frontend && npm run build` — tsc + Vite 종료 코드 **0**.
- **회귀:** 아래 11파일 **120개 통과**.
  `host-class-workspace`, `quiet-signal`, `quiet-signal-ui`, `group-aggregate`, `class-chat-panel`, `class-waiting-room`, `class-waiting-room-presence`, `class-waiting-room-band-check`, `class-audio-sync`, `class-onboarding-coachmarks`, `class-chat-api`.
- 이번 신규 회귀 4건은 빈 목록/전원 밴드 없음/테이블 포커스/모달 배경 차단의 실패를 수정 전에 재현했다.
- **브라우저:** 로컬 Chromium, 1280×720 / 390×844에서 0·1·6명 및 전원 밴드 없음 검증. 문서 너비는 각각 1280/390px. 테이블 상세 진입·포커스 복귀, Tab/Shift+Tab, Esc, 데스크톱 백드롭 클릭, 상세 내부 끝까지 스크롤, 푸터 inert/복원 확인. pageerror 0건.
- **정적 확인:** `git diff --check` 통과.
- **독립 리뷰:** 모달 배경 조작 문제 1건 발견 → 수정 → 재리뷰에서 해결 확인.

## 증거

- [측정 JSON](evidence/loop4-layout.json)
- [1280 기본 화면](evidence/loop4-actual-1280-6.png) · [390 기본 화면](evidence/loop4-actual-390-6.png)
- [1280 상세](evidence/loop4-detail-1280-6.png) · [390 상세](evidence/loop4-detail-390-6.png)
- [1280 한 명](evidence/loop4-actual-1280-1.png) · [390 한 명](evidence/loop4-actual-390-1.png)
- [1280 빈 상태](evidence/loop4-actual-1280-0.png) · [390 빈 상태](evidence/loop4-actual-390-0.png)
- [1280 목업](evidence/loop4-reference-1280.png) · [390 목업](evidence/loop4-reference-390.png)

## 의도적으로 유지한 차이와 남은 TODO

- 데스크톱 카드 정본 최종 높이 120px 대신 기존 사용자 요청인 152px 유지. 모바일 좌측 148px 칼럼도 루프3 결정 유지.
- 실서비스의 프로필·설문은 계약에 없는 값이므로 `—` 유지. 기존 `hostParticipantProfile` 백엔드 계약 TODO가 남는다.
- 정상범위·고정 시연 값 대신 실제 수신 범위·유효 평균·수신 대기 표시. 데이터 의미 차이 때문에 목업 전체 픽셀 동일성을 주장하지 않는다.
- 푸터 채팅 버튼은 기존 실제 기능인 채팅 활성화 설정을 유지한다. 목업의 시연 unread 숫자나 가짜 채팅 동작은 이식하지 않았다.
- 이번 브라우저 증거는 실제 HostClassWorkspace + 앱 CSS에 모의 참가자 데이터를 넣은 화면이다. 헤더·좌측 미디어·푸터 버튼은 검증용 구성으로, 로그인한 ClassPlayerPage 전체·실서버 상태 전이·실제 BLE/카메라/마이크 검증은 별도 TODO다.
- 기존 design-system tokens.css import 해석 경고와 500kB 초과 청크 빌드 경고는 남는다. 이번 범위의 실패는 아니다.
