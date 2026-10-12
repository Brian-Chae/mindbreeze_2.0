# [SDD-203] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/services/agent_llm.py` | `ChatRequest`, `COMPANION_SYSTEM`(성격+대화 태도+안전선, few-shot 제거), `build_chat_contents/request`, `_request_body`(systemInstruction+턴, temp 0.9), `_call_gemini_chat`, `clip_message`(문장 경계 컷). `generate/generate_stream/_invoke`는 `str | ChatRequest` 수용 |
| `backend/app/services/agent_policy.py` | `context_to_text(include_recent=False)` — 멀티턴 경로에서 `■ 최근 대화` 중복 제거 |
| `backend/app/services/agent_service.py` | 동반자·리포트대화(동기/스트림) 경로를 멀티턴으로 전환, 구 task 규칙 문구 제거 |
| `backend/app/services/agent_checkin.py` | 체크인 응답 경로 멀티턴 전환 |
| `backend/tests/test_agent_llm_chat.py` | TS1~TS6 + 폴백·가드·스트림 본문 검증 (9건) |

## Test Results
- ✅ TS1~TS6: 단위 테스트 통과
- ✅ TS7/TS8: 체크인 대화 TS5·TS16(가드·폴백) 기존 테스트 통과
- ✅ TS9: backend 전체 1736 passed / 12 skipped
- ✅ TS10: dev 서버 Gemini(키 사용)로 구/신 비교 — 스크린샷 대화 재현 시 신 방식은 4개 회사 구체 내용(CEO/CTO/창업)을 집어 받고 "그중 가장 마음 쓰이는 곳은?"으로 맺음. 구 방식은 일반 공감으로 종결. 점심 메뉴 케이스는 구 방식 "저는 ~생각나더라고요"(지어낸 경험) → 신 방식 "저라면 ~"(관점)

## Debugging Journey
- 이력에 이미 저장된 현재 사용자 입력이 포함돼 중복 → 마지막 user 이력과 동일하면 제거
- 로컬 키 없음 → dev 서버에서 새 agent_llm.py만 임시 로드해 실호출 비교(서버 코드·키 출력 없음, 배포 아님)

## Notes for Reviewer
- `agent_guard.sanitize`는 안전 정책이라 유지(문장 단위 제거). 마지막 질문 문장이 금지 패턴에 걸리면 함께 제거될 수 있음 — 로그의 제거 건수로 모니터링.
- 상담사 채널 루시·브리핑·메모리 추출은 기존 `build_prompt` 유지(범위 외).
- 미커밋·미배포 상태.
