# [SDD-109] — Implementation Plan

> BE 스키마 변경(모델 + 마이그레이션) 단일. Stage ③ Verify 후 구현.

## 변경 파일
| File | 변경 |
|------|------|
| `backend/app/models/eeg_feature.py` | `__table_args__`에 NULL play_group_id 부분 유니크 인덱스 `uq_eeg_feature_window_null_pg` 추가 |
| `backend/alembic/versions/e036a0000026_eeg_feature_null_pg_dedup.py` | (1) 기존 중복 dedup (2) 부분 유니크 인덱스 생성 |

## 아키텍처
- 모델 + 마이그레이션 모두 동일 인덱스명 `uq_eeg_feature_window_null_pg` 사용 → `create_all`(테스트)과 `alembic upgrade`(dev/prod)가 정합.
- 기존 `_persist_feature_items`의 SAVEPOINT+IntegrityError 흡수 로직은 변경 불필요 — 부분 인덱스가 발동하면 동일하게 유니크 위반으로 잡힌다.

## 배포
- develop push → Deploy Dev가 `alembic upgrade head` 수행. `e036a0000026`이 적용된다.
- Celery 워커 재시작은 배포 워크플로우가 처리.
