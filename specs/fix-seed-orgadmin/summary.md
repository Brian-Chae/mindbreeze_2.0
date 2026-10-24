# 기관관리자 테스트 계정 시드 수정 결과

- `orgadmin@test.com` / `테스트기관관리자` / `org_admin`을 기존 두 계정과 같은 환경변수·해시·멱등 방식으로 추가했다.
- 소속 기준은 `UserOrgMembership`이다(SDD-079). 활성 membership 중 `kind=institution`이며 비활성화되지 않은 기관을 생성 시각·ID 순으로 선택한다. 개인상담소는 `kind=individual`이므로 제외한다.
- 일반 기관이 없으면 새 테스트기관을 만들고 상담사·관리자 소속만 추가한다. 이름만 같은 타 기관은 재사용하지 않는다. 기존 소속·주 소속·담당자·개인상담소는 보존한다. 서비스의 개인상담소 주 소속 자동 승격을 피하기 위해 이 추가 전용 시드에 한해 membership을 직접 추가한다.
- 기존 관리자 역할·주 소속 충돌은 중단한다. CLI 예외는 롤백한다. 계정의 비밀번호·상태 갱신은 기존 동작이다.
- production/prod 환경은 로컬 URL이어도 차단한다. 비운영 환경에서는 로컬 SQLite/PG 및 정확한 mindbreeze-dev RDS 호스트 패턴만 허용한다. query는 PG의 sslmode/connect_timeout/application_name만 허용하고 접속 대상 변경 옵션은 거부한다. 우회 옵션은 없다. CLI의 세션 생성 전과 함수의 실제 bind 검사로 보호한다.

## 검증

- TDD: 기존 코드에서 신규 18개 테스트 실패 확인 → 구현 후 통과. 추가 역할 충돌·SSL 허용도 각각 실패 확인 후 보완했다.
- 최종 집중: `tests/test_seed_test_accounts.py tests/test_sdd220_review_seed.py tests/pg/test_sdd214_reset.py -q` — **33 passed, 13 skipped**, 의존성 deprecation 경고 3건.
- 해시·비밀번호 교체·기관 추가/선택·멱등·보존·운영 가드 외에 실제 FastAPI 로그인과 선택 기관 상담사 목록 API 200까지 확인했다.
- 기존 심사 시드 테스트 7건 통과. PG 전용 재시드 테스트는 세 계정 계약으로 기대값 갱신했으나 실제 PG 실행은 하지 않았다.
- 전체 pytest(`-q --maxfail=1`): **978 passed, 451 skipped, 1 failed**, 39 warnings. `tests/test_data_exports.py::test_migration_can_render_offline`의 Alembic 자식 프로세스를 격리 런처가 차단한 실패다. 제품 코드 실패/전체 통과로 판단하지 않는다. 이 지점 이후 전체 테스트는 미검증이다.
- 실행 런처는 `_env_file=None`, SQLite, test 환경을 주입하고 감사 훅으로 환경파일 읽기·네트워크·자식 프로세스를 차단했다. 서버·dev/prod DB·.env·메일 접근 없음.
- 독립 검증자 읽기 전용 리뷰 완료: 기존 역할 충돌 중단 및 관리자 API 접근 테스트 보완 후 추가 차단 결함 없음. 감독이 diff와 집중 테스트를 재검증했다.
- `git diff --check` 통과. 실제 dev 계정 생성은 OPS 실행 이후에만 확인 가능하다.

## OPS 실행

별도 승인된 dev 반영 후 backend 가상환경에서 기존 dev 설정과 dev RDS 대상을 확인한다. production 설정을 임시 덮어써 우회하지 않는다. 비밀 관리 도구로 `TEST_ACCOUNTS_PASSWORD`를 환경변수에 주입한다. 값은 명령·문서·로그에 남기지 않는다.

```sh
cd <dev 백엔드 경로>
python scripts/seed_test_accounts.py
```

세 계정 모두 주입된 비밀번호로 갱신된다. 기존 두 계정만 있으면 생성 1/갱신 2, 이후 재실행은 생성 0/갱신 3이다. 기관관리자로 로그인해 같은 기관의 상담사 목록을 확인하고 비밀번호 환경변수를 해제한다. 메일 발송은 없다.

머지·develop 푸시·배포·DB 적용은 수행하지 않는다.
