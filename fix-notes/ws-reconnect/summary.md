# 요약 — 서버 재시작·재연결 후 실시간 지표 미복구

## 원인(파일:줄, 수정 전 기준)
1. `frontend/src/lib/socket.ts` 세션 소켓 `auth` 가 생성 시점 토큰으로 고정 → 재연결 핸드셰이크가 만료 토큰 재사용 → `backend/app/ws/session_live_namespace.py:436` 거부(journalctl 14:12:31 '잘못된 토큰' → refresh 200 → open/closed 6회 반복).
2. 룸 재join 이 각 훅의 `onConnect`(`useSessionLiveSocket.ts:259`, `useBand.ts:1533`)에만 의존, `joined` 확인·재시도 없음. 재시작으로 서버 메모리 room/context 가 사라진 뒤 join 이 빠지거나 거부되면 방이 비어 있음.
3. `useBand.ts` 가 WS transport 연결만으로 REST 폴백을 끔(`wsConnectedRef`, flush 타이머 `!wsConnectedRef.current` 가드). join 미확정·ACK 정체여도 REST 로 안 보냄 → 1Hz features 저장 중단 → `last_eeg_at` 10초 초과 stale → 상담사 화면 값 '-'(`host-live-model.ts` `isEegStale`), raw 업로드(별도 REST)만 계속 200.
4. 14:11·14:14 의 POST /features 403 은 시작 전·종료 후 구간(세션 상태 불일치) — 이번 증상과 무관.

## 수정(frontend 만)
- `lib/socket.ts`: reconnect_attempt 마다 최신 access 토큰으로 auth 갱신 / 마지막 join payload 보관 후 소켓 레벨 `connect` 에서 자동 재join / joined 미수신 시 5초 간격 재전송 / join_denied·access_revoked·leave·disconnectSessionLiveSocket 시 중단 / `isSessionLiveJoined()` 신설.
- `hooks/useBand.ts`: join 미확정이면 WS emit 생략(REST 폴백), WS 가 붙어 있어도 join 미확정·ACK 10초 정체면 5초 주기 REST 재전송, joined 수신 즉시 미확정 큐 재전송.
- `hooks/useSessionLiveSocket.ts`: join 거부·권한 회수 시 자동 재join 취소.
- 상담사 화면(WS 끊김 중 live-metrics 폴링 값 표시): 폴링은 이미 소켓과 무관하게 4초마다 반영됨. 배너 판정 변경은 기존 테스트 정책(소켓 끊김=불안정 배너)과 충돌해 제외.

## 테스트
- 신규 `tests/session-live-reconnect.test.ts` 6건: 수정 전 4건 RED → 수정 후 GREEN.
- 관련 4파일 45건 통과, 전체 vitest 17 실패/8파일(기준선과 동일 목록), 신규 실패 0. tsc·eslint(변경 파일)·build 통과.
- 백엔드 미변경. pytest 는 로컬에 설치되지 않아 미실행.

## 한계
실기기(Android+LINK BAND)·dev 서버 재시작 재현은 미실행. 배포 후 대표님이 클래스 중 서버 재시작 → 30초 내 지표 복구를 확인해야 함.
