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

---
## 2차 — 100명 projection_pending 회귀 수정 (11/7)

### 1차 dev 재시험(감독, 같은 서버, stage3.sh 200초)
| 항목 (p95) | 40명 전(F40) | 40명 후(S40) | 100명 전(Q100, 11/5) | 100명 후(S100) |
|---|---|---|---|---|
| ws entry.enter | 3.05s | 1.26s | 10.3s | 1.75s |
| ws capture.renew | 2.86s | 0.98s | 5.6s | **7.4s** |
| ws metric | 1.81s | 0.65s | 3.3s | 2.2s |
| REST enter | 2.70s | 2.96s | 21.8s | 13.2s |
| REST features_batch | 0.52s | **1.77s** | 0.16s | 0.21s |
| projection_pending | 6 | 0 | 49 | **801** |
| 소켓 CPU 평균/최대 | 99/120% | 62/109% | 112/121% | 107/121% |
| 저장 | 7995/8000 | 8000/8000 | 15200/15200 | 18800/18800 |

### 원인(로컬 실 PG+Redis, 100명 상당: 방송 75스레드+명령 50스레드, 8초)
- 1차 구현(`coalesced_drain`)은 follower 가 leader 를 `wait_s`(2s) 기다린 뒤 **미달/지연 시 직접 drain 폴백(추가로 락 대기 최대 2s)** → 이중 대기. 로컬 풀 20·1차 구현: 명령 275건, p50 2.1s, 폴백 421회/drain 429회, projection_pending 11.
- 대기 중 follower 가 **DB 연결을 쥔 채** 대기(`publish_pending` 의 emit-lock 대기 포함) → 스레드 수가 풀(20+20)을 넘으면 leader 자신도 연결을 못 얻어 drain 이 2s 가까이 걸림(drain p50 223ms/max 2.5s). 풀 100으로 늘리면 같은 코드에서 p50 163ms·pending 0 — 즉 병목은 합류 로직 자체보다 **대기 중 연결 점유 + 폴백 이중 대기**.
- 방송(need=0)이 명령 leader 뒤에서 최대 2s 대기해 방송 스레드가 쌓임. publish 재실행 최대 20회 연속이 스레드를 독점.
- 40명 features_batch 0.52→1.77s: REST 프로세스 코드는 변경이 없어 DB 경합 간접 영향 또는 측정 편차로 판단(로컬 재현 불가, dev 재시험에서 재확인 필요).

### 수정(backend 만, 프로토콜·응답 불변)
| 항목 | 내용 |
|---|---|
| 폴백 이중 대기 제거 | follower 는 대기자 큐에 등록. leader 종료 시 revision 충족자는 결과 공유, 미충족자 중 최신 revision 1명이 **다음 leader 로 handoff**(락 재경합 대신 직렬 이어받기). 대기는 `wait_s` 한 번만, 초과 시 `busy` 반환 → 기존 projection_pending ACK 경로 |
| 방송 경로 비대기 | `need_revision=0`(publish_pending) 은 drain 진행 중이면 대기 없이 건너뜀(그 drain·다음 방송이 반영) |
| 연결 반납 | 대기 전 `db.rollback()`(before_wait), emit-lock 대기 전에도 rollback → 풀 고갈 방지 |
| publish 재실행 | 상한 20→5, 재실행 사이 5ms 양보. 남은 dirty 는 다음 방송 호출/heartbeat self-heal 이 반영(누락 0 근거: 워터마크 `emitted` 는 방송 성공 후에만 전진) |
정합성: revision 단조·부수효과 1회(run_live_command 구조 불변, `_run_callbacks` 그대로)·누락 0(워터마크+heartbeat).

### 로컬 전/후(풀 20, 100명 상당, 8초, 같은 하네스)
| 지표 | 1차 구현 | 2차 |
|---|---|---|
| 명령 처리 | 248 | 2454 |
| p50 / p95 | 2090 / 2566ms | 98 / 135ms |
| projection_pending | 7 | 0 |
| 40명 상당 p50/p95 | 17/29ms | 10/49ms (pending 0) |

### 시험
tests/sdd319 12 통과(신규 R1~R5) + 벤치 2 skip, 회귀 묶음 360 통과·4 실패(test_live_ingest_pg 기준선과 동일, 신규 0).

### 위험·롤백
handoff 대기자가 예외 시 leader 가 그대로 전파, 대기자는 시한 초과 busy→클라 재시도. 회귀 시 이 커밋 revert 1건(DB·설정 없음, 서비스 재시작만).
