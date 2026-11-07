
## 후속 (11/7) — 100명 동시 입장 교착 근본 원인 수정

- 원인: `verify.md` 후속 Addendum 참조. 3자 고리(REST 입장 users→회차 / `capture.start` 회차 KEY SHARE→epoch / `entry.enter` epoch→users). 308 1차는 REST 쪽만 통일했고 `apply_command` 의 epoch→handler 내 클래스 잠금 역순이 남아 있었다. 기존 시험은 `_notify_participant_changed` 를 끄고 있어 이 경로가 안 잡혔다.
- 수정: 전역 순서 users → 클래스 → ClassMember → 회차 → epoch. (1) `apply_command` 가 `entry.enter` 는 epoch 전에 `lock_class_session` (`session_live_commands.py`, `CLASS_LOCK_FIRST_KINDS`), (2) `remove_participant` 도 epoch 전에 `lock_class_session` (`session_service.py`).
- 시험: `tests/sdd308/test_s4_rootcause.py` (100 동시 REST 입장→entry.enter→capture.start, 풀 20+20). 수정 전 교착 47·성공 1/100, 수정 후 교착 0·성공 100/100(3회 반복 동일).
- 회귀 묶음 전후: 기존 실패 `test_live_ingest_pg` 4건(기준선)만 남고 나머지 397 통과.
- 못 한 것: dev 100명 부하 시험(감독이 배포 후), ingest_device 의 epoch 잠금 축소는 이번 고리와 무관해 손대지 않음.

## 3차 (2026-11-07) — 측정 단계 sessions ↔ epoch 교착

### 판정

잠금 수정의 로컬 100명·40명 32초 측정 기준(교착 0, 입장 전원, projection_pending ≤49,
renew p95 ≤2초)은 통과했다. 다만 **방송 누락 0은 미충족**이며 전체 서비스 안정화 완료로 선언하지 않는다.
실제 네트워크/기기/dev 부하시험은 수행하지 않았다.

### 원인·잠금 지도·선택

상세 kind별 지도는 [lock-map-third.md](lock-map-third.md), 후보 비교는 [plan.md](plan.md),
로컬 PG 서버 증거는 [verified-local-pg-deadlock-sample.txt](evidence-third/verified-local-pg-deadlock-sample.txt)에 있다.

| 경로 | 수정 전 | 수정 후 |
|---|---|---|
| metric/device/seed/pin | epoch U → outbox/ledger INSERT의 sessions FK K | sessions N → epoch U → outbox/ledger |
| rebuild | epoch U → epoch W·outbox SELECT(최초 epoch INSERT만 sessions FK K) | sessions N → epoch U → 기존 재구축 흐름 |
| capture 4종 | sessions N → epoch U | 동일 순서, 공통 lock_epoch로 이동 |
| entry.enter/REST remove | users N → 클래스·멤버·sessions U → epoch U | 유지 |
| session.open/start/end/cancel | epoch U → users·클래스·sessions 잠금 | users → 클래스·sessions → epoch |
| v1 presence | sessions U → 참가자 U/W, epoch 없음 | 유지, device도 sessions 선잠금으로 참가자 역순 방지 |
| v2 presence/일반 drain | Redis presence / outbox processed_at W | 변경 없음 |

U=FOR UPDATE, N=FOR NO KEY UPDATE, K=FOR KEY SHARE. SQLAlchemy key_share=True만으로는 N이며
기존 capture의 KEY SHARE 주석이 틀렸음을 실행 SQL로 확인했다.

- 실제 PG 로그: outbox INSERT가 sessions FK K를 기다리고 반대편이 epoch U를 기다리는 2/3자 고리를 재현했다.
- `backend/app/services/session_live_ledger.py:77` 공통 진입에서 sessions N을 선행한다.
- `backend/app/services/session_live_commands.py:192` 클래스 선잠금 대상에 상태 전이 4종을 추가하고 system은 실제 host를 사용한다.
- `backend/app/services/class_participation_service.py:771` 잠금 설명을 정정한다.
- ledger/savepoint/commit/retry/revision/방송 구현·DB 스키마는 변경하지 않았다. N은 FK K와 호환되어
  모든 sessions 잠금을 U로 강화하는 것보다 기존 feature INSERT를 덜 차단한다.
- 제공된 dev 표본만으로 252건 전체의 PID별 command kind를 확정할 수 없다. 로컬에서 동일 구조의 고리를 확인한 것이다.

### 로컬 전후 수치

동일 PG pool 20+20, 합성 회원, 실제 PG/Redis, 회원마다 32초 측정. 원본 app snapshot을 사전 import하고
실제 ledger 파일 SHA를 기록했다. 각 시험은 단독 실행했다.

| 항목 | 원본 100명 | 수정 100명 | 원본 40명 | 수정 40명 |
|---|---:|---:|---:|---:|
| 교착(SQLSTATE 40P01, 재시도 내부 포함) | 57 | **0** | 86 | **0** |
| 입장/측정 시작/종료 | 100/100/100 | 100/100/100 | 40/40/40 | 40/40/40 |
| projection_pending | 140 | **22** | 0 | **0** |
| renew p95(초) | 5.593 | **0.700** | 1.253 | **0.027** |
| REST enter 서비스 p95(초) | 27.945 | 9.153 | 1.667 | 1.763 |
| metric 성공/실패 | 2071/39 | **3200/0** | 977/56 | **1280/0** |
| device 성공/실패 | 394/6 | **400/0** | 143/5 | **160/0** |
| 서비스 HTTPException(500) | 0 | 0 | 0 | 0 |
| 총 실행시간(초) | 65.472 | 42.327 | 83.094 | 35.074 |
| outbox/applied/emitted revision | 2967 | 4102 | 1322 | 1642 |
| emit callback 누락 조합(event_id×audience) | 미수집 | **79/8202** | **10/2642** | **11/3282** |

40명 입장 p95는 0.096초 증가한 단일 표본이다. 측정 지연·실패는 크게 개선됐으나 모든 지표에서
악화가 전혀 없다고 단정하지 않는다. 부하는 closed-loop라 느린 원본의 metric 요청 총수도 감소한다.
원본과 수정본의 시도량 차이를 감추지 않고 성공/실패 건수를 함께 기록했다.

### 방송 잔여 이슈(이번 잠금 수정 범위 외)

`class_participation_service.py:985-994`는 applied=A를 정하고 rows(done,A]를 읽는다.
그 사이 projector가 진행하면 `events_for_rows:938-942`의 최신 seq - n_rows 계산이 과거 대상 event를
replay 범위 밖으로 밀 수 있다. 예를 들어 대상 seq 101~110인데 최신 seq가 115가 되면 cursor105로
읽어 101~105를 놓치고 emitted=A를 기록한다. emit lock은 다른 broadcaster만 막고 projector를 막지 않는다.
이 함수들은 원본 76b1f0c3와 동일하며 원본40명에서도 실제 callback 누락이 관측됐다.
관측된 누락 전부가 이 한 원인이라는 실행별 상관 증거는 없으나 기존 race의 존재는 독립 코드 감사로 확인했다.
따라서 revision 연속·watermark 일치를 클라이언트 방송 누락 0의 증거로 쓰지 않는다.

### 검증 방법과 한계

- `test_s6_epoch_lock_sql.py`: 구현 전 5실패/1통과 → 구현 후 6통과. 독립 검증자도 6통과 재확인.
- `test_s5_measurement.py`: 실제 PG/Redis 측정 및 클래스/비클래스 × host/system 종료·동일 command 재시도
  4개 검증. 수정100·40 각각 5통과. outbox revision 연속 및 최종 projection/방송 watermark 일치.
- REST enter는 서비스 직접 호출, presence는 실제 v2 handler를 프로세스 안에서 호출한다.
  login/REST join/실제 Socket.IO transport·BLE·UI는 미시험. publish/drain 루프로 방송을 수행하며
  실제 주기 heartbeat 스케줄러/네트워크 클라이언트 수신은 검증하지 않았다.
- 초기 병렬 진단은 PG 연결 한도 초과로 성능 비교에서 제외했다. 원본 import 경로를 입증하지 못한
  초기 단독 run도 제외했다. 제외 사유와 수치는 evidence-third에 별도 보존했다.
- UUID 로컬 PG DB 및 Redis namespace는 삭제하지 않고 보존했다. 외부 알림은 시험에서 차단했다.

### 위험·롤백·승인 범위

sessions 선잠금 SQL 1회와 row lock 보유가 늘어난다. 측정 성능은 로컬 결과이며 dev 서버에 대한 보장은 아니다.
DB 마이그레이션이 없어 서비스 수정 커밋을 후속 승인하에 revert하면 된다. 이번 작업에서는 rollback을 실행하지 않는다.
지정 워크트리의 backend 및 specs만 수정했다. 메인 checkout은 venv 실행파일 사용만 했으며
푸시·PR·배포·서버 접속/설정 변경·재시작·dev 부하·운영 접근·메일 발송·기존 파일/데이터 삭제를 하지 않았다.

### 회귀 및 독립 검증

| 묶음 | 원본 | 수정본 |
|---|---|---|
| sdd308 | 11 통과 | 11 통과 |
| sdd319 | 18 통과·3 생략 | 동일 |
| sdd306 | 21 통과·1 생략 | 동일 |
| sdd285 | 31 통과 | 동일 |
| sdd246 archive/commands/ingest/legacy/state/t12b/transport | 248 통과·기존 4 실패 | 동일 |
| test_mb2_ws_mid_fixes / test_sdd024_session_live_ws / live_v2 필드 | 36 통과 | 동일 |
| 기존 회귀 합계 | **365 통과·4 실패·4 생략** | **동일(신규 실패 0)** |
| 신규 SQL 순서 | 5 실패·1 통과(RED) | 6 통과 |
| 신규 실제 종료/멱등 4종 | 4 통과 | 4 통과 |

12개 partition을 각각 별도 프로세스로 전후 순차 실행하여 pool 누적을 피했다. 각 120초 상한 내 완료했다.
기존 ingest 실패 4건은 허용된 venv의 `jsonschema` 모듈 누락으로 전후 node ID까지 동일하다.
기준선 실패를 숨기기 위해 의존성을 설치하거나 메인 venv를 수정하지 않았다.

독립 검증자는 서비스 diff·SQL 테스트·전체 잠금 지도·하네스 한계를 검토했다. 감독도 최종 JSON의
소스 SHA, 100/40명 목표, 12묶음 통과·실패·생략 개수와 실패 node ID 동일성을 별도 스크립트로 재확인했다.
상세 실행법과 결과는 [evidence-third/README.md](evidence-third/README.md)에 보존한다.

### 로컬 커밋

| 순서 | 커밋 | 내용 |
|---|---|---|
| 구현 전 | `777175bc` | 잠금 지도·후보 비교·plan 및 verify addendum |
| 구현·시험 | `99a4b4d3` | 서비스 수정 3파일, 신규 테스트, 로컬 PG/Redis 전후·회귀 증거 |
| 최종 문서 | 이 절을 포함하는 후속 로컬 커밋 | 검증 체크와 3차 결과·잔여 이슈 정리 |

푸시·PR·배포는 하지 않았다. 배포 가능/행사 운영 준비 완료 승인을 의미하지 않는다.
