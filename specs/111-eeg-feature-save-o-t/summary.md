# [SDD-111] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/services/session_service.py` | `_persist_feature_items`의 dedup 사전 조회를 `window_index IN (배치 오프셋)`으로 제한 — 누적 전체 키 로드(O(T²)) → O(배치) |

## Why
1Hz 세션 30분 = ~1800 윈도우. 5초 배치마다 전체 키를 `.all()`로 로드 → 세션 후반부로 갈수록 저장 비용 선형 증가. dedup 검사는 현재 배치 오프셋에만 필요하므로 범위 조회로 축소.

## Verification
- backend pytest **983 passed, 12 skipped** (dedup 동작 회귀 없음).
- 기존 `ix_eeg_feature_window_batch_key (session_id, participant_id, window_index)` 인덱스를 타는 범위 스캔.

## Deploy
- develop push → Deploy Dev. 백엔드 코드만(마이그레이션 없음).
