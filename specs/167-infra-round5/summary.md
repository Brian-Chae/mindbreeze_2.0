# SDD-167 — 중(중) 인프라 9건 요약

## 구현 결과

9건 완료(INFRA-06 기완료 제외).

| 영역 | 변경 |
|---|---|
| cron | upgrade_narrative_cache 등록·env export |
| 배포 | 롤백 trap·concurrency·alembic.ini 번들 |
| CI | || true 제거·develop 트리거 |
| 스케줄 | beat_schedule 제거(cron 단일) |
| 프로비저닝 | ec2-setup venv·systemd |
| 설정 | env_file 소스 선택 |

## 검증

- 백엔드 `pytest -q` **1194 passed / 12 skipped / 0 failed**
