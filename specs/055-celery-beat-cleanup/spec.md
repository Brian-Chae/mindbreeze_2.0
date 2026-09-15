# SDD-055 — Celery beat/cron 이중화 정리

> 서사 캐시 주기 업그레이드가 celery beat_schedule과 cron 두 곳에 정의되어 있다.
> 실제 실행은 cron(업그레이드 스크립트)이 담당하므로 beat_schedule을 제거해 단일화한다.

## 1. 배경
- celery_app.py에 `upgrade-narrative-cache-daily` beat_schedule 등록됨.
- 하지만 서버에 celery beat 프로세스가 없고, cron(`upgrade_narrative_cache_cron.py`)이 실제 실행.
- 이중화로 혼란 → beat_schedule 제거, cron 단일화.

## 2. 구현 범위 (BE codex)
- `app/core/celery_app.py`: beat_schedule 제거 (cron이 유일 실행 경로임을 주석 명시)
- `backend/tests/test_upgrade_narrative_cache.py`: beat_schedule 테스트 제거/수정 (cron 스크립트 검증으로 대체)
- `upgrade_narrative_cache_cron.py` 유지

## 3. 완료 기준
- beat_schedule 제거 후 BE pytest 통과
