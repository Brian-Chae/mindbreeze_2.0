# SDD-300 — Summary
- 원인: iOS 는 SessionSync.onProgress(변화 시)로만 저장 진행 3종을 보냄(MeasurementHost.swift:140) → SessionSync 미생성/무변화 시 이벤트 0건 → 진단 "확인 전". Android 는 MeasurementPlugin.emitSync 가 2초 주기로 항상 송출.
- 수정: `MeasurementManager` 에 2초 하트비트(`startSyncHeartbeat`). 시작·복구 시 즉시 1회, 이후 2초마다(ARMING/CAPTURING/RECONNECTING 동안), seal 시 마지막 1회 후 해제, finishClosed 에서도 해제. 값=SessionSync 캐시 스냅샷(`emitSyncStatus` 가 저장) 우선, 없으면 `fallbackSyncSnapshot()`(outbox/archive 카운트, 0 도 숫자, reconcile idle/idle/false). 호스트 onProgress 경로는 그대로.
- 시험: SwiftPM 신규 6건(ManagerSyncHeartbeatTests) + 전체 261건 실패 0(7 skip 기존). JS 변경 없음(vitest 미실행: 워크트리에 node_modules 없음).
- 미확인: 실기기. iOS 네이티브 변경이므로 앱 재빌드 필요.
