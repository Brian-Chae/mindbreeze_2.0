# Summary — iOS 종료 기록 전송·움직임 실측 측정 횟수

## 원인
- close intent 미전송: `MeasurementManager.seal`(frontend/ios/MeasurementKit/Sources/MeasurementKit/MeasurementManager.swift:207)이 소켓 `capture.close` 만 보내고 `POST /sessions/{sid}/biosignal-events` 는 보내지 않음 → 서버 manifest `close_state` 판정 입력 없음.
- ACC 명목 rate: `RawChunker.swift:36` ACC 30Hz 고정, 헤더 `observed_rate`=null(`:130`). 실제 ≈26Hz → 서버 시간축 약 13% 단축.

## 수정 (Android #180 과 같은 계약·의미)
- `CloseIntentStore.swift`(신규): 종료 시 큐 raw·feature 로 intent 생성, 디스크 선저장(원자 쓰기), 최대 12회, participant_id 함께 저장. intent_id 는 Java `nameUUIDFromBytes` 와 같은 MD5 v3(안드와 같은 입력이면 같은 값, 테스트로 고정).
- `ArchiveUploader`: 큐가 비고 업로드 중이 없을 때 intent 전송. recorded/duplicate/conflict·4xx(401/408/429 제외)는 닫고, 네트워크/5xx/인증은 attempt+1 후 30초 뒤 재시도.
- `MeasurementManager.seal`: 큐 적재 직후·소켓 close 이전에 intent 기록. `ArchiveQueue.all()`, `archiveQueue(forSession:)` 추가.
- `MeasurementHost`: 앱 재시작 후 manager 가 큐를 안 들고 있어도 디스크의 세션 큐·intent 로 재전송. intent 가 남아 있으면 pending-archive 포인터 유지.
- `RawChunker`: ACC 장치 tick 기반 `observed_rate`·`observed_rate_window_us`·`observed_rate_reason`(1초 미만·tick 없음은 null+not_measured). EEG/PPG 는 명목과 일치해 Android 와 동일하게 기록하지 않음.

## 테스트
- swift test 192 통과(7 skip 기존), 실패 0. 신규: CloseIntentTests 10, RawChunkerTests +3, ManagerTests +1.
- 수정 전 확인: Manager 종료 기록 테스트 실패, ACC 실측 테스트 크래시(observed_rate null).
- 서버·JS 변경 없음(서버는 #180 합집합 평가 그대로).

## Android 와 차이 / 한계
- Android 는 WorkManager 재시도, iOS 는 BGTaskScheduler 미도입(Info.plist 식별자·빌드 필요, 범위 제외). 대신 앱 재시작(`resumeArchiveUploads`)·background URLSession 깨움·30초 인메모리 재시도로 전송. 앱이 종료돼 있고 깨움도 없으면 다음 실행까지 대기.
- 앱 재빌드 필요(iOS 네이티브 변경).
- 로컬 swift test 는 gitignore 된 xcframework 를 형제 워크트리에서 심링크해 실행(커밋 제외).
