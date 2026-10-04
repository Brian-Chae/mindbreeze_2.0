# TODO — 클래스 비정상 종료 시 세션 상태 방치 정리

> 상태: Backlog (Linear 한도 초과로 이슈 등록 실패 → 본 문서로 대체 기록)
> 시점: 2026-10-02
> 트리거: Brian — "진행 중인 세션이 끝나고 다시 점검하면서 정리"

## 배경

클래스 세션이 비정상 종료(상담사 브라우저 닫힘·서버 다운·네트워크 단절)될 때 세션 상태가 방치되어,
회원 화면 노출·리포트 미발행 등 서비스 품질에 심각한 영향을 준다.

## 현재 상태 (2026-10-02 점검 결과)

| 항목 | 상태 |
|------|------|
| open 방치 | SDD-100에서 open 상태 24h cron 자동 취소로 부분 해결 (배포 완료) |
| in_progress/paused 방치 | 미해결 — 진행 중 상담사 이탈 시 세션 영구 방치 |
| 리포트 미발행 | 비정상 종료 시 세션 리포트 미생성/미발행 가능성 |

## 확인된 인프라·코드 현황

1. **"비정상 종료 안전망"은 재생 정리뿐** — `session_service.py:_notify_session_state`, `session_live_namespace.py:notify_audio_sync`는 BGM·가이드 재생을 멈추는 것뿐, 세션 상태 전이 없음.
2. **WS disconnect 핸들러는 pass** — `session_live_namespace.py:291 disconnect(sid)` 빈 핸들러.
3. **LiveKit webhook 없음** — room participant 이탈 이벤트 미수신.
4. **celery beat 미구동** — dev 서버에 beat 프로세스가 없음(uvicorn + email-worker만). beat_schedule 기반 스윕이 한 번도 실행된 적 없음.
   - SDD-095 `sweep-stale-reports`(리포트 워치독), SDD-097 `sweep-session-reminders`(리마인더 스윕)도 beat에만 등록되고 cron 대체가 없어 미실행 중.
   - SDD-100은 cron 방식(`sweep_stale_open_sessions_cron.py`)으로 전환해 해결.

## 점검 시 TODO

1. 세션 활동 하트비트/마지막 활동 시각이 DB에 남는지 확인 (방치 기준 정의의 전제)
2. in_progress/paused 방치 기준 정의 (마지막 활동 N분 등)
3. 비정상 종료 감지 메커니즘 확정 (WS heartbeat TTL / LiveKit room 이벤트 / polling 스윕 중 택)
4. 리포트 미발행 대응 (비정상 종료 시 리포트 상태 정리·재처리 — SDD-095 워치독과 연계)
5. SDD-095/097 스윕 cron 전환 (celery beat 미구동 대응)

## 참고

- SDD-100: open 방치 자동 취소 (완료, cron 방식) — `specs/sdd-100-auto-close-stale-open-sessions/`
- celery beat 대체 cron 패턴 선례: `backend/cleanup_notifications_cron.py`, `backend/sweep_stale_open_sessions_cron.py`
