# [SDD-201] 루시 모델 업그레이드(2.5-pro) + 응답 스트리밍

## Goal
루시 성능 향상 2건(투표 4위 A1·A7)을 적용한다.
1. **A1**: 루시 전용 Gemini 모델을 2.5-pro 로 올려 감정 대화 품질을 높인다(STT·요약은 flash 유지).
2. **A7**: 루시 응답을 토큰 스트리밍으로 전달해 체감 지연을 줄인다(thinking 유지).

## Context
- 모델명은 `settings.gemini_model` 로 STT·요약·상담사 코멘트와 공유 → 루시만 pro 로 올리려면 분리 필요
- 현재 `_call_gemini` 는 `:generateContent`(비스트리밍) — 전체 완료 후 반환
- 프론트는 15초 폴링 + optimistic 메시지 + 타이핑 인디케이터
- thinkingBudget=1024 유지 → 사고 완료 후 텍스트 생성 시작(스트리밍은 표시만 매끄럽게)

## Scope

### ✅ In-scope (A1)
- `config.agent_llm_model` 추가, `_call_gemini` model 파라미터, `agent_llm` 전달
- 서버 `.env.dev` 에 `AGENT_LLM_MODEL=gemini-2.5-pro` 설정

### ✅ In-scope (A7)
- `agent_llm.generate_stream(prompt, fallback)` — `:streamGenerateContent`, thinking 토큰 skip, 텍스트 토큰 yield
- SSE 스트리밍 엔드포인트 (기존 동기 엔드포인트 유지)
- 프론트 스트리밍 수신 + 토큰별 렌더링

### ❌ Out-of-scope
- thinking 끄기(유지), STT·요약 모델 변경, 폴링 완전 제거

## Acceptance Criteria
- [ ] 루시가 2.5-pro 로 응답(로깅 확인)
- [ ] STT·요약은 flash 유지
- [ ] 스트리밍 응답이 토큰 단위로 도착
- [ ] thinking 토큰이 사용자에게 노출되지 않음
- [ ] 실패 시 기존 폴백(동기) 동작 유지
- [ ] `pytest` 통과

## Dependencies
- SDD-188(LLM 래퍼), SDD-200(few-shot)

## Risks
- pro 지연·비용 증가 → timeout·thinkingBudget 튜닝 필요
- thinking 유지 시 첫 텍스트 지연은 여전 → 스트리밍은 "완료 후 일괄 표시 → 토큰별 표시" 개선
- 프론트 폴링→스트리밍 구조 변경은 회귀 위험 → 기존 동기 경로 병행 유지
