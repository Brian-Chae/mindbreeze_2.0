# [SDD-111] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: dedup 동작 불변
1. 같은 `(participant, window_index)`를 두 번 저장 → 두 번째 skip.
2. 다른 `play_group_id` + 같은 `window_index` → 둘 다 저장(별개 키).
3. 배치 내 동일 window_index 중복 → `seen_in_batch`로 skip.
- *검증*: 기존 pytest(981+ 통과) 회귀 없음.

### TS2: 조회 범위 축소
1. 참가자에 이미 1000개 윈도우 존재.
2. 5건 배치 저장 시 `existing_keys` 조회가 `window_index IN (5개 오프셋)`으로 제한되어 반환 행 ≤ 5.
- *검증*: SQLAlchemy 로그/EXPLAIN으로 반환 행 수 확인, 또는 테스트에서 조회 결과가 배치 오프셋에만 한정되는지 단언.

### TS3: 인덱스 사용
1. `EXPLAIN` 상 조회가 `ix_eeg_feature_window_batch_key` 범위 스캔을 탄다.
- *검증*: `EXPLAIN` 인덱스 스캔 확인.
