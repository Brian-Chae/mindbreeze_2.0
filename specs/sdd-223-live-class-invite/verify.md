# SDD-223 — Verify (구현 전 QA 게이트)

spec.md의 Q1~Q12를 아래 자동 테스트로 검증한다. 테스트는 구현 **전에** 작성해 RED를 확인한다.
실행: `PG_SMOKE=1 DATABASE_URL=postgresql://…@localhost/sdd223_test backend/venv/bin/python -m pytest --confcutdir=tests/pg tests/pg/test_sdd223_live_invite.py`

| QA | 테스트 | 검증 |
|---|---|---|
| Q1 | `test_open_session_gets_expected_participant` | 비 `start_now` 클래스, 회차 open → expected |
| Q2 | `test_in_progress_session_gets_expected_participant` | in_progress → expected |
| Q3 | `test_live_session_capacity_enforced` | max_participants 가득 → 409 session_capacity |
| Q4 | `test_future_and_live_sessions_both_covered` | 열린+미래 회차 모두 |
| Q5 | `test_no_live_session_keeps_future_only` | 열린 회차 없으면 미래만, `live_session`=None |
| Q6 | `test_live_session_helper`, `test_members_and_email_api_return_current_session_id` | 응답 필드 |
| Q7 | `test_class_invited_notification_live_wording` | 문구·링크·params / 열린 회차 없을 때 기존 문구 |
| Q8 | `test_email_invite_body_has_entry_link` | 본문 링크 |
| Q9 | `test_code_entry_member_joins_live_session` | `via="code"` 경로 |
| Q10 | `test_waitlist_activation_covers_live_session` | `_activate_future` |
| Q11 | `test_cancelled_and_hidden_sessions_skipped` | 제외 |
| Q12 | `test_attended_participant_untouched` | 변경 없음 |

회귀: `tests/pg/test_sdd216_*`, `test_sdd217_*` 전체, 루트 `tests/` 중 `scripts/test-changed` 대상.

승인 상태: 사용자 사전 승인(작업 지시에 ①~⑥ 연속 진행 명시).
