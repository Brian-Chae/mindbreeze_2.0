# SDD-214 summary — 클래스·세션 구조 1단계 (상위 구조 기반)

> 2026-10-18 구현·dev 반영 완료. 화면 변화 없음(백엔드 구조 작업). 최종 리뷰(Stage ⑦)는 Brian 대기.

## 구현
- **스키마(리비전 `e036a0000053`~`055`, 단일 head `…055`)**
  - 053 클래스군 4테이블 / 054 상담군 5테이블 / 055 보조 테이블(`session_host_history`) + `sessions`·`session_participants`·`reports` 가산 컬럼 + 제약 일괄.
  - 부모 제약 `ck_sessions_one_parent`(템플릿 예외), 복합 FK 2개, 회차·출석 UNIQUE를 처음부터 부과. DROP·UPDATE 없음.
  - 055 가드: 비템플릿 세션이 남아 있으면 변경 0으로 중단(053·054까지 롤백, 버전 052 유지).
  - `check_migrations` 053~055 모두 `destructive=false`.
- **분류 함수** `session_classifier.classify_session` — 순수 함수. `parent_kind`: `none`·`meditation_class`·`counseling_relationship`·`unclassifiable`(plan §4.1에 허용값 명시).
- **세션 생성 경로** `POST /sessions`·`duplicate`가 부모와 세션을 같은 트랜잭션에서 생성. `PUT` 동기화(세션 행 `FOR UPDATE`), 마지막 가시 세션 숨김 시 클래스 숨김, 호스트 삭제(`admin_service`) 시 가시 세션 0인 클래스 숨김, 클래스 코드 충돌은 실제 충돌 대상만 비움, X0은 롤백 + 공통 500 문구.
- **읽기 API 5종** `/classes`, `/classes/{id}`, `/classes/{id}/sessions`, `/counseling`, `/counseling/{id}` + 세션 응답 가산 필드(`class_id`·`class_title`·`seq`·`area`). 프론트 `SessionDto` 선택 필드. 신규 API의 미존재·접근불가는 동일 404(기존 `/sessions` 불변).
- **데이터 초기화(Z)** `reset-procedure.md`, `scripts/reset_dev_data.py`(dry-run 기본, prod 기본 거부), `scripts/seed_test_accounts.py`.
- **CI 보정** PG 스모크 잡에 전체 의존성 설치, 스냅샷 복원 단계에 초기화 선행(055 가드와 정합). E2E 내담자 목록 테스트는 클래스 0건 빈 안내도 통과.

## plan 보정 (구현 중 확정, plan §16)
`new-run`은 세션·부모를 만들지 않음(TD15 정정) / 클래스 기본값 `planned_session_count=1`·`schedule_mode='fixed'` / PUT으로 `type`·`participant_mode`가 바뀌어도 부모 고정 / 세션 종료 시 클래스 `status` 미연동(Phase 3) / `uq_rel_active_pair`는 `status<>'archived'`(기획 §179 기준, verify CN-7 정정) / `uq_rel_guest`는 비종료 상태만 유일 / 복합 FK는 ORM 미선언 + alembic `include_object` 제외.

## 리뷰와 반영
구현·검증 워커를 분리(claude 구현 / codex 리뷰). 스키마·분류·읽기 API·생성 경로 각각 리뷰, P0·P1 없음, P2 총 12건 전부 반영(동시 PUT 되돌림, 호스트 삭제 고아 클래스, 코드 충돌 범위, 진행률 분모, 404 통일, 테스트를 생성 경로 기반으로 교체 등).

## 테스트 (통합 브랜치, 로컬 직접 실행)
- backend pytest(PG 제외) 3024 passed / 12 skipped / 0 failed
- PG 테스트(`PG_SMOKE=1`, 마이그레이션 적용 임시 DB) 77 passed
- frontend tsc 0 오류, vitest 1686 passed / 11 failed(기존과 동일한 11건)
- CI(PR #15): frontend·backend·backend-pg-smoke 모두 green

## dev 반영 (Brian 승인 하에)
- 초기화: dev DB 전체(63,174행: 세션 218·사용자 18·기관 6)와 Redis 85키 삭제. S3는 미삭제(조사 결과: `eeg-raw/` 1,550개 3MB, `video/` 1,316개 2.2GB, `_server-archive-20261010/` 유지 대상).
- PR #15 머지(`98b275db`) → Deploy Dev: 055 적용, 가드 통과, 서버 alembic `e036a0000055`.
- 재시드: E2E 계정(기관 1·계정 4)과 `counselor@test.com`·`client@test.com`. `E2E_PASSWORD` 시크릿은 무작위 값으로 교체.
- e2e-smoke: 계정 재시드 직후 63 PASS / 1 FAIL(내담자 목록, 클래스 0건 빈 안내) → 테스트 수정 후 Deploy Dev(`7974621d`)의 e2e-smoke 전체 success(통과 63·실패 0).

## 남은 항목
- 후속 정리: 세션 종료·취소 시 클래스 `status` 연동과 guest 강사 `removed` 전환(Phase 3), 비회원 관계·강사 수명 처리(Phase 3), `alembic check` 정보성 17건(기존 드리프트), PG 쿼리 성능 200ms 목표 미측정.
- S3 고아 오브젝트(`eeg-raw/`·`video/`) 삭제 여부 Brian 결정.
- prod 반영(N4): 사전 점검(head·`destructive` 판정·세션 계열 데이터) → 초기화 → 릴리스 승인. 정식 릴리스 전 필요.
- 최종 리뷰(Stage ⑦): Brian 승인 대기.
