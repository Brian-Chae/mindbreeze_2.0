# [SDD-112] 연결·재전송 잔여 견고화 — transports 단일화 + 재전송 상한

## Goal
① `/session-live` transport를 websocket 단일화(`/chat`과 대칭)하고 ② 미확정 큐 재전송에 in-flight 가드·배치 상한을 추가한다.

## Context
- ① `socket.ts` `transports: ['websocket', 'polling']` — polling은 sticky session 없이 멀티워커에서 깨지고 `/chat`(websocket만)과 비대칭. 단일 워커에선 동작하나 멀티워커 전환 시 disconnect 루프 위험.
- ② `useBand.ts` `retransmitPending`(411) — 5초 타이머(`FEATURE_FLUSH_MS=5000`)·재연결(`onConnect`)에서 호출되지만 **in-flight 가드 없음**(동시 재전송 → 중복 REST post), **배치 상한 없음**(장기 단절 시 1800+ feature를 단일 post로 전송).

## Out of scope
- sequence 충돌(재마운트·다중 탭), raw→S3 미연결 — 별도 후보.

## Acceptance
- `/session-live` 소켓이 websocket만 사용(polling 미사용).
- `retransmitPending` 동시 호출 시 1개만 진행(중복 post 없음), 배치가 상한 이하로 나뉜다.
- drain/ACK 정상 동작 유지(vitest·build 통과).
