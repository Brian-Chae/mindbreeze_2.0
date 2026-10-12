# [SDD-194] 루시 대화 기억 — 계정별 메모리 (Hermes 방식)

## Goal
루시가 내담자와의 이전 대화를 기억하고, 그 기억을 바탕으로 대화의 연속성을 갖게 한다. 계정별로 대화 요약을 축적하고, 루시 응답 시 최근 기억을 컨텍스트로 로드한다.

## Context
- 현재 루시는 각 메시지를 독립 처리 → 이전 대화 내용을 기억하지 못함
- 체크인 요약(`AgentCheckin.summary`)·프로파일(`AgentProfileItem`)이 이미 존재하지만 **상담사 전용**이라 루시 대화에 안 쓰임
- **Brian 결정**: D1 = 최근 100개 요약, D2 = (b) 상담사·AI 대화 모두 기억 + 상담사 열람

## Scope

### ✅ In-scope
- 내담자별 대화 요약 축적 (기존 `AgentCheckin.summary` 재사용)
- 루시 컨텍스트에 최근 100개 기억 로드 (`client_context.memories`)
- 루시가 "지난번에 ~라고 하셨죠" 같은 연속성을 갖도록 프롬프트에 기억 포함
- 상담사 열람 (기존 `counselor_checkin_summaries` 유지)

### ❌ Out-of-scope
- 상담사 채널(브리핑)의 대화 기억 — 내담자 채널 중심 (상담사 채널은 별도 SDD)
- 원문 저장 (기억은 요약만 — 기존 D1 원칙 유지)

## Acceptance Criteria
- [ ] `client_context`에 최근 체크인 요약(최대 100개)이 `memories`로 포함
- [ ] `context_to_text`에 "지난 대화 기억" 블록이 추가
- [ ] 체크인 응답(`respond`)·감정 대화(`_companion_reply`)도 기억을 참조
- [ ] 위험 표현·진단·점수 차단은 유지 (요약은 `agent_guard` 통과분만)
- [ ] `pytest` 관련 테스트 통과

## Dependencies
- SDD-188(루시 채널), SDD-191(체크인·프로파일), SDD-193(감정 대화 기본 ON)

## Risks
- 기억이 프롬프트에 과다 포함되면 응답 지연·산만 → 최대 100개로 제한 + 간결 직렬화
- 요약에 원문/민감정보 유출 → 기존 `agent_guard.sanitize` 경로 유지
