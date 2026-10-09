# [SDD-195] 상담사 채널 대화 기억

## Goal
루시가 상담사와의 최근 대화를 기억하고, 그 맥락으로 응답하게 한다(D2 "상담사와 AI 대화를 모두 기억"의 상담사 채널).

## Context
- SDD-194에서 내담자 채널 기억(체크인 요약 재사용) 완료
- 상담사 채널은 `agent_counselor_service.build_reply` 가 규칙 의도 + LLM 보조로 응답
- 상담사 채널은 "체크인" 같은 세션 경계가 없어, 최근 대화 메시지를 직접 컨텍스트로 로드하는 방식이 적합

## Scope

### ✅ In-scope
- `counselor_recent_messages` — 최근 상담사↔루시 메시지 조회
- `counselor_context` 에 `recent_messages` 추가
- `counselor_context_to_text` 에 "최근 대화" 블록 추가
- `build_reply` 가 기억을 참조 (기존 counselor_context 사용 경로 자동 반영)

### ❌ Out-of-scope
- 상담사 대화의 누적 요약 저장 (요약 시점·세션 경계가 애매해 원문 참조로 대체)

## Acceptance Criteria
- [ ] `counselor_context` 에 최근 대화가 포함
- [ ] `counselor_context_to_text` 에 최근 대화 블록
- [ ] 상담사가 "아까 물어본 내담자 다시 알려줘" 같은 맥락 질문에 답 가능
- [ ] 기존 규칙 의도(일정·요약·설정) 응답은 그대로 동작 (회귀 없음)
- [ ] `pytest` 관련 테스트 통과

## Dependencies
- SDD-189(상담사 채널), SDD-194(내담자 기억)

## Risks
- 최근 대화가 프롬프트에 과다 포함 → 최대 20개로 제한
- 내담자 이름 등이 공급자로 유출 → 기존 counselor_context 와 동일 수준(이미 LLM 경유)
