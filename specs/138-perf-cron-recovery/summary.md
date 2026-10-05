# SDD-138 — 3순위 성능·운영 2건

## 원인 분석

| # | 결함 | 원인 |
|---|---|---|
| PERF-01 | EEG 실시간 모니터링 과부하 | 호스트 4초 폴링이 매번 세션 전체 참가자의 **전체 feature 윈도우**를 Python 으로 로드해 평균·최신을 계산 |
| PIPE-01 | 복구 안전망(celery beat) 미가동 | `celery_app.conf.beat_schedule` 에 5개 주기 태스크가 정의돼 있으나 beat 프로세스가 실제로 구동되지 않음 |

## 변경 내용

**PERF-01 (`session_service.py` `_aggregate_window_stats`)**
- 평균 두뇌휴식도: 전체 윈도우 Python 집계 → **SQL `AVG`(참가자별 `GROUP BY`)** 로 이관.
- 최신 윈도우: 전체 로드 후 `max()` → **`latest_feature_window`(created_at DESC, window_index DESC `LIMIT 1`)** 로 이관.
- 수치 정확성 유지: null 제외 평균(SQL AVG 동일 의미) + pause/resume 재시작 대응(created_at 기준 최신). 부하가 참가자 수에 선형으로만 증가.

**PIPE-01 (cron 스크립트 4개 신설)**
- 기존 `sweep_stale_open_sessions_cron.py` 패턴을 따라 beat 태스크를 직접 호출하는 cron 스크립트 4개 추가:
  - `sweep_stale_reports_cron.py` (리포트 워치독, 5분)
  - `sweep_session_reminders_cron.py` (리마인더 스윕, 5분)
  - `process_pipeline_outbox_cron.py` (파이프라인 아웃박스 재발행, 1분)
  - `cleanup_data_exports_cron.py` (export 만료 정리, 5분)
- `sweep_stale_open_sessions` 는 기존 cron(`*/5`)이 이미 담당 → 변경 없음.
- `.github/workflows/deploy-dev.yml` 수정: 배포 번들에 cron 스크립트 6개 포함 + 주기 스윕 cron 등록 4개 추가(5분×3, 1분×1).

## 검증 결과

| 검증 | 결과 |
|---|---|
| 백엔드 `pytest -q` | **1009 passed / 12 skipped / 0 failed** |
| `py_compile` 수정·신규 파일 | 통과 |
| cron 스크립트 수동 실행 | dev 서버에서 검증(아래) |
