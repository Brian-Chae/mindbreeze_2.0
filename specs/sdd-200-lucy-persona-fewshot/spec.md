# [SDD-200] 루시 페르소나 일관성 + few-shot — 말투 고정 예시

## Goal
루시의 말투·어조를 고정하는 few-shot 대화 예시를 프롬프트에 포함해 응답 스타일의 들쭉날쭉함을 줄인다(투표 3위 A5).

## Context
- 현재 루시 페르소나는 `agent_llm.SYSTEM_RULES` 에 지시문으로만 정의 — 예시가 없어 어조가 일관되지 않음
- ENFP·ENFJ 성향, "공감 → 자기 생각 → 이어가는 질문" 흐름은 지시로 있지만 구체적 본보기가 없음

## Scope

### ✅ In-scope
- `agent_llm.py` 에 `FEW_SHOT_EXAMPLES` 상수 추가(우수 응답 4~5개)
- `build_prompt` 에서 SYSTEM_RULES 뒤에 few-shot 예시 포함

### ❌ Out-of-scope
- 모델 변경, 별도 페르소나 저장소
- few-shot 예시 동적 선정(고정 상수로 충분)

## Acceptance Criteria
- [ ] few-shot 예시가 모든 에이전트 프롬프트에 포함됨
- [ ] 예시가 진단·점수·조언 표현을 포함하지 않음(agent_guard 통과)
- [ ] 2~4문장·존댓말·무이모지 기준 준수
- [ ] `pytest` 통과

## Dependencies
- SDD-188(LLM 래퍼), SDD-193(페르소나)

## Risks
- few-shot 이 프롬프트를 길게 해 지연·비용 증가 → 예시 4개 이내로 제한
