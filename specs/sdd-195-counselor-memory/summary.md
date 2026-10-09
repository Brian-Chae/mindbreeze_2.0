# [SDD-195] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/services/agent_policy.py` | `counselor_recent_messages` 추가(최근 상담사↔루시 메시지, 최대 20개), `MAX_CONTEXT_RECENT_MESSAGES` 상수 |
| `backend/app/services/agent_counselor_service.py` | `build_reply` 의 LLM 응답 경로에만 최근 대화 블록 추가 |

## Test Results
- ✅ 관련 테스트 47개 통과 (`test_agent_counselor_api`, `test_agent_counselor_briefing`, `test_agent_policy`)
- ✅ 전체 `test_agent_*.py` 250개 통과, 회귀 0

## Debugging Journey
1. 처음 `counselor_context`·`counselor_context_to_text` 에 recent_messages 를 넣었더니 `test_Security_브리핑_프롬프트에는_excerpt_와_요약_본문이_들어가지_않는다` 가 실패 — 브리핑(자동 생성) 프롬프트에도 최근 대화가 실려 excerpt·요약 본문이 재유출됨.
2. 수정: recent_messages 를 컨텍스트·직렬화에서 빼고, **대화형 응답(`build_reply`) 경로에만** 직접 실어 브리핑 자동 생성에는 노출되지 않게 함.

## Notes for Reviewer
- 상담사 채널은 "체크인" 같은 세션 경계가 없어 요약 대신 최근 메시지 원문(최대 20개) 참조로 구현
- 브리핑(자동)과 대화형 응답을 분리해 excerpt·요약 재유출 방지 (보안 회귀 해결)
- 상담사 본인 대화방(channel=counselor)만 조회 — 타 상담사 대화 격리 유지
