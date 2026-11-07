# 기존 회귀 전후 비교

| 묶음 | 원본 | 수정본 |
|---|---:|---:|
| sdd308 | 11 PASS / 0 FAIL / 0 SKIP | 11 PASS / 0 FAIL / 0 SKIP |
| sdd319 | 18 PASS / 0 FAIL / 3 SKIP | 18 PASS / 0 FAIL / 3 SKIP |
| sdd306 | 21 PASS / 0 FAIL / 1 SKIP | 21 PASS / 0 FAIL / 1 SKIP |
| sdd285 | 31 PASS / 0 FAIL / 0 SKIP | 31 PASS / 0 FAIL / 0 SKIP |
| sdd246_archive | 29 PASS / 0 FAIL / 0 SKIP | 29 PASS / 0 FAIL / 0 SKIP |
| sdd246_commands | 33 PASS / 0 FAIL / 0 SKIP | 33 PASS / 0 FAIL / 0 SKIP |
| sdd246_ingest | 19 PASS / 4 FAIL / 0 SKIP | 19 PASS / 4 FAIL / 0 SKIP |
| sdd246_legacy | 50 PASS / 0 FAIL / 0 SKIP | 50 PASS / 0 FAIL / 0 SKIP |
| sdd246_state | 22 PASS / 0 FAIL / 0 SKIP | 22 PASS / 0 FAIL / 0 SKIP |
| sdd246_t12b | 11 PASS / 0 FAIL / 0 SKIP | 11 PASS / 0 FAIL / 0 SKIP |
| sdd246_transport | 84 PASS / 0 FAIL / 0 SKIP | 84 PASS / 0 FAIL / 0 SKIP |
| ws_live_v2 | 36 PASS / 0 FAIL / 0 SKIP | 36 PASS / 0 FAIL / 0 SKIP |

전후 합계 동일: {'passed': 365, 'skipped': 4, 'failed': 4}. 오류·시간초과 없음.

전후 동일 4건 ModuleNotFoundError: jsonschema (허용 venv 의존성 누락)

신규 시험을 기존 회귀 합계에 중복 합산하지 않았다. 측정·상태전이 4개와 SQL 잠금 순서 검증은 별도다.

SKIP 4건: SDD-319 별도 벤치 3개(`SDD319_BENCH` 미지정), SDD-306 빈 포트 입력 기본값 처리 case 1개. 전후 동일하다.
