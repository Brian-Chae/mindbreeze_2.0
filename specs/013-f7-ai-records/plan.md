# [SDD-013] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** 세션 녹음→STT→화자분리→AI요약 파이프라인 완성 + WebSocket 상태 브로드캐스트 + 기록지 3탭 UI

**Architecture:**

```
[브라우저]                    [FastAPI]                     [Celery Worker]              [DB/S3]
    │                            │                               │                         │
    ├─ MediaRecorder              │                               │                         │
    ├─ 5초 청크                   │                               │                         │
    ├── POST /audio/chunk ────→  ├─ save_chunk()                  │                         │
    │                            ├─ AudioChunk 저장 ───────────────────────────────────→ DB
    │                            │                               │                         │
    ├── POST /audio/stop ──────→ ├─ stop_recording()             │                         │
    │                            ├─ Celery 체인 시작 ──────────→ ├─ merge_chunks          │
    │                            │                               ├─ transcribe (Gemini)    │
    │  ←─ WebSocket 상태 ────────┼───────────────────────────────┤ (merging→transcribing)  │
    │                            │                               ├─ diarize (pyannote)     │
    │  ←─ WebSocket 상태 ────────┼───────────────────────────────┤ (diarizing)             │
    │                            │                               ├─ summarize (Claude)     │
    │  ←─ WebSocket 상태 ────────┼───────────────────────────────┤ (summarizing)           │
    │                            │                               ├─ generate_record ──────→ DB (SessionRecord)
    │                            │                               │                         │
    ├── GET /record ───────────→ ├─ record_service.get() ←──────────────────────────────── DB
    │                            │                               │                         │
    ├─ 기록지 UI (3탭)            │                               │                         │
    │  ├─ AI 요약                │                               │                         │
    │  ├─ 전사문                 │                               │                         │
    │  └─ 상담사 메모             │                               │                         │
```

**Tech Stack:**
- Backend: FastAPI + Celery + Redis + SQLAlchemy (기존 스택 유지)
- STT: Gemini Audio (1차) / Whisper+pyannote (2차) — 현재 stub, API 연동은 후속
- 요약: Claude (1차) / Gemini (2차) — 현재 stub
- WebSocket: Socket.IO (기존 ws/ 인프라)
- Frontend: React 18 + TypeScript + TanStack Query (기존 스택)

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Create | `backend/app/ws/record_namespace.py` | `/record` 네임스페이스 — 처리 상태 브로드캐스트 |
| Modify | `backend/app/ws/__init__.py` | record_namespace 등록 |
| Modify | `backend/app/tasks/stt_task.py` | diarization 분리, WebSocket 알림 추가 |
| Modify | `backend/app/tasks/summary_task.py` | WebSocket 알림 추가, 완료 시 status=completed |
| Modify | `backend/app/api/v1/audio.py` | Celery 체인 트리거로 변경 (동기→비동기) |
| Modify | `backend/app/services/audio_service.py` | stop_recording에서 Celery 체인 호출 |
| Create | `frontend/src/components/records/RecordTabs.tsx` | AI 요약/전사문/메모 3탭 컴포넌트 |
| Create | `frontend/src/components/records/AISummaryTab.tsx` | 구조화된 AI 요약 카드 뷰 |
| Create | `frontend/src/components/records/TranscriptTab.tsx` | 화자별 타임라인 + 검색 |
| Create | `frontend/src/components/records/CounselorNotesTab.tsx` | 상담사 메모 편집기 |
| Modify | `frontend/src/components/records/RecordView.tsx` | 3탭 통합 |
| Modify | `frontend/src/pages/records/SessionRecordPage.tsx` | WebSocket 상태 표시 연결 |
| Create | `frontend/src/hooks/useRecordSocket.ts` | `/record` WebSocket 훅 |
| Modify | `backend/app/schemas/record.py` | WebSocket 이벤트 스키마 추가 |

## Tasks

### Task 1: WebSocket /record 네임스페이스 (백엔드)
**Objective:** Socket.IO `/record` 네임스페이스 생성. 클라이언트가 `subscribe(session_id)`로 구독하면 해당 세션의 처리 상태를 브로드캐스트 받음.
**Files:** `backend/app/ws/record_namespace.py`, `backend/app/ws/__init__.py`
**Estimate:** 10min

### Task 2: STT/Summary 태스크에 WebSocket 연동
**Objective:** `stt_task.py`와 `summary_task.py`에 단계별 WebSocket 이벤트 발행 로직 추가 (`record_status` 이벤트: merging→transcribing→diarizing→summarizing→completed/failed)
**Files:** `backend/app/tasks/stt_task.py`, `backend/app/tasks/summary_task.py`
**Estimate:** 10min

### Task 3: Celery 체인으로 전환
**Objective:** `audio_service.stop_recording()`에서 `chain(merge, transcribe, diarize, summarize).apply_async()` 호출하도록 변경. 동기 실행은 Celery 비활성 시 폴백.
**Files:** `backend/app/services/audio_service.py`, `backend/app/api/v1/audio.py`
**Estimate:** 10min

### Task 4: AI 요약 탭 (프론트엔드)
**Objective:** `AISummaryTab.tsx` — `ai_summary` JSON을 섹션별 카드로 렌더링. headline + sections(주요 주제, 감정 분석, 상담사 소견, 권고사항, 진행 단계) + keywords
**Files:** `frontend/src/components/records/AISummaryTab.tsx`
**Estimate:** 10min

### Task 5: 전사문 탭 (프론트엔드)
**Objective:** `TranscriptTab.tsx` — 화자별 타임라인 (speaker + timestamp + text). 텍스트 검색 필터. segments 배열 렌더링.
**Files:** `frontend/src/components/records/TranscriptTab.tsx`
**Estimate:** 10min

### Task 6: 상담사 메모 탭 (프론트엔드)
**Objective:** `CounselorNotesTab.tsx` — 자유 텍스트 에디터. 저장 시 PUT /record 호출. 수정 이력 표시 (edit_history 타임라인)
**Files:** `frontend/src/components/records/CounselorNotesTab.tsx`
**Estimate:** 10min

### Task 7: RecordTabs 통합 + WebSocket 연결
**Objective:** `RecordTabs.tsx`로 3탭 통합. `useRecordSocket` 훅으로 처리 상태 실시간 표시 (진행바: merging→transcribing→diarizing→summarizing→완료). `RecordView.tsx`에서 기존 단일 뷰 → 탭으로 교체.
**Files:** `frontend/src/components/records/RecordTabs.tsx`, `frontend/src/hooks/useRecordSocket.ts`, `frontend/src/components/records/RecordView.tsx`
**Estimate:** 10min

### Task 8: E2E 테스트 + 배포
**Objective:** EC2에서 녹음→STT→요약→기록지 조회 E2E 파이프라인 검증. `npm run build` 통과 확인. EC2 배포.
**Files:** `backend/tests/test_sdd013_e2e.py`, 배포
**Estimate:** 15min

## Testing Strategy
- `pytest backend/tests/test_sdd013_e2e.py` — E2E: 세션 생성→녹음 시작→청크 업로드→중지→기록지 완료 대기→GET record 검증
- `cd frontend && npm run build` — 빌드 검증
- EC2 라이브 환경에서 API 연쇄 호출 검증
