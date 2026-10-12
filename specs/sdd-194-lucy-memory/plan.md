# [SDD-194] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** 루시가 내담자와의 최근 대화 요약을 기억하고, 응답 시 컨텍스트로 로드해 연속성을 갖게 한다.

**Architecture:**
```
체크인 마무리(close) → AgentCheckin.summary 저장 (기존, 요약은 agent_guard 통과)
        ↓
루시 응답 시 client_context(user_id) → memories (최근 100개 summary)
        ↓
context_to_text → "■ 지난 대화 기억" 블록 → LLM 프롬프트 [허용 자료]
```

**Tech Stack:** FastAPI + SQLAlchemy (백엔드만, 프론트 무변경)

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/agent_policy.py` | `client_memories` 추가, `client_context`에 `memories`, `context_to_text`에 기억 블록 |
| Modify | `backend/app/services/agent_checkin.py` | `respond` 프롬프트에 기억 포함 |
| Modify | `backend/app/services/agent_service.py` | `_companion_reply`에 db·user_id 전달 + 기억 포함 |

## Tasks

### Task 1: 기억 조회 헬퍼
**Objective:** `client_memories(user_id, db, limit=100)` — 최근 체크인 요약 시간순 반환
**Files:** `backend/app/services/agent_policy.py`
**Estimate:** 10min

### Task 2: 컨텍스트·직렬화에 기억 포함
**Objective:** `client_context`에 `memories` 추가, `context_to_text`에 "지난 대화 기억" 블록
**Files:** `backend/app/services/agent_policy.py`
**Estimate:** 10min

### Task 3: 체크인·감정 대화 응답에 기억 반영
**Objective:** `respond`·`_companion_reply` 프롬프트에 기억 포함
**Files:** `backend/app/services/agent_checkin.py`, `backend/app/services/agent_service.py`
**Estimate:** 10min

## Testing Strategy
- `./venv/bin/python -m pytest tests/test_agent_policy.py tests/test_agent_checkin_conversation.py tests/test_agent_api.py tests/test_agent_report_chat.py`
- 전체 `pytest` 회귀 확인
