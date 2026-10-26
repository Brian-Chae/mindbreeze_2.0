# SDD-214 데이터 초기화 절차서 (Z 트랙)

> 정식 릴리스 전 전제에서 기존 데이터를 **지우고** 새 구조로 시작한다. 마이그레이션이 아니라 **별도 수동 절차**다.
> **삭제는 되돌릴 수 없다.** 아래 확인(§3)과 Brian 의 go 없이는 실행하지 않는다. 구현자는 합성 DB 에서만 검증했고 dev·prod 는 한 번도 실행하지 않았다.
> 근거: plan §5, TD21 / verify ZR-1~ZR-8, M-3·M-4·M-6, DL-1~DL-4.

## 1. 도구

| 파일 | 역할 |
|---|---|
| `backend/scripts/reset_dev_data.py` | 초기화 CLI (기본 dry-run, 건수만 출력) |
| `backend/app/services/dev_data_reset.py` | 로직(환경 가드·범위 분류·TRUNCATE·Redis·S3) |
| `backend/scripts/seed_test_accounts.py` | `counselor@test.com`·`client@test.com` 재시드 |
| `backend/scripts/e2e_seed.py seed` | `e2e-smoke` 용 e2e 계정 (기존) |

## 2. 삭제 범위 (N1~N4 — Brian 확인 대상)

### N1. DB·Redis

| 범위 | 옵션 | 삭제 | 보존 |
|---|---|---|---|
| **전부** (dev 권고) | `--scope all` | `alembic_version` 을 제외한 **카탈로그의 모든 테이블** (사용자·기관 포함) | `alembic_version` |
| **세션 계열만** (prod 권고) | `--scope sessions` | 세션·참여자·리포트·EEG·영상/음성 청크·채팅·알림·클래스·상담 관계 등 31개 (`dev_data_reset.SESSIONS_SCOPE_DELETE`) | 사용자·기관·인증·에이전트·연구·감사 등 41개 (`SESSIONS_SCOPE_KEEP`) + `alembic_version` |
| Redis | `--redis` | 접속한 Redis **DB 번호 하나**(`flushdb`) — Celery 큐·캐시. 삭제된 세션 id 를 가리키는 잔여 작업 방지 | 다른 DB 번호 |

- 삭제는 한 트랜잭션의 `TRUNCATE TABLE <명시 목록> RESTART IDENTITY`(CASCADE 없음). 삭제 후 0행을 확인하지 못하면 롤백한다.
- `--scope sessions` 는 **fail-closed**: 어느 쪽에도 분류되지 않은 테이블이 있거나, 보존 테이블이 삭제 테이블을 FK 로 참조하면 **삭제 전에** 거부한다(새 마이그레이션이 테이블을 추가하면 두 목록에 분류를 추가해야 하며, 단위 테스트가 ORM 테이블 누락을 잡는다).
- `--scope sessions` 는 템플릿 세션(`is_template`)도 함께 지운다 — `미확인`: prod 의 템플릿 세션이 계정과 함께 유지되어야 하는지 Brian 확인 필요.
- `research_export_items` 등 FK 없이 세션 id 를 문자열로 가질 수 있는 보존 테이블은 정리하지 않는다 — `미확인`.

### N2. S3 · 재시드

| 항목 | 내용 |
|---|---|
| S3 | 버킷은 유지하고 **프리픽스 단위**로만 삭제: `--s3-bucket <앱 설정의 버킷> --s3-prefix video/ --s3-prefix eeg-raw/ --s3-prefix data-exports/` (코드로 확인된 키 접두사). 프리픽스는 `/` 로 끝나야 하며 그 밖(다른 프리픽스·`videos-archive/` 처럼 접두사만 같은 키)은 건드리지 않는다. 버킷명은 앱 설정과 같아야 한다 |
| `미확인` | **음성 청크·리포트 PDF·`credentials`/`org_documents` 의 S3 프리픽스**는 코드에서 확정하지 못했다(`audio_chunks.file_path`·`credentials.s3_key`·`org_documents.s3_key` 에 저장). 실행 전에 dry-run 건수와 함께 **읽기 전용으로 해당 컬럼의 프리픽스 분포**(값 원문 아님, 첫 경로 조각별 건수)를 확인하고 필요한 `--s3-prefix` 를 추가한다. PV-5(개인정보 잔존 0) 충족을 위해 필수 |
| 재시드 | `seed_test_accounts.py`(`counselor@test.com`·`client@test.com`) + `e2e_seed.py seed`(`e2e-*@e2e.looxidlabs.com`, `e2e-smoke` 의존) |

재시드 수단 확정 결과: 저장소에는 `counselor@test.com`/`client@test.com` 을 만드는 시드가 **없었다**(테스트 코드·부하 재현 스크립트가 사용만 함) → `seed_test_accounts.py` 를 신규 작성했다. 상담사는 **기관 소속 없이**(개인) 생성, 상담사 프로필(코드 `TST001`)·온보딩 완료·상담사-내담자 활성 연결을 함께 만든다. 비밀번호는 환경변수 `TEST_ACCOUNTS_PASSWORD` 로만 받는다(코드·문서·로그에 없음). `미확인`: 기관 없는 상담사가 dev 에서 세션 호스트 가능한지는 합성 DB 에서는 확인하지 못했다.

### N3. 시점

**PR-A 머지 직전** (CI GREEN 이후). 055 가드(비템플릿 세션이 있으면 `RAISE EXCEPTION`, 변경 0)가 초기화 후 생성된 세션을 막으므로 초기화와 머지 사이에 E2E·수동 테스트로 세션을 만들지 않는다. 만들어졌다면 **재초기화 후 재배포**(데이터 변경 0 이므로 안전).

### N4. prod

권고: **계정·기관 유지, 세션 계열만 삭제** (`--scope sessions`). 스크립트는 prod 로 판정되면 `--scope all` 을 거부한다. prod 는 `--allow-prod` + 허용 목록 + `--prod-host` 지정이 모두 필요하다. 사전 점검(현재 head `…051`/`…052`, `release-build` 의 `destructive` 판정, 비템플릿 세션 잔존 현황)은 읽기 전용으로 먼저 보고한다.

## 3. 되돌릴 수 없음에 대한 확인 체크리스트 (Brian 이 응답)

실행 전 아래를 **모두** 확인받는다(M-3·M-4·M-6). 하나라도 No 면 중단.

- [ ] 대상 환경이 **dev**(또는 N4 확정 범위의 prod)임을 확인했다 — 환경 이름과 DB 호스트(식별자만; 접속 문자열 아님)
- [ ] **N1** 삭제 범위(`all`/`sessions`)와 Redis 포함 여부를 확정했다
- [ ] **N2** S3 프리픽스 목록과 재시드 계정을 확정했다 (미확인 프리픽스 조회 결과 반영)
- [ ] **N3** 실행 시점이 PR-A 머지 직전이며 그 사이 세션 생성이 없을 것이다
- [ ] dry-run 건수(§4-1)를 보고받았고 예상과 일치한다
- [ ] "기존 데이터는 하나도 필요 없다"(plan §5.3)는 전제가 **여전히 유효**하다 — RDS 스냅샷은 기본 생략. 원하면 스냅샷 생성(별도 승인)을 먼저 한다
- [ ] 정식 릴리스 전이다(spec C5). 릴리스 후에는 이 절차를 쓰지 않는다
- [ ] 최종 go: 위 항목을 보고 `--apply --i-understand-this-deletes-data` 실행을 승인한다

## 4. 실행 순서 (모든 단계는 대상 환경의 서버/배스천에서, 비밀 값은 터미널에 직접 입력하지 않고 환경에서 읽는다)

환경: `backend/.env.dev` 가 로드된 상태(앱 설정이 DB·Redis·S3 를 가리킴). 허용 호스트는 환경변수 `RESET_ALLOWED_HOSTS` 로 지정한다(예: dev DB 호스트). 출력에는 건수만 나온다.

1. **사전 점검 (읽기 전용)** — 기본이 dry-run 이다.
   ```bash
   cd backend
   python scripts/reset_dev_data.py --scope all --redis \
     --s3-bucket <버킷> --s3-prefix video/ --s3-prefix eeg-raw/ --s3-prefix data-exports/
   ```
   출력 JSON: `env`, `scope`, `applied:false`, 테이블별 건수, `redis_keys`, `s3_objects`. `alembic_version` 이 `…052` 인지는 별도로 읽기 전용 확인한다.
2. **Brian 확인(§3) → go**
3. **삭제**
   ```bash
   python scripts/reset_dev_data.py --scope all --redis --s3-bucket <버킷> --s3-prefix … \
     --apply --i-understand-this-deletes-data
   ```
   두 플래그 중 하나라도 없으면 거부한다(종료 코드 2). 대상 호스트가 허용 목록 밖이면 플래그가 있어도 거부한다.
4. **재시드** (055 이전에도 이후에도 가능 — 계정은 가드 대상이 아니다. 합성 DB 에서 052 상태 시드 후 head 적용을 검증함)
   ```bash
   TEST_ACCOUNTS_PASSWORD="$(…환경에서 읽기…)" python scripts/seed_test_accounts.py
   E2E_PASSWORD="$(…)" python scripts/e2e_seed.py seed
   ```
5. **사후 확인** — 건수·성공 여부만 보고한다
   - 같은 명령을 다시 dry-run: 모든 테이블 0(재시드한 `users` 등 제외 — 비템플릿 세션 **0**)
   - 비템플릿 세션 0, `redis_keys` 0, S3 프리픽스별 0 (PV-5)
   - `counselor@test.com`·`client@test.com` 로그인 성공, e2e 계정 로그인 성공
6. **재실행 안전**: 이미 비어 있으면 변경 0·오류 0 (`--apply` 를 한 번 더 해도 동일).

## 5. 조정자 체크리스트 — PR-A 머지 직전 (DL-1·DL-2)

순서 고정. 어긋나면 중단한다.

1. [ ] **CI GREEN** — frontend · backend · `backend-pg-smoke` 3잡. 마이그레이션 PR 본문에 롤백 설계(§10.3)와 `check_migrations` 결과 첨부
2. [ ] **초기화 완료** — §4 의 3~4 단계(Brian go 후) 실행 및 사후 확인
3. [ ] **가드 조건 확인** — 비템플릿 세션 **0** (dry-run 의 `tables.sessions` 가 0 이거나 `is_template` 만 남음). 초기화 후 시간이 지났다면 다시 확인한다
4. [ ] **머지** (Brian go) → `deploy-dev` 가 055 를 적용(가드 통과) → `e2e-smoke`
5. [ ] 중간에 세션이 생겼다면: 가드가 변경 0 으로 배포를 중단 → §4 의 3~5 재실행 후 재배포

## 6. 안전장치 요약 (ZR-2·ZR-7·ZR-8)

| 장치 | 동작 |
|---|---|
| 기본 모드 | dry-run. 삭제 대상 **건수만** 출력 |
| 삭제 조건 | `--apply` **그리고** `--i-understand-this-deletes-data` 둘 다. 확인 플래그만 단독이면 거부 |
| 호스트 가드 | 로컬(소켓·loopback) 또는 허용 목록(`RESET_ALLOWED_HOSTS`/`--allow-host`)만. 그 밖은 거부(dry-run 포함) |
| prod 가드 | 호스트에 `prod` 포함 또는 `RESET_PROD_HOSTS`/`--prod-host` → 기본 거부. 통과하려면 `--allow-prod` + 허용 목록 + `--scope sessions` |
| 출력 | 건수·테이블명·환경명만. 접속 문자열·호스트·비밀번호·이메일·UUID·S3 키 원문 없음. DB 오류는 예외 종류만 출력 |
| `alembic_version` | 어떤 범위에서도 보존 |
| Redis·S3 범위 | Redis 는 접속한 DB 번호 하나. S3 는 지정 프리픽스(`/` 종료)만, 버킷은 앱 설정과 일치해야 함 |

## 7. 구현자가 실행한 검증 (합성 DB 에서만)

`backend/tests/test_sdd214_reset_guards.py`(DB 없음 22건) · `backend/tests/pg/test_sdd214_reset.py`(합성 PG 12건): dry-run 무변경, `--scope all` 삭제 → 0행 → `alembic upgrade head`(055 가드) 통과, 재실행 변경 0, `--scope sessions` 계정·기관 보존, 분류 누락·FK 역참조 거부, 052 에서 재시드 후 head 적용·로그인 해시 유효·멱등, CLI 출력 개인정보 0·플래그 거부.

## 8. 미확인 요약

1. 음성 청크·PDF·`credentials`/`org_documents` 의 S3 프리픽스(§2 N2)
2. `--scope sessions` 가 템플릿 세션을 지워도 되는지(§2 N1)
3. 기관 없는 `counselor@test.com` 으로 dev 에서 세션 호스트가 되는지(§2 N2)
4. Redis 의 Celery 큐가 앱 `REDIS_URL` 과 같은 DB 번호를 쓰는지(`flushdb` 는 접속한 DB 번호만 비움)
