# SDD-285 조사 결과 — 회원 경로에서 데이터가 저장되지 않은 원인 (2026-11-04 조사)

- 대상 회차 `1a74e4c9`(11/4 행사, 10:12~11:27 KST). 운영 DB·nginx·journald **읽기 전용** 조회. 개인정보는 접두사(6자)만.
- 분류: **확정**(쿼리·코드로 직접 확인) / **가설**(정황) / **모름**.
- 조회 스크립트: `queries/c1~c12.sh` (SSM 실행, 전부 `set transaction read only`). 선행 사실은 SDD-282 `handoff-1104.md` F1~F18.

## 1. 한 줄 결론

1. **"동의 완료 + 밴드 연결 + 대기열 아님"인데 분석 데이터가 0건인 회원은 4명이다(전원 Android, 모두 회원).** 서버의 `band_connected` 플래그만 기준으로 하면 0명이지만, 그 플래그는 stream 확정 뒤 기기 보고로만 켜지므로 이 4명은 측정 자체는 했음에도(원시 청크·분석 파일 업로드 있음) `false`로 남았다. 실제 연결 기준(측정 증거)으로는 **4명**이다.
2. 따라서 **"회원이면 성공 6명처럼 문제없다"는 보장은 지금 근거로 할 수 없다.** 4명은 서버에서 `capture.start`가 적용됐는데 앱이 stream 신원을 못 받은 상태로 75분을 보냈다(아래 §4).
3. 앱 수정 필요 여부: **서버 쪽 정산(파일→DB 자동 적재)으로 데이터는 지킬 수 있어, 금요일 전 앱 업데이트 없이도 손실을 막을 수 있다.** 다만 근본 원인(앱이 stream을 못 받는 상태)은 기기 로그 없이 확정 불가 → 앱 수정은 "원인 확정 후 결정"이 맞다(§6).

## 2. 회원 24명 전수 분류 (확정)

공통: 24명 모두 회원(1행씩), 대기열 아님(`is_waitlisted=false` 24/24), `consent_audio=false` 24/24(마이크 동의는 EEG 저장 조건이 아님).
뇌파 동의(`eeg_collection_consented`): true 21 / false 2 / 미응답(null) 1.

| 묶음 | 인원 | 구성 | 분석 DB 건수 | 판정 |
|---|---|---|---|---|
| A. 정상 완주 | 6 | Android 6 (`14b252`·`c364c0`·`f36261`·`352d27`·`df551b`·`b5eed5`) | 3,980~4,511 | 성공. renew 254~352, reanchor 14~49, start 1~4회 |
| B. 짧게 측정, 손실 없음 | 2 | `6ecab3`(Android, 998건, 10:42 이후 측정 중단), `bc8a88`(앱 푸시 미등록, 141건, 11:25 입장) | 998 / 141 | 기대량(`session_ingest_expected`) = 저장량 → **손실 0** |
| C. **조건 충족 + 0건** | **4** | Android 4 (`de8312`·`6a2172`·`518675`·`ac1a78`) | **0** | **실패** (기대량 4,516~4,833, 원시 청크 773~1,204 업로드됨) |
| D. iOS 측정 시도 | 1 | `94234b`(iOS) stream 2개 | 0 (기대량도 0) | 원시 781청크만. 분석창 자체가 안 만들어짐 → iOS(SDD-284) 범위 |
| E. 원시만 있고 stream 없음 | 1 | `879091` (푸시 미등록) | 0 | 원시 721청크, `capture_stream` 0개. 원인 모름 |
| F. 측정 시작 전 이탈 | 10 | iOS 6, Android 2(`e187ef`·`47e01c`), 푸시 없음 2 | 0 | 원시 0, 밴드 미연결, 일부는 `capture.start`만 적용 |

묶음 C가 대표 지시의 핵심 케이스다. 묶음 A·B(Android 8명)는 **앱이 만든 분석창이 서버에 전부 저장됐다**(저장 = 기대량, 최대 1건 차이 `b5eed5`).

### 묶음 C 4명 상세 (확정)

| 참가자 | start 적용 | start 거절 | renew | reanchor | 기기 보고(device) | stream | 분석 DB | 기대량 | 원시 청크 | 복구 가능(S3 feature 파일) |
|---|---|---|---|---|---|---|---|---|---|---|
| `de8312` | 10:13:05 | 6회 (11:28:14~11:30:00 `session_ended`) | 0 | 0 | 시작·종료 2건뿐 | 1개(gen 1) | 0 | 4,833 | 804 | 2,820행 |
| `6a2172` | 10:13:05 | 1회 (11:28:14) | 0 | 0 | 2건 | 1개 | 0 | 4,520 | 1,204 | 4,200행 |
| `518675` | 10:12:55 | 0 | 0 | 0 | 2건 | 1개 | 0 | 4,517 | 773 | 2,580행 |
| `ac1a78` | 10:13:01 | 1회 (11:28:16) | 0 | 0 | 2건 | 1개 | 0 | 4,516 | 843 | 2,940행 |

대조(정상): renew 254~352회, device 이벤트 100건 이상, 분석 3,980건 이상.

## 3. 밴드 연결 판정이 갈리는 이유 (확정)

- `band_connected`는 `live:device` 보고를 받을 때만 갱신된다 (`live_ingest_service.py:411-412`). 이 보고는 앱이 `capture.start` ACK로 stream을 받은 **뒤**에야 나간다 (`LiveSession.kt:434` → `flushDevice`).
- 묶음 C는 stream 신원을 못 받아 보고가 0번이었고, 그래서 플래그가 `false`로 남았다. 같은 시간대 같은 기기에서 분석 파일(feature 209개)·원시 청크가 서버에 올라온 것은 **밴드가 실제로 데이터를 만들고 있었다**는 뜻이다.
- 즉 "연결 완료"의 서버 신호는 **정상 경로가 성공했을 때만** 믿을 수 있다. 4명의 상태는 "연결됐지만 서버가 모른다"이다. 운영 대시보드/대기실의 연결 확인이 이 플래그에 의존하면 같은 오판이 반복된다.

## 4. 원인 분석 — H1′ 검증

### 4.1 코드로 확정한 사실

| # | 사실 | 근거 |
|---|---|---|
| C1 | 앱은 stream이 없을 때 만든 창을 **귀속 없이 보관만** 하고 전송하지 않는다. `pendingBatch`는 `tag`가 있는 창만 반환 | `MetricOutbox.kt:96-107`, `FeatureUploader.kt:flushOnce` |
| C2 | 귀속은 `capture.start`/`capture.renew` **ACK을 받았을 때만** 일어난다 (`adoptCaptureResult` → `bindUntagged`). snapshot에서의 stream 채택은 일부러 막혀 있다("새 stream 채택은 ACK 로만") | `LiveSession.kt:418-436`, `:289-291` |
| C3 | 복구 스위퍼 `ScopeSweeper.drain`은 `scope.json`에 stream이 없으면 귀속하지 않고 진단만 남긴다 | `ScopeSweeper.kt:120-124` |
| C4 | `capture.renew`는 `streamId != null && READY`일 때만 10초마다 나간다. 4명은 renew 0건 → 앱의 `streamId`가 **끝까지 null**이었다 | `LiveSession.kt:442-449`, ledger |
| C5 | 앱이 `capture.start`를 다시 보내는 유일한 조건이 `streamId == null`이다(`startCaptureIfAllowed`). 4명 중 3명이 수업 종료 직후(11:28:14~16) `capture.start`를 다시 보냈다 → **그 시점에도 `streamId`가 null이었다**는 앱 내부 상태의 직접 증거 | `LiveSession.kt:739`, ledger |
| C6 | 서버는 `capture.start`를 **정상 적용**했다(ledger `applied`, `capture_stream` generation 1, ACK 결과에 `stream_id` 포함). 서버 쪽 `store_batch`가 거절하는 조건(`stream_not_owned`)은 해당되지 않는다(SDD-282 F4) | DB, `live_ingest_service.py:225-258` |

→ **H1′ 중 "앱이 stream 신원을 못 받아 창이 전송되지 않았다"는 코드·원장으로 확정.** 남는 질문은 "왜 받지 못했는가"이다.

### 4.2 "왜 ACK을 못 받았나" — 단서와 한계

단서 (확정):
- 4명은 전원 **10:12:55~10:13:14의 `capture.start` 폭주 구간**(10명 시작)에 있다. 같은 구간에 정상 4명(`352d27`·`14b252`·`f36261`·`c364c0`)도 시작했으므로 폭주 자체가 곧 실패는 아니고, 개별 ACK 유실 문제다(확률적).
- 10:12:59(UTC 01:12:59) 서버에서 **교착(deadlock) 11건**이 났고, 그중 `capture_stream` INSERT 실패 4건의 참가자는 `6a2172`·`de8312`·`59a1ea`·`481312`다. 교착 지점은 `sessions` 행 `FOR KEY SHARE`(외래키 검사)와 동시 갱신의 충돌이다. 이 경우 핸들러가 예외로 끝나 **ACK이 클라이언트에 가지 않고** `Task exception was never retrieved`가 남는다(`_run_command_sync` → `session_live_commands.py:329`). 앱은 2초 뒤 같은 command_id로 재시도(0.5/1/2/4초 간격)해 10:13:05에 적용됐다(2명의 적용 시각 10:13:05와 일치).
- 소켓 접속 로그(nginx는 연결이 **끝난 시각**에 기록): 4명이 쓴 것으로 보이는 3개 IP(IP→참가자 매핑은 `biosignal-capabilities` 요청의 참가자 ID로 한 **추정**, 1개 IP는 미확인)에서 모두 **10:12:59(UTC 01:12:59)에 약 1.1KB짜리 짧은 소켓이 닫혔다** — 교착 11건이 난 바로 그 시각이다. 이후 22KB 안팎의 **긴 소켓은 11:28(수업 종료)에 닫혔다**. 즉 첫 소켓이 입장 폭주 때 끊기고 재연결된 뒤 수업 끝까지 유지된 것으로 보이며, 그 긴 소켓 위에서 renew·device 보고가 한 번도 없었다. 같은 IP에서 REST(`features/batch`·`biosignal-*`)는 11:54까지 계속 성공 → 앱은 살아 있었고 네트워크도 정상이었다.
- 11:28:14~16의 `capture.start` 재전송은 소켓이 READY일 때만 나간다(`sendCommand`는 `state==READY` 필요). 곧 수업 종료 시점에는 소켓이 정상 상태였고 앱의 `streamId`가 여전히 null이었다.
- 서버 `live_outbox` 처리 지연은 모두 10초 이하(p95 0.74초), 미처리 0건 → 투영 지연이 원인은 아니다.

가설 (직접 증거 없음, 확률 순):
1. **(가장 유력)** 입장 폭주(10:12:59)에 소켓이 끊기고 `capture.start` ACK이 앱에 도달하지 못했다(교착 예외 또는 재접속 중 유실). 같은 command_id 재시도가 `duplicate`로 재생되어 채택돼야 하는데, 4명은 그러지 못했고 이후 새 소켓 위에서도 `streamId`가 null인 채 renew·device 보고 없이 수업 끝까지 갔다. 코드상 재시도 흐름은 `committedHint`/`expireIfStillPending`(30초 만료 후 `resync`)에 걸려 있어 상태 꼬임 경로가 존재한다 (`LiveSession.kt:530-538`, `:576-585`).
2. `518675`·`ac1a78`은 교착 INSERT 실패 목록에 없다. 이들은 다른 문(SELECT `session_participants` 6건·`users` 3건이 교착 대상)에서 같은 증상이 났을 수 있다. **교착 대상자 전체는 확인하지 못함.**
3. `518675`는 수업 종료 뒤 `capture.start` 재전송도 없다(앱 쪽 소켓이 종료 후 재접속하지 않음). 별개 경로일 가능성.

**모름**: 앱 소켓 상태(`LiveState`)가 어떤 상태에서 멈췄는지, ACK이 실제로 도착했는데 `adoptCaptureResult`가 조용히 반환(`return`)했는지(`stream_id` 빈 값, `generation` 형식 오류, `participant_id` 빈 값). 확정에는 기기의 `outbox.log`/`scope.json`/앱 로그가 필요하다. ACK 본문은 ledger에 저장돼 있고 형식은 정상으로 보인다(`de8312`·`518675` 확인: `stream_id`·`generation`·`owner_generation`·`participant_id` 모두 있음).

### 4.3 dev 재현 (하지 않음 — 절차만)
이번 조사에서는 재현을 실행하지 않았다(워크트리에 dev 구동 환경이 없음). 재현 절차는 `verify.md` §4-R에 적었다: 소켓을 연 채 `capture.start` ACK만 서버에서 삼키거나(교착 주입) 지연시킨 뒤, 앱이 READY로 돌아오는지·창이 전송되는지 본다.

## 5. 부수 확인 (확정)

- `[ingest-batch]` 로그 부재: 로거 설정 없음(SDD-282 F14). 이번 journald 조회에서도 INFO 로그는 uvicorn 접근 로그와 에러만 남아 있었다.
- 서비스 로그 `TimeoutError` 127건: 모두 `publish_pending` → `emit`(`session_live_namespace.py:1942`, `run_coroutine_threadsafe(...).result(timeout=5)`) 5초 방송 시간초과. 02:12~02:23 UTC(수업 중반 이후)에 분당 5~26건. 방송 실패는 ACK을 막지 않는다고 코드가 명시(`:2219-2222`)하지만 폭주 구간의 부하 지표다.
- `KeyError: 'Session not found'` 16건: `on_join`에서 이미 끊긴 소켓을 조회(`session_live_namespace.py:598`). 입장 직후 끊김·재접속 부하의 흔적.
- `log_truncated` 1,561건(11:23~11:30 KST) — SDD-282 F17과 동일. 원인 코드는 `class_participation_service.py:893` 부근(고정 폭으로 되감기).
- 정원: 활성 행 51 > 정원 50 (SDD-282 F11).

## 6. 안드로이드 앱 수정 필요 여부 — 결론

**"앱 수정 없이는 안전하다고 말할 수 없다. 단, 데이터는 서버만으로도 지킬 수 있다."**

- 지킬 수 있는 근거 (확정): 묶음 C 4명의 분석 파일(`biosignal_artifacts` kind=`feature`)은 서버에 있고 멱등 적재 형식이 정상 경로와 같다(SDD-282 F5·F6). 이 업로드(`ArchiveUploader`)는 `capture.start` ACK 없이도 진행됐다. 따라서 **수업 종료 시 "artifact에 있고 DB에 없는 창"을 자동 적재하는 서버 정산**을 넣으면 같은 사건이 와도 분석 DB가 채워진다(앱 변경 불필요).
- 한계: 기대량 대비 57~93%만 복구 가능했다. 파일 업로드가 늦거나 끝나지 않은 구간은 기기에만 있다. 즉 서버 정산은 "대부분 구제"이지 완전 보장이 아니다.
- 앱 수정 후보(원인 확정 후 결정, 최소 3건):
  - A1. `capture.start`가 일정 시간(예: 20초) ACK 없이 지속되거나, READY 상태에서 `streamId==null`이 30초 이상이면 소켓을 강제 재연결하고 새 command_id로 재시작.
  - A2. join/resync snapshot의 `devices`에서 **본인 활성 stream**을 채택(현재는 종료만 반영). 소유자 확인(`participant_id`·`owner_actor_id`)이 서버 snapshot에 포함됨.
  - A3. 귀속 전 창이 60초 이상 쌓이면 진단 이벤트를 서버에 올리고 REST로 stream 조회(신규 API 필요).
- 금요일 전 업데이트 심사 1회에 넣으려면 **11/5(수) 정오까지 원인(기기 로그 확보 또는 dev 재현)** 이 필요하다. 못 얻으면 앱은 그대로 두고 서버 정산 + 입장 안정화 + 모니터링으로 간다.

## 7. 확인하지 못한 것

1. 앱이 stream 신원을 못 받은 정확한 이유(기기 로그/`scope.json` 필요). 교착 피해 참가자 전체 목록.
2. Play vc47(11/4 16:29 게시)이 vc46과 이 경로에서 달라졌는지. 행사 기기가 vc46이었는지 확인 불가(푸시 등록은 전원 `android/1.0.0`이라 구분 불가).
3. 묶음 E `879091`(원시 있고 stream 없음)과 묶음 D `94234b`(iOS) 원인.
4. 4명의 `band_connected=true` 전환이 없었던 점이 실제 BLE 연결 상태와 일치하는지(기기 확인 필요). 원시 업로드가 있으므로 BLE 연결은 사실상 확실하나 **추정**이다.
5. dev 재현 미실행.
