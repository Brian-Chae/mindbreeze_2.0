# [SDD-109] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/models/eeg_feature.py` | `__table_args__`에 NULL play_group_id 부분 유니크 인덱스 `uq_eeg_feature_window_null_pg` 추가 |
| `backend/alembic/versions/e036a0000026_eeg_feature_null_pg_dedup.py` | (1) 기존 NULL 세그먼트 중복 dedup (2) 부분 유니크 인덱스 생성 |

## Why
FE가 play_group_id를 미전송 → feature 윈도우 전부 NULL(dev 14,731행). 기존 유니크 제약은 NULL != NULL로 무효화되어 동시 WS+REST 저장 시 중복 행 발생. dev에서 중복 3행 확인(session 05fbf8f7, participant 3d94f74c, window_index 646/846/1647).

## Verification
- 마이그레이션 SQL을 throwaway DB에서 직접 검증: dedup 7→4행, 부분 인덱스 생성, NULL-pg 중복 insert 시 IntegrityError(유니크 위반) 발동.
- backend pytest **983 passed, 12 skipped** (모델 변경 회귀 없음).

## Deploy
- develop push → Deploy Dev `alembic upgrade head`가 `e036a0000026` 적용(dev DB는 `e036a0000025` head 상태에서 1단계만 실행).
