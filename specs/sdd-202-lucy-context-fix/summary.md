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

## 후속 수정 (동문서답 — 인사·감탄사 오해)
- **증상:** "안녕??" 인사에 "그런 마음이 들었군요", "아야야"에 "편안한 순간은 언제인가요" 같은 감정 위로 동문서답
- **원인:** 감정 위로 프롬프트(SYSTEM_RULES + task)가 모든 입력을 감정 표현으로 해석
- **수정:**
  - SYSTEM_RULES: "인사·감탄사에는 감정 해석 금지, 짧은 말에 '그 마음' 같은 해석 덧붙이지 말 것"
  - few-shot: "안녕?? → 반갑게 인사" 예시 추가(총 7개)
  - task(companion/checkin): "인사·감탄사에는 감정 해석하지 말고 자연스럽게 받아 주세요"

## 추가 수정 — LLM 실패 시 고정 폴백 제거 (verify-llm-failure-ux.md)
- 원인: dev 모델 `gemini-3.1-pro-preview` 첫 토큰 7~10s(서버 실측), 스트리밍 read 타임아웃 15s 초과 시
  `REPLY_FALLBACKS` 고정 문구가 문맥과 무관하게 나감.
- 조치: 모델 유지 + 스트리밍 read 타임아웃 40s, 첫 토큰 전 일시 오류 1회 자동 재시도,
  실패 시 `LLMUnavailableError` → SSE `{"error":"llm_unavailable"}`(메시지 미저장·롤백) →
  프론트 "답변을 만들지 못했어요" + [다시 시도]. 로그는 예외 클래스·HTTP 상태만.
- 테스트: `backend/tests/test_agent_llm_stream_failure.py` 11건, `frontend/tests/agent-page.test.tsx` 재시도 시나리오.
- 미변경: 비스트리밍 `POST /agent/messages`(프론트 미사용), 브리핑·리마인더 템플릿.
- 참고: 프론트 vitest 기존 실패 11건(agent-counselor-page 등 6파일)은 본 변경과 무관(baseline 동일).

## 추가 수정 2 — 상담사 연결 제안형 문구 + 채팅 버튼, 타임아웃 60s
- 타임아웃: `AGENT_LLM_TIMEOUT_SEC`·스트리밍 read 60s, `_call_gemini(timeout=)` 신설(기존 내부 공용 15s 때문에
  비스트리밍은 사실상 12s였음), 스레드풀 2→4. 리포트 코멘트 초안 경로는 15s 유지.
- 문구: "상담사님과 이야기해 보세요" → "상담사님과 직접 이야기 나눌 수 있도록 채팅을 연결해 드릴까요?"
  (OUT_OF_SCOPE·SAFE_FALLBACK·SAFE_REPLIES·LLM 프롬프트). 연결 방식 A(이동만)이므로 "상태 전달"은 말하지 않는다.
- 버튼: 최종 응답에 연결 제안 패턴이 있으면 서버가 `talk_to_counselor` CTA 부착(`agent_service.handoff_cta`).
  라벨 "상담사님과 채팅하기". 담당 상담사 없으면 미부착. 후속(B): 대화 요약 전달 + 동의 확인 단계.
- 테스트: `backend/tests/test_agent_handoff_cta.py` 7건. 백엔드 전체 통과(agent 300 + 그 외 1454).
