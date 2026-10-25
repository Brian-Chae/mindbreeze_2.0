# 구현 전 검증 계획 — 서버 재시작·재연결 후 실시간 지표 미복구

작성 시점: 구현 전. 증상: 10/25 dev 배포(backend 재시작) 후 '연결이 불안정' 유지, 상담사 지표 전부 '-' 가 종료까지 복구되지 않음.

## 확정 원인(코드·journalctl 근거)
1. `frontend/src/lib/socket.ts` 세션 소켓의 `auth` 가 생성 시점 토큰으로 고정 → 재연결 핸드셰이크가 만료 토큰을 재사용 → 서버 `session_live_namespace.py:436` 거부.
2. 거부 후 `connect_error` 핸들러와 `getSessionLiveSocket` 토큰변경 분기가 동시에 `connect()` 호출 → 중복 연결(서버 로그 open 6 / closed 6).
3. 룸 재join 이 각 훅의 `onConnect` 에만 의존하고 `joined` 수신 확인·재시도가 없음.
4. `useBand` 가 WS transport 연결만으로 REST 폴백을 끔 → join 불일치·ACK 정체 시 feature 가 어디에도 저장되지 않음(재시작 후 REST /features 흔적 없음).
5. 상담사 화면이 소켓 끊김만으로 '연결이 불안정'(흐림·수신 일시 중단)을 표시, live-metrics 폴링이 정상이어도 해제되지 않음.

## 시나리오(RED → GREEN)
- [ ] 재연결 시도(reconnect_attempt) 때 토큰 제공자의 최신 토큰이 auth 에 반영된다.
- [ ] 토큰 만료 거부 후 refresh 성공 시 connect 를 중복 호출하지 않는다(이미 active 면 생략).
- [ ] join 한 방(세션)은 훅과 무관하게 소켓 `connect` 시 자동 재join emit 된다(끊김→재연결).
- [ ] `joined` 가 5초 내 오지 않으면 connected 상태에서 join 을 재전송한다. joined 수신 시 중단.
- [ ] `isSessionLiveJoined` 는 joined 전 false, 수신 후 true, disconnect/leave 후 false.
- [ ] feature REST 폴백 판정: WS 미연결 / 미join / ACK 10초 정체면 REST, 정상이면 WS 만.
- [ ] 상담사 화면 네트워크 판정: 소켓 끊김이어도 폴링 정상이면 'ok', 폴링 실패면 기존대로 reconnecting/down.
- [ ] 기존 session-live 소켓 테스트 회귀 없음.

## 실행
관련 vitest → 전체 vitest(기준선 17건/8파일 실패와 비교) → tsc → 변경 파일 eslint → build. 서버 쪽 변경 없음(pytest 는 session-live 관련 회귀만).
실기기(Android+LINK BAND)·dev 서버 재시작 재현은 미실행 — 배포 후 대표님 확인 필요.
