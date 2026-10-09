# [SDD-194] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/services/agent_policy.py` | `client_memories(user_id, db, limit=100)` 추가(최근 체크인 요약 시간순), `client_context`에 `memories`, `context_to_text`에 "지난 대화 기억" 블록 |
| `backend/app/services/agent_checkin.py` | `respond` 프롬프트를 `client_context` 기반으로 변경(기억·리포트·일정 포함) |
| `backend/app/services/agent_service.py` | `_companion_reply`에 `db`·`user_id` 전달 + 기억 포함 |

## Test Results
- ✅ 관련 테스트 69개 통과 (`test_agent_policy`, `test_agent_checkin_conversation`, `test_agent_api`, `test_agent_report_chat`, `test_agent_profile_items`)
- ✅ 전체 `test_agent_*.py` 250개 통과, 회귀 0

## Debugging Journey
- 새 테이블 없이 기존 `AgentCheckin.summary`(체크인 마무리 시 `agent_guard` 통과분)를 재사용해 구현 — 요약이 이미 "내담자가 무슨 이야기를 했는지"를 담고 있어 루시 기억으로 적합.
- `respond`(체크인 대화)와 `_companion_reply`(담당 없는 감정 대화)는 기존에 "참고 자료 없음"으로 프롬프트를 만들었는데, `client_context` 기반으로 바꿔 기억이 자동 포함되게 함.

## Notes for Reviewer
- 기억은 요약만 (원문 아님), 최대 100개, 본인(client_id) 것만 조회 — D1·프라이버시 유지
- 상담사 열람은 기존 `counselor_checkin_summaries` 로 이미 가능 (D2 충족)
- 상담사 채널(브리핑) 대화 기억은 Out-of-scope — 별도 SDD 필요 시 진행
