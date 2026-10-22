# SDD-235 — 상담사 모바일 신호 FE 구현 결과

## FE — 2026-10-22

### 결과
Brian의 10/22 확정 A안을 구현했다. 구현 전 plan/verify FE 절을 a7cb6dd8로 커밋했으며, BE 파일은 수정하지 않았다. develop 리베이스 후 해당 기능 브랜치에서 작업했다.

- 모바일: 기존 도크 5개 위 76px 영역에 손들기/조용한 신호 버튼 두 개를 상시 배치. 0건도 흐리게 표시하면서 탭 진입 가능. 발언권 인원 병기. 데스크톱은 상단 진입점으로 통일하고 세로 태블릿은 모바일 방식 유지.
- 손들기/발언권/밴드 요약을 접힘 +N에 의존하지 않도록 분리. 밴드는 수업 상태 시트에서 확인. 전원 밴드 미착용 타일에도 손듦/발언권 있음 표시.
- 손든 회원·발언권 있는 회원·그 외 회원을 이름순으로 구분. 손 내리기/발언권 부여·회수 제공. 두 상태인 회원은 한 행에 조치를 모아 중복 방지.
- 손 내리기: 기존 lower-hand 엔드포인트 호출, 중복 요청 차단, 성공 전 상태 유지, 성공 후 페이지 상태 갱신, 실패 행 안내·재시도. BE의 호스트 인가 확장이 합쳐져야 실제 서버 사용 가능.
- 조용한 신호: 최근 10초 종류별 건수만 별도 시트에 표시. 빈 상태/체크인 요약 연결. 이름·참가자 ID는 새 UI/토스트/접근성 문구에 전달하지 않음. 서버 수준 익명화는 이번 범위 아님.
- 토스트: 손들기·조용한 신호·입장 대기만 무음, 한 장씩. 손들기/신호 2초·대기 3초 묶음, following만 4초/나머지 6초. P1 우선·동일 우선순위 FIFO, 신호 10초 빈도 제한, P2 지연 폐기. 같은 주제 추가 수신은 카드에 병합하고 최초 표시 시간 유지. hover/focus 동안 정지. 탭은 해당 시트만 열며 조치를 자동 실행하지 않음.
- 초기/재연결/백그라운드 복귀/세션 전환은 기존 요청을 새 알림으로 만들지 않음. 서버 시각 중복/역순/만료 이벤트 및 구 payload 500ms 중복 억제. 로컬 수신 시각과 서버 중복 판정 시각 분리.
- 공통 시트: Tab/Shift+Tab 제한, Escape, inert 적용 전 진입점 보존과 닫기 후 포커스 복귀. 실제 Chrome에서 발견한 데스크톱 복귀 실패를 수정했다.

### 변경 파일
- 뷰/레이아웃: `HostLiveView.tsx`, `HostParticipantGrid.tsx`, `host-player.css`, `sheets/AlertsSheet.tsx`, 신규 `sheets/SignalsSheet.tsx`, `host-player-case.ts`.
- 이벤트/API 연결: `HostLiveContainer.tsx`, 신규 `HostSignalToast.tsx`, `host-signal-toast.ts`, `quiet-signal.ts`, `ClassPlayerPage.tsx`, `SpeakingRightsPanel.tsx`.
- 접근성/하니스: `shared/PlayerSheet.tsx`, `shared/PlayerShell.tsx`, `HostCaseHarness.tsx`.
- 테스트: 기존 `class-player-host-{container,detail,sheets,view}.test.tsx`의 진입점 단언을 새 UI에 맞게 유지. 신규 `host-signal-toast{,-view}.test.*`, `sdd235-{host-signals-ui,quiet-receive,sheet-focus,speaking-rights}.test.*`.
- 문서/증거: `plan.md`, `verify.md`, `summary.md`, `capture.cjs`, `screens/`.

### 검증
- `cd frontend && npx vitest run tests/class-player-host-*.test.* tests/host-signal-toast*.test.* tests/sdd235*.test.* tests/quiet-signal*.test.* tests/class-player-harness.test.tsx` — 16개 파일 255개 통과. 전체 프로젝트 테스트는 실행하지 않음.
- `npx tsc --noEmit -p tsconfig.app.json` 통과.
- 변경 TS/TSX 파일 ESLint 통과, `git diff --check` 통과.
- `npm run build` 통과. 기존 tokens CSS import 탐색 경고, dynamic/static import 경고와 500kB 청크 경고는 남아 있음. 해당 설정/파일은 변경하지 않음.
- 신규 요구마다 실패 테스트 확인 후 구현. 손 내리기 mock API 성공·실패·재시도·중복 차단, 신호 UI/TTL/익명/토스트 정책/포커스를 검증.
- 독립 워커 리뷰에서 발견한 표시 중 병합·소켓 중복·최신 숫자·P1 우선순위·시트 연결을 보완하고 감독이 diff/테스트/실제 Chrome을 재확인. 최종 차단 결함 없음.

### 화면 증거
지정 Chrome 실행 파일로 `/design/class-player?role=host&case=C13&n=6&signalsDemo=...` 실제 컴포넌트를 렌더했다. API/원격 요청은 차단하고 .env를 읽지 않는 로컬 Vite 설정으로 실행했다. 익명 가상 회원을 사용하는 고정 샘플이며 실제 세션/서버 이벤트 증거가 아니다.

- `screens/{none,hand,signals,toast,hands-sheet,quiet-sheet}-{390,1440}.png` — 12장.
- `screens/validation.json`: 가로 넘침/타일 하단 가림/블러/페이지 오류 없음, 도크5·신호버튼2 유지. 신호 버튼 높이 64px(390)/52px(1440), 본문15px·보조13px.
- `capture.cjs`: 실제 손 내리기 샘플 조작 후 건수0, Escape 진입점 복귀, 토스트→익명 신호 시트 연결도 단언.
- 초기 캡처의 시트 애니메이션 중간 프레임을 발견하여 완료 후 다시 저장. 최종 손들기/익명 시트 대표 화면 육안 확인.

### 남은 통합 확인
- 별도 BE 브랜치의 호스트 lower-hand 권한 변경 합치기 및 실제 인증 API/WS 반영 검증.
- 실제 iPhone/Android·LiveKit 마이크·BLE, 확대 글자/스크린리더 발화는 미검증.
- 서버·DB·메일·PR·develop 푸시·머지·배포는 수행하지 않음. 최종 Brian 리뷰는 감독이 BE 통합 후 진행.
- 원본 저장소 node_modules 임시 심링크는 검증 종료 후 제거. 재실행 시 frontend 의존성 준비 필요.
