# [SDD-200] — Implementation Plan

**Goal:** few-shot 예시로 루시 말투를 고정한다.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/agent_llm.py` | `FEW_SHOT_EXAMPLES` + `build_prompt` 포함 |
| Create | `backend/tests/test_agent_llm_fewshot.py` | QA |

## Tasks
1. **Task 1:** `FEW_SHOT_EXAMPLES` 상수 + `build_prompt` 에 삽입
2. **Task 2:** 테스트 — 예시 포함·금지 표현 없음

## Testing
- `./venv/bin/python -m pytest tests/test_agent_llm_fewshot.py tests/test_agent_*.py`
