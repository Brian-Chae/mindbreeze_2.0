# [SDD-201] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/config.py` | `agent_llm_model` — 루시 전용 모델(기본 flash) |
| `backend/app/services/report_comment_service.py` | `_call_gemini` model 파라미터 |
| `backend/app/services/agent_llm.py` | model 전달 + `generate_stream`(thinking 토큰 skip) |
| `backend/app/services/agent_checkin.py` | `_respond_prompt` 분리 + `respond_stream` |
| `backend/app/services/agent_service.py` | `_companion_prompt` 분리 + `stream_user_message` |
| `backend/app/api/v1/agent.py` | `POST /agent/messages/stream` (SSE) |
| `frontend/.../agent.ts` | `streamMessage` (AsyncGenerator, SSE 파싱) |
| `frontend/.../ai-agent-page.tsx` | 스트리밍 실시간 표시 → 완료 후 확정 교체 |
| `backend/tests/test_agent_llm_fewshot.py` | generate_stream 테스트 2건 |

## Test Results
- ✅ 백엔드 `test_agent_*.py` 272건 통과, 회귀 0
- ✅ 프론트 `tsc -b` 통과, `vite build` 성공

## Key Decisions
- **A1**: `agent_llm_model` 로 루시만 분리 → 서버 `.env.dev` `AGENT_LLM_MODEL=gemini-2.5-pro`, STT·요약은 flash 유지(비용 절감)
- **A7**: thinking 유지 → `generate_stream` 이 `thought=true` 토큰을 건너뛰고 텍스트만 yield
- 스트리밍은 "완료 후 일괄 표시 → 토큰별 표시"로 개선, 첫 텍스트 지연은 thinking 때문에 유지(허용)
- 저장본은 `agent_guard.sanitize` 통과 후 저장, 프론트는 완료 후 폴링으로 확정 메시지 교체

## Notes for Reviewer
- SSE 엔드포인트는 기존 동기 `POST /agent/messages` 와 병행(회귀 리스크 최소화)
- 위험 탐지·리포트 규칙 응답도 단일 토큰으로 동일 SSE 흐름
- thinking 유지 → 스트리밍의 체감 개선은 "표시 매끄러움" 중심(첫 토큰 지연은 유지)
