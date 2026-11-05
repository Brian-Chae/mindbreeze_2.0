# SDD-297 Plan

1. `use-native-measurement.ts`: 순수 함수 `uploadPatchFromSnapshot(snap)` 추가·export. `archive.queue` 의 live_pending/live_acked/archive_pending/archive_verified 가 모두 유한한 수일 때만 `{featurePending, featureAcked, rawPending, rawUploading:0, rawVerified}` 반환, 아니면 null.
2. 같은 파일: 훅에 `uploadEventSeenRef: Set<sessionId>`. `onUploadProgress` 콜백에서 이벤트 수신 표시 후 스토어 갱신. `onMeasurement` 콜백에서 이벤트 미수신 세션이면 `uploadPatchFromSnapshot` 으로 스토어 시드.
3. 같은 파일: `uploadProgressStore.get` 직접 읽기 → `useSyncExternalStore(subscribe, () => get(sessionId))`.
4. 시험(`tests/sdd297-ios-diag-unknown.test.tsx`): 순수 함수(iOS 형태 snapshot/Android 형태/queue 없음), 시드 후 `deriveConnectionDiagnostics` 줄이 '확인 전'이 아님, 이벤트 후 우선, 훅 단위 통합(퍼사드 mock).
5. 회귀: `tsc -b`, `sdd284-connection-diagnostics` 23건, `sdd260-web`, 관련 vitest.
