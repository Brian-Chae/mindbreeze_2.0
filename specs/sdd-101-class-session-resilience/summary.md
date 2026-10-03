# [SDD-101] — Summary

## What Was Built

클래스 세션 종료·강제종료 시 발생하는 **종료 지연 제거 + 수집 데이터 유실 방지 + 상태 전이 원자화** (4 Phase).

| Phase | Action | File | Description |
|---|---|---|---|
| A | Edit | `backend/app/services/audio_service.py` | STT·요약 발행을 `finalize_on_session_end` 1곳으로 단일화. `/audio/stop`은 마킹만. `_build_pipeline_tasks` 헬퍼 |
| A4 | Create | `backend/app/models/pipeline_outbox.py` | `PipelineOutbox` 모델 — 발행 의도를 세션 상태 전이와 같은 트랜잭션으로 durable 기록(멱등키 겸용) |
| A4 | Create | `backend/app/tasks/pipeline_outbox_task.py` | `process_pipeline_outbox` beat 스윕(30s) — 미발행 pending 재발행 + 백오프 + MAX_ATTEMPTS 초과 시 failed |
| A4 | Edit | `backend/app/core/celery_app.py` | `include` + `beat_schedule['process-pipeline-outbox']`(30s) |
| A | Edit | `backend/app/tasks/{stt,summary,video,report,upgrade_narrative_cache}.py` | `@shared_task` → `@celery_app.task` 명시 바인딩 |
| A | Edit | `backend/app/tasks/report_email_task.py` | `email_app = Celery(..., set_as_current=False)` — current_app 탈취 방지 |
| B | Edit | `backend/app/services/session_service.py` | `transition_status`를 CAS UPDATE(`WHERE status IN (allowed)`)로 교체 + `join_session` CAS 통일 + `_close_out_media_on_cancel` |
| C1 | Edit | `backend/app/models/record.py` | `AudioChunk`/`VideoChunk`에 `UNIQUE(session_id, chunk_index)` — 멱등 업로드 |
| C1 | Edit | `backend/app/services/{audio,video}_service.py` | `save_chunk` 멱등화(기존 청크 있으면 중복 저장 안 함) |
| C4 | Edit | `backend/app/models/record.py` | `SessionRecord.video_expected_chunks` — 병합 50% 규칙의 정확한 분모 |
| C4 | Edit | `backend/app/services/video_service.py` + `api/v1/video.py` + `schemas/record.py` | `/video/stop`이 `expected_count` 받아 누락 인덱스 반환 |
| C5 | Edit | `backend/app/services/video_service.py` | `merge_video_chunks` 갭 감지 + 50% 미만 시 `merge_failed` + `video_s3_key` 보류 |
| D1 | Edit | `backend/app/services/record_service.py` + `schemas/record.py` | 기록지 응답에 `video_status`/`video_expected_chunks`/`video_actual_chunks` 노출 |
| C3 | Create | `frontend/src/lib/api/upload-helper.ts` | multipart 업로드 15s timeout + 5xx/타임아웃 3회 재시도 |
| C3 | Edit | `frontend/src/lib/api/{audio,video}.ts` | 업로드 함수를 재시도 헬퍼로 리팩터 |
| C4 | Edit | `frontend/src/hooks/useVideoRecorder.ts` + `pages/sessions/ClassPlayerPage.tsx` | `getExpectedCount()` → 종료 시 `expected_count` 전달 |
| D3 | Edit | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 종료 확정 실패 시 `endFailed` + **종료 재시도 CTA** |
| D1 | Edit | `frontend/src/pages/records/SessionRecordPage.tsx` | 영상 저장 미완료 안내 배너 |
| D4 | — | `ClassPlayerPage.tsx` | 종료 후 `/record` 즉시 이동(기존 완료) |

### 마이그레이션 (3건, 단일 head `e036a0000025`)
| Revision | 내용 |
|---|---|
| `e036a0000023` | `pipeline_outbox` 테이블 |
| `e036a0000024` | `uq_{audio,video}_chunk_session_idx` UNIQUE (기존 중복 ctid 격리) |
| `e036a0000025` | `session_records.video_expected_chunks` |

## Test Results

| 검증 | 결과 |
|------|------|
| 신규 `test_sdd101_pipeline_outbox.py` | ✅ 아웃박스 기록·재발행·failed 마감 |
| 신규 `test_sdd101_chunk_reliability.py` | ✅ 멱등·50%·merge_failed·expected_count·누락인덱스·기록지 무결성 필드 |
| 전체 `pytest` | ✅ **968 passed, 12 skipped** |
| 프론트 `tsc -b` + `vite build` | ✅ 통과 |

## Debugging Journey

- **`@shared_task` 오바인딩 (핵심)**: `report_email_task.py`의 `email_app = Celery("report_email", ...)`가 `celery._state.current_app`을 탈취 → stt/summary/video/report 태스크가 `celery_app`이 아닌 `email_app`에 바인딩되어 eager·등록 어긋남. `set_as_current=False` + `@celery_app.task` 명시 바인딩으로 해결(`stt_task.app is celery_app: True` 확인).
- **eager 모드 리마인더 회귀**: `task_always_eager=True`가 ETA 예약 리마인더 태스크를 즉시 실행해 `test_sdd097`/`test_sdd085` 실패. 1차 시도(opt-in `celery_eager` fixture)는 인라인 폴백 제거 후 파이프라인 테스트 29건을 깨뜨려 롤백 → **전역 eager 복원 + 리마인더 ETA 발행 `apply_async` mock**. 최종 무회귀.
- **`UnboundLocalError: cannot access local variable 'Session'`**: `finalize_on_session_end` except 블록의 중복 로컬 `import`가 `Session`을 함수 로컬화 → 중복 import 제거.
- **finalize 예외 삼킴**: `except: pass` → `logger.exception(...)`.
- **C1 recording_id 단순화**: 계획은 `recording_id + checksum + UNIQUE(recording_id, chunk_index)`였으나, 프론트 확인 결과 `indexRef`가 pause/resume·카메라 전환 시에도 **이어가므로**(reset 없음) `UNIQUE(session_id, chunk_index)`로 충분 → 단순화. `recording_id` 세그먼트 구분은 재접속 시 새 녹음과의 index 충돌 해결용으로 다음 SDD 유보.

## Notes for Reviewer

- **배포 순서**: `alembic upgrade head`(3건) → Celery 워커 재시작(신규 태스크·`@celery_app.task` 변경·`include` 변경) → 프론트 배포.
- **D2(누락 재전송 CTA) 유보**: 재전송은 실패 청크 IndexedDB 영속이 선행돼야 하고, 재접속 후 새 녹음과 동일 `chunk_index`가 충돌 → `recording_id` 세그먼트 구분이 필요. Brian 결정 #3 "재접속 복구만" MVP 범위 밖.
- **Brian 결정 6건(`07-decisions.md`)**: (1) 고아 유예 24h+폐기 확인 (2) 부분 정상 50%+상담사 리뷰 (3) 재접속 복구만 (4) 단일 EC2+systemd (5) 아웃박스 (6) `/record` 이동.
- **아웃박스 멱등**: 아웃박스 행이 발행 멱등키 겸용 — beat 스윕이 중복 발행하지 않는다.
