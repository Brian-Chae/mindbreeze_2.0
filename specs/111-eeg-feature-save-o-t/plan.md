# [SDD-111] — Implementation Plan

> BE `session_service.py` 단일 함수 조회 범위 축소. Stage ③ Verify 후 구현.

## 변경: `backend/app/services/session_service.py` `_persist_feature_items`

- `features`의 `second_offset` 집합 `batch_offsets`를 구하고,
- 기존 키 조회에 `.filter(EEGFeatureWindow.window_index.in_(batch_offsets))`를 추가.

## 아키텍처
- dedup 키 `(play_group_id, second_offset)` 검사는 현재 배치 오프셋에만 필요 → 조회 범위가 O(배치).
- `ix_eeg_feature_window_batch_key` 인덱스로 범위 스캔(기존 전체 스캔 → 인덱스 범위 스캔).
- 저장/SAVEPOINT/IntegrityError 로직은 그대로(변경 없음).

## 배포
- develop push → Deploy Dev. 백엔드 코드만(마이그레이션 없음).
