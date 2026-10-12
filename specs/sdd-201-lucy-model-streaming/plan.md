# [SDD-201] — Implementation Plan

**Goal:** 루시 모델 2.5-pro 전환 + 응답 스트리밍(thinking 유지).

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/config.py` | `agent_llm_model` 추가 |
| Modify | `backend/app/services/report_comment_service.py` | `_call_gemini` model 파라미터 |
| Modify | `backend/app/services/agent_llm.py` | model 전달 + `generate_stream` |
| Modify | `backend/app/services/agent_checkin.py` | `_respond_prompt` 분리 + `respond_stream` |
| Modify | `backend/app/services/agent_service.py` | `_companion_prompt` 분리 + `stream_user_message` |
| Modify | `backend/app/api/v1/agent.py` | `POST /agent/messages/stream` (SSE) |
| Modify | `frontend/src/lib/api/client.ts` | `BASE_URL` export |
| Modify | `frontend/src/lib/api/agent.ts` | `streamMessage` (AsyncGenerator) |
| Modify | `frontend/src/pages/client/ai-agent-page.tsx` | 스트리밍 수신·실시간 표시 |
| Modify | `backend/tests/test_agent_llm_fewshot.py` | generate_stream 테스트 |

## Tasks
1. A1: 루시 전용 모델 분리 + 서버 `.env.dev` `AGENT_LLM_MODEL=gemini-2.5-pro`
2. A7-백엔드: `generate_stream` + SSE 엔드포인트 + `stream_user_message`
3. A7-프론트: `streamMessage` + ai-agent-page 스트리밍 표시
4. 테스트 + 빌드 + 배포

## Testing
- 백엔드: `pytest tests/test_agent_*.py`
- 프론트: `tsc -b` + `npm run build`
