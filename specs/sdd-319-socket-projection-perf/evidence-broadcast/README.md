# SDD-319b 방송 누락 로컬 검증

## 범위 및 재현

기준 커밋 `68229ab6`, 지정 `mindbreeze_2.0-sdd319b` 워크트리에서 localhost PostgreSQL/Redis만 사용.
UUID별 합성 시험 DB와 Redis prefix는 삭제하지 않고 보존한다. 외부 알림은 하네스에서 차단한다.
`test_s5_measurement`의 PreserveEvidence 플러그인으로 기존 fixture 삭제 teardown을 교체한다.
PG 연결 불가는 skip. 실제 Socket.IO transport·클라이언트 수신·화면·BLE·소켓 CPU 시험이 아니다.

backend 디렉터리에서:

```sh
S308_MEASURE=1 S308_N=100 S319_REQUIRE_BROADCAST=1 S308_RESULT=../specs/sdd-319-socket-projection-perf/evidence-broadcast/after-100.json ../../mindbreeze_2.0/backend/venv/bin/python -m tests.sdd308.test_s5_measurement tests/sdd308/test_s5_measurement.py -q -s
```

40명은 `S308_N=40`, 별도 결과 경로를 사용한다. 전후/회귀 실행은 반드시 순차로 한다.
기준선은 같은 하네스에서 S319_REQUIRE_BROADCAST를 해제하고, 수정 전 app을 별도 보존하여
`S308_BASELINE_SRC`로 지정한다. 이번 기준선 app 경로는 baseline-path.txt에 있다.
`ledger_source_path`와 `broadcast_source_sha256`으로 로드 소스를 확인한다.
회귀는 `python3 specs/sdd-319-socket-projection-perf/evidence-broadcast/run_regression.py before` 또는
`after`로 12묶음을 각 별도 프로세스·120초 상한에서 실행한다. 신규 방송 단위시험은 별도 실행한다.

## 누락 판정

DB outbox의 `(event_id,audience)` 기대 집합과 callback 성공 집합을 비교한다. 계측은 실제
replay cursor·반환 집합·ReplayUnavailable 사유를 보존한다. 부하가 끝난 뒤 누락 이벤트의
stream seq를 조회한다. `stream_seq ≤ 실제 cursor`이며 replay 성공/반환 없음일 때만 seq_shift로
확정한다. ReplayUnavailable, callback exception, 미분류는 구분해 기록하며 각 누락의 상세를
broadcast_missing_details에 남긴다. 하네스의 callback은 메모리 수집이므로 실제 소켓 실패 재현은
아니다. 누락이 없어도 실제 사용자 화면 전달을 증명하지 않는다.

## 감독의 dev 관측

| 로그 키워드 | 의미·판정 |
|---|---|
| `broadcast_progress` | `applied`, `emitted`, 배치 `expected`, 실제 callback `sent`, 첫 미완료 행 `missing` |
| `broadcast_gap` | 누락 또는 revision 구멍. 해당 행 전에 중단. 정상 시험 목표 0건 |
| `broadcast_emit_failed` | callback 예외. 목표 0건. 일부 전송 성공 후 실패하면 재시도 중복 가능 |
| `broadcast_lease_lost` | 락/epoch/status 변경으로 checkpoint 거절. 목표 0건 |
| `방송 되감기 불가` | replay 실패. pair별 60초 억제, 발생 시 원인 확인 |

시험 동안 progress의 expected=sent/missing=0, 종료 후 applied=emitted와 outbox revision 일치,
위 실패 로그 0을 함께 확인한다. 이는 서버 callback 단계 증거이며 네트워크 전달 증거가 아니다.
종료/rebuild로 emitted를 정렬하는 기존 경로가 있으므로 watermark만으로 누락0을 판정하지 않는다.
dev에서 정확한 event_id×audience coverage가 필요하면 감독의 소켓 수집 집합과 합성 시험 outbox
기대 집합을 비교해야 한다. 서버 로그만으로 클라이언트별 수신100%를 주장하지 않는다.

## 알려진 한계와 롤백

- stream retention을 넘겨 실제 이벤트가 사라지면 미완료 행에서 후속 방송도 대기한다.
  클라이언트 heartbeat의 snapshot resync는 기존대로 작동하지만 방송 성공으로 집계하지 않는다.
- callback 자체가 5초 락 TTL보다 오래 정지하면 이미 진행 중인 외부 전송을 취소하지 못한다.
  이후 checkpoint는 소유권을 검사하고 stale watermark 쓰기를 막는다. 엄격한 네트워크 수신 순서는 별도 문제다.
- projection 후 revision이 많이 증가하면 보수적 범위는 과조회할 수 있다. 기존 stream retention 상한 내이며
  보통 경로의 Redis 왕복은 snapshot/replay 그대로이고 checkpoint는 시작/종료와 1초 간격이다.
- 마이그레이션 없음. 감독 승인 후 구현 커밋을 revert하는 것이 롤백 경로다. 여기서는 실행하지 않는다.
- SDD-285 기존 'replay 불가에도 watermark 전진' 시험 하나는 요구 변경으로 '유지'로 갱신했다.
  테스트 기대를 몰래 완화한 회귀 통과가 아니라 새 계약의 검증이며 전후 비교에 따로 명시한다.

기록된 BEFORE의 SDD-285는 시험 기대 변경 전에 실행했다. 현재 변경된 유지 계약 시험을 그대로
baseline app에 다시 실행하면 해당 1건은 추가 실패가 정상이다. 같은 당시 회귀를 재현하려면
`68229ab6`의 `test_s4_replay_unavailable.py`도 별도 시험 사본에 사용해야 한다.
`run_regression.py`는 기존 증거 덮어쓰기를 거절하므로 재시험은 별도 evidence 폴더 사본을 사용한다.
`python3 specs/sdd-319-socket-projection-perf/evidence-broadcast/verify_evidence.py`는 네트워크·DB 없이
전후 실제 소스 SHA, 누락72건 원인, 합격 수치, 회귀 실패 node ID를 독립 검산한다.
