# Plan — iOS 종료 기록(close intent) 전송·ACC 실측 rate

## 원인 분석
- close intent 미전송: `MeasurementManager.seal`(frontend/ios/MeasurementKit/Sources/MeasurementKit/MeasurementManager.swift:207) 이 실시간 소켓 `capture.close` 만 보내고 `POST /sessions/{sid}/biosignal-events` 는 보내지 않음. 서버 manifest `close_state` 는 이 intent 로 판정(합집합 `_merged_intent`, #180).
- ACC 명목 rate: `RawChunker.swift:36` 이 ACC 를 30Hz 로 고정, 헤더 `observed_rate`=null(`:130`). 실제 ≈26Hz → 서버 시간축이 약 13% 짧아짐.

## 수정 (Android #180 과 같은 계약·의미)
1. `CloseIntentStore.swift`(신규): Android `CloseIntentStore.kt` 포팅. 종료 시 큐의 raw·feature 로 intent 생성 → 디스크(`close-intent.json`, fsync+rename) 선저장. intent_id = MD5 v3 UUID(안드 `nameUUIDFromBytes` 와 동일 입력·동일 값). pending(): 미전송·시도 12회 미만. markSent/markAttempt. participant_id 도 파일에 함께 저장(재시작 후에도 전송 가능).
2. `Archive.swift`: `ArchiveQueue.all()` 추가.
3. `ArchiveUploader.swift`: 큐에 더 시작할 항목이 없고 업로드 중이 없을 때(`pump` 끝) 대기 intent 전송(`sendCloseIntent`). recorded/duplicate/conflict 와 4xx(401/408/429 제외)는 닫고, 네트워크/5xx/인증은 attempt+1 후 30초 뒤 재시도.
4. `MeasurementManager.seal`: 봉인 성공 + closeStream 이면 enqueueArchive 직후 intent 기록(서버 응답·소켓 close 이전).
5. `MeasurementHost`: 큐/intent 파일을 세션 디렉터리에서 직접 열어 앱 재시작·background URLSession 깨움 때 재전송(기존엔 manager 가 비활성이면 재개 불가). 포인터 파일은 archive 미완 또는 intent 대기 중이면 유지.
6. `RawChunker.swift`: ACC 만 Android 와 같은 방식으로 장치 tick 실측 rate(`observed_rate`, `observed_rate_window_us`, `observed_rate_reason`). 1초 미만·tick 없음은 null+`not_measured`. EEG/PPG 는 명목과 일치해 Android 와 동일하게 기록하지 않음(근거: #180).

## 비범위
- BGTaskScheduler 신규 등록은 하지 않음: Info.plist 식별자·Capability 변경과 앱 빌드가 필요(이번 범위 금지). background URLSession 완료 깨움(handleEventsForBackgroundURLSession)과 앱 재시작(resumeArchiveUploads) 경로로 전송한다.
- 서버·안드·JS 변경 없음.
