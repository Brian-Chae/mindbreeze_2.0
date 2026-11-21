# SDD-331 Plan

| 경로 | 변경 |
|---|---|
| JS 정책 | `reconnect-policy.ts` — `FAST_WINDOW_MS=120000`, 간격 2.5±0.5초, `ATTEMPT_TIMEOUT_MS=10000`, 느린 단계 직접 연결 2회 연속 실패 시 스캔 전환, `withAttemptTimeout` |
| JS 훅 | `useBand.ts` — 끊김 시각(`gapStartRef`)·느린 시도·직접 실패 카운터, 자동 시도에 10초 제한(초과 시 `abortConnectAttempt`로 정리, `bandConnectInFlight`는 기존 finally 가 해제), 스캔 복귀(`rediscoverBand`), `wakeBand()` 노출 |
| JS BLE | `bluetoothService.abortConnectAttempt/rediscoverBand`, `BluetoothProvider.rediscoverDevice`(선택), `CapacitorBleAdapter.rediscoverDevice`(requestLEScan, 이름/ID 일치) — 웹은 미구현(null) |
| UI | 회원 기기 시트: 끊김 + 120초 경과 시 깨우기 안내 + [깨웠어요](`onBandWake`). 점수·등급 없음 |
| Android | `BandReconnectPolicy.kt`(순수), `BandGattClient` 연결 단계 10초(빠른 창)·고정 간격·스캔 복귀·`reconnectNow()`, `MeasurementPlugin.reconnectBand`, `MeasurementManager.activeBand` |
| iOS | `ReconnectBackoff` 새 정책(시계 주입), `BandLink` 10초 시도 제한·스캔 복귀·`restartFastWindow()`, `MeasurementManager.reconnectBand` 가 이를 호출 |
| 네이티브 facade | `reconnectBand` 의 iOS 전용 분기 해제(android 허용) |

결정: 깨우기 안내 기준은 "연결 끊김(lost)이 120초 지속"(JS 측 표시 시계), 네이티브 소유 시에도 동일. [깨웠어요]는 네이티브 소유면 `reconnectBand`(빠른 창 재시작), JS 소유면 `wakeBand`(첫 시도는 스캔).
