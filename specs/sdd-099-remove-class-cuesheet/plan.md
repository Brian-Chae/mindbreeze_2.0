# [SDD-099] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현 진행. 제거 작업은 파일 의존성이 명확하므로 단일 에이전트 순차 구현(멀티에이전트 병렬은 계약 불일치 위험).

**Goal:** 클래스 진행 큐시트 기능을 프론트·백엔드에서 전부 제거.

**Architecture:** 변경 없음(기능 제거). 제거 순서는 BE 모델/스키마 → BE 서비스 → BE 테스트 → BE 마이그레이션 → FE 타입/로직/컴포넌트 → FE 페이지 → FE 테스트.

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/models/session.py` | `Session.cuesheet` 컬럼 제거 |
| Edit | `backend/app/schemas/session.py` | `CuesheetStep`, `CUESHEET_MAX_STEPS`, cuesheet 필드 3곳 제거 |
| Edit | `backend/app/services/session_service.py` | `_cuesheet_steps`/`_copy_cuesheet` + 직렬화·생성·템플릿·복제·수정 cuesheet 제거 |
| Delete | `backend/tests/test_class_cuesheet.py` | 큐시트 QA 테스트 삭제 |
| Create | `backend/alembic/versions/e036a0000022_drop_class_cuesheet.py` | `sessions.cuesheet` drop |
| Delete | `frontend/src/lib/class/cuesheet.ts` | 순수 로직 삭제 |
| Delete | `frontend/src/components/session/CuesheetEditor.tsx` | 생성 폼 작성기 삭제 |
| Delete | `frontend/src/components/class/CuesheetPanel.tsx` | 상담사 플레이어 패널 삭제 |
| Edit | `frontend/src/lib/api/session.ts` | `CuesheetStep`, `CUESHEET_MAX_STEPS`, cuesheet 필드 3곳 제거 |
| Edit | `frontend/src/pages/sessions/SessionCreatePage.tsx` | cuesheet 상태·임포트·폼 제거 |
| Edit | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | `CuesheetPanel` 임포트·렌더링 제거 |
| Delete | `frontend/tests/cuesheet.test.ts` | 로직 테스트 삭제 |
| Delete | `frontend/tests/cuesheet-ui.test.ts` | UI 테스트 삭제 |
| Edit | `docs/클래스-개선-루프-아이디어.md` | 7번 항목 "제거됨" 반영 |

## Tasks

### Task 1: 백엔드 모델·스키마에서 cuesheet 제거
**Objective:** `Session.cuesheet` 컬럼과 Pydantic 스키마의 큐시트 타입·필드 제거
**Files:** `backend/app/models/session.py`, `backend/app/schemas/session.py`
**Estimate:** 10min

### Task 2: 백엔드 서비스에서 cuesheet 처리 제거
**Objective:** `_serialize`/`create_session`/`_create_template`/`_clone_session_config`/`update_session`의 cuesheet 제거 + 헬퍼 2종 삭제
**Files:** `backend/app/services/session_service.py`
**Estimate:** 10min

### Task 3: 백엔드 테스트 삭제 + drop 마이그레이션 추가
**Objective:** `test_class_cuesheet.py` 삭제, `e036a0000022` drop 마이그레이션 생성, `alembic heads` 단일 head 확인
**Files:** `backend/tests/test_class_cuesheet.py`, `backend/alembic/versions/e036a0000022_drop_class_cuesheet.py`
**Estimate:** 10min

### Task 4: 프론트 타입·로직·컴포넌트 제거
**Objective:** `cuesheet.ts`/`CuesheetEditor.tsx`/`CuesheetPanel.tsx` 삭제 + `api/session.ts` 큐시트 타입·필드 제거
**Files:** `frontend/src/lib/class/cuesheet.ts`, `frontend/src/components/session/CuesheetEditor.tsx`, `frontend/src/components/class/CuesheetPanel.tsx`, `frontend/src/lib/api/session.ts`
**Estimate:** 10min

### Task 5: 프론트 페이지에서 큐시트 UI 제거
**Objective:** 생성 폼 큐시트 상태·에디터, 플레이어 패널 제거
**Files:** `frontend/src/pages/sessions/SessionCreatePage.tsx`, `frontend/src/pages/sessions/ClassPlayerPage.tsx`
**Estimate:** 10min

### Task 6: 프론트 테스트 삭제 + 문서 반영
**Objective:** 큐시트 테스트 2종 삭제, 문서 반영
**Files:** `frontend/tests/cuesheet.test.ts`, `frontend/tests/cuesheet-ui.test.ts`, `docs/클래스-개선-루프-아이디어.md`
**Estimate:** 5min

## Testing Strategy
- `cd backend && venv/bin/python -m pytest` — 전체 무회귀
- `cd backend && venv/bin/python -m alembic heads` — 단일 head 확인
- `cd frontend && npm run build` — 빌드
- `cd frontend && npx tsc -b` — 타입 체크
- `cd frontend && npm test` — vitest
