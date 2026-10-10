# [SDD-198] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/models/agent.py` | `AgentMemoryItem` 모델 — (client_id, category, key) UNIQUE |
| `backend/alembic/versions/e036a0000041_*.py` | agent_memory_items 테이블 마이그레이션 |
| `backend/app/services/agent_memory.py` | 추출(LLM JSON)·upsert·조회 서비스 |
| `backend/app/services/agent_policy.py` | `structured_memories` + `client_context`·`context_to_text` 반영 |
| `backend/app/services/agent_checkin.py` | 체크인 `close()` 에서 기억 추출 연결 |
| `backend/tests/test_agent_memory.py` | QA 7건 (TS1~TS4) |

## Test Results
- ✅ `test_agent_memory.py` 7건 통과 (추출·저장·갱신·인출·차단)
- ✅ 전체 `test_agent_*.py` 257건 통과, 회귀 0
- ✅ `alembic upgrade e036a0000040:e036a0000041 --sql` 정상 생성

## Debugging Journey
1. `.sdd-counter`가 병렬 워크스트림에 197로 밀려 SDD-196→198로 조정
2. `AgentMemoryItem` 추가 시 `handled_at` old_string 중복(AgentRelayEvent·AgentRiskSignal) → status 필드 포함해 유니크화

## Notes for Reviewer
- 카테고리 4종: `fact`/`preference`/`relation`/`emotion_trend`
- (client_id, category, key) 당 최신 1건 유지 — "자녀" 키는 value 갱신, evidence 병합
- 진단·점수 표현은 `agent_guard.is_blocked` 로 차단, 원문 미저장(근거 message_id만)
- 기억은 루시 대화에만 노출, 상담사 프로파일(AgentProfileItem)과 분리
- LLM 키 없으면 추출 스킵(빈 결과), 체크인 마무리는 실패하지 않음
