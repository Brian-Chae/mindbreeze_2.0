# SDD-217 최종 통합 리뷰 단일 수정 결과

2026-10-19. Important 4건을 한 수정 단계로 보완했다. 제한된 재리뷰 전이며 커밋·push·merge·배포하지 않았다. 전용 워크트리 밖 제품파일 변경 없음. 주요 수정의 API 재시작은 root가 session2001에서 완료했고 readiness DB/Redis 정상이다. 마지막 read capability 보완 뒤 root가 session32104로 재시작하고 readiness DB/Redis 정상도 확인했다.

## 수정과 근거

1. **P1 종료 후 본인 조회·사후 체크인 403**: `resolve_participant_actor`의 현재 활동 자격 검사에 제한된 `allow_completed` 인자를 추가했다. 정상 completed 회차의 소유 검증 후 `get_entry_state`와 `phase=after`만 사용한다. 제거·철회·superseded·left/removed·타인 접근 차단 및 새 미디어 입장 제한을 유지한다. 신규 PG의 로그인 회원/guest 두 케이스는 실제 HTTP end→entry-state200→after200과 before/다른 participant/left/removed 거부를 검증한다. 외부 미디어·알림 경계만 대체하며 종료 트랜잭션·라우터·PG는 실제다.
2. **P1 057 기존 회차 선택 유실**: 미배포057에서 기존 모든 참가행의 report/research override를 true로 backfill한다. 기존 회차 선택과 기본값 복사를 확정 구별할 수 없으므로 긍정·거절·철회·증빙 없는 값도 보수 보존한다. 신규행 DEFAULT false, 가입 연구 동의 false·origin NULL은 유지한다. 독립 임시 DB에 056 데이터와 실제 ResearchConsent/리포트 선택 이력을 넣고057을 적용한 뒤 클래스 기본값 true→false 변경, 원값·동의ID·시각·철회·고지·export 상태 유지 및 신규행 default를 검증했다. head 재적용도 통과했다. 기존 browser DB의 신규 합성행을 legacy backfill 검증으로 계산하지 않는다.
3. **P2 보강 원결석 무효화**: `_change` 및 실제 entered_at 기록 이전에 유효 reserved/completed 원결석 guard를 둔다. undo_excuse·직접 입장·강사 correct_attended·명시 재초대는409 `makeup_source_in_use`다. reserved는 명시 취소 후 변경 가능, completed는 자동 상태·감사 변경 없이 충돌한다. PG에서 원출석/entered_at/버전/보강상태/감사 원자 보존을 검증했다. **root 승인 예외**: 탈퇴·제외를 차단하지 않고 보강의 원본 excused만 보존한다. 멤버/입장 자격 회수·대상 미래행 withdrawn·비활동 좌석0·재가입/복구 후 원결석 유지도 검증했다. 이탈 후 미래 원행에 excused가 남으므로 운영화면은 멤버 상태·참여 범위를 함께 해석해야 한다. 자체 최종점검에서 개인 보강 대상이 withdrawn으로 남은 채 복구하면 예약취소 UI가 숨는 직접 연쇄를 확인했다. 서버가 이미 허용하는 취소 조건에 capability를 맞추고 leave/remove→rejoin/restore→예약 명시취소→undo_excuse를 검증했다. spec R1/API 계약에 반영했다.
4. **P2 lead/assistant UI 정정 403**: 회차 목록 DTO에 정정 권한이 있는 회차의 participation_version만 노출하고 UI가 이를 사용한다. 전체 participation 권한은 넓히지 않았다. PG에서 서로 다른 lead/assistant/scoped guest session host를 구성해 목록 버전→정정200·동일 재시도, 비host lead/assistant의 전체 participation403을 검증했다. FE에서 그403 조건에도 POST가 전송되고 GET participation이0회임을 확인했다. 최초 버전·revision·operation key·본문 고정 재시도는 유지한다. 버전 미수신 시 정정 저장은 비활성화한다.

## RED → GREEN

- 초기 PG 실행은10실패/1통과였고 그중 guest instructor scope_session_id 누락1개는 fixture 오류다. fixture 수정과 승인된 이탈 예외 회귀 추가 후 기록한 **제품 RED 12실패/1통과**가 `final-fix-pg-red.log`다.
- FE RED **3실패/30통과**: lead/assistant 정정 차단2개와 host의 불필요 participation GET1개. `final-fix-fe-red.log`.
- 최초 GREEN은 PG13/FE33. 이후 HTTP end 보강·재초대 회귀를 포함한 **신규 PG14가 아래 관련 PG172에 포함**된다. 최초 결과와 최종 결과를 합산하지 않는다.
- 준비 중 cwd 경로 불일치3회(테스트 파일 경로, 로그 경로, projection 편집 경로)와 첫 구현의 SQL projection 필드 누락3실패는 제품 RED 수에 더하지 않았다. 모두 보정하고 마지막 관련 회귀에서 통과했다.

- 마지막 직접 연쇄는 PG **2 RED**(`final-fix-cancel-capability-red.log`) 후 신규/읽기 관련 **41 PASS**다. 이41은 앞선172와 포함 관계이며 합산하지 않는다. 첫 준비에서 get_my_attendance의 now 인자 TypeError와 정규 회차 기본 fixture는 보강 재현의 근거로 쓰지 않았고, 실제 session_kind=makeup/복구 후 withdrawn 유지 조건을 명시한 최종 테스트로 확인했다.

## 최종 검증

| 범위 | 결과 | 로그 |
|---|---|---|
| PG 관련8파일: 신규 final_fixes + attendance/makeup/membership/completion/consent_retention/read_access/schema | 172 passed, 5 기존 deprecation warnings | final-fix-pg-regression.log |
| 마지막 취소 capability 보완 후 final_fixes/read_access 2파일 | 41 passed, 1 기존 deprecation warning | final-fix-cancel-capability-green.log |
| SQLite: 기존 subjective_checkin/report_choice +217 contract/read_access | 26 passed, 2 기존 deprecation warnings | final-fix-sqlite.log |
| FE 관련5파일: member_operations/integration_regressions/self_view/member_class_structure/completion | 67 passed | final-fix-fe-regression.log |
| npm run build (tsc -b + vite build) | exit0, 기존 큰 chunk/ineffective dynamic import 경고 | final-fix-build.log |
| git diff --check | exit0 | 최종 명령 확인 |

전체 BE/FE 저장소 회귀를 실행하지 않았다. 위 수치는 서로 다른 범위의 결과이며 기존T11/집중 실행 수에 중복 합산하지 않는다. 추가 브라우저 전체23여정 재실행·실카메라·LiveKit외부연동·운영실측을 주장하지 않는다. 실제 HTTP/PG 종료 및 DOM UI 증거는 기존 T11 실제 브라우저 증거와 구분한다.

재현 명령(backend cwd):

```bash
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_final_fixes.py tests/pg/test_sdd217_attendance.py tests/pg/test_sdd217_makeup.py tests/pg/test_sdd217_membership.py tests/pg/test_sdd217_completion.py tests/pg/test_sdd217_consent_retention.py tests/pg/test_sdd217_read_access.py tests/pg/test_sdd217_schema.py -q --tb=short
DATABASE_URL=sqlite:// '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest tests/test_sdd096_subjective_checkin.py tests/test_sdd209_b2_report_choice.py tests/test_sdd217_contract.py tests/test_sdd217_read_access.py -q --tb=short
```

재현 명령(frontend cwd):

```bash
npx vitest run tests/sdd217-member-operations.test.tsx tests/sdd217-integration-regressions.test.tsx tests/sdd217-self-view.test.tsx tests/member-class-structure.test.tsx tests/sdd217-completion.test.tsx
npm run build
```

마지막 capability 검증(backend cwd):

```bash
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_final_fixes.py tests/pg/test_sdd217_read_access.py -q --tb=short
```

## 이번 수정 파일

제품10파일:

- `backend/alembic/versions/e036a0000057_sdd217_membership.py`
- `backend/app/services/class_attendance_service.py`
- `backend/app/services/session_service.py`
- `backend/app/services/record_service.py`
- `backend/app/services/class_membership_service.py`
- `backend/app/services/class_read_service.py`
- `backend/app/schemas/class_parent.py`
- `frontend/src/components/class/structure/host-member-operations.tsx`
- `frontend/src/components/class/structure/membership-operation-state.ts`
- `frontend/src/lib/api/class-structure.ts`

회귀2파일:

- `backend/tests/pg/test_sdd217_final_fixes.py`
- `frontend/tests/sdd217-member-operations.test.tsx`

문서: spec.md(R1 예외), api-contract.md(최종 가산 계약), summary.md(결과·증거), progress.md(ruling·검증), 본 보고서·로그·final-fix.diff. 구현 전 verify.md는 수정하지 않았다.

## 남은 사항

제한된 최종 재리뷰와 Brian Stage⑦ 승인. 기존 summary의 실카메라·외부 LiveKit/다중워커·90초 실제 lease·외부 전달/운영배포 미검증은 그대로다. 보강 completed의 원결석 정정은 자동취소 없이409이며 새로운 완료 보강 정정 정책은 만들지 않았다. legacy 참가행은 보수 보존되므로 이후 클래스 기본값 자동 전파 대상에서 제외된다.
