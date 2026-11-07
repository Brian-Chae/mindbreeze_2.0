# SDD-319 — Summary

## 측정(dev, py-spy 50Hz, 40명×200초 재현)
| 항목 | 값 |
|---|---|
| 스레드 샘플 중 metric/device 직후 방송(`publish_session_sync→publish_pending→drain`) | 72% |
| `_acquire`(projector 락 20ms 폴링) | 18% |
| SQLAlchemy 실행 / Redis 왕복 / DB ping | 24% / 약 20% / 약 8% |
| 소켓 CPU 평균/최대 | 91% / 120% |
원인: metric 건별 방송과 명령 drain 이 같은 회차에서 직렬 중복 실행되어 락 경합(busy → projection_pending).

## 수정(backend 만)
- 신규 `app/services/live_single_flight.py`: 방송 합류(`run_coalesced`, dirty 재실행으로 누락 0), 명령 drain 합류(`coalesced_drain`, leader 결과 공유·미달 시 직접 drain 폴백).
- 적용: `publish_session_sync`, `run_live_command`, `publish_pending` 내부 drain. 프로토콜·응답 형식·스키마 변경 없음.

## 시험
| 구분 | 결과 |
|---|---|
| 신규 tests/sdd319 (단위 6 + PG/Redis 1) | 7 통과 |
| 회귀(sdd246/285/306, sdd024/026, live_v2, metric_profile, mb2_ws_mid_fixes) | 360 통과, 4 실패 = 변경 전에도 동일 실패(test_live_ingest_pg 4건, 신규 0) |

## 로컬 전/후(실 PG+Redis, 방송 30스레드+명령 20스레드, 8초)
| 지표 | 전 | 후 |
|---|---|---|
| 명령 처리량 | 1122 | 2084 |
| 명령 p50 / p95 | 52 / 343ms | 18 / 63ms |
| drain 호출/명령 | 3.05 | 0.84 |
| projection_pending | 0 | 0 |

## dev 재시험 비교표(감독 기입)
| 지표 | 기준선(11/7 dev) | 변경 후 | 합격 |
|---|---|---|---|
| entry.enter p95 | 3.05초 | | <1.5초 |
| capture.renew projection_pending | 6건 | | 0 |
| capture.renew p95 | 2.86초 | | 하락 |
| metric p95 | 1.81초 | | 하락 |
| 소켓 CPU 평균/최대 | 91%/120% | | 평균 하락 |
| 분석창 저장률 / 5xx | 100% / 0 | | 유지 |

## 롤백
해당 커밋 revert 1건(DB·스키마·설정 변화 없음, 서비스 재시작만).
