## 실시간 경로 정합 검증

**판정: 핵심 이벤트·저장 경로는 연결됐지만 통합 승인은 보류한다. 재연결 버퍼 삭제, 저장 확인 없는 송신 완료 처리, 중복 payload의 DB/방송 불일치, 무권한 room 가입이 우선 차단 항목이다.**

- 검증일: 2026-09-07. HEAD `6f2366b` 위의 미커밋 작업 트리를 검토했다. 최초에는 신규 구현이 없었으나 검증 중 다른 작업자가 BE/FE 코드를 추가하여 다시 대조했다. 아래 행 번호는 23:41~23:42 KST에 읽은 코드 기준이며 이후 동시 변경에는 재검증이 필요하다.
- 읽은 문서: 같은 디렉터리의 `spec.md`, `plan.md`, `verify.md`. 이 검증자는 본 문서만 작성했으며 코드·사전 verify 문서는 수정하지 않았다.
- 근거의 `경로:행`은 저장소 루트 기준이다. **확인**은 정적 코드/실행 결과, **위험**은 그 코드에서 도출한 장애 시나리오, **권고**는 미구현 결정 사항이다.

### 1. 전체 경로 및 이벤트 계약

1. **생성·emit: 연결 확인.** `useBand.ingestMetrics`가 1초 feature를 생성하고 `/session-live`에 `feature` 이벤트로 `{session_id, participant_id, feature, band_battery, device_status}`를 전송한다. WS가 연결되지 않으면 REST 버퍼에 넣는다. 실기기 1초 주기의 시간 정확도는 계측하지 않았다. 근거: `frontend/src/hooks/useBand.ts:216-251`, `frontend/src/lib/socket.ts:39-46,122-129`.
2. **namespace 등록·join: 연결 확인.** `register_session_live_namespace(sio)`가 등록되어 있고 `join({session_id})` → `session:{id}` room → `joined` 이벤트 순서다. namespace와 이벤트 이름은 FE와 일치한다. 근거: `backend/app/ws/__init__.py:9-13`, `backend/app/ws/session_live_namespace.py:60-77`, `frontend/src/lib/socket.ts:104-119`.
3. **검증·저장: 연결 확인.** handler는 `data.feature`를 `EEGFeatureItem.model_validate`로 검증하고 참가자를 해석한 뒤 공통 `persist_feature_windows`를 호출한다. `db.commit()` 이후 반환하며 WS DB 세션은 finally에서 닫는다. REST도 같은 참가자 해석·저장 함수를 호출한다. 근거: `backend/app/ws/session_live_namespace.py:79-139`, `backend/app/services/session_service.py:846-973`.
4. **broadcast: 연결 확인, 저장값 일치에는 결함.** 이벤트는 `{session_id, participant_id, feature: item.model_dump(), saved}`이며 `/session-live`의 동일 세션 room으로 발행한다. 그러나 `saved=0`이어도 요청의 feature를 방송한다. 이미 DB에 인덱스 1의 relaxation=0.5가 있고 같은 키로 0.9를 보내면 DB는 0.5, 이벤트는 0.9가 된다. UI가 저장되지 않은 값을 표시할 수 있다. 근거: `backend/app/ws/session_live_namespace.py:98-114,128-137,142-155`, `backend/tests/test_sdd024_session_live_ws.py`의 `test_09_REST_배치후_WS_동일인덱스_이중저장_방지`.
5. **호스트 UI: 구독·부분 갱신 연결 확인.** `useSessionLiveSocket` → `handleLiveFeature`가 session_id를 검사 → participant_id 행을 갱신한다. WS 연결 시 4초 EEG 폴링을 멈추고 전환 때 한 번 REST를 조회한다. 세션 상태 5초 폴링은 유지한다. 근거: `frontend/src/pages/sessions/SessionLivePage.tsx:33-84,168-177,189-221`.
6. **게스트 UI: useBand 경유 수신 확인.** `useBand`는 본인 participant_id의 이벤트를 받아 nested relaxation/focus/stress/품질을 갱신한다. 패널은 이 훅의 값과 차트를 표시한다. 확인 당시 패널 표시 조건은 BLE `connectionState === connected`였으므로 WS만으로 본인 데이터가 들어오는 별도 관찰 상황에는 표시되지 않는다. 근거: `frontend/src/hooks/useBand.ts:435-460`, `frontend/src/components/class/GuestMeditationPanel.tsx:39-46,74-108`.

### 2. 필드 전수 대응

공통 근거: `frontend/src/hooks/useBand.ts`의 `metricsToFeature`, `frontend/src/lib/socket.ts:39-64`, `backend/app/schemas/session.py:230-270`, `backend/app/services/session_service.py:912-934`, `backend/app/models/eeg_feature.py:28-70`. 아래 핵심 feature는 WS와 REST에서 동일 스키마를 사용한다.

- `session_id`: WS envelope/REST URL → DB `session_id` → broadcast envelope → 호스트 필터. 참가자 식별은 `participant_id` 또는 토큰 user_id로 해석 → DB와 broadcast의 participant_id. 게스트 user_id는 null이므로 UI 행 키로 쓰면 안 된다.
- `second_offset`: FE feature → DB `window_index` → broadcast에서는 다시 `second_offset` 이름 유지. DB 키는 `(session_id, participant_id, window_index)`이다.
- `timestamp`: FE ms epoch → DB `device_timestamp_ms` → nested timestamp. DB `created_at`과는 다른 시간이다. 호스트 WS UI는 nested timestamp 또는 수신 시각을 `last_eeg_at`으로 쓰지만 REST는 DB created_at을 쓰므로 의미가 다르다(`SessionLivePage.tsx:46-50`, `session_service.py:837-841`).
- 파워 5종 `delta_power/theta_power/alpha_power/beta_power/gamma_power`: 동일 이름으로 검증·저장·방송한다.
- 추가 `total_power`: 동일 이름으로 저장·방송한다. 별도 DB `total_neural_activity`로 대입하지 않는다.
- 지표 8종 `focus_index/relaxation_index/stress_index/meditation_level/attention_level/cognitive_load/emotional_stability/hemispheric_balance`: 동일 이름으로 검증·저장·방송한다. DB `faa`는 현 입력에 없다.
- `signal_quality`: SDK 0~100 → FE /100 및 clamp → API·DB·broadcast 0~1 → useBand 수신 시 ×100. 서버 quality는 0.7 이상 valid, 0.4 이상 degraded, 그 미만 invalid, null은 valid다. 스키마의 float에는 범위 제한이 없어 직접 WS 입력은 별도 검증이 필요하다(`backend/app/services/session_service.py:780-805`, `backend/app/schemas/session.py:253-254`).
- `quality`: DB 저장 때 파생하나 broadcast의 nested item에는 포함하지 않는다. FE 로컬 device_status는 SQI 40 미만만 lead_off, REST는 degraded까지 lead_off다. SQI 50일 때 로컬 ok/REST lead_off로 갈린다(`useBand.ts:123-130`, `session_service.py:780-805`).
- `band_battery/device_status`: FE가 feature 바깥에 보내지만 BE handler는 읽거나 저장·재발행하지 않는다. 호스트는 이전 device_status를 유지하고 새 행은 ok로 가정한다. 따라서 접촉 불량·배터리가 원격 WS 행에 반영되지 않는다(`socket.ts:40-45`, `session_live_namespace.py:89-114`, `SessionLivePage.tsx:58-60,69-80`).
- `saved`: BE가 방송하지만 FE 이벤트 타입에 없고 UI가 검사하지 않는다. 순차 중복의 DB 효과만 1회이며 차트·UI 효과는 1회가 아니다.
- null: 스키마→DB→nested 방송은 null을 보존하지만 호스트 current_efficiency와 useBand 수신부는 숫자가 아니면 이전 값을 유지한다. 새 null 측정이 와도 과거 값이 남아 REST와 달라진다(`SessionLivePage.tsx:41-45,61-62`, `useBand.ts:440-450`).
- raw 250Hz 샘플 배열은 해당 payload에 없으며 경량 feature 범위는 스펙과 일치한다.

**호스트의 avg_efficiency는 WS에서 갱신하지 않는다.** 초기 REST 누적 평균이 계속 남고 새 참가자는 null이다. 표시 이름·is_guest도 broadcast에 없어 새 행을 임의의 ‘참가자’, is_guest=false로 만든다. 초기 스냅샷·참가자 변경 갱신·누적 집계 계약이 필요하다. REST fallback 행은 실제 participant_id 대신 user_id/합성 guest 키를 사용해 이벤트의 실제 participant_id와 다른 중복 행이 생길 수도 있다. 근거: `SessionLivePage.tsx:53-100`, `backend/app/services/session_service.py:656-700,807-842`.

### 3. record_namespace 패턴과 일관성

- 수동 register, lazy `_get_sio`, `session:{id}`, namespace 지정 broadcast 구조는 일치한다(`record_namespace.py:12-23,44-80`, `session_live_namespace.py:19-36,142-155`). 이벤트는 record의 subscribe/unsubscribe와 live의 join/leave로 구분된다.
- **느슨한 인증까지 그대로 일치한다.** 둘 다 무토큰과 decode 실패에도 연결을 허용한다. 신규 live는 user_id를 socket session에 보관하지만 이를 join 권한에 쓰지 않는다. 스펙의 ‘JWT 인증’ 표현이 접근 통제를 보장하지 않는다(`record_namespace.py:25-38`, `session_live_namespace.py:38-68`).
- record 훅은 최초 subscribe에서 once(connect)를 쓰지만 live 훅은 매 connect에 join하여 재가입 자체는 개선됐다. 다만 joined 응답을 기다리지 않고 isConnected=true로 처리한다(`useRecordSocket.ts:59-84`, `useSessionLiveSocket.ts:59-75`, `useBand.ts:420-427`).
- record는 VITE_WS_URL, live/chat은 VITE_SOCKET_URL 또는 API URL에서 유도한다. `/socket.io` path는 일치한다. Socket.IO transport polling은 EEG REST 폴백과 별개다(`useRecordSocket.ts:7,52-57`, `socket.ts:5-9,86-92`).
- 서버 실행 객체는 `backend/app/main.py:43`의 `asgi_app`이어야 Socket.IO wrapper를 사용한다. 가이드의 `app.main:app`으로 실제 실행하면 별도 FastAPI app이므로 WS 제공을 단정할 수 없다. 배포 진입점·프록시 핸드셰이크는 미검증이다.

### 4. 실행 결과와 증명 범위

`backend/`에서 다음을 실행했다.

```bash
./venv/bin/python -m pytest -q -p no:cacheprovider tests/test_sdd024_session_live_ws.py tests/test_sdd023_eeg_ingestion.py tests/test_sdd021_session_class_flow.py
```

**35 passed, 2 warnings, 5.23s, 종료 코드 0.** 경고는 crypt 및 argon2.__version__ 사용 중단 예고다. SDD-024 신규 9개와 기존 REST/세션 26개를 확인했다. 최초 구현 반영 전의 기존 26개 실행도 통과했다.

신규 테스트는 FakeSio handler 직접 호출과 SQLite 인메모리 DB를 사용한다. room 문자열 지정, 단일 저장·방송, 순차 재전송을 검증하지만 실제 Socket.IO 네트워크 전달·브라우저 렌더·재연결·PostgreSQL 동시 commit을 증명하지 않는다. test_08은 중복 방송 2회를 정상으로 기대하고 test_09는 saved=0만 확인하여 DB와 방송 값의 불일치를 놓친다.

전체 backend pytest, 프론트 tsc/build, BLE 실기기, 실제 WS E2E 및 부하 테스트는 이번 검증에서 미실행이다. 부분 테스트 통과를 스펙 전체 통과로 확대하지 않는다.

## 폴백·에지 케이스

### 1. 연결 단절·재연결: 데이터 유실 경로

- **P0: 재연결 시 미전송 버퍼 삭제.** onConnect가 featureBufferRef를 빈 배열로 만든다. 예: WS 단절 중 3초 데이터를 쌓고 REST 5초 flush 전에 복구되면 해당 데이터가 저장 없이 사라진다. ‘이중 저장 완화’가 큐 삭제의 근거가 될 수 없다. 미확인 항목은 같은 키로 재전송해야 한다(`useBand.ts:420-427`).
- **P0: emit=true는 저장 ACK가 아니다.** emitSessionLiveFeature는 connected이면 emit 직후 true를 반환한다. useBand는 그 항목을 큐에 보관하지 않는다. 서버 저장 오류는 경고 후 return이므로 연결이 정상이어도 DB 오류·입력 거부·송신 중 단절 때 복구할 수 없다(`socket.ts:122-129`, `useBand.ts:221-237`, `session_live_namespace.py:98-105`).
- WS가 연결되어 있으면 REST flush를 무조건 생략한다. REST 실패 배치가 재연결 이후 늦게 큐로 되돌아오면 연결 동안 계속 대기할 수 있다. 큐 항목별 저장 확인 및 drain 정책이 필요하다(`useBand.ts:189-208`).
- **혼합 연결 정지:** 업로더가 REST 폴백으로 저장해도 ingest_features는 방송하지 않는다. 호스트 WS가 정상 연결이면 EEG 폴링이 중단되어 새 값을 받지 못한다. REST/WS 공통 저장 후 발행 또는 보완 스냅샷이 필요하다(`session_service.py:953-973`, `SessionLivePage.tsx:212-221`).
- 재가입은 있지만 joined 확인·스냅샷 버전 동기화는 없다. 연결 시 한 번의 REST 요청과 동시 WS delta가 역순 도착하면 REST setMetrics가 새 값을 덮는다. 폴링 종료 기준을 transport connected가 아닌 joined+synced로 정하고 버전/순서 가드를 둔다.
- unmount cleanup은 큐를 flush하지 않으며 큐는 메모리뿐이다. 수동 disconnect 역시 WS 연결 중이면 flush가 생략된다. 새로고침·화면 종료·장기 오프라인은 영속 큐나 명시적 손실 정책이 필요하다(`useBand.ts:189-191,283 이후 disconnect,481-495`).
- 게스트 기존 상위 페이지 폴링은 세션 시작·종료 감지용이다. 본인 EEG 응답을 패널로 전달하는 REST 수신 폴백으로 간주하면 안 된다(`frontend/src/pages/class-join-page.tsx:153-197`). 경과 시간 타이머와 세션 상태 폴링도 EEG WS 전환과 분리한다.

### 2. REST 5초 + WS 1초 race·멱등성

- 최신 구현은 기존 인덱스/배치 내 중복 skip와 DB unique 제약, **항목별 SAVEPOINT + IntegrityError 처리**를 함께 사용한다. 초기 코드의 단순 조회 후 insert보다 개선됐으며 배치 전체 rollback 위험을 줄이는 의도가 확인된다. 실제 PostgreSQL 병렬 트랜잭션 검증은 별도다(`session_service.py:895-950`, `eeg_feature.py:22-25`).
- IntegrityError 전체를 ‘중복’으로 취급하므로 FK 등 다른 무결성 오류도 숨길 수 있다. 실제 충돌 제약/키를 구분하고 실패 원인을 ACK해야 한다. saved=0인데 실제로 기존 행이 없는 경우까지 정상으로 취급하지 않아야 한다.
- 저장 멱등과 방송 멱등은 다르다. saved=0일 때 요청값 방송을 억제하거나 기존 저장값으로 정규화하고, UI는 참가자별 second_offset 중복·역순 이벤트를 제거해야 한다.
- useBand는 로컬 ingest에서 차트에 한 번 추가하고 자기 broadcast에서도 같은 측정을 다시 추가한다. 정상 연결에서도 1초당 2개 차트 포인트가 생길 수 있다(`useBand.ts:249,440-443`).
- 훅 재마운트는 secondOffsetRef=0으로 돌아간다. 같은 참가자의 기존 window_index와 충돌해 새 측정 저장은 skip하면서 새 값만 방송하는 불일치가 커진다. 서버 재개 인덱스 또는 수집 stream 식별자 정책이 필요하다(`useBand.ts:166,218`, `session_live_namespace.py:135-137`).

### 3. 다참가자·룸 격리·미착용

- DB는 (session, participant, window) 기준으로 다른 참가자의 같은 초 인덱스를 공존시킨다. 기존 REST 테스트에서 확인했다. 호스트는 session_id/participant_id로 필터하나 useBand 수신부는 participant_id만 검사하고 일반 구독 훅은 모든 이벤트를 callback에 넘긴다(`useBand.ts:435-437`, `useSessionLiveSocket.ts:45-47`). 방어적으로 두 식별자를 함께 검사한다.
- sessionLiveSocket은 싱글톤인데 useBand와 useSessionLiveSocket이 독립적으로 join/leave한다. 한 소비자의 cleanup이 room을 leave하면 남은 소비자도 그 room 수신을 잃을 수 있다. room별 참조 수 또는 단일 소유자를 정해야 한다(`socket.ts:68-100`, `useBand.ts:471-479`, `useSessionLiveSocket.ts:78-88`).
- 토큰이 바뀌면 싱글톤 socket을 교체하지만 기존 훅 리스너는 이전 객체에 남을 수 있다. 토큰 갱신 및 로그인/게스트 전환을 구독 수명과 함께 검증한다(`socket.ts:75-94`).
- room 문자열 라우팅은 namespace를 포함해 맞지만 **다른 세션의 무권한 join을 막지는 않는다**. leave, 세션 이동, 권한 회수 후 수신도 실제 다중 클라이언트로 검증해야 한다.
- WS 연결과 BLE 연결은 별개다. 미착용 관찰자는 수신할 수 있어야 하며 기존 데이터가 있다는 이유로 band_connected/streaming이 영구 유지되어서는 안 된다. 서버는 saved가 있으면 band_connected를 true로 만들고 REST는 저장값이 있으면 streaming을 반환한다. stale/heartbeat 정책은 없다(`session_service.py:673-699,945-949`).
- 한 브라우저의 여러 밴드와 여러 브라우저의 참가자를 구분한다. AnalysisMetricsService는 싱글톤이고 setCallbacks가 같은 onMetricsUpdate를 덮을 수 있다(`frontend/src/lib/eeg/AnalysisMetricsService.ts:40-60`).

## 리스크·결정 포인트

### P0 — 인증·쓰기 권한·민감 데이터 수신 범위

connect는 무토큰·잘못된 토큰 모두 허용하고 join은 session_id만으로 진입한다. 참가자 해석은 명시 participant_id가 있으면 해당 세션 행 존재만 확인하며 토큰 사용자 소유와 대조하지 않는다. 세션 ID를 아는 비인가 구독, 참가자 ID를 아는 타인의 feature 쓰기를 막는 검사가 없다. feature는 join 없이도 호출할 수 있다. 근거: `session_live_namespace.py:38-68,79-101`, `session_service.py:846-879`.

**권고:** 사용자 JWT 또는 단기 게스트 자격 증명을 검증하고 join/read/write를 각각 인가한다. 참가 상태·세션 진행 상태·EEG 동의도 공통 저장 경계에서 검사한다. 현재 공유 함수에는 이 검사가 없다. 익명 게스트를 지원한다는 이유로 모든 room 읽기까지 공개하면 안 된다.

현재 방송은 같은 room의 모든 게스트에게 타 참가자 EEG를 전달한다. REST는 호스트 전체 지표와 게스트 본인 상태를 분리한다(`backend/app/api/v1/session.py:181-188`, `session_service.py:718-773`). 호스트 세션 room/참가자 개인 수신 범위를 나누거나, 전체 공유를 허용할 명시적 제품·동의 정책을 결정해야 한다. FE 필터는 이미 전달된 데이터의 접근 통제를 대신하지 못한다.

### P1 — 저장·발행·복구의 완료 기준

공통 저장 후 commit→발행 순서는 확인되지만 ACK·오프라인 큐 복구·REST 발행이 빠져 있다. 항목 키와 stored/duplicate/rejected 결과를 ACK하고 저장 확인 전 큐를 보존할 것을 권고한다. commit 후 broadcast 전 장애는 스냅샷 복구로 허용할지, outbox/재생까지 보장할지 결정한다. 동일 키 다른 payload를 단순 중복으로 숨기지 않도록 관측한다.

### P1 — broadcast·DB·렌더 부하

- 송신자 N명, 수신자 M명이 초당 한 번씩 받으면 입력 N건/초, room 전달 약 N×M건/초다. 예: N=30, M=31이면 930건/초. 평균 payload P바이트일 때 약 930×P바이트/초이며 프로토콜 부가량은 별도다. 이는 가정 기반 산식이지 실측치가 아니다.
- persist_feature_windows는 매 요청에 참가자의 과거 인덱스를 전부 조회한다. 1초 WS 호출을 T초 유지하면 누적 조회 인덱스 수가 대략 T²에 비례할 수 있다(`session_service.py:895-904`). 현재 전체 live-metrics도 모든 윈도우를 조회해 평균을 계산하므로 매 feature마다 전체 스냅샷 방송을 추가하면 부하가 커진다(`session_service.py:807-842`).
- async handler에서 동기 SQLAlchemy 조회·flush·commit을 직접 호출한다. DB 지연이 이벤트 루프를 막는 위험을 검토하고 threadpool/비동기 DB 전략을 정한다(`session_live_namespace.py:98-101,119-139`).
- AsyncServer에는 공유 client manager 설정이 없다(`backend/app/ws/__init__.py:5`). 다중 worker 배포라면 worker 간 room/emit 전달 설정을 별도로 확인해야 한다. 실제 다중 worker 장애는 미재현이다.
- 권고: 최대 참가자 수·수신 지연 목표·입력 크기/빈도 제한을 정하고 ACK 지연, commit 지연, 이벤트 누락·중복, 큐 길이를 계측한다. 경량 delta, 제한된 DB 조회, 참가자별 UI 병합을 우선한다.

### P2 — 운영·표시 계약

Socket URL 환경변수, `/socket.io` 프록시, ASGI 실행 객체, 토큰 갱신, origin 설정을 통일한다. Socket.IO CORS는 wildcard이며 FastAPI CORS와 별개다(`ws/__init__.py:5`, `main.py:15-29`). 품질 경계·null 갱신·평균·측정 시각/저장 시각·stale 기준을 REST와 WS에서 동일하게 정의한다. 오류 로그는 원인을 구분하되 토큰과 EEG 전체 payload 기록을 피한다.

## 최종 권고안

**구현 연결은 확인했지만 P0 데이터 유실·인가 결함과 P1 저장/방송/UI 불일치 때문에 SDD-024 통합 승인은 보류한다.** 이 검증의 코드 근거는 동시 구현 중 읽은 스냅샷이므로 수정 완료 시점에 다시 확인해야 한다.

우선 조치 순서는 다음과 같다.

1. 재연결 시 큐 삭제 제거, 항목별 저장 ACK와 안전한 재전송·오프라인 큐 복구.
2. join/read/write 인가와 게스트 자격 증명, 호스트 전체/게스트 본인 수신 정책 확정.
3. REST 저장도 발행하는 공통 경로, saved=0 방송 정합, 중복·역순 제거, 새로고침 인덱스 재개.
4. UI null·품질·배터리·평균·시각 계약, 자기 echo 차트 중복, 싱글톤 room 수명 해결.
5. joined+snapshot 완료 후 폴백 종료 및 늦은 REST 응답의 덮어쓰기 차단.

재검증에 필요한 증거:

- 실제 Socket.IO 호스트·게스트 2명·다른 세션 관찰자로 join→feature→DB 1행→허용된 수신자 UI를 대조. 비인가 join/타인 쓰기/leave 이후 수신도 확인.
- 5종 파워+total_power+8종 지표+품질+null+timestamp+index 전수 비교. 동일 키 다른 값 재전송에서 DB와 이벤트·UI가 같은 값인지 확인.
- WS 미연결, 5초 이전 재연결, commit 뒤 ACK 유실, DB 거부, 송신자 REST/수신자 WS 혼합, 지연 REST 응답, 새로고침·다중 탭·다중 소비자 cleanup을 재현.
- PostgreSQL에서 WS+REST 동일 키 동시 commit을 실행해 중복 1행·다른 신규 항목 보존·오류 분류를 확인.
- `backend/`의 `./venv/bin/python -m pytest -q`, `frontend/`의 `npm run build`(내부 tsc -b 포함), 실제 UI 및 합의된 인원 부하 테스트 결과 첨부.

이번 실행 증거는 관련 테스트 **35개 통과**이며 전체 회귀·실제 WS E2E 통과를 의미하지 않는다. 사전 verify 체크리스트는 변경하지 않았다.
