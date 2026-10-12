# [SDD-111] EEG feature 저장 O(T²) → O(배치) 최적화

## Goal
`_persist_feature_items`가 참가자의 **누적 전체 키를 `.all()`로 로드**하는 O(T²) 패턴을, 현재 배치 window_index만 범위 조회하는 O(배치)로 줄인다.

## Context
- `backend/app/services/session_service.py:2193` — dedup 키 사전 조회가 `(session_id, participant_id)` 전체 `(play_group_id, window_index)`를 `.all()`로 로드.
- 1Hz 세션 30분 = ~1800 윈도우. 5초 배치(5건)마다 1800행을 로드 → 누적 ~O(T²). 세션 후반부로 갈수록 매 배치 비용이 선형 증가.
- dedup 검사는 `(play_group_id, second_offset)`가 이미 있는지만 보므로, **현재 배치의 `second_offset` 값만 조회하면 충분**하다.
- `ix_eeg_feature_window_batch_key (session_id, participant_id, window_index)` 인덱스가 이미 존재 → `window_index IN (...)` 범위 조회가 인덱스를 탄다.

## Out of scope
- 멱등 키/유니크 제약 변경(SDD-109 완료). 저장 로직 변경 없음(조회 범위만 축소).
- raw→S3 미연결, sequence 충돌.

## Acceptance
- `existing_keys` 조회가 `window_index IN (배치 오프셋)`으로 제한되어 배치 크기(≤N)에 비례한다.
- dedup 동작이 기존과 동일(같은 window_index 재업로드 skip, 다른 play_group_id는 별개 키).
- pytest 전체 통과 + 세션 후반부에도 배치 저장 비용이 일정하다.
