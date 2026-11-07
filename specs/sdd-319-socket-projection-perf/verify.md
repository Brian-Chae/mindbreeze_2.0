# SDD-319 — Verify (구현 전 QA 체크리스트)

## 합격 기준(dev 40명×200초, 감독 재시험)
| # | 기준 | 기준선(재현) |
|---|---|---|
| V1 | projection_pending 0건 | 6건 |
| V2 | entry.enter p95 < 1.5초 | 3.05초 |
| V3 | 소켓(8000) CPU 평균 < 기준선 | 91% |
| V4 | 분석창 저장률 100%, 5xx 0 | 100%/0 |
| V5 | 기존 시험 회귀 0 | — |

## 시나리오(자동 시험, tests/sdd319)
- S1: 한 회차에 명령 N(=12) 동시 → 모두 `applied` ack(committed), projection_pending 0, drain 실행 횟수 ≤ N/2(합류).
- S2: 명령 부수효과(after-commit callback) 명령당 정확히 1회.
- S3: revision 단조(applied_revision 가 줄지 않음), outbox 전부 projection.
- S4: publish 합류 — 동시 publish 호출 중 마지막 변경 이후 반드시 1회 이상 재실행(누락 0), 동시 실행 수 ≤ 1.
- S5: leader 예외/ busy 시 follower 가 직접 drain 으로 폴백해 성공.
- S6: `projection_pending` 응답 경로(진짜 busy) 형식 불변.
- S7: 기존 sdd246/sdd285/sdd306/test_sdd024/ws 시험 전후 동일 통과.

## Addendum (11/7) — 100명 projection_pending 회귀 수정 합격 기준 (구현 전 작성)
1차 배포 후 dev 재시험(stage3.sh, 200초)에서 40명은 개선됐으나 100명에서 capture.renew projection_pending 49→801, renew p95 5.6→7.4s 로 회귀했다.
가설: follower 가 leader drain(2초)을 기다린 뒤 직접 drain 폴백(다시 락 대기 2초) → 락 경합·busy. 방송 재실행 루프의 스레드 점유.

| # | 기준 | 40명 | 100명 |
|---|---|---|---|
| A1 | projection_pending | 0 | ≤ 49 (11/5 이하) |
| A2 | entry.enter p95 | ≤ 1.5s | 입장 500 0건 |
| A3 | capture.renew p95 | ≤ 1.5s | ≤ 5.6s |
| A4 | features_batch p95 | ≤ 1.0s | — |
| A5 | 저장률 / 5xx | 100% / 0 | 저장 100% |
| A6 | 정합성 | revision 단조, 부수효과 정확히 1회, 방송 누락 0 (heartbeat self-heal 근거) | 동일 |

로컬 시나리오(tests/sdd319 보강): 100명 상당 동시성에서 (a) projection_pending 비율, (b) follower 총 대기 ≤ drain_wait_s(이중 대기 제거), (c) publish 재실행 횟수 상한·양보, (d) 기존 S1~S7 유지.

## Addendum 2 (11/7) — 3차: 동시 입장 대기줄(클래스별 동시 처리 상한) 합격 기준 (구현 전 작성)
운영 100명 동시 입장 시험(11/7 11:22): login 100/100, join 60/100·enter 40/40 이 60초 ReadTimeout, 소켓 프로세스 로그에 `QueuePool limit of size 20 overflow 20 reached` 약 120건, CPU≈0.
가설(코드 근거): `get_current_user`(deps.py:24)가 요청 시작에 DB 연결을 잡아 응답까지 쥔 채, join(`class_code_service.py:167` 클래스 행 FOR UPDATE)·enter(`lock_class_session`, `_lock_session_for_capacity`) 의 같은 행 잠금을 기다린다 → 100 요청이 연결 40개를 전부 점유해 풀 고갈.
대책: 클래스(회차)별 동시 처리 상한 대기줄을 인증·DB 의존성보다 **앞**에 둬서 대기 중 연결 0개. 대기 시한 초과 시 503 + Retry-After(재시도 가능 오류).

| # | 기준 | 값 |
|---|---|---|
| E1 | 100명 동시 입장(5초 내 login→join→enter) join/enter 성공 | 100/100 |
| E2 | 500 응답 | 0건 |
| E3 | 입장(join+enter) p95 / 최대 | ≤ 20초 / ≤ 45초 |
| E4 | QueuePool timeout 로그 | 0건 |
| E5 | 40명 입장 p95 | ≤ 5초 |
| E6 | 측정 단계 저장 | 100% |
| E7 | 기존 시험 회귀(tests/sdd319·sdd306·sdd285·sdd246, class join/enter 관련) | 0 |

자동 시험(tests/sdd319/test_entry_queue.py):
- Q1: 같은 키 동시 N 요청 → 동시 실행 ≤ 상한, 전부 결국 처리(순서 FIFO 근사).
- Q2: 다른 키(클래스)는 서로 막지 않는다.
- Q3: 대기 시한 초과 → 503 `entry_busy` + Retry-After, 슬롯·대기 카운터 누수 0.
- Q4: 대기 중 DB 연결 미점유(풀 크기 2 로 20 요청이 전부 성공, checkedout ≤ 상한).
- Q5: 예외·취소 시 슬롯 반환. 상한 0 이면 비활성(기존 동작).
- Q6: 로컬 실 PG 로 100 동시 join/enter 전/후(풀 20+20).
