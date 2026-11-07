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

## Addendum 3 (2026-11-07) — SDD-319b 방송 누락 수정 (구현 전)

브리프의 설계 선커밋 → backend 구현·로컬 검증 지시를 수행한다. 작업 브랜치는
`sdd/319-broadcast-gap`, 기준 `68229ab6`. 프로토콜·응답·프론트·서버 설정은 변경하지 않는다.

### 원인 및 후보 선택

100명 기준선 계측: 기대 8202쌍 중 62쌍 누락, 모두 실제 stream seq가 replay cursor 이하인
seq_shift로 확정. replay 불가/emit 실패/기타 0. 결정적 단위시험도 seq101~110 대상에 최신115를
주면 cursor105로 앞 5개 누락, 일부 audience 누락에도 emitted가 3까지 진행함을 재현(2 실패·1 통과).

| 후보 | 판단 |
|---|---|
| a. outbox에 projection seq 저장 | 정확하나 DB/Redis 이중 기록·스키마 변경이 필요하여 보류 |
| b. 보수적 replay + 완전성 검사 | 채택. 기존 snapshot Lua가 원자적으로 반환하는 applied_revision 활용, 추가 정상 경로 Redis 왕복 없음 |
| c. projector/방송 공통 lock | 느린 emit이 명령 projection을 막아 renew 성능 위험, 제외 |

`A=max(rows.revision)`, snapshot의 seq=S/applied=B에 대해 `cursor=max(0,S-n-max(0,B-A))`.
동일 epoch에서 revision당 해당 pair의 seq는 최대 1 증가하므로 B-A는 대상 이후 증가량 상한이다.
대상은 (done,A]의 연속 outbox 행이며 정확한 event_id/audience/domain으로 걸러 revision 순 정렬한다.
과도하게 오래된 하한으로 log_truncated면 stream 첫 seq-1까지 clamp하여 1회 재조회한다.
실제 기대 pair가 사라졌으면 복원했다고 간주하지 않는다. 최초 누락 행 이전의 완전한 prefix만
방송·watermark 처리한다. 기존 SDD-285의 '미방송 상태에서도 watermark 전진' 시험은 이 요구와
충돌하므로 의도된 변경으로 별도 표시한다. heartbeat snapshot 복구는 유지된다.

### 구현 계획 및 검증

- [x] `class_participation_service.events_for_rows`: 원자 snapshot 하한, 최초 epoch 고정,
  trim 재조회, 정확한 pair 필터. 결정적 seq 선행·절단·epoch 변경 시험.
- [x] `publish_pending`: contiguous revision/all-audience coverage, emit 실패 시 재시도,
  lock token/epoch 검사 및 갱신, 단조 watermark 원자 쓰기. 누락·실패 로그에는 payload/개인정보 제외.
- [x] 단위시험: audience 일부 누락, revision hole, callback 실패, lock 상실, epoch 교체.
- [x] 실제 로컬 PG/Redis 100명·40명 순차 재시험: callback 누락0, 교착0, pending≤49,
  renew p95≤2초. 실제 네트워크/화면/소켓 CPU는 감독 dev 시험 범위.
- [x] 기존 회귀 12묶음 전후 독립 프로세스 실행, 실패 nodeid 비교. PG 불가 skip,
  UUID DB/Redis 증거 보존, 삭제 teardown 차단.
- [x] summary·재현 명령·전후 수치·위험·dev 로그 관측법 기록, 독립 검토 후 로컬 커밋.

### 위험과 관측

stream retention 초과로 실제 이벤트가 사라지면 gap을 숨기지 않고 정지한다. 중복은 허용한다.
배치 중 lock 갱신 및 최종 CAS로 stale broadcaster의 watermark 쓰기를 막는다. callback 자체가
락 TTL보다 오래 정지하는 경우 이미 진행 중인 외부 전송까지 취소할 수는 없으므로 엄격한 네트워크
수신 순서는 보장하지 않는다. 일반 경로에서 projector 락은 추가하지 않는다.
`broadcast_gap`, `broadcast_emit_failed`, `broadcast_progress`, `broadcast_lease_lost` 로그로
applied/emitted/expected/sent/missing을 확인한다. callback 성공은 클라이언트 전달 ACK가 아니다.
