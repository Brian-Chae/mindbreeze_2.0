# SDD-223 — Plan

## 설계
핵심은 "현재 열린 회차" 판정을 `start_now` 플래그에서 **회차 상태 자체**로 바꾸는 것이다.

1. `class_membership_service.live_session(db, cls)` 신설: `regular`·`hidden_at IS NULL`·`status in (open,in_progress)` 중 `seq` 최소 1건(없으면 None). 알림의 `instant_session` 기준과 동일하게 한다.
2. `invite_members` 회차 조회 조건에서 `start_now` 조건 제거 → `ready/scheduled(미래)` OR `open/in_progress`. `Session.hidden_at IS NULL`은 열린 회차 분기에만 추가(기존 미래 회차 동작 보존).
3. `_activate_future`의 `instant` 판정에서 `start_now` 제거.
4. `class_effect_service._deliver`의 `instant_session`을 `start_now` 가드 없이 `live_session`으로 계산(이메일 본문·`class_invited` 알림 공통).
5. `classes.queue_class_effects`: 열린 회차가 있어도 즉시 dispatch(`start_now` 또는 `live_session`).
6. `api/v1/classes.py` `invite_members`/`invite_emails`의 `apply` 반환에 `current_session_id` 추가.

## 파일 담당 표 (단독 담당)
| 파일 | 변경 |
|---|---|
| `backend/app/services/class_membership_service.py` | `live_session` 신설, `invite_members`·`_activate_future` 조건 |
| `backend/app/services/class_effect_service.py` | `instant_session` 계산 일반화 |
| `backend/app/api/v1/classes.py` | `queue_class_effects`, 두 응답에 `current_session_id` |
| `backend/tests/pg/test_sdd223_live_invite.py` | 신규 PG 테스트 |
| `specs/sdd-223-live-class-invite/*` | 문서 |

alembic 마이그레이션: **없음**(스키마 변경 불필요).

## Task
1. [RED] `tests/pg/test_sdd223_live_invite.py` 작성 → 실패 확인 (Q1~Q12)
2. `live_session` + `invite_members` 수정 (Q1~Q5, Q11, Q12)
3. `_activate_future` 수정 (Q10)
4. `class_effect_service` 일반화 (Q7, Q8)
5. API 응답·즉시 dispatch (Q6)
6. 코드 입장 경로 테스트 (Q9)
7. 기존 `tests/pg/test_sdd216_*`·`test_sdd217_*` 회귀 실행
8. summary.md

## 리스크
- `start_now` 아닌 클래스에서 열린 회차가 정원이 찬 경우 초대 전체가 409. 기존 미래 회차 정원 초과와 동일 정책이라 유지(사용자 결정: 정원 체크 유지).
- 기존 `start_now` 가정을 하는 테스트(`test_sdd216_instant` 등)가 깨지지 않는지 회귀로 확인.
