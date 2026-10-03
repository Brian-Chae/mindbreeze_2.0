# [SDD-101] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현 시작. Brian "진행하라" = Stage ①~⑥ 사전 승인.

**Goal:** 종료 지연 제거 + 수집 데이터 유실 방지 + 상태 전이 원자화 (4 Phase).

**Architecture:**
```
프론트(ClassPlayerPage.handleStop)
  → /audio/stop (stop_recording: 마킹만)
  → /video/stop (save 마감)
  → /end (transition_status 'end' → finalize_on_session_end)
       ├─ 아웃박스 행 삽입(같은 트랜잭션) — 발행 의도 durable 기록
       └─ 단일 정렬 체인 [merge → stt → summary → reports] 발행
              └─ 실패 시 celery beat가 아웃박스 재발행(멱등키로 중복 방지)
```

**Tech Stack:** FastAPI + SQLAlchemy(PostgreSQL) + Celery + Redis. 프론트 React 18 + TypeScript.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/audio_service.py` | stop_recording 마킹화, finalize 소유권 단일화, 리포트 가드 |
| Modify | `backend/app/services/session_service.py` | CAS 전이, join 제거, cancel finalize |
| Modify | `backend/app/services/video_service.py` | recording_id 조회, merge_failed 재병합, 수신 마감 |
| Modify | `backend/app/models/record.py` | AudioChunk/VideoChunk recording_id+checksum+unique |
| Modify | `backend/app/core/celery_app.py` | 아웃박스 발행 beat + include |
| Create | `backend/app/tasks/pipeline_outbox.py` | 아웃박스 발행기 태스크 |
| Create | `backend/alembic/versions/xxxx_chunk_recording_id.py` | 마이그레이션 |
| Modify | `frontend/src/hooks/useAudioRecorder.ts` | stop in-flight 대기 상한 |
| Modify | `frontend/src/hooks/useVideoRecorder.ts` | 업로드 timeout·재시도 예산 |
| Modify | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 종료 실패 복구 CTA·/record 이동 |
| Modify | `frontend/src/lib/report-status.ts` | 저장 미완료 상태 노출 |

## Tasks

### Phase A — 종료 파이프라인 단일화
**A1.** `stop_recording`에서 STT·요약 발행(`stt_task.si`/`summary_task.si`) 제거 → `recording_ended_at` 기록 + `processing` 마킹만. (NameError 버그 제거)
**A2.** `finalize_on_session_end`에 `stt_task`/`summary_task` import(이미 있음) 유지 + `has_recording = status in ("recording","processing")`로 확장(단 `recording_ended_at` 세팅 순서 정리).
**A3.** 리포트 적재 가드: `started_at`/recording/video 중 하나 있을 때만 `generate_reports_for_session` append.
**A4.** 파이프라인 아웃박스: `PipelineOutbox` 모델 + `finalize_on_session_end`에서 같은 트랜잭션으로 발행 의도 기록 + celery beat(`pipeline-outbox-sweep`)로 미발행 건 재발행. 아웃박스 행 = 멱등키(recording_id+task).
**A5.** 운영 경로 인라인 동기 폴백 제거(발행 실패 시 아웃박스가 복구).

### Phase B — 상태 전이 원자성
**B1.** `transition_status`를 조건부 UPDATE로: `UPDATE ... SET status=:to, state_version=state_version+1 WHERE id=:sid AND status IN (:allowed)`. rowcount 0 → rollback + 409 + finalize 생략.
**B2.** `join_session` 직접 `s.status = "in_progress"` 제거 → `transition_status('start')` 라우팅(그룹 start 가드 완화 + `open` 출발 처리).
**B3.** `cancel` 시 미디어·기록 마감(finalize) + 데이터 폐기(상담사 확인 플로우). SDD-100 `sweep_stale_open_sessions`와 정합(빈 리포트 가드로 보호).

### Phase C — 청크 신뢰성·멱등
**C1.** `AudioChunk`/`VideoChunk`에 `recording_id` + `checksum` + `UNIQUE(recording_id, chunk_index)` 추가(EEGRawChunk 패턴). Alembic 마이그레이션(기존 행 recording_id 역산·중복 격리, 단일 head).
**C2.** 병합·STT 조회를 `session_id` → `recording_id` 기준으로 전환.
**C3.** 업로드 대기 상한: 프론트 fetch timeout·재시도 예산 + 미전송 데이터 IndexedDB 영속.
**C4.** 수신 마감 vs 후처리 분리: 종료 요청 `expected_count`, 서버 누락 인덱스 반환, 지각 청크 유예(24h), 유예 만료 시 후처리 발행 주체 명시.
**C5.** `merge_failed` 재병합: 무결성 실패 시 `video_s3_key` 보류 + truncation 로직 수정. 누락 50% 규칙.

### Phase D — 예외 UX(필수)
**D1.** 저장 미완료 표시(기록 목록·스텝퍼).
**D2.** 누락 재전송 CTA.
**D3.** 종료 실패 복구 CTA(미디어 재개 vs 종료 재시도).
**D4.** 종료 후 `/record` 즉시 이동.

## Testing Strategy
- `backend/venv/bin/python -m pytest -q` — 전체 회귀.
- `frontend && npm run build` + `npx tsc -b` — 타입·빌드.
- 기존 테스트 계약 재정의(`test_audio_record.py:247` end 직후 전사 완료 가정 → 미완료로, `test_video_record.py:157` 종료 후 업로드 400 → 유예 내 선언 누락 허용).
