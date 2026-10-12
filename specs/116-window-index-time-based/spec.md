# [SDD-116] sequence 충돌 — 경과시간 기반 window_index

## Goal
브라우저 새로고침·재마운트 시 `secondOffsetRef`가 0으로 초기화되어 이전 구간과 `window_index`가 충돌(서버 멱등성 폐기)하던 데이터 유실을 제거한다.

## Context
- `useBand.ts` `ingestMetrics`에서 `offset = secondOffsetRef.current++` — 훅 mount마다 0부터 재시작.
- 서버 멱등 키(SDD-109)는 `(session_id, participant_id, play_group_id NULL, window_index)`. remount 후 offset 0부터 재전송하면 기존 행과 충돌 → 신규 측정 조용히 폐기.
- 마운트 내에선 단조증가라 정상. 오직 remount(새로고침)에서만 발생.

## Approach (Brian 확정: 시간기반 (a))
- 첫 샘플 wall-clock(`Date.now()`)을 base로 `localStorage`에 영속(키: `sessionId:participantId`).
- `window_index = max(floor((now - base)/1000), lastOffset)` — 경과시간 기반 + 단조 증가 가드(같은 초 내 중복 샘플 드롭 방지).
- remount 시 base를 localStorage에서 복원 → 이전 구간과 충돌 없음. 다중 탭도 동일 base → 동일 데이터로 멱등 처리(정상).

## Non-goals
- `play_group_id` 전송(FE 미구현, 별도 과제). 서버 멱등 키는 SDD-109 그대로.

## Acceptance
1. remount 후 window_index가 0으로 재시작하지 않는다.
2. 단조 증가(중복·역행 없음).
3. build + vitest 통과.
