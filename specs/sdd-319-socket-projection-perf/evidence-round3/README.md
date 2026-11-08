# round-3 로컬 검증

기준 `4854d33c`, 설계 선커밋 `c00e0ed5` 및 실험 보완 `794a0ece`, 최종 SQL 축소 `90341fed`, 브랜치 `sdd/319-renew-light-3`.

## 변경

내장 capture.renew + commit=True만 session SHARE → epoch SHARE → 원장 키별 transaction
advisory lock을 사용한다. stream FOR UPDATE와 ledger 동일 commit은 유지된다. 다른 명령/종료/
추방/rebuild는 기존 배타 잠금을 사용하므로 renew와 동시에 상태 경계를 바꾸지 못한다.
공유 잠금을 제거하거나 권한을 캐시하지 않는다. handler 교체/commit=False는 기존 배타 경로다.

cold epoch는 SHARE 아래 INSERT ON CONFLICT로 생성한 뒤 SHARE로 읽는다. 공유→배타 승격은 없다.
SHA256(session UUID bytes + actor UUID bytes + command UUID bytes)의 앞64비트 signed값으로
원장 키를 직렬화한다. 해시 충돌은 불필요한 대기를 만들 수 있으나 정합성을 깨지 않는다.
리스 만료 active stream의 기존 재연장 의미, generation/entity version/epoch 검사, outbox 및
방송 ACK 계약은 유지한다. 전용4worker 풀은100/40명 모두renew4초대로악화하여미채택했다. 최종 namespace는기준선과동일하다.
최종은내장renew의 SAVEPOINT/RELEASE 및 중복session조회3SQL왕복을줄인다. 결정적거절은변경전이며
예상밖오류는전체rollback한다. custom/commitFalse는기존savepoint를유지한다.

## 재현과 증거

- `run_socket.py before|after|pool-after|sql-after 100|40 [고유접미사]`: 기존 round-2 localhost 하네스 그대로,32tick/snapshot120/
  CPU15ms per25ms/5초 합성 heartbeat. source manifest와 실행 전후 SHA를 보존한다.
- `run_regression.py before|after`: 기존12묶음, 신규 round3 PG시험은 별도 집계한다.
- 신규 `test_round3_renew_lock.py`: 실제 PG19개. 타 stream 병렬 시험 baseline RED 확인 후 GREEN.
- PG 연결 불가는 skip, UUID 합성 DB와 Redis 증거는 삭제하지 않는다.
- `verify_evidence.py`: 네트워크 없이 소스 SHA, 저장/close/방송 경계, 전후 회귀를 검산한다.

`baseline-path.txt`는 당시 로컬 임시 app 사본 경로다. 사본은 기준 커밋의 tracked app 파일만 포함한다.
후속 재현 시 같은 기준 커밋 app 사본을 사용해야 한다. 메인 체크아웃은 실행용 venv만 읽었다.

## 해석 한계

로컬 측정은 실제 Socket.IO handler와 PG/Redis를 사용하지만 로그인/REST join은 주입한다.
entry는 WS entry.enter이며 REST 입장 지연을 증명하지 않는다. heartbeat는 실제 공개 서비스의
읽기/publish/emit을 호출하는 합성 스케줄러이고 auth/join 전체 수명주기의 재현은 아니다.
CPU는 서버와 같은 프로세스의 client 스레드를 포함한다. ACK를 기다리는 tick은 지연시 종료도 늦어진다.
방송/client 누락은 (event_id,audience) 합집합 검산이며 개별100명 모두의 화면 수신을 뜻하지 않는다.
최종 revision settle은 측정 종료와 별도다. 실제 EEGFeatureWindow 개수로 durable 저장을 확인한다.

제공 Y100 로그에는 reanchor pending5 및 metric timeout4의 개별 trace가 없다. 집계 max만으로
원인을 확정하지 않는다. 작은 실패도 기록하고 round-4 감독 측정에서 재확인한다. 로컬 기준선의
metric timeout을 포함한 실패 표본은 보존한다. 단일 로컬 표본과 dev의 p95/CPU는 직접 비교하지 않는다.

서버 접속/변경·푸시·PR·배포·dev/운영부하·메일·삭제·시크릿 출력 없음. 마이그레이션 없음.
승인 후 구현 커밋 revert로 롤백할 수 있으며 이번 작업에서는 실행하지 않는다.

`after`는 공유 잠금 단독 중간 변형(각2표본), `pool-after`는 미채택 전용4worker 풀 변형, `sql-after`는 최종 SQL 축소 변형이다.
중간 변형100명 renew악화를 은폐하지 않고 보존했다. 최종 검산의 소스SHA는 sql-after를 사용한다.

최종 session_epoch_lock_ms에는 session/epoch 공유 잠금과 원장 키별 advisory 대기가 포함된다.
100명 metric timeout이 남은 부하시험은 실패로 보존한다. verify_evidence.py의 통과는 저장/잠금/
소스/기록 정합성 검산이며 전체 부하시험 성공이나 dev 목표 달성을 뜻하지 않는다.
