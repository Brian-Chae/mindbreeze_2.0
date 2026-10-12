# [SDD-109] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 마이그레이션 upgrade — dedup + 인덱스 생성
1. 중복 행이 있는 상태에서 `alembic upgrade head` 실행.
2. 동일 (session, participant, window_index) 중복이 1행으로 줄고(id 최소만 잔존), 부분 유니크 인덱스가 생성된다.
- *검증*: dev DB에서 upgrade 후 중복 3행 제거 확인 + `\di uq_eeg_feature_window_null_pg` 존재.

### TS2: 동시 중복 insert 시 유니크 위반
1. 같은 (session, participant, window_index)의 play_group_id=NULL 행을 두 번 insert.
2. 두 번째 insert가 IntegrityError(unique violation)로 실패한다.
- *검증*: SQLAlchemy로 직접 insert 2회 시도, 두 번째가 IntegrityError.

### TS3: non-NULL play_group_id는 기존 제약 유지
1. play_group_id가 서로 다른 두 행(같은 window_index)은 충돌하지 않고 둘 다 저장된다.
2. play_group_id 동일 + window_index 동일은 기존 제약으로 충돌한다.
- *검증*: 기존 `uq_eeg_feature_window` 동작 회귀 없음.
