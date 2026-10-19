# SDD-217 PR20 CI — PDF 권한·초기화 분류 보완

2026-10-20. 기준 HEAD `d78d2975`, 전용 worktree `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`.
담당 두 실패를 수정했다. 커밋·push·merge·배포하지 않았으며 다른 담당자의 contracts 변경은 수정하지 않았다.

## PDF 권한 실패

CI `test_pdf_requires_host_counselor_and_approval`는 무작위 UUID(실제 User 없음)를 타 상담사처럼 주입해403을 기대했지만217 본인 이력 읽기에서는 존재하지 않는 주체를404로 숨긴다. 실제 활성 타 상담사의 권한 거부는 기존대로403이다.

- 기준 `a4acf6ba`의 `get_report`는 바로 `_can_access_report`를 호출했고,217 현재는 실제 viewer 조회 및 신규 본인 이력 분기 후 미존재viewer404를 반환한다(`report_service.py`의 `get_report`).
- 217 API 계약 §6은 본인/타인·승인/숨김 범위를 명확히 구분한다. PDF 라우터의 상담사/센터관리자 역할 게이트와 승인409는 그대로다.
- 테스트에 실제 active counselor 계정을 추가해 타 상담사403을 유지하고, 미존재 주체404를 별도 확인했다. host200·미승인409·client 역할403도 유지한다.
- **리포트 서비스/API 제품 코드는 변경하지 않았다.** 기존403을 단순404로 치환해 권한 검사를 약화하지 않았다.

첫 로컬 실행은 시스템 라이브러리 탐색 경로 때문에 기존 module-level skip이 발생했다. 설치된 `/opt/homebrew/lib`의 glib/pango를 확인하고 `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`를 해당 테스트 프로세스에만 설정했다. 이후 HEAD 원본 테스트를 임시 파일로 복사해 실제404≠403 RED1을 재현했고, 임시 파일은 제거했다. 최종 실행은0skip으로 실제 PDF 생성·페이지·한글·폰트 검증까지 통과했다. 환경 설치·설정 파일 변경 없음.

## reset 신규9테이블 분류

기존 `dev_data_reset.py`의 sessions 범위는 계정·기관·연구·감사를 보존하고 클래스/세션 종속 운영 상태를 지운다.217 API 계약 §8의 `class_attendance_events`, `class_guest_merges`, `class_member_consent_events`는 append-only 원본으로 정의되며, 실제057 및 ORM도 부모와 독립 보존하도록 FK가 없다. 기존 migration의 감사 트리거는 UPDATE/DELETE를 거부한다. TRUNCATE는 그 행 트리거를 통과하지 않으므로 세 감사를 DELETE 집합에 넣는 것은 안전하지 않다.

| 분류 | 신규 테이블 |
|---|---|
| sessions DELETE | class_makeup_assignments, class_guest_credentials, class_guest_recoveries, class_member_operations, class_guest_join_operations, session_presence_leases |
| sessions KEEP | class_attendance_events, class_guest_merges, class_member_consent_events |

제품 수정은 위 두 상수 집합과 이유 주석5줄뿐이다. **감사 KEEP는 scope=sessions에만 적용된다. scope=all은 기존대로 감사까지 포함한 전체 앱 테이블 삭제 범위이며 이번 수정이 all의 감사 보존을 보장하지 않는다.** scope all의 기존 명시 전체 초기화 의미, 환경/명시플래그/미분류/FK 가드, TRUNCATE 방식, alembic_version 보존, 트리거·제약을 변경하지 않았다. 운영 데이터 초기화는217 제외 범위(spec §2)이며 이번 작업도 **실제 dev/prod reset·운영 sweep·backfill·S3·Redis 삭제를 실행하지 않았다.**

## 새057 실제 PG 검증

`tests/pg/test_sdd214_reset.py`에 감사 없는 DB/감사 있는 DB 두 케이스를 추가했다. `scratch_db`가 로컬55437에 생성한 임시DB만 사용하고 종료 시 해당 임시DB를 정리한다. 공용 `sdd217_test`는 생성 제어 연결로만 사용하고 reset 대상은 항상 별도 scratch DB다.

각각 운영6테이블을 실제 FK가 있는1행씩 시드하고 다음을 검증했다.

1. 감사3테이블에 실제 FK가 없음 확인. 감사 유무와 관계없이 합성 FK `class_attendance_events.class_id→classes.id`를 추가하면 정확히 '보존 테이블이 삭제 테이블을 참조한다' 오류로 **삭제 전에** 거부하고 모든 테이블 건수 불변.
2. 테스트 전용 FK만 제거한 뒤 dry-run: 운영6행 집계, 감사3개 삭제 계획 제외, 모든 데이터 불변.
3. sessions apply: 운영6테이블·클래스/멤버/회차/참가행0, 계정/기관·migration head 보존, 감사 원행 전체 값 동일.
4. 감사3개의 트리거가 활성 상태로 남고, 감사 있는 DB에서 직접 UPDATE/DELETE 시 실제 PG append-only 오류 발생.
5. 재실행도 멱등이며 보존 감사 건수 유지.

기존 미분류테이블 거부·보존FK 거부·환경/명시플래그·출력 비밀정보·합성052 reset/재시드 회귀도 함께 통과했다.

## 실행 결과와 로그

- 기존 두 CI 케이스: reset 미분류 RED1; PDF 최초 로컬1skip은 제품 증거에서 제외.
- PDF 기준 원본의 실제 RED1: `release-pdf-red.log`.
- 신규 PG 두 케이스 RED2: `release-reset-pg-red.log`(분류 누락 때문에 dry-run 거부).
- 최종 PDF/reset guards **33 passed, 7 deprecation warnings, 0 skipped**, 7.83초: `release-be-pdf-reset-green.log`.
- 최종 합성 PG reset **14 passed, 2 deprecation warnings, 0 skipped**, 14.23초: `release-reset-pg-green.log`.
- `git diff --check` exit0.

기존 warning은 crypt/argon2/WeasyPrint URL fetcher API에 대한 것이다. 전체 BE·다른 CI 실패3건 통과를 이 결과로 주장하지 않는다.

```bash
# backend cwd — 설치된 라이브러리를 해당 프로세스에서만 탐색
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib DATABASE_URL=sqlite:// '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest tests/test_sdd070_report_pdf.py tests/test_sdd214_reset_guards.py -q --tb=short
# 해당 모듈은 자체 scratch_db를 생성해 그 DB에만 reset을 적용한다.
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' -m pytest --confcutdir=tests/pg tests/pg/test_sdd214_reset.py -q --tb=short
```

## 변경 파일·인계

- `backend/app/services/dev_data_reset.py`: 운영6 DELETE/감사3 KEEP 분류와 이유 주석.
- `backend/tests/test_sdd070_report_pdf.py`: 실제 타 상담사 fixture 및 미존재 주체의 독립404 검증.
- `backend/tests/test_sdd214_reset_guards.py`: 신규9개 분류 의미 고정.
- `backend/tests/pg/test_sdd214_reset.py`: 감사 유무별 실제057/FK/trigger/dry-run/apply/멱등 검증2개.

root 최종 검토·통합 CI 확인을 남긴다. 앱 리포트 권한 제품코드/마이그레이션 변경은 없으며 API 재시작은 필요하지 않다. 운영 초기화 실행 승인은 별개이고 이번 수정으로 승인되지 않는다.
