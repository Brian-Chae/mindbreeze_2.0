# [SDD-200] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/services/agent_llm.py` | `FEW_SHOT_EXAMPLES` 상수(우수 응답 5개) + `build_prompt` 삽입 |
| `backend/tests/test_agent_llm_fewshot.py` | QA 5건 (포함·금지 표현·어조·개수) |

## Test Results
- ✅ `test_agent_llm_fewshot.py` 5건 통과
- ✅ 전체 `test_agent_*.py` 270건 통과, 회귀 0

## Debugging Journey
1. TS1 `prompt.index("[허용 자료]")` 비교 실패 — SYSTEM_RULES 안에도 "[허용 자료]"/"[사용자 입력]" 문구가 있어 index 가 꼬임 → "[해야 할 일]" 블록 기준으로 비교하도록 수정

## Notes for Reviewer
- few-shot 5개: 힘듦·분노·기쁨·사랑 질문·외로움 — "공감 → 자기 생각 → 이어가는 질문" 본보기
- 모든 에이전트 프롬프트(체크인·동반자·상담사)에 자동 포함
- 예시 자체도 진단·점수·조언·이모지 없음, 2~4문장·존댓말
- 프롬프트 비대화 방지: 5개로 제한
