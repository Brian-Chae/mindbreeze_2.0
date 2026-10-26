# T12-Android — 통합 테스트판 점검 결과 (브랜치 `sdd/246-t12-android`)

로컬 커밋만. push·머지·배포·Play·메일·서버접속 없음. 수정 경로 `frontend/android/` 만.

## (1) MetricOutbox ↔ stream 귀속
- 문제: outbox 는 순번만 기억하고 전송 시점의 현재 `streamId/ownerGeneration/anchorId` 로 envelope 을 만들었다. 재시작 후 서버가 새 stream 을 주면 옛 창이 **새 stream_id·generation** 으로 나갈 수 있었다.
- 수정(`live/MetricOutbox.kt`, `live/LiveSession.kt`): `StreamTag(streamId, generation, anchorId, participantId)` 를 창마다 영속(줄 `B\t<seq>\t<json>`, 압축 시 보존). `nextBatch(current, max)` — 현재 stream 창 우선, 없으면 가장 오래된 다른 stream 창을 **그 stream 의 옛 신원**으로 전송, 한 묶음=한 stream. 같은 stream 은 최신 앵커 id, 옛 stream 은 기록된 앵커 id.
- 귀속 없는 창: 이번 프로세스에서 stream 없이 만든 창(capture.start 전)은 첫 stream 에 귀속·영속. 디스크에서 복원했는데 귀속 기록이 없는 창(이전 형식)은 `stream_unattributed` 로 격리(새 stream 으로 보내지 않음).
- 시험 `OutboxStreamBindingTest` 4건 + `LiveContractT05bTest.restartThenNewStreamNeverMixesOldWindows`(프로세스1: stream 에서 3창 미ACK 종료 → 프로세스2: 새 stream2/generation 9 로 capture.start → 옛 창 1–3 은 stream/generation 3, 새 창 4 는 stream2/9, 묶음 혼합 0).
- 한계: 서버가 옛 stream 을 이미 `stream_not_active` 로 끝냈으면 그 창은 서버에서 rejected → 기존 로직대로 격리(원본은 journal·archive 에 남음).

## (2) 시간축 점검 — 일치 (수정 없음)
- 코어: `packages/measurement-core/src/engine.rs:478` `wall_us = wall_ms*1000 + (arrival_monotonic_us − anchor.monotonic_us)` 가 창 `window_start/end_us` 의 시간축.
- Android 가 reanchor 에 보내는 값: `MeasurementEngine.kt` `windowTimelineUs(monoUs) = wallAnchor*1000 + (monoUs − anchorMono)` (같은 식), `lastEegAnchor` 가 이 값을 `monotonic_us` 로 제공 → `NativeRuntime.kt:54` `anchorProvider` → `LiveSession.sendProbe` 의 `capture.reanchor.monotonic_us`.
- 서버: `session_live_commands.py:392` 가 `anchor_monotonic_us = monotonic_us`, `anchor_server_at = ctx.now` 저장 → `live_ingest_service.py:79-83` `anchor_server_at + (window_{start,end}_us − anchor_monotonic_us)`. 즉 `anchor_server_at + (window_end_us − anchor_monotonic_us)` 환산이 같은 축.
- 기존 회귀 시험 `ReanchorTimelineTest`(elapsedRealtime 과 벽시계가 다른 축일 때 앵커·창 종료가 3초 이내, 앵커 = 벽시계앵커 + 단조 경과) 통과.
- 잔여 오차: anchor 쌍이 "마지막 EEG 패킷 도착 시각"이고 서버는 수신 시각을 쓰므로 패킷 간격(≤수십 ms)+네트워크 지연이 오차. `clock_uncertainty_ms`(rtt/2+5)가 이를 표현.

## (3) dev 변형 native 소유 — 막는 요소 없음 (기록만)
- 플래그는 JS 의 `setNativeOwnership(true)` 로만 켜진다(`MeasurementPlugin.kt:76`). 변형(dev/prod) 분기 코드·BuildConfig 차단 없음 → dev·prod 모두 JS 가 켜면 native 소유 가능. `nativeEnabled` 기본값은 false 유지(JS 미호출 시 기존 BLE 경로).
- debug 합성 주입(`debug_force_native`)은 FLAG_DEBUGGABLE 일 때만 유효.

## (4) Release 검증
- `./gradlew bundleProdRelease -PallowUnsignedRelease=true` 성공(keystore.properties 없음 → 서명 요구 게이트를 이 플래그로만 우회; **기본은 여전히 서명 필수**, 키 값 미출력). 산출물 `app/build/outputs/bundle/prodRelease/app-prod-release.aab`(서명 안 됨, 배포 불가).
- AAB 내 `base/lib/arm64-v8a/libmeasurement_core.so` **929,616 B 포함** 확인(+ libjnidispatch.so 등). 32비트/x86 에는 코어 .so 없음 → `core_unavailable` 경로(arm64 기기만 지원).
- merged manifest(`intermediates/merged_manifests/prodRelease/...`): `MeasurementService` exported=false, cleartext/debuggable 속성 없음. exported=true 는 MainActivity(LAUNCHER), facebook `CustomTabActivity`(fbconnect 스킴), androidx.work `SystemJobService`(BIND_JOB_SERVICE 권한 보호) 뿐 — debug 전용 서비스·리시버 export 없음. `src/debug` 의 cleartext 와 `src/adbtest` 의 서비스 export 는 release 에 미포함.

## (5) 검증 수치
- `./gradlew testDevDebugUnitTest testProdDebugUnitTest assembleDevDebug` → dev 125 / prod 125건, 실패 0, skipped 0 (기존 120 → +5).

## 남은 일 / 타 워커 요청
- 실제 LINK BAND 측정·Doze(삼성 Freecess 동결) 실측은 여전히 대표 실기기 필요(t08.md 위험 1).
- 실기기(Note10) 설치 시험은 이번 작업에서 수행하지 않음(코드 변경이 단위 시험 범위; 필요 시 `adb install -r` dev 변형으로 후속).
- T12-BE: 옛 stream 창이 옛 stream_id/generation 으로 도착할 수 있으므로 서버는 `stream_not_active`/superseded stream 창을 명시 코드로 rejected 해야 클라이언트가 격리한다(현재 동작과 동일 계약).
- CI(T12): release 서명 키는 `keystore.properties` 로 주입, `-PallowUnsignedRelease` 는 검증 전용.
