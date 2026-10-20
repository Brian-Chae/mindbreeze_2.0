# SDD-223 — Summary

## 구현 결과
"현재 열린 회차" 판정을 `recurrence_rule.start_now`에서 **회차 상태(open/in_progress, regular, 숨김 아님)** 로 바꿨다.

- `class_membership_service.live_session()` 신설(seq 최소 열린 회차).
- `invite_members`: 열린 회차에도 `expected` 참여자 생성(정원 체크 유지). 이메일 초대 수신자의 코드 입장(`via="code"`)도 같은 함수라 함께 해결.
- `_activate_future`(대기 승격·재가입): 열린 회차 포함.
- `class_effect_service._deliver`: `class_invited` 알림과 이메일 본문의 "지금 입장 가능"·입장 링크를 `start_now` 무관하게 적용.
- `queue_class_effects`: 열린 회차가 있으면 즉시 발송.
- 응답에 `current_session_id` 가산.

## API 계약 (프론트 sdd/223-fe)
| API | 추가 필드 |
|---|---|
| `POST /classes/{id}/members` | `current_session_id: string \| null` |
| `POST /classes/{id}/email-invites` | `current_session_id: string \| null` |

입장 URL: `/class/{current_session_id}/enter`. 기존 필드·에러 코드 변경 없음. 멱등 재생 시 최초 응답 값이 재생된다.

## 마이그레이션
없음(스키마 변경 불필요).

## 기존 테스트 수정 1건
`tests/pg/test_sdd216_entry.py::test_legacy_enter_respects_removed_membership_and_counselor_scope`가 "열린 회차에 초대해도 참여자 없음"이라는 옛 동작을 전제해, 회차를 열기 전에 초대하고 참여자를 비운 뒤 열도록 순서만 바꿨다(검증 의도인 '제거된 멤버는 입장으로 참여자를 못 만든다'는 유지).

## 테스트 결과
- 신규 `tests/pg/test_sdd223_live_invite.py` 14건 통과 (조건을 되돌린 변이 시 6건 실패 확인 = 테스트 유효).
- `tests/pg` 전체: 448 통과 / 1 실패. 실패 `test_m0_prequery_pg::…분류_집계…`는 변경을 stash한 상태에서도 동일 실패(기존 문제, SDD-223 무관).
- 관련 SQLite 테스트 8개 파일 50건 통과.
- 참고: `scripts/test-changed`는 워크트리에 `backend/venv`가 없어 시스템 python을 써서 pytest 모듈 오류가 난다 → 메인 레포 venv로 직접 실행함.

## 유의
- 비 `start_now` 클래스에서 열린 회차 정원이 가득 차면 초대 전체가 `409 session_capacity`(미래 회차와 동일 정책, 사용자 결정 "정원 체크 유지").
