# SDD-217 — 클래스 멤버십·출석·보강과 진행 상태 안정화 구현 계획

> 2026-10-19 실행 상태: 사용자 승인 후 `superpowers:subagent-driven-development`로 T00~T11 구현·태스크별 리뷰를 마쳤다. 아래는 구현 전 계획을 보존한 것으로, 체크박스는 실행 결과를 뜻하지 않는다. 실제 검증 및 미측정 항목은 [summary.md](summary.md)를 따른다. 최종 전체 리뷰와 수정분 재리뷰를 통과했으며 Brian의 Stage ⑦ 승인이 남아 있다.

**목표:** 클래스 Phase 4와 216 이월 결함 3건을 검증 가능한 단위로 완성한다.
**구조:** 216의 부모·멤버·회차 모델을 확장한다. 상태 전이는 서비스에, 데이터 계약은 스키마에, 화면은 기존 구조 컴포넌트에 둔다. API·감사·알림 의도는 단일 트랜잭션을 사용한다.
**기술:** FastAPI/SQLAlchemy/PostgreSQL, React 19/TypeScript(현재 lockfile 기준), Socket.IO/LiveKit, pytest/vitest/Playwright.
**Spec:** [spec.md](spec.md). **구현 전 게이트:** [verify.md](verify.md).

## 전역 제약

- Spec·Verify 승인 전 제품 코드·테스트 코드 구현 금지. P01·P03 검토안을 반영한다. P02는 O3로 사용자 확정됐다.
- 전용 워크트리만 수정, 기준 a4acf6ba. 번호 예약 외 제품 커밋·push·PR·배포는 이번 문서 작업에 포함하지 않는다.
- 056 이후 마이그레이션 필요 시 T00 담당 한 명이 생성. 다른 태스크는 모델 추가 필요사항을 T00에 먼저 반영한다. 최종 revision ID는 당시 단일 head 기준으로 정한다.
- participant ID·EEG·리포트 FK 유지. guest를 NULL user_id로 묶지 않는다. LINK BAND 없이 전체 핵심 흐름 제공.
- 고정 잠금 순서: 클래스 → 멤버 ID 오름차순 → 회차 ID 오름차순 → 참가자 ID 오름차순. 외부 메일/푸시는 커밋 후 ClassEffect 소비로 분리.
- 이미 확인된 216 전체 BE CI를 반복하지 않는다. 개발 중 변경 관련 테스트, PR 시 전체 게이트. 문서 단계에는 의존성 설치·제품 테스트 재실행 없음.

## 리뷰 중점

1. 남은 한 자리에 복구·승격·신규 가입 동시 요청 → T02/V03.
2. guest 두 명의 user_id=NULL 및 병합 중 같은 회차 충돌 → T07/V15,V18.
3. 탈퇴 후 리포트 deep link와 미승인/타인 접근 → T09/V26.
4. 종료/재시도/이벤트 순서 역전 → T04/NV08, T06/NV11.
5. 미래 동의 기본값 변경이 명시 override·종료 기록을 덮는 경우 → T08/V21.

## 계약 확정과 파일 소유

T00은 구현 착수 첫 계약 작업이다. 신규 HTTP 경로·DTO는 현행 API와 대조하여 `api-contract.md`에 고정하고 BE/FE가 함께 사용한다. 정본 작성 전 FE가 가짜 응답 형태를 만들어 병행하지 않는다. API·모델·session_service.py는 태스크 간 공유되므로 순차 수정한다. 분담 시 각 서비스/테스트만 별도 워크트리에서 맡고 공유 파일은 통합 담당만 수정한다.

신규 서비스 인터페이스의 검토안(모두 아직 미구현):
- `transition_member(db, class_id, member_id, actor_id, action, operation_key, now) -> ClassMember` (membership). action=leave/remove/restore/rejoin/cancel_waitlist/promote. actor와 capability 서버 검증.
- `mark_attendance(db, session_id, member_id, actor_id, action, reason, operation_key, now) -> SessionParticipant` (attendance). action=excuse/undo_excuse/correct_attended/correct_absent/correct_excused. 시스템 종료는 별도 `finalize_attendance(db, session_id, now) -> None`.
- `assign_makeup(db, class_id, member_id, source_session_id, target_session_id, actor_id, operation_key) -> SessionParticipant` (makeup).
- `merge_guests(db, class_id, source_member_id, target_member_id, actor_id, reason, operation_key) -> ClassMember` (guest). 동일 회차 실제 기록 충돌은 409, 미래 expected 중복은 canonical 매핑·withdrawn 처리로 통합한다.
- 참여 읽기 가산값: `checkin_state=completed/not_completed/unknown`, `presence_state=connected/disconnected/unknown`, 기존 `attendance_status`, 단조 증가 `state_version`. 접근 가능한 호스트/해당 본인에게만 제공. TTL·연결 소유 및 기존 이벤트 이름과의 매핑은 T00 계약에서 고정한다.
- 쓰기 공통: UUID 문자열 검증, 미존재/접근 불가 404, 상태/정원/버전 충돌 409, 입력 오류 422. 새 기능 operation_key는 actor+action+대상 범위에 결합; 같은 키·다른 payload는 409. 기존 endpoint의 오류 형태는 유지한다.

### T00 — 기준선·계약 확정

- 요구: spec.md R1~R6. 검증: DOC-01~04.
- 담당 파일: `specs/sdd-217-class-structure-phase4/api-contract.md (신규)`.
- 연계 파일(순차 통합): `backend/app/api/v1/classes.py, backend/app/schemas/class_parent.py, backend/app/schemas/class_scheduling.py`.
- 테스트: `backend/tests/test_sdd217_contract.py`.
- 처리: 기존 초대 409·guest NULL·회차 UNIQUE·읽기 envelope를 스냅샷으로 대조. 스키마 추가와 API DTO·오류·capability·상태 버전·멱등 키를 확정한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T01 — 본인 영상 재현·수정

- 요구: R6 DEV-01. 검증: NV-01~03.
- 담당 파일: `frontend/src/components/class/player/host/HostLiveKitBridge.tsx, frontend/src/components/class/player/host/HostHeadSlot.tsx`.
- 연계 파일(순차 통합): `frontend/src/hooks/useVideoRecorder.ts, frontend/src/pages/sessions/ClassPlayerPage.tsx`.
- 테스트: `frontend/tests/sdd217-self-view.test.tsx`.
- 처리: 녹화 켬/끔·트랙 교체·장치 복구의 프레임 진행을 먼저 비교. 확인된 원인에만 수정을 한정하고 타이머 렌더에서 재연결·중복 캡처 여부를 검사한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T02 — 멤버 전이·대기열

- 요구: R1. 검증: V01~06, V36.
- 담당 파일: `backend/app/services/class_membership_service.py`.
- 연계 파일(순차 통합): `backend/app/models/class_program.py, backend/app/api/v1/classes.py, backend/app/services/class_effect_service.py`.
- 테스트: `backend/tests/pg/test_sdd217_membership.py`.
- 처리: 클래스→멤버→회차 순서로 잠금을 통일. 전이·미래 출석·감사·승격 의도는 호출자 트랜잭션에서 함께 처리. 중간 flush 실패는 전부 롤백한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T03 — 출석 확정·정정

- 요구: R2. 검증: V07~10.
- 담당 파일: `backend/app/services/class_attendance_service.py (신규)`.
- 연계 파일(순차 통합): `backend/app/services/session_service.py, backend/app/models/session.py, backend/app/api/v1/classes.py`.
- 테스트: `backend/tests/pg/test_sdd217_attendance.py`.
- 처리: entered_at 기반 입장과 종료 훅을 구현. excused 복귀 정원을 잠그고 사후 정정 감사 이벤트를 남긴다. 현재 접속과 출석을 혼용하지 않는다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T04 — 체크인·접속 상태 복원

- 요구: R2, R6 DEV-02. 검증: NV-04~08.
- 담당 파일: `frontend/src/components/class/player/host/host-live-model.ts, frontend/src/components/class/player/host/HostParticipantGrid.tsx`.
- 연계 파일(순차 통합): `backend/app/services/session_service.py, frontend/src/pages/sessions/ClassPlayerPage.tsx`.
- 테스트: `frontend/tests/sdd217-participation.test.tsx`.
- 처리: 서버 스냅샷의 체크인/출석/접속/버전을 구분하여 타입화. 초기 조회와 재접속 복원 후 오래된 이벤트를 무시. unknown과 미입장을 구분한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T05 — 보강 매칭

- 요구: R3. 검증: V11~14, V35.
- 담당 파일: `backend/app/services/class_makeup_service.py (신규)`.
- 연계 파일(순차 통합): `backend/app/models/session.py, backend/app/api/v1/classes.py, backend/app/services/class_write_service.py`.
- 테스트: `backend/tests/pg/test_sdd217_makeup.py`.
- 처리: 동일 클래스·멤버·원결석을 검증하고 중복 예약을 잠금/DB 제약으로 방어한다. 기존 정규 참가 행이 있으면 409. 취소 후 재예약은 원기록 보존.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T06 — 즉시 종료 원자성·화면 갱신

- 요구: R6 DEV-03. 검증: NV-09~12.
- 담당 파일: `backend/app/services/class_rolling_service.py, backend/app/services/session_service.py`.
- 연계 파일(순차 통합): `frontend/src/hooks/use-class-structure.ts, frontend/src/components/class/structure/host-class-views.tsx`.
- 테스트: `backend/tests/pg/test_sdd217_completion.py`.
- 처리: 종료/출석/부모 완료/완료 의도는 단일 트랜잭션. 성공 응답 후 클래스 목록·상세·회원 상세를 재조회하며 롤링/취소/보강의 완료 판정은 분리한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T07 — 비회원 장기 자격·병합

- 요구: R4. 검증: V15~19, V37~38.
- 담당 파일: `backend/app/services/class_guest_service.py (신규)`.
- 연계 파일(순차 통합): `backend/app/services/class_membership_service.py, backend/app/models/class_program.py, backend/app/api/v1/classes.py`.
- 테스트: `backend/tests/pg/test_sdd217_guests.py`.
- 처리: user_id=NULL 조회를 member_id로 대체. 서명된 클래스 자격의 만료/entry_ver를 검증. 병합은 멤버 잠금·참가자 ID 보존·동일 회차 실제 기록 충돌 롤백·미래 expected 중복 정리·양쪽 자격 회수·단회 교환 복구(10분/일회)를 구현한다. canonical 매핑과 guest 기록 읽기 자격을 T00 모델·마이그레이션 소유 범위에 포함한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T08 — 동의·보관·코드

- 요구: R4. 검증: V20~24, V39.
- 담당 파일: `backend/app/services/class_member_consent_service.py (신규)`.
- 연계 파일(순차 통합): `backend/app/services/research_consent_service.py, backend/app/services/retention_sweep_service.py, backend/app/api/v1/classes.py`.
- 테스트: `backend/tests/pg/test_sdd217_consent_retention.py`.
- 처리: 확정된 P02 O3로 구현. 기본 false/미동의, 가입 1회 연구 선택·고지 버전·원동의 증빙 복사, 미래 미입장만 전파, override 보존, 명시적 철회는 기존 경로 적용. 스크럽은 멤버와 사본 원자 처리, 코드 교환/자격 폐기 구분. 기존 내보내기 계약을 회귀 검증.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T09 — 읽기 모델·과거 권한

- 요구: R5. 검증: V25~27.
- 담당 파일: `backend/app/services/class_read_service.py`.
- 연계 파일(순차 통합): `backend/app/schemas/class_parent.py, backend/app/api/v1/classes.py`.
- 테스트: `backend/tests/test_sdd217_read_access.py`.
- 처리: 멤버 상태·출석 요약·보강 상태·capability를 가산하고 left/removed의 본인 승인 리포트 접근을 기존 리포트 권한 경로에서도 검증. 합류 전 메타만 제공.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T10 — 회원·호스트 운영 화면

- 요구: R5. 검증: V28~31, V38.
- 담당 파일: `frontend/src/pages/client/member-classes-page.tsx, frontend/src/pages/client/member-class-detail-page.tsx, frontend/src/components/class/structure/class-members-panel.tsx`.
- 연계 파일(순차 통합): `frontend/src/components/class/structure/member-class-views.tsx, frontend/src/lib/api/class-operations.ts, frontend/src/hooks/use-class-structure.ts`.
- 테스트: `frontend/tests/sdd217-member-operations.test.tsx`.
- 처리: T00 DTO에 맞춰 대기·탈퇴·사전 결석·보강·동의/guest 메뉴를 연결. 성공/409/403/네트워크 실패 및 중복 클릭·계정 전환을 검증. guest 전용 `frontend/src/pages/client/guest-class-membership-page.tsx`(신규)와 `frontend/src/App.tsx` 라우트도 연결한다. 가입→기기 상실→강사 확인→복구→과거 본인 기록을 실제 guest 자격으로 검증한다. 전역 CSS 변경 금지.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

### T11 — 통합 검증·결과 인계

- 요구: R1~R6. 검증: V32~34, DOC-01~04.
- 담당 파일: `specs/sdd-217-class-structure-phase4/summary.md (구현 후 신규)`.
- 연계 파일(순차 통합): `frontend/e2e, backend/tests/pg`.
- 테스트: `frontend/e2e/sdd217-class-membership.mjs (신규)`.
- 처리: 실제 PG+BE 여정·뷰포트·실카메라 증거를 연결. 기존 실패와 신규 실패 분리. 승인된 배포만 수행하며 최신 SHA·스위치·DB head·미검증을 기록한다.
- 입력: T00 계약, 기존 216 실제 데이터 모델. 출력: 이 태스크 요구를 충족하는 서비스/화면과 검증 결과.
- [ ] verify의 해당 ID별 테스트를 작성하고 RED를 확인한다(구현 전에 수행).
- [ ] 위 담당 파일에 최소 구현 후 같은 테스트의 GREEN을 확인한다.
- [ ] 관련 기존 회귀만 실행하고 실패를 기준선/신규로 분류한다.
- [ ] 변경·실행 명령·결과·남은 미검증을 기록한다. 커밋은 승인된 실행 범위에서만 수행한다.

## 실행 명령과 의존 순서

T00 → T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11. T01은 재현 결과가 없으면 원인/수정 완료로 닫지 않는다. T00 계약 승인과 schema 검증 없이 후속 쓰기 구현을 진행하지 않는다.

- BE 초점: `cd backend && pytest tests/test_sdd217_contract.py tests/test_sdd217_read_access.py -q`.
- PG 초점: 마이그레이션 적용한 합성 임시 PostgreSQL에서 `cd backend && PG_SMOKE=1 pytest tests/pg/test_sdd217_*.py -q`. 환경변수는 기존 PG 하네스를 따르고 접속 비밀값을 출력하지 않는다.
- FE 초점: `cd frontend && npx vitest run tests/sdd217-*.test.tsx`.
- 빌드: `cd frontend && npm run build`. DB head: `python3 scripts/check-alembic-heads.py`.
- 실제 BE 통합: `node frontend/e2e/sdd217-class-membership.mjs`(T11에서 기존 E2E 인증·환경 계약을 재사용해 신규 작성). 실제 카메라·외부 전달 검증은 별도 결과를 첨부한다.
- 위 신규 파일/명령은 계획이며 지금 실행한 결과가 아니다. 성공은 종료 코드 0 및 해당 verify 기대값 충족으로 판단한다.

## 자기 검토

R1=T02, R2=T03/T04, R3=T05, R4=T07/T08, R5=T09/T10, R6=T01/T04/T06. 216 인계 NV 12개와 신규 검증 39개·문서 검증 4개를 연결했다. P02는 O3 확정, 상세 HTTP 계약은 구현 전 확인 사항으로 명시했다. summary는 구현 결과 없이 미리 작성하지 않는다.
