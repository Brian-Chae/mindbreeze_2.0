# [SDD-109] EEG feature 멱등 키 보강 — NULL play_group_id 부분 유니크 인덱스

## Goal
`play_group_id`가 NULL인 EEG feature 윈도우의 동시 저장 중복(WS 1초 + REST 5초 폴백)을 DB 레벨에서 차단한다.

## Context
- FE(`useBand.ts`)가 `play_group_id`를 미전송 → 실제 모든 feature 윈도우의 `play_group_id`가 NULL(dev 14,731행 전부 NULL).
- 기존 유니크 제약 `uq_eeg_feature_window (session_id, participant_id, play_group_id, window_index)`는 PostgreSQL/SQLite에서 **NULL != NULL**이므로 play_group_id가 NULL이면 무효화된다.
- 결과: `_persist_feature_items`의 사전 조회(비동시)와 SAVEPOINT+IntegrityError(유니크 위반)에 의존하지만, 유니크 제약이 실제로 발동하지 않아 **동시 WS+REST 저장 시 중복 행**이 생긴다. dev에서 이미 중복 3행 확인(동일 session+participant, window_index 646/846/1647).
- SDD-108(feature_ack)이 WS 확정 시 REST 재전송을 줄였지만, ACK 유실·지연 시 여전히 이중 전송 경로가 남아 DB 멱등성이 최종 방어선이다.

## Out of scope
- FE의 play_group_id 전송(pause/resume 세그먼트 식별)은 별도 기능.
- join/leave 소유권 단일화, transports 단일화.

## Acceptance
- NULL play_group_id에 대한 부분 유니크 인덱스가 추가되고, 기존 중복 행이 dedup 된다.
- 동시 중복 insert 시 IntegrityError(유니크 위반)가 발생해 SAVEPOINT가 흡수한다.
- non-NULL play_group_id 행은 기존 유니크 제약이 계속 동작한다.
