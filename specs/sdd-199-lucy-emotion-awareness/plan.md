# [SDD-199] — Implementation Plan

**Goal:** 루시가 감정 톤·강도를 감지해 공감 정확도를 높인다.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Create | `backend/app/services/agent_emotion.py` | 감정 사전 + `detect_emotion` + 직렬화 |
| Modify | `backend/app/services/agent_service.py` | `_companion_reply` 감정 신호 주입 |
| Modify | `backend/app/services/agent_checkin.py` | `respond` 감정 신호 주입 |
| Create | `backend/tests/test_agent_emotion.py` | QA |

## Tasks
1. **Task 1: 감정 감지 서비스** — `agent_emotion.detect_emotion(text) -> {emotion, intensity}`, 6종+중립
2. **Task 2: 프롬프트 주입** — `_companion_reply`/`respond` 에서 최근 메시지 감정 → "■ 현재 감정"
3. **Task 3: 테스트** — 감지·중립·강도·프롬프트 포함

## Testing
- `./venv/bin/python -m pytest tests/test_agent_emotion.py tests/test_agent_*.py`
