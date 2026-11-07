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
