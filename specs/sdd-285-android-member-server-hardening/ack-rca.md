# SDD-285 — "시작 응답(ACK) 유실" 가설 검증 (2026-11-04)

범위: 서버·앱 **코드 읽기** + 로컬 PG 임시 DB 재현(`backend/tests/sdd285/test_ack_loss_repro_pg.py`, 5건 통과). 운영·dev DB 접속 없음, 앱 빌드·실행 없음.
분류: **확정**(코드/재현) / **가설** / **확정 불가(기기 증거 없음)**. 4명의 기기 로그는 확보 불가.

## 1. 결론 (한 줄씩)
1. "교착 → ACK 유실" **단독으로는 이 상태를 만들지 못한다.** 서버·앱 모두 같은 command_id 재전송으로 스스로 복구하도록 설계돼 있고, 재현으로 확인했다(R1·R2).
2. 4명의 실제 상태(시작 적용 1회, 이후 새 start 0회, 75분간 `streamId=null`, 소켓은 READY)는 **"앱이 시작 명령을 `rejected`(종결) 또는 채택 실패로 처리하고 다시 시도하지 않는 경로"**와만 일치한다. 코드에 그 경로가 존재함(§3). 실제로 그 경로를 탔는지는 **확정 불가(기기 증거 없음)**.
3. 서버만으로 **재발을 완전히 막을 수는 없다**(앱의 종결 처리). 다만 서버가 (a) 종결형 거절을 `retryable`로 바꾸고 (b) 앱이 못 받은 stream을 다른 경로로 알려주면 앱 수정 없이 완화된다(§5). 확실한 차단은 앱 수정(A1/A2).

## 2. 서버 `capture.start` 흐름 (확정, 줄 단위)
`session_live_namespace.py:2237-2252 live_command` → 게이트 검사(아래 ※) → `_run_command_sync`(:2211) → `class_participation_service.run_live_command`(:942) → `apply_command`(`session_live_commands.py:149`).
- `apply_command`: `lock_epoch`(epoch 행 FOR UPDATE, 회차 내 명령 직렬화) → ledger 조회(있으면 `duplicate` 재생, :163-169) → `sessions` 조회 → handler(SAVEPOINT) → ledger insert → commit.
- `_handle_capture_start`(:297): `session_participants` FOR UPDATE → 활성 stream FOR UPDATE → generation=max+1 → `CaptureStream` INSERT(**FK로 `sessions` 행 FOR KEY SHARE**) → outbox → ACK result(`stream_id`·`participant_id`·`owner_generation`·lease).
- 예외/교착: `apply_command`는 `rollback` 후 **재raise**(:204-206). `_run_command_sync`에 except가 없고 python-socketio는 핸들러 예외 시 **ACK 패킷을 보내지 않는다**(`_handle_event_internal`: 예외면 `_send_packet` 도달 못 함). → 앱은 응답 없음. ledger·stream은 롤백되어 **남지 않음** → 같은 ID 재시도 시 정상 적용(R2).
- commit 후 ACK 지연: 투영(Redis drain) 실패면 `retryable, committed:true, code=projection_pending|live_unavailable`(:981-986), 권한 revision이 바뀌면 `scope_stale`(:987-999). 모두 앱이 같은 ID로 재시도하면 `duplicate`로 결과 재생.
- ※ **게이트 검사는 ledger 조회보다 앞**이다: `v2_disabled`, `session_mismatch`, `access_revoked`(REVOKED/TERMINAL 또는 `_ensure_scope` 실패), **`token_expired`(:2246)**, `invalid_message`는 `error_ack` 기본값 **status=`rejected`**로 나간다(`session_live_v2.py:353`, `retryable`은 not_joined·not_ready뿐). 이미 commit된 명령이라도 재전송이 이 게이트에 걸리면 `rejected`를 받는다.

## 3. 앱(Android) 상태 기계 (확정, 코드)
- 시작: `NativeRuntime.kt:73` — READY 전환 시 `streamId==null && !captureRequested`면 `startCaptureIfAllowed()`; **`captureRequested`는 READY가 아닌 상태로 갈 때만** `streamId!=null`로 재설정(:74).
- 전송/재시도: `sendCommand`→2초 타임아웃→같은 ID로 0.5/1/2/4초 재시도(`LiveSession.kt:543-565`). 재연결 시 `onReady→flushCommands`로 pending 재전송. 30초 내 확정 못 하면 `expireIfStillPending`→`intent_expired`+`resync`(→READY 아님→`captureRequested=false`→READY 복귀 시 **새 ID로 재시작**).
- 응답 처리 `onCommandAck`(:566-586): `applied|duplicate|rejected`는 **전부 pending 제거**. `rejected`는 채택 없이 `acks`에만 적재하고 **재시도 없음**. 채택 `adoptCaptureResult`(:418-436)는 `stream_id/participant_id` 빈 값·generation 형식 오류면 조용히 `return`.
- 따라서 종결 후 상태: `state=READY`(소켓 정상), `streamId=null`, `captureRequested=true`(전환이 없어 재설정 안 됨), pending 없음 → **다시 보내지 않고 renew(`streamId!=null` 필요)·device 보고(`streamId` 필요)도 0건**. 운영 관찰(renew 0, device 2건, 75분)과 일치. 11:28의 `capture.start` 재전송은 종료 직후 소켓 상태 전환(READY 재진입)에서 `captureRequested`가 리셋된 결과로 설명된다.
- **단순 ACK 유실은 이 상태와 모순**: ACK만 유실됐다면 (i) 재전송 → `duplicate` 채택 또는 (ii) 30초 만료→resync→**새 ID start → generation 2**가 생긴다. 운영 4명은 전원 `capture_stream` generation 1, 적용 start 1회뿐이다(analysis.md §2).

## 4. 재현 결과 (`backend/tests/sdd285`, 로컬 PG 임시 DB, 5/5 통과)
| # | 시험 | 결과 |
|---|---|---|
| R1 | commit 후 ACK 유실 가정, 같은 ID 재전송 | `duplicate`로 동일 `stream_id`·`participant_id` 재생, stream 1개 |
| R2 | handler에서 교착성 예외 주입 | 예외가 호출자에 전파(ACK 없음), ledger·stream **0건**, 같은 ID 재시도 `applied` |
| R3 | 새 ID로 재시작 | 이전 stream `superseded`, generation 2 (운영 4명은 이 흔적 없음 → 새 ID 재시작이 없었다) |
| R4 | `sessions` 행 락을 쥔 트랜잭션과 `capture.start`가 락 순서 반대 | **실제 교착 발생**(PG `deadlock detected`) — 서버 코드 구조상 가능 |
| R5 | 40명 동시 `capture.start`만 | 교착 0, 40/40 `applied` (epoch 락 직렬화) |
- 해석: 교착은 `capture.start` 단독이 아니라 **다른 경로(입장·참가자 갱신 등, `sessions`/`session_participants` 행을 먼저 잡는 쪽)와의 락 순서 역전**에서만 난다. 운영 교착 11건 중 `session_participants`·`users` SELECT가 포함된 것과 일치. 4건의 start 교착은 재시도로 10:13:05에 적용(2명). 나머지 2명(`518675`·`ac1a78`)은 교착 목록에 없으므로 교착은 필요조건이 아니다.
- **못 한 것**: ① 앱 상태 기계 실행 재현(앱 빌드·gradle/xcode 금지) — §3은 코드 읽기이며 `LiveSessionTest.kt`에 "rejected 후 재시작 없음" 시험을 추가하는 것을 후속 권고. ② 소켓 단 `token_expired`/`access_revoked` 게이트가 재전송에 실제로 걸렸는지(서버 로그에 command_id별 ACK 기록 없음). ③ 입장 폭주를 실서버 소켓으로 재현(Redis·socket.io 하네스 미구성).

## 5. 해결안 비교
| 안 | 내용 | 이 상태를 막는가 | 앱 수정 | 비고 |
|---|---|---|---|---|
| S1 | 게이트 거절 중 일시 사유(`token_expired`, `access_revoked` 중 재인가 가능한 경우, `scope_stale`)를 **`retryable`**로 변경 | 종결형 거절 경로 제거 → **가설 경로 차단** | 불필요 | 서버 코드 소폭. 재전송이 영구 `rejected`가 되는 것을 막음 |
| S2 | `_run_command_sync` 예외를 잡아 `retryable`(retry_after) ACK 반환 | 교착 시 "무응답"을 명시 재시도로 | 불필요 | 현재도 2초 타임아웃으로 복구되므로 효과는 지연 단축 |
| S3 | 교착 완화: 락 순서 통일(항상 epoch→sessions), 입장 폭주 구간 부하 분산, FK KEY SHARE 경합 축소 | 교착 빈도↓, 근본 해소 아님 | 불필요 | R4로 회귀 시험 가능 |
| S4 | 서버 정산(분석 파일→DB 자동 적재, analysis.md §6) | **데이터 손실만 방지**(57~93%), 상태는 못 막음 | 불필요 | 금요일 전 현실적 안전망 |
| S5 | join/resync snapshot의 본인 활성 stream 정보를 앱이 채택(A2) | 상태 자체 해소 | **필요** | 서버는 이미 snapshot에 포함 |
| A1 | READY에서 `streamId==null`이 20~30초 지속 / `capture.start`가 `rejected`면 새 ID로 재시작 | 상태 자체 해소 | **필요** | 가장 직접적 |

**서버만으로 충분하다고 결론 내리려면 필요한 증거**: ① 4명의 소켓에서 해당 command_id 재전송에 대한 ACK status가 `retryable/duplicate/applied`였음(서버 ACK 로깅 없어 불가), 또는 ② S1+S2 적용 후 dev에서 "폭주 중 재접속·토큰 만료 재현" 시 앱이 자동 복구함(앱 측 실행 필요). 현재 증거로는 **서버 단독 확정 불가 → S1·S3·S4는 앱 업데이트 없이 지금 가능한 완화, 근본 차단은 A1(+A2)**.

## 6. 같은 구조적 약점 (확정/코드)
- `capture.close`(종료): `closeCapture`는 `streamId==null`이면 보내지 않음(`LiveSession.kt` closeCapture) → stream을 못 받은 4명은 close도 없음(서버는 24h 뒤 orphan sweep이 종결, `biosignal_orphan_sweep.py`). 게이트 `rejected` 종결 처리가 동일해 close도 재전송 포기 가능(`final_sequences` 손실).
- `capture.reanchor`/`renew`: `onCommandAck`의 종결 처리 공통. renew가 `rejected`(token_expired 등)면 다음 10초 주기에 새 ID로 재전송되어 **자가 치유**됨(스케줄러가 주기 재발행). **start만 재발행 주기가 없다**(전환 기반) — 구조적으로 가장 취약.
- 재연결 직후 창: `onReady→flushCommands` 재전송이 `_ensure_scope`/`conn.expired()` 게이트를 통과하기 전 `RESYNCING`이면 `retryable(not_ready)`로 안전하나, 토큰 만료 경계에서는 `rejected(token_expired)`가 나간다(§2 ※).
- iOS 2명: 코드 미조사 범위(SDD-284 analysis.md 참고). `arming` 무한 대기 가설은 본 조사에서 **미검증**.
