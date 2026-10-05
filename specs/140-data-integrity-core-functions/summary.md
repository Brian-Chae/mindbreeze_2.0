# SDD-140 — 데이터 무결성·핵심 기능 (7건) 요약

## 구현 결과

3개 그룹 병렬 구현 + 리포트 유일 인덱스 alembic 마이그레이션 추가.

| # | ID | 변경 | 파일 |
|---|---|---|---|
| 1 | STT-01 | 누락 청크 건너뛰기 + 실제 길이 offset | `tasks/stt_task.py` |
| 2 | EEG-01 | 롤업 버킷 (play_group_id, window_index) 분리 | `eeg_rollup_service.py` `report_narrative.py` |
| 3 | DATA-01 | Report 부분 유일 인덱스 + IntegrityError 흡수 | `models/record.py` `report_service.py` `alembic/e036a0000029` |
| 4 | STATE-01 | state_version +1 정상화(인메모리 선반영 제거) | `session_service.py` |
| 5 | DATA-03 | 가입 단일 트랜잭션(flush 통일, commit 1회) | `auth.py` `onboarding.py` `onboarding_service.py` `client_service.py` `refresh_token_service.py` |
| 6 | AUTHZ-01 | PATCH /users/me 온보딩 완료 호출 제거 → 전용 엔드포인트 분리 | `auth.py` |
| 7 | AUTHZ-03 | change_counselor 위임(org_admin 가드 + 감사) + 스키마 | `org.py` `org_service.py` |

## 테스트

- 백엔드 `pytest -q` → **1009 passed / 12 skipped / 0 failed**

## 배포

GitHub Actions Deploy Dev (alembic upgrade head 가 인덱스 적용).
