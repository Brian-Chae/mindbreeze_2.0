# SDD-260 — Android 트랙 구현 노트 (N1~N6)

- 소유: frontend/android/** . 계약: contract.md(304ea934) + plan §5.1.
- 검증: `./gradlew compileDevDebugKotlin`, `./gradlew testDevDebugUnitTest`. 워크트리에 node_modules 심링크·local.properties·capacitor-cordova-android-plugins 복사가 필요하다(모두 gitignore).

## 설계 결정 / plan 과 달라진 점
1. **소켓 ACK 로 outbox 변경 0건**: LiveSession 의 pump·배치 재전송·ACK 기반 격리를 삭제했다. live:metric 은 현재 창 1개만 방송한다(best-effort, 재시도 없음). 근거: LiveSession.kt onFrame/broadcast/onMetricAck.
2. **MetricOutbox**: REST ACK 된 창도 삭제하지 않고 보관한다(A/R 레코드). 대조 시 재큐잉한다. stream 미확정 창은 `stream_unattributed` 로 격리하지 않고 보관한다(plan 의 구 동작과 다름, 저장 100% 목표). capture.start 시 bindUntagged 로 귀속한다.
3. **완료 판정**(contract §2): 서버 missing_ranges 가 비어도 완료로 보지 않는다. 로컬 sequence 집합 − 서버 보유([min,max]−gaps) = ∅ 일 때만 완료. truncated 면 마지막 gap 이후는 결측으로 취급. 키는 (stream_id, sequence).
4. **422 invalid_message**: contract 는 재시도 ✗ 이나 독 창 1개가 배치 전체를 막으므로 배치를 이분해 단일 창만 격리한다(iOS 와 동일).
5. **ScopeSweeper**(N3/N5): `<sid>/scope.json`(계정·참가자·stream, 비밀 아님) 기준으로 전 세션을 훑는다. 계정(JWT sub)이 다르면 보존만, 실행 중 scope 는 skip. 순서: feature 전송 → features/summary 대조 → archive 업로드 → close intent → biosignal-raw/summary 대조 → sync-complete.json. 삭제 0.
6. ArchiveWorker 는 sweeper 로 교체. 트리거: 종료 직후(5~60s 지터)·앱 시작/포그라운드(MeasurementPlugin.handleOnStart)·네트워크 복귀(NetworkCallback)·실패 시 WorkManager backoff.
7. 429: Retry-After 하한 + full jitter(V-C10).

## 미구현·미검증
- presign/ack **배치 ≤24 묶음(N4)**: 미구현(항목당 1 presign). 서버 슬롯 16 이라 지터로만 분산.
- NativeArchiveOnly(구 경로)는 남아 있으나 ArchiveWorker 가 더 이상 호출하지 않는다(미삭제).
- `feature.counts`/`archive.counts`/`reconcile.state` 이벤트 emit: 미구현. 대신 getMeasurementSnapshot 에 `uploadCounts` 필드를 추가했다. 웹 트랙 계약 문서 확정 후 emit 연결 필요.
- 60초 주기 스윕: WorkManager retry 로 대체(정확한 60s 아님).
- 실기기·Doze·강제종료(V-C5 실기기, V-A10 혼합) 시험 미실시. JVM 시험만.
- N6 의 capture.renew 즉시 호출은 기존 10초 renew 타이머에 맡겼다.
