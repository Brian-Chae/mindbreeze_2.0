# [SDD-198] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 승인받고 구현 시작할 것.

**Goal:** 루시가 사실·선호·관계·감정 트렌드를 구조화 기억으로 축적하고 인출한다.

**Architecture:**
```
체크인 마무리(close) → agent_memory.extract_and_store (LLM JSON → upsert)
        ↓ AgentMemoryItem (내담자별 category·key·value)
루시 응답 시 client_context.structured_memories → context_to_text "■ 기억" → 프롬프트
```

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/models/agent.py` | `AgentMemoryItem` 모델 추가 |
| Create | `backend/alembic/versions/*_agent_memory_items.py` | 마이그레이션 |
| Create | `backend/app/services/agent_memory.py` | 추출·upsert·조회 서비스 |
| Modify | `backend/app/services/agent_policy.py` | 구조화 기억 인출 + 직렬화 |
| Modify | `backend/app/services/agent_checkin.py` | close 에 추출 연결 |

## Tasks

### Task 1: 모델 + 마이그레이션
**Objective:** `AgentMemoryItem` (client_id·category·key·value·evidence, (client_id,category,key) UNIQUE)
**Files:** `backend/app/models/agent.py`, alembic 리비전
**Estimate:** 15min

### Task 2: 추출·저장 서비스
**Objective:** `agent_memory.extract_and_store` — LLM JSON 추출(카테고리 4종) → upsert
**Files:** `backend/app/services/agent_memory.py`
**Estimate:** 20min

### Task 3: 인출
**Objective:** `client_structured_memories` + `client_context`·`context_to_text` 반영
**Files:** `backend/app/services/agent_policy.py`
**Estimate:** 10min

### Task 4: close 연결
**Objective:** 체크인 close 에서 `agent_memory.extract_and_store` 호출
**Files:** `backend/app/services/agent_checkin.py`
**Estimate:** 5min

## Testing Strategy
- `./venv/bin/python -m pytest tests/test_agent_policy.py tests/test_agent_checkin_conversation.py tests/test_agent_profile_items.py`
- 전체 `pytest` 회귀 확인
