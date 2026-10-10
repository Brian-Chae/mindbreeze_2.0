# [SDD-202] — 루시 대화 맥락 상실 수정 (Summary)

## 원인 분석 (Fix)

**증상:** 루시가 "고마워 친구" 같은 짧은 말에 "그 일을 떠올리면 어떤 생각이 드나요?"처럼 **맥락 없는 뜬금없는 응답**을 반복.

**근본 원인 2가지:**
1. **체크인 진행 중 직전 메시지 원문이 프롬프트에 없음** — SDD-194의 `memories`는 체크인 마무리 후에만 생성되는 요약이라, 진행 중인 대화에서는 비어 있음. 루시가 "방금 무슨 얘기했는지" 모르고 `[사용자 입력]` 한 줄만 보고 응답 → "그 일", "그 마음" 같은 지시 대명사 환각.
2. **few-shot "질문 던지기" 과적합** — 5개 예시가 모두 "공감 → 이어가는 질문"으로 끝나, 짧은 인사·감사에도 무조건 질문을 던짐.

## 수정 내용
| File | 변경 |
|------|------|
| `agent_policy.py` | `client_recent_messages`(내담자 채널 최근 N개) + `client_context.recent_messages` + `context_to_text` "■ 최근 대화" 블록 |
| `agent_llm.py` | SYSTEM_RULES에 "짧은 인사·동의에는 질문 억지 금지" + few-shot "고마워 친구" 예시 추가 |

## Test Results
- ✅ `test_agent_memory.py` recent_messages 포함 테스트 통과
- ✅ 전체 `test_agent_*.py` 273건 통과, 회귀 0

## Notes for Reviewer
- 상담사 채널(SDD-195)의 `counselor_recent_messages` 와 대칭 — 내담자 채널에도 최근 대화 맥락 부여
- recent_messages 는 루시 본인과 내담자의 1:1 대화 원문이라, 새 정보 노출이 아니라 루시가 이미 본 내용을 프롬프트에 다시 실은 것
- 저장본·상담사 전달 경로는 기존(요약만) 유지 — 원문 노출 범위 변화 없음
