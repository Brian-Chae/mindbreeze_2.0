# [SDD-126] — Implementation Plan

> **For Hermes:** SDD-125 완료 후 순차 진행. Stage ③ Verify 후 구현.

**Goal:** 게스트 유령 참가자 방지(멱등) + 대기열 회원 입장 시 관제 반영.

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/schemas/session.py` | `JoinByCodeRequest`에 `participant_token` 필드 추가 |
| Edit | `backend/app/services/session_service.py` | `join_session_by_code`에 `participant_token` 파라미터 + 게스트 멱등 재사용 + 회원 `is_waitlisted` 해제 |
| Edit | `backend/app/api/v1/session.py` | `payload.participant_token` 전달 |
| Edit | `frontend/src/lib/api/session.ts` | `JoinByCodePayload`에 `participant_token` 추가 |
| Edit | `frontend/src/pages/class-join-page.tsx` | 저장된 `participantToken`을 `joinSessionByCode`에 전달 |

## Tasks

### Task 1: 백엔드 스키마 (schemas/session.py)
- `JoinByCodeRequest`에 `participant_token: str | None = None` 추가.

### Task 2: 백엔드 서비스 (session_service.py)
- `join_session_by_code(..., participant_token=None)` 파라미터 추가.
- 게스트 경로: 토큰 decode → 기존 행 재사용(멱등), 이름·성별·생년월일 갱신.
- 회원 경로: `existing.is_waitlisted` 해제.
- `participant_token` import 충돌 회피(`as make_token`).

### Task 3: API 라우트 (api/v1/session.py)
- `participant_token=payload.participant_token if payload else None` 전달.

### Task 4: 프론트 (session.ts + class-join-page.tsx)
- `JoinByCodePayload`에 `participant_token?` 추가.
- `class-join-page.tsx`: `performJoin`에서 저장된 토큰 전달.

### Task 5: 검증
- `pytest`, `npm run build`.

## Testing Strategy
- 백엔드: `pytest tests/test_session.py` + 게스트 멱등·대기열 테스트 추가.
- 프론트: `npm run build` 0 errors.
