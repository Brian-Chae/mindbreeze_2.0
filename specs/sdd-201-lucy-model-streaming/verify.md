# [SDD-201] — Verification (Pre-Implementation)

## Test Scenarios
### TS1 (A1): 루시만 2.5-pro, STT·요약은 flash
- 서버 `settings.agent_llm_model == "gemini-2.5-pro"`, `settings.gemini_model == "gemini-2.5-flash"`

### TS2 (A7): 스트리밍이 thinking 토큰을 건너뛴다
- `generate_stream` 이 `thought=true` 파트는 yield 하지 않고 텍스트만 모은다

### TS3 (A7): 실패 시 폴백
- `generate_stream` 예외 시 fallback 을 yield

### TS4 (A7): SSE 엔드포인트
- `POST /agent/messages/stream` 이 `data: {"token": ...}` + `[DONE]` 흐름

### TS5 (프론트): 스트리밍 표시
- 토큰이 실시간 말풍선으로 채워지고, 완료 후 확정 메시지로 교체

## Edge Cases
- [ ] thinking 유지 → 첫 텍스트는 사고 완료 후 도착(허용)
- [ ] 위험 탐지·리포트 규칙 응답은 단일 토큰으로 흐름
- [ ] 스트리밍 중 진단 표현 → 저장 시 sanitize

## Security Review
- [ ] thinking 토큰이 사용자에게 노출되지 않음
- [ ] 동의 게이트(require_consent) 유지
- [ ] 저장본은 agent_guard.sanitize 통과
