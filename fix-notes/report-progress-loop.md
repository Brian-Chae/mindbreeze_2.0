# report:progress "attached to a different loop" 수정

## 원인
- `sio` = AsyncServer + AsyncRedisManager(첫 이벤트 루프에 Redis 연결이 묶임).
- 동기 컨텍스트(Celery 태스크, FastAPI 스레드풀)가 호출마다 `asyncio.run(sio.emit(...))` 로 새 루프를 만들어 충돌 → `RuntimeError: attached to a different loop`.
- 영향: 리포트 생성은 성공, 실시간 진행 표시(report:progress / record_status)만 유실. dev 로그 10/15~.

## 수정
- 신규 `backend/app/ws/sync_emit.py`: 동기 `socketio.RedisManager(url, channel="mindbreeze", write_only=True)`를 지연 생성·재사용, `emit(..., room=f"session:{sid}", namespace="/record")`.
  - redis_url 미설정 / pytest / Redis 연결 불가 → emit 생략(False). emit 실패 → 경고만, 파이프라인 계속.
  - datetime(updated_at) → ISO 문자열. 이벤트명·room·namespace는 record_namespace.py와 동일.
- `report_progress_service.emit_report_progress`: asyncio.run(_broadcast) 제거 → `emit_report_progress_sync`.
- `stt_task._emit_status`, `summary_task._emit_status`: async → 동기 + `emit_record_status_sync` (asyncio.run 호출 13곳 제거).

## 동일 패턴 목록
- 함께 수정: report_progress_service, stt_task(5곳), summary_task(6곳 → _emit_status 호출 전부).
- 미수정(범위 밖, sio.emit 아님): `class_effect_service.py:138-139` asyncio.run(_refresh_instructor_rooms / reconcile_observers) — 별도 확인 필요. `account_deletion_task.py:24` 은 emit 무관.
- `broadcast_report_progress`/`broadcast_record_status`(async)는 WS 핸들러용으로 유지.

## Verify
- tests/test_report_progress_sync_emit.py (연속 3회 호출·room/namespace/payload·실패 시 False·Redis 없음), test_sdd095 test_18 갱신. 관련 회귀 포함 pytest 통과(22 + 117).
- dev 확인: 배포 후 backend·report/stt worker 로그에서 "attached to a different loop" 미발생, 세션 종료 후 종료 화면 스텝퍼가 실시간 갱신.
