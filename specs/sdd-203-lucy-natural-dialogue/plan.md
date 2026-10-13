# [SDD-203][Refactor] 루시 대화를 ChatGPT식 멀티턴으로 전환 — Implementation Plan

**Goal:** 루시(내담자 채널) 답변이 덕담으로 끊기지 않고 대화가 이어지도록, LLM 호출 구조를
"단일 프롬프트 문자열" → "systemInstruction + 실제 user/model 턴"으로 바꾸고 프롬프트를 정리한다.

## 원인 분석 (코드 근거)
- 대화 이력이 시스템 프롬프트의 `■ 최근 대화` 글머리표로만 전달됨 (`agent_policy.py:424`) → 모델이 자기 대화로 인식 못 함.
- Gemini 호출이 `contents:[{parts:[{text: 프롬프트 전체}]}]` 단일 덩어리 (`agent_llm.py`).
- 규칙 충돌("질문은 막힐 때만" vs "대화 이어가기") + 닫힌 끝맺음 few-shot 8개 + "경험 곁들이기"로 지어낸 경험담.
- temperature 0.6, 후처리 800자 하드컷.

## Architecture
- `agent_llm.ChatRequest(system, contents)` 신설. `generate`/`generate_stream`/`_invoke`가 `str | ChatRequest` 모두 수용
  (기존 호출부·테스트 패치 지점 보존).
- `COMPANION_SYSTEM`: 성격 + 대화 태도(받기→나누기→열기, 끝맺음을 LLM이 상황 보고 선택) + 안전선. few-shot 제거.
  경험담 조작 금지, "저라면/듣고 보니/많은 분들이" 관점·관찰 표현.
- 이력은 `contents`의 user/model 턴. 현재 사용자 입력은 마지막 user 턴(DB 선저장분 중복 제거, 역할 교대 정규화).
- `agent_policy.context_to_text(context, include_recent=False)`: 멀티턴 경로에서 `■ 최근 대화` 블록 제외.
- 샘플링: 루시 대화 temperature 0.9 (thinking 1024 유지).
- 후처리: 800자 상한을 문장 경계 컷으로. `agent_guard.sanitize`(안전 정책)는 유지, 동작 점검 결과만 기록.

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/services/agent_llm.py` | ChatRequest·COMPANION_SYSTEM·멀티턴 호출·문장경계 컷 |
| Modify | `backend/app/services/agent_policy.py` | `context_to_text(include_recent)` |
| Modify | `backend/app/services/agent_service.py` | 동반자·리포트대화 경로(동기/스트림) ChatRequest 사용 |
| Modify | `backend/app/services/agent_checkin.py` | 체크인 응답 경로 ChatRequest 사용 |
| Create | `backend/tests/test_agent_llm_chat.py` | 멀티턴·프롬프트·잘림 단위 테스트 |
| Modify | `backend/tests/test_agent_llm_fewshot.py` | 기존 SYSTEM_RULES(few-shot) 테스트는 비채팅 경로용으로 유지 |

## Out of scope
상담사 채널 루시, 브리핑·메모리 추출·요약(`build_prompt` 유지), 리포트 오프닝 질문, 프론트.

## Tasks
1. agent_llm: ChatRequest/COMPANION_SYSTEM/멀티턴 생성·스트림/컷 (15m)
2. agent_policy: include_recent 옵션 (3m)
3. agent_service·agent_checkin: 호출부 전환 (10m)
4. 테스트 작성·전체 agent 테스트 회귀 (15m)

## Testing Strategy
`cd backend && venv/bin/pytest tests -k agent -q`, 실제 Gemini 호출 비교(이번 대화 재현 입력 세트, 키가 있을 때).
