# [SDD-193] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `backend/app/services/agent_checkin.py` | `active_counselor_ids` 추가(담당 상담사, 안부 스위치 무관), `ensure_checkin_for_conversation` 게이트를 `enabled or active` 로 변경, `started_at` 파라미터 추가(회귀 방지), `REPLY_FALLBACKS`·`respond` task 친근한 톤 |
| `backend/app/services/agent_service.py` | `_companion_reply` + `COMPANION_REPLY_FALLBACKS` 추가(담당 상담사·리포트·일정 없는 내담자 감정 대화), `_build_reply` 에서 `NO_CONTEXT_REPLY` → `_companion_reply` 로 교체, `_route_reply` 에서 `started_at=user_message.created_at` 전달 |
| `backend/app/services/agent_llm.py` | `SYSTEM_RULES` 에 "편안한 친구처럼 경청·공감" 추가 |
| `backend/tests/test_agent_api.py` | 리포트/일정 없으면 안내 응답 → 감정 대화 응답 검증으로 변경 |
| `backend/tests/test_agent_checkin_conversation.py` | "안부 꺼져도 담당 상담사 있으면 체크인" 검증으로 변경 |

## Test Results
- ✅ 내 변경 관련 테스트 60개 통과 (`test_agent_api`, `test_agent_report_chat`, `test_agent_policy`, `test_agent_checkin_api`, 업데이트한 TS4 등)
- ⚠️ 11개 실패는 **시간 의존적 테스트 취약성** (아래 참조, 실제 운영 버그 아님)

## Debugging Journey
1. **결정 1 구현 중 프로파일 테스트 8개가 실패** → 원인 추적 결과 `_checkin_user_texts` 의 `created_at >= started_at` 필터가 방금 저장된 사용자 메시지를 제외.
2. **근본 원인 (회귀)**: 이전 커밋(e9771ac8)에서 `created_at` 을 명시적 `_now()`(마이크로초)로 바꾸면서, `send_user_message` 가 사용자 메시지(T1)를 먼저 저장하고 체크인을 열어(T2>T1) `created_at < started_at` 이 됨. → `ensure_checkin_for_conversation` 에 `started_at` 파라미터를 추가하고 `_route_reply` 에서 `user_message.created_at` 을 넘겨 해결.
3. **잔여 11개 실패**: `H.kst_at(10, 0)` 이 "오늘 10:00 KST" 를 주입하는데, 현재 시각이 새벽이면 미래 시각이 되어 아웃리치로 열린 체크인의 `started_at` 이 사용자 메시지 `created_at` 보다 미래 → 필터가 전부 제외. **실제 운영에서는 started_at 이 항상 과거이므로 발생하지 않음.** 별도 Fix 필요(테스트 시각 주입을 과거로 조정).

## Notes for Reviewer
- 반응형 감정 대화가 모든 내담자에게 기본 ON 됨 (담당 상담사 있으면 체크인 + 프로파일, 없으면 감정 대화만)
- 아웃리치(상담사가 먼저 안부 켜는 정책)는 기존 유지
- 진단·처방·점수·조언 차단(`agent_guard`)은 그대로 유지
- 잔여 11개 테스트 취약성은 별도 Fix로 처리 권장 (CI 시간대에 따라 실패)
