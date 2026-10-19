# SDD-216 — 명상 클래스 편성·강사 로컬 구현 결과

- 최신 추가분: **바로 지금 1회차·즉시 초대 로컬 구현 및 검증 완료**. [상세 요구사항·결과](instant-class-followup.md). 아래 초기 BE 결과와 실행 시점을 구분한다. 전체 SDD 최종 리뷰·배포 완료를 뜻하지 않는다.

- 작성일: 2026-10-19. 범위: 첫 번째 출시를 위한 BE 코드·로컬 검증. **BE 배포·FE 구현·SDD 전체 완료는 아님**.
- 작업 브랜치: `sdd/216-class-structure-phase3`. 이번 실행 전 HEAD: `62a8e67fe3b357bef2043db2af2c566a597ab315`. 이 문서를 포함하는 로컬 커밋이 결과 식별자다.
- 실행 근거: Brian의 “아니 괜찮아. 계속 개발 진행해줘”. 최초 문서 전용 지시 이후의 명시적 개발 계속 지시를 근거로 한다.
- 경계: 지정 워크트리만 수정. push·배포·머지·실제 메일 발송·실데이터 삭제 없음. 로컬 PG는 합성 데이터만 사용한다.
- `verify.md`는 구현 전에 작성된 원본을 유지했다. 기존 헤더의 승인 인용을 새로 확인한 사실로 재인용하지 않는다. 현재 실행 근거는 위의 실제 후속 지시다.
- 원래 계획: **40 Task(T00~T39), 79 검증 행(V 67·VR 6·DOC 6)**. 테스트 실행 수와 시나리오 전체 통과 수를 혼용하지 않는다.

## 1. 구현 결과

| 영역 | 구현·효과 |
|---|---|
| 편성·원자 쓰기 | fixed/rolling·4개 배정 방식·KST 계산·초안/공개·8회 생성, 클래스/회차 버전과 operation_key 검증. 회차별 단건 commit 대신 전체 트랜잭션 |
| 편집·기수 | 일괄 전후 미리 보기·변경·취소·한 주 이동·정규/보강 추가·지난 기수 복제. 복제는 원본 ID와 실제 요청으로 멱등 판정하며 원본 변경 후 재시도도 기존 결과 반환 |
| 강사 | 추가·복구·제거·마지막 주강사 보호·guest scope, 61/60/15분 변경 경계·양도·수락·거절·만료. 승인 전 귀속 정정과 승인 후 표시 메모 분리 |
| 계정 제한 | 플랫폼/센터 정지·삭제·소속 해제의 미래 명상 회차에 needs_reassign 적용. host FK·과거 이력·부모 가시성 보존 |
| 충돌·코드 | 명상/상담·요청 내부 host/place/member 검사, 주소는 정보성, 비가시 메타 제거·fingerprint 재확인. Class/단건 Session 코드 합집합 잠금 |
| 회원 | 초대·정원·미래 expected·명시적 재초대·코드 가입. 완료 기수 회원은 복제 초대와 지정 보강에 사용하되 기존 멤버를 자동 재활성화하지 않음 |
| 알림·작업 | 도메인과 전달 의도 원자 저장·후속 소비·그룹 변경·초대 실패 재시도·임박 변경 푸시 선호. 정기 보충·만료·마무리 cron 진입점 |
| 권한 | D-05 새 고지 전 팀 열람/참관 차단, D-28 관리자 명상 읽기만·상담 본문 비공개. REST·PDF·기록·영상·제어·입장 우회와 기존 명상 생성/복제 우회 차단 |
| 실시간 | 참관 전용 WS 방·민감 payload 제외·기존 구독 재검사. 읽기 전용 LiveKit 토큰과 권한 변경 후 참여자 회수 의도. 실제 SFU·배포 환경 검증은 미실행 |
| 스키마 | 055 다음 가산 리비전 056: Class 설정 5개·Session override·host/date 인덱스·신규 테이블 5개. 기존 FK/부모 제약 유지, 자동 downgrade로 이력 삭제 금지 |

- `CLASS_SCHEDULING_ENABLED`, `CLASS_ROLLING_ENABLED`, `CLASS_TEAM_READ_ENABLED` 기본값은 모두 false.
- D-28 읽기 축소는 편성 스위치와 독립적으로 적용한다. 팀 열람 스위치는 FE 고지·실제 LiveKit 검증 전까지 off.
- cron 파일 존재는 예약 작업 설치를 뜻하지 않는다. 실제 설치·배포 절차는 [release-checklist.md](release-checklist.md)에 기록했다.
- FE가 소비할 실제 요청·응답·오류·nullable 계약은 [api-contract.md](api-contract.md)를 기준으로 한다.

## 2. 로컬 검증 결과

| 실행 | 결과 | 증거 |
|---|---|---|
| 최종 전체 PostgreSQL | 181 passed, 2 warnings, 51.14초 | `.superpowers/sdd/plan/pg-final.log` |
| 빈 PG → head, 같은 head 반복 적용 | 성공, 056 | `.superpowers/sdd/plan/pg-final-migration.log` |
| 순수 편성 계산 | 18 passed | `.superpowers/sdd/plan/pure-final.log` |
| 이전 실패가 있었던 회귀 파일 15개 재실행 | 657 passed, 21 warnings, 203.75초 | `.superpowers/sdd/plan/final-regression.log` |
| CI 정적 게이트·head | 23 passed, 공백 경로 영향 1개 deselected | `.superpowers/sdd/plan/ci-head-final.log` |
| WS 실시간 회귀 | 35 passed | `.superpowers/sdd/plan/ws-failure.log`(이름은 과거 실패 추적용, 마지막 내용은 통과) |
| 추가 경합·복제·합성 성능 | 14 passed | `.superpowers/sdd/plan/races-performance.log` |
| 정적 검사 | 89 리비전·단일 head 056, Python AST·공백 검사 통과 | `scripts/check-alembic-heads.py`, `git diff --check` |

- 테스트 경고는 crypt/argon2 등의 의존성 폐기 예고를 포함한다. 경고를 기능 실패로 바꾸거나 숨기지 않았다.
- 로그는 이 워크트리의 무시 경로에 보관한다. 새 환경에서는 아래 명령과 커밋된 테스트로 재실행한다.
- 위 실행들은 서로 겹친다. 합산한 수를 고유 테스트 수로 보고하지 않는다.

### PG 필수 항목과 경합 증거

| 검증 행 | 테스트·관찰 |
|---|---|
| V-02 복합 FK | `test_sdd216_concurrency.py`: 타 클래스/NULL host raw UPDATE 거부, removed 강사는 FK만으로 통과하므로 앱이 별도 거부 |
| V-07 8회 원자성 | `test_sdd216_write.py`: 5번째 INSERT·회원 오류·flush 이후 commit 실패에서 도메인/멤버/expected/operation/effects/알림 건수 원복. commit 실패 시 메일·브로커 호출 0 |
| V-13 일괄 충돌 | `test_sdd216_conflicts.py`: 실제 PG 범위 SQL 1회, 요청 내부·맞닿음·긴 회차·정보 투영·주소·회원 검증 |
| V-24 needs_reassign | `test_sdd216_account_paths.py`: 플랫폼 정지·센터 정지·계정 삭제·소속 해제 실제 서비스 호출, 미래 회차만 재배정·과거/숨김 보존 |
| V-08 동일 제출 | `test_sdd216_concurrency.py`: 별도 연결 2개·barrier, 같은 key의 8회 생성 결과 1세트 |
| V-17/41 | `test_sdd216_races.py`: 동시 lead 제거 후 1명 유지, 마지막 자리 동시 초대 후 active 정원 이하·최신 revision 재시도도 초과 거부 |
| V-19/25 | 같은 파일: 수락과 열기 중 하나만 성공, 후보 정지와 수락 후 비활성 assigned로 남지 않음 |
| V-23/45 | 같은 파일: 승인과 귀속 정정 중 하나만 성공·승인 소유 고정, 두 rolling 작업이 다음 주 회차/준비 의도 1세트만 생성 |

- 두 연결 경합은 5초 lock timeout과 20초 future timeout을 사용한다. 순차 호출을 경합 검증으로 집계하지 않는다.
- 이 표는 명시된 자동 검증의 근거다. verify 한 행에 포함된 UI·실서비스·모든 조합까지 통과했다는 뜻은 아니다.

### 합성 성능

- 데이터: 합성 클래스 100개 × 52회 = 5,200회차, 강사 20명. 실제 PG 16, 후보 8개/52개 각각 20회. 외부 네트워크·HTTP 지연 제외.
- 8개 후보: SELECT 4회, p50 10.49ms / p95 22.70ms. 회차 조회 1회, `ix_sessions_host_scheduled_at` bitmap index scan.
- 52개 후보: SELECT 4회, p50 378.91ms / p95 457.75ms. 회차 조회 1회, `ix_sessions_host_is_template` bitmap index scan. 이 입력은 전체 5,200행이 범위에 들어간다.
- `EXPLAIN (ANALYZE, BUFFERS)`도 같은 실행에서 기록했다. SQL 실행 시간은 각각 0.142ms/1.539ms이고 전체 함수 지연과 다르다. 넓은 일정의 Python 후보 비교 비용이 남아 있다.
- 운영 p95나 200ms 달성으로 보고하지 않는다. 재실행하면 로컬 부하·플래너 통계에 따라 값이 달라질 수 있다.

### 최초 BE 구현 시 전체 회귀의 제한과 당시 남은 실패

- 중간 전체 BE 실행: **3027 passed / 39 failed / 12 skipped**, 1164.05초. `.superpowers/sdd/plan/backend-full.log`.
- 실행 도중 코드가 변경되어 이 결과를 최종 전체 스위트 또는 변경 전 기준선으로 사용하지 않는다.
- 39건 중 31건은 정책 변경 기대값·fixture·head·임시 경로·구현 문제 수정 후 관련 파일 재실행에서 통과했다.
- 당시 남은 8건(아래 §6 출시 준비에서 후속 처리): 변경하지 않은 배포 스크립트가 테스트 임시 절대경로의 `Looxid SSD` 공백을 처리하지 못한다.
  - `test_sdd210_ci_gates.py::test_ssm_run_은_원격_종료코드를_전달한다`: `deploy/ci/ssm-run.sh`의 `$AWS` 확장에서 경로 분리.
  - `test_sdd210_install_release.py` 7개: 첫 설치, 두 번째 설치, 헬스 실패 복귀, 복귀 실패, 파괴적 마이그레이션 승인, 활성 timer, 보관 개수. `deploy/render.py`의 PREFIX 공백 거부로 실패하거나 후속 파일이 없음.
- 배포 스크립트와 설치 테스트 원본은 수정하지 않았다. 별도 깨끗한 기준 커밋에서 이 8건을 재실행하지 않았으므로 “기준선에서도 통과/실패했다”고 단정하지 않는다. 경로 제한이 없는 Linux CI 결과는 미확인이다.
- 최초 구현 종료 시점에는 **전체 BE 테스트 전부 통과·출시 게이트 G1 완료로 보고하지 않았다**. 최종 재실행한 로컬 PG·관련 회귀만 통과로 기록한다.

## 3. Task·검증 진행 상태

| 구간 | 상태 |
|---|---|
| T00~T01 | 최신 명시 지시·실제 계약·소유 표 기록. 전체 변경 전 기준선 확보는 불완전하며 위 결과와 구분 |
| T02~T25 | BE 구현과 관련 단위/PG/권한 회귀 완료. 실제 전달·기기·외부 서버 결과는 미확인 |
| T26 | 로컬 PG·경합·합성 성능·API/서비스 검증 수행. 전체 회귀/실서버의 남은 게이트 때문에 출시 완료는 아님 |
| T27 | BE 배포 미실행. push·배포 금지 유지 |
| T28~T38 | FE 구현·4뷰포트 시안 검증·실제 BE+FE E2E·2차 출시 미실행. 계획의 T27 선행 조건 유지 |
| T39 | 이 문서는 로컬 BE 중간 결과. BE/FE 출시 SHA·최종 사용자 리뷰를 채운 SDD 전체 완료 요약은 아님 |

- 리플레이 84 case×4뷰포트·보완 상태와 히어로/사이드바/행 마감은 아직 측정하지 않았다. SDD-215의 중앙값 59%를 이번 결과로 재사용하지 않는다.
- 과거 `verify.md`의 계획 행에 사후 PASS를 덮어쓰지 않았다. 최종 Stage ⑦ 승인도 받은 것으로 기록하지 않는다.

## 4. 재실행

- Python 3.11, 저장소 backend 의존성, PostgreSQL 16 사용. 테스트용 DATABASE_URL은 localhost 합성 DB로만 설정한다.
- 외부 메일/FCM/AWS 자격은 비우고 Redis는 격리한다. 임시 파일·영상/음성 청크·캐시 경로를 워크트리 안에 만들고 사용한다.
- backend에서 빈 합성 PG에 `python -m alembic upgrade head`를 두 번 실행한 뒤:

```sh
PG_SMOKE=1 python -m pytest --confcutdir=tests/pg tests/pg -q -p no:cacheprovider --tb=short
python -m pytest --noconftest tests/test_sdd216_schedule.py -q -p no:cacheprovider
python -m pytest tests/pg/test_sdd216_performance.py --confcutdir=tests/pg -q -s -p no:cacheprovider
```

- PG 명령에는 사전에 설정한 합성 DATABASE_URL과 `PG_SMOKE=1`이 필요하다. 성능 명령도 같은 환경에서 실행한다.
- 일반 회귀는 SQLite fixture로 별도 실행한다. 전체 CI 명령은 `.github/workflows/ci-feature.yml`의 backend Test 단계가 기준이다.
- 전체 PG 테스트는 일부 두 연결 시드가 남으므로 새 합성 DB에서 실행한다. 실제 DB 초기화 명령을 대체 수단으로 사용하지 않는다.

## 5. 변경 경로·남은 결정

- `backend/app/` 40개 파일: 편성·강사·충돌·멤버·작업·권한 모듈, 기존 세션/리포트/알림/계정/WS 연동과 가산 DTO.
- `backend/alembic/versions/e036a0000056_sdd216_class_scheduling.py`, `backend/class_operations_cron.py`, `backend/class_rolling_cron.py`.
- `backend/tests/` 40개 파일: 신규 PG·계산·경합·성능과 기존 정책/스키마/계약 회귀. 과거 리비전 053~055 파일 수정 없음.
- 이 폴더 `spec.md`, `plan.md`, `api-contract.md`, `release-checklist.md`, `summary.md`. `verify.md` 변경 없음.
- 사용자 정책 결정 필요: **없음**. U-216-01은 요청한 기본값 적용. 배포·팀 열람 활성화·최종 리뷰는 별도 실행 게이트다.
- 미확인: 실제 dev/prod DB head·배포·cron 설치, 실제 메일/푸시/리마인더 수신, LiveKit 송출 거부/연결 회수·WS 배포 토폴로지, FE·시안·실기기/BLE, Linux 전체 CI·운영 성능.


## 6. 후속: 백엔드 출시 준비

- 실행 근거: Brian의 “좋아. 다음 단계 진행해줘”. 시작 HEAD `36d42741`, 시작 시 미커밋 변경 없음. 이전 결과 커밋은 `fb0347b6`이다.
- `36d42741`의 develop 병합과 회원 화면 변경은 이 후속 작업 이전 상태이며 이번 작업에서 병합하지 않았다.
- 범위: T26 남은 일반 회귀, T27의 배포 설정·복귀 산출물. T27 실제 배포와 T28 이후 FE는 실행하지 않았다.
- 제품·테스트 수정은 기존 워크트리에서 B 담당 1명이 수행했다. 별도 읽기 전용 리뷰에서 발견한 복귀 누락은 실패 테스트를 먼저 확인한 뒤 수정했다.
- 구현 전 `verify.md` 원본 유지. 이번 출시 준비 기대값은 [release-local-verify.md](release-local-verify.md)에 분리했다. 원래 40 Task·79 검증 행 수는 그대로이며 추가 출시 검증은 RL-01~08이다.

### 변경

| 경로·영역 | 결과 |
|---|---|
| `deploy/ci/ssm-run.sh` | AWS 실행 파일 경로를 인용해 `Looxid SSD` 공백 경로를 한 인자로 유지 |
| `deploy/render.py`·앱 systemd 템플릿 8개 | 앱 전용 PREFIX의 일반 공백 허용·ExecStart 경로 인용. 인프라 공백 및 제어·인용·확장 문자는 계속 거부 |
| `deploy/jobs.tsv`·`deploy/env-manifest.tsv` | 매분 운영·매시 롤링 작업 추가. 활성 timer 15→17. 세 스위치는 선택 SSM 값이며 미지정은 기본 off |
| `deploy-dev.yml` | cron 진입점 두 파일을 번들에 포함. 중복 실행 잠금과 cron 두 행 등록. 등록 시 스위치 자동 활성화 없음 |
| dev 실패 복귀 | 배포 전 클래스 cron 두 행·진입점 두 파일을 보관해 복원. 기존 파일이 없었으면 새 파일만 제거. 다른 작업의 신규 등록 유지 |
| cron 진입점 두 개 | 처리 실패 건수가 있으면 종료 코드 1. 실패 없거나 off면 0. 결과 JSON 유지 |
| 테스트·문서 | 신규 출시 테스트, 기존 렌더·설치 기대값 갱신, 소유 경로·실제 반영 전 확인 목록 보완 |

### 실패 재현과 후속 실행

| 실행 | 결과·해석 | 로그 |
|---|---|---|
| 이전 배포 회귀 8건 재현 | 8 failed / 28 passed. 실제 공백 경로 문제 확인 | `release-red.log` |
| 추가 앱 렌더·cron/환경 기대값 | 7 failed / 35 passed | `render-red.log` |
| dev 번들·등록 | 1 failed / 2 passed | `dev-cron-red.log` |
| cron 실패 종료 코드 | 5 failed / 3 passed → 0/1 반환 수정 | `cron-exit-red.log` |
| dev 실패 복귀 | 이전 작업 있음/없음 2 failed → snapshot/restore 수정 | `rollback-red.log` |
| 수정 후 선택 회귀 4파일 | 87 passed / 1 failed. 실패는 cron 프로세스 시작의 20초 제한 초과. 이전 공백 경로 8건과 복귀는 통과 | `release-focused.log` |
| 동일 코드·동일 20초 제한 재실행 | 신규 출시 10 passed / 1 warning, 17.61초. 임계 시간을 늘리지 않음 | `release-cron-recheck.log` |
| 일반 BE 전체 CI 명령, 추가 요청 전 | 감독자 커밋·capability 추가 요청 수신 후 중단. 1612 passed / 179 skipped / 1 deselected / 64 warnings, 841.36초. 전체 통과 증거 아님 | `release-full.log` |
| 추가 요청 반영 후 일반 BE 전체 CI 명령 | 장시간 진행 지연으로 중단: 1407 passed / 169 skipped / 1 deselected / 55 warnings, 1987.56초. 전체 통과 증거 아님 | `release-full-final.log` |
| 같은 코드의 전체 수집 목록 | 3279/3280 collected, 1 deselected. 232.11초 | `release-collected.log` |
| 남은 항목 분할 실행 | 41 passed / 2 warnings, 438.64초 후 중단. 사용자 중지 요청에 따라 소유 테스트 프로세스 종료. 전체 통과 증거 아님 | `release-full-rest.log` |
| 정적 검사 | YAML·원격 셸·SSM 셸·수정 Python AST 통과, 89 리비전·단일 head 056 | 로컬 명령 결과 |

- 로그 경로는 모두 `.superpowers/sdd/plan/` 아래다. 선택 회귀와 전체 실행은 중복되므로 건수를 합산하지 않는다.
- off 프로세스 제한 초과는 별도 `-X importtime` 진단에서 정상 off 종료했고 같은 테스트 재실행도 통과했다. 최초 시간 초과 사실은 유지하며 서비스 동작 오류로 단정하지 않는다.
- 전체 실행 시작·분할 재개 시 추적 중인 backend/deploy/.github 파일과 새 테스트의 SHA-256이 동일함을 확인했다. 중지 직후 최종 대조는 수행하지 않았다.
- 단일 실행 중 진행 지연과 로컬 스왑 약 20GB 사용을 관찰했다. 특정 제품 결함으로 단정하지 않는다. 중단 요약 후 종료 대기 중이던 자기 pytest만 종료했고 다른 작업 프로세스는 건드리지 않았다.
- 분할 실행은 수집 순서의 앞 1576개와 뒤 1704개(1개 중복)를 대조하려 했으나 미완료다. `release-all-nodes.json`·`release-remaining-nodes.json`에 목록을 보관한다. 분할 결과를 단일 전체 명령의 정상 종료나 원격 Linux CI 통과로 보고하지 않는다.
- DB 모델·마이그레이션 변경 없음. 아래 추가 요청으로 읽기 서비스 capability만 가산했다. 기존 PG 181건은 §2의 이전 실행 근거이며 이번 전체 일반 테스트의 PG skip을 그 재실행으로 보고하지 않는다.

### 남은 출시 조건

- 이 워커의 push·dev 배포·마이그레이션·스위치 전환·cron 설치 미실행. 감독자 추가 지시로 push는 감독자가 담당한다. 이 워커는 자기 파일만 명시적으로 stage해 로컬 커밋한다.
- 현재 dev 워크플로는 FE 빌드도 함께 반영한다. 이번 1차는 BE 기능 출시이며, 실제 배포할 기존 FE SHA·빌드도 확인해야 한다.
- 실제 dev/prod 구성·Linux CI·메일/푸시·LiveKit·WS·FE 구현/시안/실기기는 미확인 또는 미실행 상태다.
- 새 비즈니스 정책 결정 항목 없음. 기본값 유지. SDD 전체 완료 및 최종 Review 승인을 받은 것으로 표시하지 않는다.


## 7. 감독자 추가 요청: FE 편성 CTA 권한

- 감독자가 제공한 PR #18 CI 실패 수정 커밋 `eb26f41f`가 현재 로컬 HEAD에 반영된 것을 확인했다. `backend/tests/test_sdd070_report_pdf.py`는 감독자 소유 변경이며 이 워커가 수정·stage하지 않는다. 원격 CI 상태는 직접 확인하지 않았다.
- `GET /api/v1/classes/{id}`에 `capabilities.schedule: bool`을 가산했다. 현재 클래스의 주강사·같은 센터 관리자이고 편성 스위치가 켜진 경우에만 true다. 기존 manage·invite는 유지한다.
- 실제 설정 필드는 `settings.class_scheduling_enabled`다. 계정·센터 소속·강사 상태는 기존 `class_role` 판정을 재사용한다. 권한 범위를 확대하지 않는다.
- API 계약에 FE CTA 조건 `capabilities.schedule === true`와 off에서 읽기 유지 규칙을 기록했다.
- 테스트 함수 1개 추가: 실제 GET 상세에서 off/on × 주강사/센터 관리자/보조강사/회원 8조합. 최초 시드의 필수 joined_via 누락을 고친 뒤 `KeyError: schedule` 실패를 확인하고 제품 코드를 수정했다. 시드 오류를 기능 RED로 집계하지 않는다.
- 추가 검증 SC-01은 이 필드 구현 전에 계약 문서와 테스트에 작성했다. 원래 40 Task·79 QA, 출시 검증 RL 8개와 별개다.
- 로컬 커밋 `9cff4593`: 읽기 서비스·신규 테스트·API 계약 3파일만 포함. push 없음.
- 관련 실행: `test_sdd216_capabilities.py`, `test_sdd214_read_api.py`, `test_sdd070_report_pdf.py`에서 **51 passed / 10 skipped / 2 warnings, 50.65초**. `.superpowers/sdd/plan/capabilities-green.log`.
- 최초 PDF 10건 skip은 기본 검색 경로에서 WeasyPrint 시스템 라이브러리를 불러오지 못한 결과다. 설치된 Homebrew 라이브러리 경로를 별도 테스트 프로세스에 지정해 재실행했다.
- PDF 별도 실행: **10 passed / 7 warnings, 12.30초**. 감독자가 수정한 `test_pdf_requires_host_counselor_and_approval` 포함. `.superpowers/sdd/plan/pdf-native.log`. 코드·의존성 설치 변경 없이 `DYLD_FALLBACK_LIBRARY_PATH`를 Python 프로세스 안에서 pango/glib/cairo/harfbuzz/libffi/fontconfig/freetype의 `/opt/homebrew/opt/<이름>/lib`로 지정했다. `XDG_CACHE_HOME`은 워크트리 안으로 고정했다. 실제 Linux CI 결과는 감독자가 확인한다.
- 이 워커의 FE 코드 변경은 없으며 FE 트랙 결과·실제 배포 여부는 미확인이다.

## 8. 후속: 전체 회귀 제외·FE 연결 조회 보완

- 사용자 지시로 전체 BE 회귀·전체 수집을 실행하지 않는다. 변경 직접 영향 테스트가 통과하면 다음 구현으로 이동한다. 이번 결과를 전체 회귀 통과로 표시하지 않는다.
- 이전 출시 준비 23파일은 내용 해시를 이전 검증 스냅샷과 대조한 뒤 `30728b53`로 로컬 커밋했다. 출시 테스트를 반복 실행하지 않았다. 감독자 소유 PDF 테스트 수정 없음.
- [be-read-followup.md](be-read-followup.md)에 BF-T1~8 및 BF-01~12를 구현 전에 기록했다. 원본 40 Task·79 QA 및 verify.md는 유지한다.

| BE 보완 | 결과 |
|---|---|
| 요청·초대 결과 조회 | 진행자 요청 목록·알림 request_id·이메일 전달 결과 조회. 역할/관련자/대강 지정 회차 검사 |
| FE 설정 복원 | 녹화·채팅·리마인더 현재값, 회원 표시 이름·nullable user_id |
| 편성 선택·홈 | 같은 센터 활성 지도사 후보 목록, 대시보드 실제 부모 FK·영역·회차 |
| 읽기·수락 진입 | 회차 리포트 식별자 목록, host_request capability, 대강의 지정 회차 상세·목록만 허용 |
| 인수 권한 보완 | 출석자로도 등록된 대강에게 팀 전체 리포트 목록 권한을 부여하지 않음 |

- 신규 HTTP/DB 테스트 함수 11개를 변경 단위로 실행했다. 첫 묶음 신규 5개+기존 capability 1개 **6 passed, 1.87초**; 후보 **2 passed, 2.34초**; 회원 이름 **1 passed, 1.67초**; 홈 부모 **1 passed, 1.63초**; 리포트 목록 최종 **1 passed, 1.71초**; 대강 진입 **1 passed, 1.69초**. 같은 함수의 RED/후속 재실행은 합산하지 않는다.
- 전부 SQLite·실제 HTTP·합성 데이터 근거. 새 마이그레이션/트랜잭션 변경 없음. PG·실서버·메일·푸시를 다시 검증한 결과가 아니다.

## 9. FE 하위 트랙 로컬 통합

- 사용자 “FE 남은 할일도 하위 에이전트로 계속 진행” 지시에 따라 루트 안 3개 독립 워크트리로 분담했다. 다른 트랙 의존 파일은 검증용으로 읽고 자기 소유 파일만 커밋했다. 루트는 커밋별 파일 패치를 검토·적용했으며 git merge·push·배포를 실행하지 않았다.
- `.claude/worktrees/sdd216-fe-followup`, `sdd216-fe-operations`, `sdd216-fe-entry` 사용. 임시 의존성 링크·로그·캐시는 각 워크트리 안에 둔다.

| 트랙 | 구현 결과 | 검증 기록 |
|---|---|---|
| 편성 | API/DTO, 4단계 마법사, 초안 재개·지난 기수 복제, 배정 4종, CSV/직접 이메일, 충돌 확인·관리자 사유·이탈 보호 | [fe-followup.md](fe-followup.md), 신규 초점 시나리오 22개 + 마지막 시각 표시 2개 |
| 회차 편집 | 표/모바일 카드/시트, 선택/이후 회차 일괄 변경·한 주 밀기·취소, 정규/보강 추가·회원 선택 | 같은 문서, 모델/API·마법사 13개 및 편집/추가 등 변경별 초점 검증 |
| 운영 | 멤버·이메일 결과/재시도, 설정·강사 추가/제거/주강사·수명 전이, CH30 진행자 요청/수락, 완료 귀속 정정·표시 메모 | [fe-operations.md](fe-operations.md), O1~4·OP01~12 |
| 고지·열람 | class-team-v1 고지와 저장, 참관 송출 비활성, 팀 기록·리포트 읽기, 관리자 진행/쓰기 제한 | 같은 문서, 단위/DOM 검증. 실제 LiveKit은 미확인 |
| 진입·알림 | 호출자 AbortSignal 실제 연결, 회원 코드 확인·가입, 실제 알림/푸시 부모 경로·요청 강조, 홈 영역 칩 | [fe-entry.md](fe-entry.md), E1~3·신규 18개. 인접 포함 84 passed, 2.77초 |

- 인수 검토에서 후보 API의 manage 권한 때문에 보조강사 요청 목록까지 사라지는 문제와 host_view=null인 대강의 수락 UI 누락을 발견해 수정했다. 비관리자는 팀 후보를 사용하고 요청 패널은 host_request로 판정한다.
- FE 테스트는 API·인증·LiveKit을 제어한 단위/DOM 근거다. 실제 BE 연결·메일 수신·푸시 수신·브라우저 참관 송출/회수 증거와 구분한다.
- 전체 BE/FE 회귀는 실행하지 않았다. 통합 빌드 결과는 아래 최종 인수 기록에 남긴다.
- 추가 사용자 정책 결정 없음. 기본값 유지. 실제 배포는 ① BE ② FE 순서다. 로컬 통합 완료를 SDD 전체 완료·최종 Review 승인으로 표시하지 않는다.

- 운영 후속: 향후 회차 요일·시각·소요·리마인더 입력과 기존 규칙 보존, 편성 off에서 회원 읽기 유지 및 초대 쓰기 차단. 마지막 직접 영향 2파일 **12 passed, 0.64초**; 그 전 운영 11파일 **50 passed, 4.35초**. 서로 중복되는 테스트이므로 합산하지 않는다.
- 시안 코드 대조에서 CH02 히어로·공통 사이드바 선택/프로필·CH01 5열/정기형 표기가 미구현임을 확인했다. F07에서 구현 보완하며 최종 시각 측정 여부는 아래 기록으로 구분한다.

### 최종 로컬 인수

- F07 `8dcce0f7`: CH01 5열·모바일 2열·정기형 N회차째, CH02/대기 목록 다음 회차 이미지 히어로, structure 셸 내부 사이드바 선택·프로필 스타일 보완. 시안 배경8과 실제 앱 이미지의 SHA-256 일치 확인. 추가 표시 2개 RED → 기존 포함 **16 passed, 1.04초**. 브라우저 픽셀 차이는 미측정이다.
- 기능 통합 뒤 `npm run build` **1회 종료 코드 0**: `tsc -b` 및 Vite production build 성공. Vite 표시 시간 2.46초는 타입 검사 시간을 포함하지 않는다. `.superpowers/sdd/plan/fe-integrated-build.log`.
- 빌드 경고: `src/index.css`가 참조하는 design-system tokens.css 없음, 500kB 초과 청크, 세 모듈의 동적/정적 import 혼용. 토큰 참조와 추적 대상 파일 부재는 시작 커밋 `9cff4593`에도 존재한다. 이번 변경에서 전체 디자인 토큰 생성 체계를 수정하지 않았다.
- `9cff4593` 이후 변경 96파일: frontend 61, backend 12, deploy 12, .github 1, specs 10. 출시 준비를 포함하며 다른 작업자의 변경을 새로 포함하지 않았다. 자기 파일만 명시 stage했다. 원본 verify.md와 감독자 PDF 테스트는 이 구간 diff가 없다.
- 문서 단위: 원본 40 Task·79 QA 유지. BE 추가 8 Task·12 검증 행, 편성 계획 F01~7, 운영 O1~4·OP01~12, 입장 E1~3·신규 테스트 18개. FE 계획의 F05~6은 운영/입장 트랙으로 분담한 항목이므로 Task 수를 중복 합산하지 않는다.
- 남은 검증: T36 시안 전체 case·4뷰포트 픽셀 비교, T37 실제 BE/브라우저 E2E·기기·LiveKit 권한 회수·메일/푸시 전달, 기존 토큰 CSS 경고의 시각 영향. 단위/DOM·빌드 통과로 이를 대체하지 않는다.
- 실행하지 않은 단계: 실제 BE 출시·cron/마이그레이션·스위치 전환, FE 출시, 최종 Review. 배포·push·merge 없음. 추가 사용자 정책 결정 없음.

## 10. 시안 재현·잔여 구현 보완

- 사용자 확인 뒤 CH10~15가 시안과 다른 밝은 2열 화면임을 실제 브라우저에서 확인했다. 이전 §9의 시각 마감은 CH01/02·공통 셸 일부이며 마법사 시각 완료가 아니었다.
- [visual-review.md](visual-review.md)에 점검 근거·후속 상태·실제 브라우저 결과를 기록했다. [wizard-visual-followup.md](wizard-visual-followup.md), [member-search-followup.md](member-search-followup.md), [operations-visual-followup.md](operations-visual-followup.md)에 추가 수정의 사전 기대값과 초점 테스트를 분리했다.
- 마법사는 시안의 숲 배경·640px 중앙 반투명 카드·4단계 점·스텝퍼·하단 버튼·시트로 변경했다. 시작/실제 복제 선택, 회원 후보 선택, 첫 회차 이동, 동일 초안 재개를 연결했다. 정원10 등 확정 정책은 유지했다.
- 클래스 초대용 최소 회원 후보 API를 추가했다. 기존 상담 회원 검색을 변경하지 않고 클래스 초대 권한·관계 범위 이름 검색·정확 이메일·최소 반환 필드를 적용했다. 계정/클래스 경계에서 선택과 부모 입력을 초기화한다.
- CH20 변경 필드만 전파, CH06 대강→보조강사·2열, CH30 단일 취소·사진 히어로·회차 기록 설정, 직접 탭 주소와 중복 회차 표를 보완했다.
- 로컬 통합 구현 커밋: `02d83405`~`cf992c2e`. 담당 소유 파일만 패치로 인수·명시 stage했다. push·merge·배포·외부 발송 없음.
- 검증: 신규 BE 18개(2.74초), 최종 통합 FE 초점 7파일 63개(6.36초), 통합 build 1회 종료0. 앞선 담당별 실행과 중복이므로 합산하지 않는다. 전체 BE 회귀/수집·전체 FE 회귀 없음. 빌드의 기존 토큰 CSS·청크/import 경고는 유지된다.
- 실제 로컬 BE+PG 브라우저: 8회 교대 배정·회원1명 생성, 첫 회차 진입, 단일 취소와 나머지7회 유지, 소요 시간만 이후7회 변경·교대 배정 보존, 같은 초안 재저장/재개 통과. 실제 메일/푸시 전달·LiveKit 증거가 아니다.
- 대표 10개 화면×4뷰포트 앱40장·시안40장 확보, 문서 가로 넘침0. CH11 1280×720 카드 위치·크기는 시안과 일치. 전체94case·픽셀0.1% 게이트는 미완료다.
- 원본40Task·79시나리오 유지. 추가 기대값 WV6개/MS5개/OV10개는 후속 문서 식별자 단위다. 새로운 사용자 정책 결정 없음. 출시·실기기·외부 전달·최종Review가 남아 있어 SDD 전체 완료로 표시하지 않는다.


## 바로 지금 1회차·즉시 초대 추가 구현 (2026-10-19)

- CH12 ‘바로 지금’ → 상담사는 강사 배정 단계 생략 → 회원/이메일 초대 → 서버 현재 시각의 open 1회차. 진행자는 완료 화면에서 로비로 이동한다. 수업/녹음 자동 시작 없음.
- 앱 초대는 회원 입장 경로로 연결. 이메일은 입장 링크와 코드 경로 제공. 완료 화면의 실제 발송 상태·재시도와 회원 클래스의 입장 버튼 포함. 직접 링크의 무초대 가입 우회 차단.
- 추가 6 Task·16 QA, 신규 PG21·FE41개 고유 테스트 통과. 전체 BE 회귀는 미실행. 통합 빌드 통과, 실제 PG 서버·브라우저에서 생성→앱 알림→회원 고지/준비 흐름 확인.
- 마이그레이션 없음. 원본 verify 유지. 외부 메일 전송은 없으며 로컬 대역만 사용했다. 실제 수신함·푸시·LiveKit/BLE·배포는 미확인. 사용자 정책 결정 필요 없음.
- 로컬 커밋: 요구/QA `4f00d5c7`, 마법사 `e74128c8`, 회원 입장 `157d06da`, BE `61bfba34`, 예약값 보완 `e63f6112`, 발송 상태 `c0275a70`. 현재 결과 문서/버튼 정렬 커밋이 마지막 변경이다.
- 코드/시나리오별 결과·증거·한계: [instant-class-followup.md](instant-class-followup.md). 확인 링크: https://brian-macmini.taila00d2a.ts.net:8443/classes/new


## 사진 타이틀 카드 대비 보완

- 사용자 첨부의 어두운 ‘1회차’ 제목/일시 원인은 전역 h2/p 색 지정. 클래스 개요와 목록 사진 카드에 밝은 제목(#F7F4F0)·보조 문구(#CFC6D6)를 직접 지정했다.
- CSS 구문·로컬 스타일 제공 확인. 브라우저 연결 시간 초과로 새 화면 실측은 미확인. 상세: operations-visual-followup.md OV-11~12.
