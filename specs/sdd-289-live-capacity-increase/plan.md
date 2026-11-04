# SDD-289 plan — 클래스 단위 정원 늘리기 (해결안 B)

## 방향
경로 a는 우회 불가(반복 클래스 409)이고 b는 회차를 안 바꾸므로 **전용 증원 API 신설**이 필요하다. 구 세션 API 409 정책(클래스 편성 API로 일원화)은 유지한다.

## 설계
- `POST /api/v1/classes/{class_id}/capacity` (`mutate_class` 재사용: 사용자→클래스 잠금, `operation_key` 멱등, `expected_revision`, 권한 `manage`, 기관관리자 `reason` 필수는 기존 규칙).
- 본문: `{operation_key, expected_revision, capacity, reason?}`.
- 한 트랜잭션 순서: ① 클래스 잠금(mutate_class) ② 비종료 회차(`status in scheduled/ready/open/in_progress`, 숨김 제외) `_sessions_locked`로 잠금 ③ 검증 ④ `cls.capacity` + 해당 회차 `max_participants` 동시 갱신(`participation_version += 1`) ⑤ `_promote_fifo` 호출 ⑥ 감사 기록 ⑦ revision 증가(mutate_class 기본).
- 검증: `new > current`만 허용(줄이기는 별도 단계, 아래). 상한 오프라인 100/온라인 50(기존 `validate_row_settings`·스키마와 동일), 클래스 `status == active`, 종료·취소 회차는 갱신 대상에서 제외, 줄이기 API는 이번 범위에서 제외(요구: 늘리기만). 줄이기 방지는 `new < 현재 active 멤버 수 / 회차 점유 좌석`이면 422 `capacity_below_occupied`로 서버에서 막고 UI는 최솟값을 표시.
- 감사: 신규 테이블 `class_capacity_events(id, class_id, actor_id, old_capacity, new_capacity, promoted_count, reason, operation_key, created_at)` + alembic. (`ClassOperation`은 멱등 용도라 사유·전후값을 구조적으로 못 담아 별도 테이블.)
- 알림: 기존 `class_waitlist_promoted` 효과를 그대로 사용(추가 발송 로직 없음). 대표 결정 7-2(푸시 여부)는 "기존 승격 알림 유지"를 기본값으로 한다.
- 프런트: 상담사 라이브 화면(`HostLiveView` 상단 정보 또는 `HostTopBar`)과 클래스 상세에 "정원 늘리기" 한 동작(현재/대기 표시 + 숫자 입력 + 확인). 금지 표현 사용 안 함. 완료 후 클래스 쿼리 무효화로 인원 숫자 갱신.

## 작업 분할(담당 경로 비중첩)
| 워커 | 담당 경로 | 내용 |
|---|---|---|
| W1 백엔드 | `backend/app/services/class_capacity_service.py`(신규), `api/v1/classes.py`(라우트 1개), `schemas/class_scheduling.py`(명령 스키마), `models/class_scheduling.py` + `backend/alembic/versions/*` | API·서비스·감사 테이블 |
| W2 프런트 | `frontend/src/lib/api/class-structure.ts`, `components/class/player/host/CapacityIncreaseSheet.tsx`(신규), `HostTopBar.tsx`/`HostLiveView.tsx` 최소 연결 | 시트·진입점 |
| W3 테스트(구현자와 분리) | `backend/tests/test_class_capacity_increase.py`(신규), `frontend/src/**/__tests__/capacity-*.test.tsx` | verify.md 시나리오 |

## 위험·롤백
- 위험: 클래스·회차 정원 불일치 잔존(이전에 b로 바뀐 클래스) → 증원 API가 모든 비종료 회차를 새 값으로 맞춤. 승격 중 409 롤백 → 회차 갱신이 승격보다 먼저라 정상 경로에서는 발생하지 않음.
- 롤백: 코드 revert + 마이그레이션 downgrade(테이블 drop, 데이터는 감사 기록뿐). 이미 늘어난 정원은 운영 DB 수동 조정(승인 필요).

## 테스트 계획
`_future_monday_iso()` 패턴으로 미래 날짜를 쓰고 하드코딩 날짜 금지. pytest(SQLite) + 클래스 잠금 직렬화는 PostgreSQL 경로 코드 리뷰로 보완. 배포 전 dev 서버에서 실제 PATCH 아닌 신규 API 호출로 확인.
