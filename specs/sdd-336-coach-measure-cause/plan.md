# SDD-336 — Plan

## Architecture
- 서버: 신규 `app/services/measure_cause_service.py`(순수 판정 + 배치 로더) → `get_live_metrics` 에서 1회 호출해 `measure_issue_reason` 부착. 스키마 `SessionLiveMetric.measure_issue_reason` 1필드.
- 푸시: 같은 서비스의 `enqueue_measure_nudges(db, now)` — 기존 1분 cron `process_push_outbox_cron.py` 에서 outbox 처리 직전에 호출(신규 cron·마이그레이션 0). 중복 제한은 `session_reminder_logs`(channel=`push_nudge`, offset_min=-1/-2)로 한다.
- 소켓: `session_live_namespace` `on_join` 의 KeyError 방어, `live_ingest_service` 방송 TimeoutError 를 한 줄 경고로.
- 리포트: `report_progress_service.generation_status_for_content` 에서 `excluded` 사유는 결함이 아니므로 ready.
- 웹: `measure_issue_reason` 을 api 타입 → live-legacy-adapter → host-live-model → `HostParticipant.measureIssueReason` → 카드/상세 문구(`host-player-case.ts` 순수 함수).

## Files to Change
| Action | File | Description |
|---|---|---|
| Create | backend/app/services/measure_cause_service.py | 판정·앱버전 비교·넛지 적재 |
| Modify | backend/app/schemas/session.py, services/session_service.py | 필드·부착 |
| Modify | backend/process_push_outbox_cron.py | 넛지 적재 호출 |
| Modify | backend/app/ws/session_live_namespace.py, services/live_ingest_service.py | 소켓 무해화 |
| Modify | backend/app/services/report_progress_service.py | excluded → ready |
| Modify | frontend/src/lib/api/session.ts, session-live/live-legacy-adapter.ts, class/host-player-case.ts, player/host/host-live-model.ts, HostParticipantGrid.tsx, HostPersonParts.tsx | 라벨 |
| Create | backend/tests/test_measure_cause.py 외 | 시험 |

## Tasks
1. 판정 순수 함수 + 시험(RED→GREEN) 2. 배치 로더 + get_live_metrics 연결 3. 넛지 적재 + 시험 4. 소켓·partial 수정 + 시험 5. 웹 라벨 + vitest 6. 전체 시험·PR·머지·dev 실측

## Testing Strategy
backend `pytest tests/test_measure_cause.py tests/test_measure_not_started.py` + 관련(report_progress·deploy templates), frontend `vitest`·`tsc -b`·`eslint`.
