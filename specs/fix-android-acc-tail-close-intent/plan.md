# [Fix] 안드 착용 움직임 끝부분 누락·종료 기록 미전송 — 원인분석·Plan

대상 회차: 2a11d64c-8d3d-4cff-90f3-5a5f82208c22 (10/29 12:06~12:20 KST, Android dev APK vc6 = a7839efe). dev DB 읽기 전용 확인.

## 1. 원인 분석 (근거)

### 1-1. ACC "끝부분 누락" = 데이터 누락이 아니라 시간축(명목 30Hz) 오표기
- 청크 업로드 시각: ACC 마지막 청크 created_at 03:20:50.20, EEG 03:20:49.74, PPG 03:20:49.02 → 종료 후 플러시·업로드는 3신호 모두 정상(`NativeRuntime.stop` → `rawArchiver.flush()`, `NativeRuntime.kt:122`).
- 청크 중간 구멍 0(chunk_index 0..70 연속), 같은 segment 1개.
- 실제 도착: ACC 패킷 702개 × 30샘플 = 21,060샘플, 패킷 간 장치 tick 간격 평균 1,156ms(= 25.96Hz). EEG 811.2초 대비 ACC 샘플/초 = 26.0Hz, 최근 10일 다른 회차 12건 모두 25.9~26.6Hz(PPG 50.2Hz, 정상).
- 그런데 `RawChunker.kt:41` 은 `Sensor.ACC.sampleRateHz=30`(`Models.kt:7`)으로 헤더 `rate=30/1`을 쓰고, 서버 `biosignal_service._time_ms`(`biosignal_service.py:120`)는 `anchor + index/명목rate` 로 start_ms/end_ms 를 계산 → 21,060/30 = 702초. 실제 811초 → 약 108초 "일찍 끝난 것처럼" 보임. 샘플은 하나도 빠지지 않았다.
- 즉 누락 아님. 결함 = 실측 rate 를 헤더에 안 싣고(`observed_rate: null, not_measured`) 명목 rate 로만 시간축을 산출.

### 1-2. close intent 0건
- 서버: `biosignal_close_intents` 0행, nginx/uvicorn 로그에 해당 회차 `biosignal-events` 요청 없음 → 앱이 보내지 않았다(거절 아님).
- 네이티브(Kotlin)·iOS(Swift) 어디에도 `biosignal-events`/close intent 송신 코드가 없다. 종료 시 네이티브는 `capture.close`(live 소켓)만 보낸다(`NativeRuntime.kt:123`). 이 회차 raw/feature 는 네이티브가 올렸고(`parser_profile.platform=native-candidate`) → close intent 의 expected set 을 만들 주체가 없음.
- 같은 회차 indices 67·normalization 1 은 JS(`display-snapshot.ts`)가 올렸다(stream_id 가 네이티브와 다름). 즉 JS 캡처 런타임은 살아 있었는데, `useCloseBiosignalOnEnd`(#176)가 `phase==='ended'` 에서 `close()` 를 호출하면 같은 순간 EntryPage 가 종료 화면으로 전환되며 `MemberClassContainer` 가 unmount 된다. 훅 cleanup 이 `cancelled=true` 로 만들어 `rt.active()` 가 false → `pump()`/`sendBiosignalEvents(…, rt.active)` 가 전송을 건너뛰고(`useBiosignalCapture.ts` pump·`upload-queue.ts:184`), cleanup 의 `session.pause()` 가 lease 를 반납해 close 의 `addEvent` 도 경합. (코드 경로상 확정, 실기기 재현 로그는 없음)
- 서버 `manifest_service._latest_intent` 는 가장 최근 1건만 평가 → JS·네이티브가 각각 보내도 합쳐지지 않음.

## 2. 수정 계획
1. **네이티브(Android) close intent**: `NativeRuntime.stop()` 에서 raw/feature 플러시 후 `ArchiveQueue` 항목(alias·checksum·청크 메타)으로 close intent 를 만들어 디스크(`close-intent.json`)에 먼저 저장 → 업로드 drain 끝에서 `POST /sessions/{sid}/biosignal-events` 전송, 성공(recorded/duplicate/conflict)이면 sent 표시. 실패는 WorkManager 재시도(`NativeArchiveOnly.drain` 도 전송).
2. **서버 intent 병합**: manifest 평가가 최신 1건이 아니라 참가자의 모든 close intent 를 합집합(expected/streams/snapshots/lost, last_gap_sequence=max)으로 평가 → 네이티브(raw·feature)와 JS(indices·normalization) intent 가 공존.
3. **JS 훅**: `close()` 가 unmount 경합과 무관하게 전송 — close 진행 중이면 unmount cleanup 이 기다렸다가 pause, 전송은 `active` 와 무관하게 수행.
4. **ACC 시간축**: `RawChunker`(Android) 가 구간 누적 tick 으로 실측 rate 를 `observed_rate`(+window)에 기록, 서버 `_time_ms` 는 observed_rate 가 있으면 그것으로 start/end 산출(없으면 기존 명목).
5. iOS 는 동일 결함(close intent 미송신, ACC 명목 rate)이 있으나 병렬 카드(#179 BandBLE.swift·native-measurement/index.ts)와 영역이 달라도 이번 PR 범위 밖 → 보고만.

## 3. 영향
- 앱 재빌드 필요(Kotlin). 서버/프런트 배포 별도.
- 기존 청크 호환: observed_rate null 이면 기존 동작.
