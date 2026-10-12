# SDD-105 구현 계획

실행 전제: verify.md 승인 후 구현. 기존 흐름을 읽은 결과를 반영한 계획이며, 신규 화면 설계 대신 제공된 목업을 사용한다.

## 1. 준비 상태 계약과 회귀 테스트

대상: `frontend/src/lib/socket.ts`, `frontend/src/hooks/useWaitingRoomPresence.ts`, `frontend/src/hooks/useWaitingRoomCount.ts`, `backend/app/ws/session_live_namespace.py`.

- spec.md의 WaitingRoomReadiness를 optional readiness로 presence emit/event/entry에 추가한다. 기존 checkin을 대체하지 않는다.
- presence의 최신 상태 ref, 즉시 재전송, heartbeat 경로 모두 같은 상태를 사용한다. 서버는 불리언 3필드만 수용하고 participant_id는 기존 인증 컨텍스트로 결정한다.
- `frontend/tests/class-waiting-room-presence.test.ts`에 완료·스킵 상태 전송/수신, 구버전 payload, TTL/퇴장 회귀를 먼저 추가해 실패를 확인한 후 구현한다.
- `backend/tests/test_class_waiting_room_presence.py`에 필드 검증과 호스트 전용 전달을 추가한다.

## 2. 회원 3단계

대상: ClassWaitingRoom.tsx, PreCheckinPanel.tsx, WaitingRoomBandCheck.tsx와 대기실 전용 스타일.

- PreCheckinPanel에 선택적 완료/스킵 콜백을 추가한다. REST 성공 전에 완료하지 않는다.
- WaitingRoomBandCheck에 완료 통지와 미사용 선택을 추가한다. BLE 연결 상태와 절차 완료를 별도로 보관한다.
- ClassWaitingRoom이 activeStep과 readiness를 소유한다. 완료 콜백은 해당 항목을 불변 갱신하고 다음 탭을 선택한다.
- 기존 미디어 로직과 BGM을 보존하면서 목업의 hero/탭/밴드 이미지/안내/완료 표시로 렌더를 재배치한다. 탭을 바꿔도 입력·useBand 구독을 잃지 않도록 유지한다.
- 기존 `class-waiting-room.test.ts`, `class-waiting-room-band-check.test.ts`를 갱신하고 DOM 상호작용 테스트를 추가한다. 저장 실패, 권한 거부, 모두 건너뛰기, 빈 이름을 검증한다.

## 3. 단일 대기 흐름

대상: `frontend/src/components/player/MemberWaitingScene.tsx`, `frontend/src/pages/class-join-page.tsx`.

- welcome/guide/wait 타입·상태·콜백을 제거하고 단일 ClassWaitingRoom 렌더로 모은다.
- 준비 중과 입장 확정 후 대기에서 동일한 인스턴스를 유지한다. 상담사 시작 감지를 통합 대기 동안 활성화한다.
- 이름 유효성만 자동/수동 입장에 적용한다. 종료/취소/404 처리와 게스트 state API fallback, Wake Lock, MemberSessionScene 전달 값을 보존한다.
- 흐름 테스트에서 준비 중 시작, 시작 전 입장 클릭, 진행 중 입장, 종료·취소를 검증한다. 중복 presence leave/join 및 BLE 재연결이 없어야 한다.

## 4. 상담사 패널 및 대기실 리마인드

대상: 새 `frontend/src/components/class/waiting-room-readiness-panel.tsx`, ClassPlayerPage.tsx, socket.ts, 서버 WS 처리와 대기실 알림 구독.

- entries의 세 boolean 합으로 n/3을 계산하고 모두 true인 인원으로 그룹 완료율을 계산한다. 분모 0은 0%다.
- open 상태의 기존 목록 위치에 패널을 배치하되 CheckinSummary와 retainedCheckinsRef 보존 흐름은 유지한다.
- 호스트 인증과 세션 범위를 검증하는 리마인드 WS 요청을 추가하고 참가자 본인 룸에만 안내한다. 회원 화면은 안내를 접근 가능한 status로 표시한다.
- 패널 테스트는 0명, 전원 완료, 일부 미완, 스킵 완료, 체크인 요약을 검증한다. 리마인드 테스트는 권한 거부·타 세션·전송 실패·중복 클릭을 검증한다.

## 5. 검증 및 결과

- frontend에서 `npx vitest run tests/class-waiting-room.test.ts tests/class-waiting-room-presence.test.ts tests/class-waiting-room-band-check.test.ts` 및 새 DOM/흐름/패널 테스트 실행.
- backend에서 `pytest tests/test_class_waiting_room_presence.py` 및 추가 리마인드 테스트 실행.
- frontend에서 `npm run build` 실행.
- 실제 브라우저에서 회원 각 탭과 준비 완료 상태, 상담사 패널을 목업과 비교한다. 390px 모바일과 1440px 데스크톱을 확인하고 증거를 이 스펙의 evidence/에 저장한다.
- summary.md에 변경·시험 명령/결과·실기기 검증 여부를 기록한다. 커밋 시 `feat(sdd-105):` 한글 메시지를 사용한다.

## 리뷰 집중 항목

탭 이동 시 설문 입력 손실, BLE singleton 해제, 시작 시 이름 게이트 우회, 서버가 readiness를 버리는 문제, 구버전 이벤트를 모두 완료로 오인하는 문제, 체크인 전달 말 손실을 각각 위 테스트에서 확인한다.
