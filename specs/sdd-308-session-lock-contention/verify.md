# SDD-308 Verify — 구현 전 QA 게이트 (Stage ③)

> 구현 전 작성. 사후 수정 금지(추가는 날짜·사유 표기). 합격 기준은 숫자. 범위: 서버 수정 1·2·3·5 (4번 측정 배치 합치기 제외). 마이그레이션 금지.

## 0. 구현 전 기준선 (2026-11-05, 로컬 PG16 임시 DB, 회원 10명·100명 동일)
| 대상 | 쿼리 수 | 비고 |
|---|---|---|
| `GET /sessions/{id}` (get_session + add_parent_fields) | **12** | classes 2회·users 2회 조회 |
| `GET /classes/{id}` (get_class_detail) | **18** | `class_role` 3회 반복(회당 users·memberships·instructors 3~4쿼리) |
| `GET /classes/{id}/members` | **6** | 인원 비례 N+1 없음(10명=100명) |
- 쿼리 수는 인원과 무관(상수). 따라서 개선 대상은 **중복 조회 제거**다.

## 1. 합격 기준 (숫자)
| ID | 대상 | 시나리오 | 합격 |
|---|---|---|---|
| V-1-1 | seed 잠금 전 확인 | 이미 시드된 회차에서 `seed_live_state` 호출 | `FOR UPDATE` 문 **0개**, 반환 False |
| V-1-2 | seed 멱등 | 미시드 회차에 40스레드 동시 호출 | 시드 True **정확히 1회**, `session`/`participation` outbox 중복 0 |
| V-2-1 | 잠금 순서(참가자 제거 ↔ 명령) | 제거 경로가 참가자 행을 먼저 갱신한 채 epoch 대기하는 상황 재현 | 교착 **0**(수정 전 재현 시 DeadlockDetected) |
| V-2-2 | 잠금 순서(REST 입장 ↔ entry.enter 명령) | 입장(회차 행 `FOR UPDATE`)과 명령(epoch→참가자→outbox FK)을 교차 실행 | 교착 **0**, 두 쪽 모두 성공 |
| V-2-3 | 측정 저장 상태 재확인 | `ingest_device`가 epoch 잠금 뒤 stream 종료됨 | `stream_not_active` 반환(기존 동작 보존), 기존 `tests/sdd246/ingest` 통과 |
| V-3-1 | 교착 재시도 성공 | `_enter_resolved`가 첫 1~2회 DeadlockDetected | 최종 200, 참가자 행 **1개**, 대기·출석 이력 중복 0, 로그 `lock_retry=n` |
| V-3-2 | 재시도 상한 | 계속 교착 | 시도 **4회**(최초+재시도 3), 이후 503(`lock_busy`) — 500 아님 |
| V-3-3 | 지터 | 재시도 간 sleep | 매 회 **0.05~0.15초** |
| V-3-4 | 비교착 오류 | HTTPException/기타 DB 오류 | 재시도 **0회**, 그대로 전파 |
| V-3-5 | join 경로 | `join_session`도 동일 재시도 | V-3-1·3-2 동일 |
| V-3-6 | 50스레드 동시 입장 | 50명이 같은 회차 `enter_session_as_invited` 동시 | 5xx **0**, 교착 **0**, 참가자 행 50개 |
| V-5-1 | 세션 상세 쿼리 | 100명 회차 | 12 → **≤ 10** |
| V-5-2 | 클래스 상세 쿼리 | 100명 회차 | 18 → **≤ 10** |
| V-5-3 | 멤버 목록 쿼리 | 100명 회차 | 6 → **≤ 6**(증가 금지) |
| V-5-4 | 인원 비례 증가 금지 | 10명 vs 100명 쿼리 수 | 3종 모두 **동일** |
| V-5-5 | 응답 불변 | 수정 전/후 JSON 골든 비교 | 3종 **완전 일치** |
| V-5-6 | 권한 불변 | 비참여자·타 기관·guest | 상태코드·본문 수정 전과 동일 |
| V-5-7 | 캐시 | 이번 변경에 TTL 캐시 사용 여부 | **사용 안 함**(요청 범위 메모이즈만, 요청 종료 시 폐기) |

## 2. 회귀
- `tests/sdd246`·`tests/sdd285`·`tests/sdd306`·`tests/pg` 중 라이브 원장·ingest·참가·입장 관련 전부 통과, 신규 실패 0.
- alembic 변경 0 (`git diff --stat`에 `alembic/` 없음).

## 3. 확인 불가(감독 몫)
- 실부하 100명 재측정(p95 <3초, 교착 0)은 dev 서버 배포 후 감독이 수행한다.
