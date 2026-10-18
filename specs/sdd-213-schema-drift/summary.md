# SDD-213 summary — dev 스키마 ↔ 체인 드리프트 정리 리비전

## 구현
- 리비전 `e036a0000052_sdd_213_schema_drift_cleanup` (`down_revision=e036a0000051`, 단일 head). DR D-01~D-09 를 한 리비전에 멱등 가드로 구현. 삭제 없음, NULL 백필, `downgrade` no-op.
- 제외(결정): D-11 dev 전용 컬럼 5개 보존, B군·모델 변경(E-01~E-11, D-07 모델 `ondelete`) 미포함, D-10/12/13 허용 차이.
- `careers.organization` NULL 채움 값은 `''` (근거: plan §3). dev 의 NULL 은 0건이라 실제로는 작동하지 않는 안전망.
- 하드코딩된 head 단언 3곳을 새 head 로 갱신: `tests/test_sdd210_ci_gates.py`, `tests/test_sdd211_migration_30c1_idempotent.py`(head·리비전 수 85).

## 사전 조회(dev, 읽기 전용)
NULL/중복 해당 항목 전부 0건, careers·qualifications 0행, users 18행, chat_messages 104행. 상세는 plan §3.

## 테스트
- 신규 `tests/pg/test_sdd213_schema_drift.py` (11 케이스): 임시 DB 2개(덤프 픽스처 복원 / 빈 체인 0051까지)에 NULL·배열 값 시드 → `upgrade head` → ① 두 DB 스키마 수렴 ② `read_by` jsonb·NOT NULL·`varchar(200)`·`is_current` 기본값·FK CASCADE·인덱스 ③ NULL 백필·행 보존·배열값 보존 ④ `downgrade 51`+`upgrade head` 재실행 후 스키마 동일(멱등) ⑤ dev 전용 컬럼 5개와 값 보존.
- 구현 전 RED(9 failed) → 리비전 후 GREEN(11 passed) 확인.
- 로컬 PG16 `tests/pg` 전체 19 passed. 기존 SQLite `pytest -q`: head 하드코딩 2건 갱신 후 신규 실패 0.
- CI·Deploy Dev·e2e-smoke·배포 후 해소 확인 결과는 PR 코멘트와 최종 보고에 기록.
