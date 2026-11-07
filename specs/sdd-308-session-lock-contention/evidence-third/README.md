# SDD-308 3차 로컬 검증 증거

- 지정 워크트리에서만 실행. 실제 localhost PostgreSQL 16.13과 Redis DB 11 사용.
- 시험은 합성 UUID DB와 Redis prefix를 새로 생성하며 증거 보존을 위해 삭제하지 않는다. 서비스·서버 설정 변경 없음.
- DB pool_size=20, max_overflow=20. 회원별 REST enter → entry.enter → capture.start → 32초 동안 renew/presence/device 10초, metric 1초 → capture.close. 별도 publish/drain 루프 0.1초.
- REST enter와 명령은 서비스 함수를 직접 호출한다. v2 presence는 실제 등록 handler를 in-process 호출한다. HTTP/WS 네트워크, 토큰 로그인, BLE 기기, UI, 운영 안정성 증거가 아니다. 회원은 미리 등록된 합성 ClassMember/SessionParticipant이며 REST join은 시험 범위 밖이다.
- `renew_p95_s`는 DB 명령과 Redis projection ACK 처리까지의 서비스 시간이다. `http500=0` 해석은 서비스가 HTTPException(500)을 던지지 않았다는 뜻으로 실제 HTTP 응답 측정이 아니다.
- PG `handle_error`의 SQLSTATE 40P01 전체를 세어 내부 재시도로 숨겨진 교착도 포함한다. 서버 로그 별도 샘플이 outbox FK의 sessions KEY SHARE → epoch FOR UPDATE 고리를 확인한다.
- `before-100.json`은 원본 package를 사전 import로 고정한 단독 실행이다. `ledger_source_path`, `ledger_sha256`, 잠금 여부로 구현 전/후를 구분한다.
- `excluded-parallel-diagnostic.json`은 회귀와 측정 병렬 실행으로 PG 접속 한도에 도달하여 수치 비교에서 제외했다. `excluded-unverified-import.json`은 pytest 경로 재배치 전 package를 고정하지 않아 원본 로드를 입증하지 못했으므로 제외했다.
- broadcast coverage는 DB의 `(event_id, audience)` 집합과 publish emit callback 수신 집합을 비교한다. 워터마크 일치와 실제 callback coverage는 별개이며, 네트워크 전달 보장은 포함하지 않는다. before100은 coverage 추가 전 실행이라 미수집이다.

## 재실행

backend 디렉터리에서 Python은 `../../mindbreeze_2.0/backend/venv/bin/python`을 사용한다.

```sh
S308_MEASURE=1 S308_N=100 S308_RESULT=/tmp/sdd308c-after100.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd308.test_s5_measurement tests/sdd308/test_s5_measurement.py -q -s
S308_MEASURE=1 S308_N=40 S308_RESULT=/tmp/sdd308c-after40.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd308.test_s5_measurement tests/sdd308/test_s5_measurement.py -q -s
```

구현 전 기준선은 기준 커밋 `76b1f0c3`의 backend/app을 별도 임시 경로에 보존한 뒤 `S308_BASELINE_SRC=<app 디렉터리의 부모>`를 추가한다. 이번 실행에서는 `/tmp/sdd308c-baseline-src/app`을 사용했다. runner가 `app` package를 pytest 수집 전에 고정하고 실제 ledger 경로/SHA를 기록한다. 전후 시험은 동시에 실행하지 않는다.

기존 회귀는 추가한 s5/s6 테스트를 분리하며 아래 12개 partition을 **서로 다른 Python 프로세스에서 순차 실행**한다. 단일 pytest로 모두 실행하면 하위 conftest의 session-scoped PG pool이 누적될 수 있다. 각 partition의 각 전후 run은 120초 상한을 사용한다. 원본은 `S308_BASELINE_SRC`를 추가하고 수정본에서는 해제한다.

| partition | pytest 대상 |
|---|---|
| sdd308 | `tests/sdd308 --ignore=tests/sdd308/test_s5_measurement.py --ignore=tests/sdd308/test_s6_epoch_lock_sql.py` |
| sdd319 | `tests/sdd319` |
| sdd306 | `tests/sdd306` |
| sdd285 | `tests/sdd285` |
| sdd246_archive | `tests/sdd246/archive` |
| sdd246_commands | `tests/sdd246/commands` |
| sdd246_ingest | `tests/sdd246/ingest` |
| sdd246_legacy | `tests/sdd246/legacy` |
| sdd246_state | `tests/sdd246/state` |
| sdd246_t12b | `tests/sdd246/t12b` |
| sdd246_transport | `tests/sdd246/transport` |
| ws_live_v2 | `tests/test_mb2_ws_mid_fixes.py tests/test_sdd024_session_live_ws.py tests/test_fix_live_v2_feature_fields.py` |

예: 각 대상별로 아래 명령을 한 프로세스씩 실행하며 앞 프로세스가 종료된 뒤 다음을 시작한다. pytest launcher 외부의 `subprocess.run(..., timeout=120)`으로 상한을 적용했다. stdout 전체는 임시 로그로만 남기고 JSON의 성공/실패/생략 수와 실패 nodeid를 합산한다. timeout은 성공/실패 수로 환산하지 않고 미완료로 별도 기록한다.

```sh
S308_BASELINE_SRC=/tmp/sdd308c-baseline-src S308_REGRESSION_RESULT=/tmp/sdd308c-regression-before-sdd246_ingest.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd308.test_s5_measurement tests/sdd246/ingest -q
S308_REGRESSION_RESULT=/tmp/sdd308c-regression-after-sdd246_ingest.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd308.test_s5_measurement tests/sdd246/ingest -q
```

신규 검증은 별도 집계한다: `test_s5_measurement.py`의 측정 1개 + 클래스/상담관계 × 호스트/system 실제 종료 전이·동일 command ID 멱등 4개, `test_s6_epoch_lock_sql.py` SQL 순서 6개. 100명과 40명 측정 run마다 같은 전이 4개를 실행했으므로 신규 고유 테스트 수에는 중복 합산하지 않는다.

## 최종 회귀 결과와 생략 사유

- 전후 각각 **365 PASS / 4 FAIL / 4 SKIP**, 오류·시간초과 0. 실패 nodeid 집합 완전 동일.
- 4 FAIL은 `test_live_ingest_pg.py` 계약 검증의 `ModuleNotFoundError: jsonschema`이며 허용된 기존 venv의 의존성 누락이다. 패키지 설치나 venv 변경을 하지 않았다.
- 3 SKIP은 `sdd319/test_bench_local.py`의 `SDD319_BENCH` 미지정으로 생략된 별도 벤치다. 이번 40명/100명 측정 하네스 실행과 구분한다.
- 1 SKIP은 `sdd306/test_deploy_scale.py`에서 빈 포트 값이 기본값 8000으로 대체되는 case의 명시적 skip이다.
- `regression-comparison.json`은 24개 프로세스(12개 partition × 전후)의 실제 결과·실패 nodeid·소스 SHA와 합계를 담는다. `regression-summary.md`는 같은 결과의 표다.
