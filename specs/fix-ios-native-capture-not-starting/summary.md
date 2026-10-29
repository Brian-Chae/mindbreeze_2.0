# [Fix] summary
- 원인(확정): 이틀 지난 CAPTURING 세션(`04ab448d…`, feature/outbox 저널 각 ~500MB)을 `recoverOnLaunch` 가 매 실행마다 되살려 `MeasurementEngine.recover()` 가 저널 전체를 메모리에 올림 → 3GB 한도 초과 jetsam(실행 25~31초 후 종료, 4회). 되살아난 낡은 세션이 매니저를 점유해 새 `startMeasurement` 는 `alreadyActive`(추정 연결: 빌드 21 '연결하는 중' 고착과 부합, 실기기 재확인 필요).
- 수정: `MeasurementManager.swift` — `recoveryVeto`(3시간 초과·저널 128MB 초과 시 복구 거부, active.json 은 `active.abandoned-*.json` 으로 보존), `startMeasurement` 다른 회차 수집 봉인 후 교체. FE: 시작 실패 사유를 기기 시트 오류줄에 표시(`describeNativeStartFailure`).
- 테스트: swift test 195건 0 실패(신규 3), vitest sdd246-web+신규 통과(121), tsc 통과.
- 미검증: 실기기. iOS 앱 재빌드 필요(Swift 변경). 기기의 1GB 저널은 삭제하지 않았다(새 로직이 읽지 않음).
- 이전 가설(BLE 재획득·소켓 토큰): 이번 증거로는 원인 아님(소켓 접속 이전에 막힘).
