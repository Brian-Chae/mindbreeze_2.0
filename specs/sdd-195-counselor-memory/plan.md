# [SDD-195] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** 루시가 상담사와의 최근 대화를 컨텍스트로 로드해 맥락을 기억한다.

**Architecture:**
```
상담사 메시지 → build_reply → counselor_context → recent_messages(최근 20개)
        → counselor_context_to_text → "■ 최근 대화" 블록 → LLM 프롬프트
```

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/agent_policy.py` | `counselor_recent_messages` 추가, `counselor_context` 에 `recent_messages`, `counselor_context_to_text` 에 블록 |

## Tasks

### Task 1: 최근 대화 조회
**Objective:** `counselor_recent_messages` — 최근 상담사↔루시 메시지(최대 20개)
**Files:** `backend/app/services/agent_policy.py`
**Estimate:** 10min

### Task 2: 컨텍스트·직렬화 반영
**Objective:** `counselor_context`·`counselor_context_to_text` 에 최근 대화 포함
**Files:** `backend/app/services/agent_policy.py`
**Estimate:** 10min

## Testing Strategy
- `./venv/bin/python -m pytest tests/test_agent_counselor_api.py tests/test_agent_counselor_briefing.py tests/test_agent_policy.py`
- 전체 `pytest` 회귀 확인
