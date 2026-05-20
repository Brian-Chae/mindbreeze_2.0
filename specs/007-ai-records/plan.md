# Plan 007 — AI 자동 기록

## 구현 전략
1. **모델 확장**: `SessionRecord`에 status/audio_s3_key/recording_started_at/recording_ended_at 컬럼 추가. `AudioChunk` 신규.
2. **서비스 계층**:
   - `audio_service`: 녹음 시작 (consent 검증, status=recording), 청크 수신 (로컬 임시 저장), 종료 (status=processing, Celery 큐잉)
   - `record_service`: 기록지 CRUD, 편집 이력 누적
3. **Celery 태스크 (stub)**:
   - `stt_task`: 청크 병합 → Gemini STT 호출 시뮬레이션 → transcript 저장
   - `summary_task`: transcript → Claude 요약 호출 시뮬레이션 → ai_summary 저장
   - 테스트 환경에서는 동기 실행되도록 `_run_inline()` 헬퍼 제공
4. **API 라우터**: `audio.py` (start/chunk/stop), `records.py` (record/transcript GET/PUT)
5. **세션 end 훅**: `session_service.transition_status`의 action=end 시 audio_service.finalize 자동 호출
6. **테스트**: pytest 10+ 케이스

## 파일 목록
### Backend
- `backend/app/models/record.py` (수정 — 컬럼 추가, AudioChunk 추가)
- `backend/app/models/__init__.py` (수정 — AudioChunk export)
- `backend/app/schemas/record.py` (신규)
- `backend/app/services/audio_service.py` (신규)
- `backend/app/services/record_service.py` (신규)
- `backend/app/tasks/stt_task.py` (신규)
- `backend/app/tasks/summary_task.py` (신규)
- `backend/app/api/v1/audio.py` (신규)
- `backend/app/api/v1/records.py` (신규)
- `backend/app/api/v1/__init__.py` (수정 — 라우터 추가)
- `backend/app/services/session_service.py` (수정 — end 시 audio finalize)
- `backend/tests/test_audio_record.py` (신규)

### Frontend
- `frontend/src/lib/api/audio.ts`
- `frontend/src/hooks/useAudioRecorder.ts`
- `frontend/src/components/session/ConsentModal.tsx`
- `frontend/src/components/session/RecordingControls.tsx`
- `frontend/src/components/session/MarkerButton.tsx`
- `frontend/src/components/records/RecordView.tsx`
- `frontend/src/components/records/TranscriptView.tsx`
- `frontend/src/pages/sessions/SessionLivePage.tsx`
- `frontend/src/pages/records/SessionRecordPage.tsx`
- `frontend/src/App.tsx` (수정 — 라우트 추가)
