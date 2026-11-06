# SDD-289 분석 — 상담사 화면 정원 증원 경로 판정 (2026-11-04)

## 결론
**지금은 안 된다(아니오).** 구 세션 API는 반복 클래스 회차에서 409로 막히고, 클래스 설정 PATCH는 클래스 정원만 바꾸며 **이미 만들어진 회차의 `max_participants`를 갱신하지 않고 대기열도 승격하지 않는다.** 입장 판정은 회차 값을 읽으므로 증원이 입장에 반영되지 않는다.

## 1. 정원 변경 경로 표
| # | 경로 | 위치 | 바꾸는 값 | 반복 클래스 회차 | 대기열 승격 | 판정 |
|---|---|---|---|---|---|---|
| a | 구 세션 수정 `update_session` | `session_service.py:937-985` | `sessions.max_participants` | `_require_legacy_mutation`(`:929-933`)이 `recurrence_rule` 있는 클래스 소속이면 409 `use_class_scheduling_api` | 있음(`_promote_waitlist_all` `:983`, `:1624`) | 반복 클래스에서 **차단**. 단독(비반복) 회차만 동작 |
| b | 클래스 설정 PATCH `update_class` | `api/v1/classes.py:197`, `class_write_service.py:932-1000` | `classes.capacity`만(`:978-990`) | 해당 없음(클래스 단위) | **없음** (`_promote_fifo` 호출 안 함) | 회차 값 미갱신 → **효과 없음** |
| c | 설정 패널 정원 입력 | `class-settings-panel.tsx:29` (`min=2`, `max=온라인50/오프라인100`) | 위 b 호출 | - | - | 진입점은 있으나 b의 한계 그대로 |
| d | 회차 단독 정원 변경 API | 없음 | - | - | - | **부재** |
| e | 상담사 라이브 화면 `HostLiveView`/`HostLiveContainer` | `components/class/player/host/` | 정원·대기열 표시/증원 진입점 없음(정원 관련 코드는 입력 속성 수준) | - | - | **부재** |
| f | 클래스 상세 | `host-class-detail-page.tsx:37` | 정원 읽기 전용 표시 | - | - | 표시만 |

회차 값이 설정되는 곳은 **회차 생성 시 한 번**(`class_write_service.py:124` `max_participants=cls.capacity`, 롤링 `class_rolling_service.py:47`)과 구 세션 API(`session_service.py:979`)뿐이다(전수 grep). 회차와 클래스 정원은 별개 컬럼(`sessions.max_participants` vs `classes.capacity`)이며 **생성 후 동기화되지 않는다.**

## 2. 정원 판정이 읽는 값
| 판정 | 위치 | 읽는 값 |
|---|---|---|
| 회차 입장 `check_capacity` | `class_attendance_service.py:74-76` | `session.max_participants` |
| 보강/예약 | `class_makeup_service.py:137`, `class_write_service.py:797` | `session.max_participants` |
| 멤버 추가 시 회차 배정 | `class_membership_service.py:86-89`, `:395` | `session.max_participants` → 409 `session_capacity` |
| 클래스 멤버 추가/초대 | `class_membership_service.py:131`, `:355`, `class_write_service.py:953` | `cls.capacity` → 409 `class_capacity` |
| 클래스 대기열 승격 `_promote_fifo` | `class_membership_service.py:440-450` | `_has_seat`(`cls.capacity`), 승격 시 `_activate_future`가 다시 **회차** 정원 검사(`:395`) |
| 구 세션 입장 `_has_capacity` | `session_service.py:1579` | `session.max_participants` |

**어긋남 시 결과**: b로 클래스를 50→60으로 올리면 클래스 멤버는 60까지 받지만 회차는 50에 머물러, 51번째부터 `session_capacity` 409. 반대로 승격(`_promote_fifo`)이 호출되면 `_activate_future`가 409를 던져 승격 트랜잭션이 롤백될 수 있다(추정 — 실제 재현은 구현 후 테스트에서 확인).

## 3. 운영 읽기 전용 확인 (건수·숫자만)
11/10~11/12 범위 회차 1건: 클래스 `status=active`, 오프라인, 반복 규칙 있음, `classes.capacity=50`, 회차 `status=scheduled`·`max_participants=50`, 클래스 active 멤버 25, 대기 0. → **반복 클래스 소속이라 경로 a는 409**, 현재 클래스·회차 정원 일치(50). 40→50 예시와 달리 현재 값은 이미 50이며, 50 초과 증원 시 오프라인 상한(스키마 `le=100`, `schemas/class_scheduling.py:94`) 안이다.

## 4. 증원 후 동작(구현이 따라야 할 기존 동작)
- 승격 알림: 클래스 대기 승격은 `ClassEffect kind=class_waitlist_promoted`(`class_membership_service.py:447`, 문구 `class_effect_service.py:127` "대기 순번 확정 / {title} 클래스에 참여할 수 있게 되었어요."). 구 세션은 `participant_promoted` WS(대상 본인 룸) + 인앱 알림 `session_waitlist_promoted`(`session_service.py:~1650`).
- 진행 중(open/in_progress) 회차가 있으면 `mutate_class`가 `queue_live_reconcile`을 큐잉(`class_write_service.py:~385`)해 접근 상태를 재조정한다.
- 회원 대기 화면이 소켓/폴링 중 무엇으로 갱신되는지, 상담사 화면 인원 숫자 갱신 경로는 **프런트 전수 확인을 못했다**(verify에서 실측 항목으로 둠).

## 5. 막히는 지점 요약
1. 반복 클래스 회차는 구 API 409 (`session_service.py:929-933`).
2. 클래스 PATCH는 회차 정원·대기열을 건드리지 않는다 (`class_write_service.py:978-990`).
3. 회차 정원 단독 변경 API 부재, 라이브 화면 진입점 부재.
4. `update_class`는 전체 `ScheduleInput` 재전송이 필요하고 `rows` 변경은 `use_bulk_schedule_edit`로 막혀(`:942-946`) 행사 중 빠른 한 동작으로 쓰기 어렵다. 기관관리자는 사유 필수(`:362-363`).

## 6. 확인 못 한 것
- 회원 대기 화면·상담사 인원 숫자의 실시간 갱신 방식(프런트 미추적).
- 클래스 PATCH가 프런트에서 실제로 `rows`를 보내는지(설정 패널 저장 payload).
- 승격 롤백 시나리오의 실제 재현(코드 읽기 기반 추정).
- 운영 환경에서 40명 정원 클래스는 조회 범위에 없었다(11/11 1건만 확인).
