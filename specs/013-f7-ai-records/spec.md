# [SDD-013] F7 AI 기록지 — 음성녹음→STT→화자분리→AI요약

## Goal

세션 진행 중 음성을 청크 단위로 녹음·업로드하고, 세션 종료 시 Gemini Audio(1차)→Whisper+pyannote(2차) STT·화자분리 파이프라인 + Claude(1차)→Gemini(2차) AI 요약을 비동기로 실행하여 **AI 기록지를 자동 생성**한다.

## Figma Reference

없음 (백엔드 파이프라인 + 기존 Live 화면 내 녹음 트리거 확장)

## Context

- **LOO-319 (F5) 완료**: 세션 Live 화면에서 녹음 시작/중지 트리거 가능해짐
- **후행**: LOO-321 (F8 AI 리포트) — 기록지 기반 리포트 생성
- **AI 스택**: `docs/AI_STACK_DECISION.md` v1.0.0에 따라 Gemini Audio(1차), Whisper+pyannote(2차), Claude 요약(1차), Gemini 요약(2차)
- **기존 Spec**: `specs/007-ai-records/` 에 초안 존재 → SDD-013으로 정식화
- **비동기 인프라**: Celery + Redis 이미 구성됨 (F5에서 celery worker 확인)

## Scope

### ✅ In-scope

- **F7.1 세션 녹음**: `POST /audio/start` (동의 검증), `POST /audio/chunk` (청크 업로드, 5초 간격), `POST /audio/stop` (종료 → 파이프라인 트리거)
- **F7.2 STT + 화자분리**: Celery 체인 (merge_chunks → transcribe → diarize)
  - Gemini Audio (1차): STT + speaker segments 단일 API
  - Whisper large-v3-turbo + pyannote.audio 3.1 (2차 폴백)
- **F7.3 AI 기록지**: Celery 체인 계속 (summarize → generate_record)
  - Claude (1차): JSON 구조화 요약 (주제·감정·소견·권고·진행단계)
  - Gemini (2차 폴백)
- **SessionRecord 모델**: `status`, `audio_s3_key`, `transcript_json`, `ai_summary`, `counselor_notes`, `is_edited`, `edit_history`
- **AudioChunk 모델**: `session_id`, `chunk_index`, `file_path`, `size_bytes`, `created_at`
- **WebSocket 상태 브로드캐스트**: merging → transcribing → diarizing → summarizing → completed/failed
- **기록지 UI**: AI 요약 탭 + 전사문 탭 + 상담사 메모 탭, 수정 및 수정 이력

### ❌ Out-of-scope

- F7.4 마커 (P1, F5에서 일부 구현 완료)
- 음성 파일 장기 보관 정책 (S3 수명 주기)
- F8 리포트 생성 (LOO-321)
- 실제 Gemini/Claude API 연동은 MVP1 중반 — 현재는 stub/모의 응답으로 파이프라인 검증

## Acceptance Criteria

- [ ] `POST /sessions/{id}/audio/start` — 동의 없으면 400, host 아니면 403
- [ ] 5초 간격 청크 업로드 → S3/로컬 저장 → chunk_index 순차 누적
- [ ] `POST /sessions/{id}/audio/stop` → Celery 체인 시작, SessionRecord.status = processing
- [ ] Celery 체인 완료 → transcript_json + ai_summary 채워짐, status = completed
- [ ] WebSocket으로 각 단계 (merging→transcribing→diarizing→summarizing→completed) 실시간 브로드캐스트
- [ ] 기록지 GET/PUT API 정상 동작, 수정 시 is_edited=true + edit_history 누적
- [ ] Gemini 1차 실패 시 Whisper+pyannote 2차 폴백 자동 전환
- [ ] Claude 1차 실패 시 Gemini 2차 폴백 자동 전환
- [ ] `npm run build` 0 errors (frontend)
- [ ] 백엔드 pytest 통과

## Dependencies

- **선행 완료**: LOO-319 (F5 세션 관리) — 녹음 트리거, Live 화면
- **외부 API**: Gemini Audio, Whisper, pyannote, Claude — API 키는 `.env.dev`에 설정
- **인프라**: Celery worker + Redis (기존 docker-compose.dev.yml에 포함)
- **저장소**: S3 또는 로컬 파일시스템 (dev: 로컬 `./data/audio/`)

## Risks

| 리스크 | 영향 | 대응책 |
|--------|------|--------|
| Gemini API 불안정 | STT 지연/실패 | Whisper+pyannote 폴백 자동 전환 |
| 30분 음성 처리 시간 | NFR-03 5분 초과 | 청크 병렬 처리 검토, Gemini Audio 우선 |
| 한국어 화자분리 정확도 | 식별 오류 | Speaker count hint 제공, 2인 기준 90%→80% 현실 목표 |
| Celery worker OOM | EC2 t4g.medium 4GB | 청크 단위 처리, GPU 불필요 (API 기반) |
