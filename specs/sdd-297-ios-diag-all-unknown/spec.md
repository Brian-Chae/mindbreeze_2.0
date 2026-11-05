# SDD-297 — iOS 연결 진단이 전부 "확인 전"으로 표시

- 상태: Stage ① Spec
- 브랜치: `sdd/297-ios-diag-all-unknown` (develop 687967bb 기반)
- 작성일: 2026-11-05

## 증상
iOS 빌드 2 실기기에서 기기 시트의 연결 진단 "분석 데이터 / 측정 기록 파일" 줄이 모두 "확인 전"이고 클래스 중에도 갱신되지 않는다.

## 코드 대조로 확정한 원인
"확인 전"은 `diagnostics.upload === null`(→ `count(undefined)`)일 때 나온다. `upload` 는 `uploadProgressStore.get(sessionId)` 가 null 이면 null 이다.

| # | 구간 | Android | iOS | 판정 |
|---|---|---|---|---|
| 1 | 저장 진행 이벤트(`feature.counts`·`archive.counts`) 방출 | `MeasurementPlugin.emitBatch → emitSync` 가 변경 즉시 + **2초마다 무조건** | `SessionSync.publish` 콜백(`MeasurementHost` onProgress) **변경 시에만**, 그것도 `sessionReady`→`uploader.whenReady` 뒤 SessionSync 가 만들어진 다음부터 | iOS 는 SessionSync 가 안 만들어지거나(자격·uploader 준비 지연) 변화가 없으면 이벤트가 0건 → 스토어 영구 null |
| 2 | JS 수신 | 이벤트 → `facade.onUploadProgress` → 스토어 | 동일 코드(payload 키 동일: pending/acked/rejected, pending/uploading/verified/quarantined) | payload 형태 차이는 **없음**(키·sessionId 동일) |
| 3 | 대체 경로 | 매초 `measurementUpdated` 의 `archive.queue`(live_pending·live_acked·archive_pending·archive_verified) | iOS `snapshot()` 도 같은 4개 키를 매 snapshot 에 포함 | JS 가 이 값을 안 읽어서, 이벤트가 안 오면 값이 있어도 "확인 전" |
| 4 | 렌더 | 매초 상태 갱신으로 우연히 재렌더 | 같음 | `uploadProgressStore.get()` 을 렌더 중 직접 읽을 뿐 구독하지 않아 이벤트만 오고 재렌더가 없으면 갱신 지연 |
| 5 | 경로 | — | `diagPath !== 'native'`(web_wasm 하강·게스트)면 의도적으로 upload=null | 빌드 2 에서 iOS 가 어느 경로였는지는 실기기 로그 없이 확정 불가(보고에 남김) |

## 수정 범위(소유: connection-diagnostics-model.ts, use-native-measurement.ts diagnostics 구성부)
1. JS 가 `measurementUpdated` snapshot 의 `archive.queue` 에서 저장 진행 값을 뽑아, 해당 세션에서 저장 진행 **이벤트가 아직 한 번도 오지 않았을 때만** 스토어에 채운다(이벤트가 오면 이벤트가 우선, 항상 덮어씀). Android 불변.
2. `diagnostics` 가 스토어를 구독(`useSyncExternalStore`)해 값이 바뀌면 재렌더.
3. 값이 정말 없을 때(스냅샷에도 queue 가 없음)만 "확인 전".
4. 네이티브(iOS) 변경 없음 → **앱 재빌드 불필요**(웹 번들만). 계약 버전·Android 계약 불변.

## 범위 밖
인계 로직(293), 진단 패널 UI(294), 상태 문구(295), 종료 해제(298).
