# SDD-300 — Plan
1. `MeasurementManager` 에 하트비트: `syncHeartbeatTimer`(scheduler, 2초). 시작(arming)·복구(reconnecting) 직후 즉시 1회 + 재예약. 재arm 시 기존 타이머 취소(이중 타이머 방지).
2. tick: state 가 ARMING/CAPTURING/RECONNECTING 이 아니면 해제하고 종료. 맞으면 송출 후 재예약.
3. 송출 값: `lastSyncSnapshot[sid]`(emitSyncStatus 가 캐시, SessionSync 가 있으면 이것) 우선, 없으면 `fallbackSyncSnapshot()`(순수, outbox.counts/ArchiveCounts/signalCounts, state idle).
4. seal()/finishClosed(): 타이머 해제, seal 시 마지막 값 1회 송출.
5. 시험: ManagerSyncHeartbeatTests (ManualScheduler).
6. 호스트 `onProgress` 경로는 유지(변경 즉시 송출). 폭주 방지: 하트비트 간격 2초 고정.
