# SDD-315 — Verify (구현 전 QA 체크리스트)

> Stage ③. 구현 전에 작성한다. 사후 수정은 "결과" 열만 채운다.

## 합격 기준

| # | 기준 | 시험 방법 | 시험 파일 |
|---|---|---|---|
| a1 | 수업 중(봉인 전) 큐에 raw 항목이 생긴다 | 매니저에 패킷 N개 투입 → 수업 중 tick 경과 → `archiveQueue.all()` 에 `.raw` 존재, 봉인 상태 아님 | ManagerArchiveDuringClassTests |
| a2 | 수업 중 만든 항목이 업로더 pump 대상(`dueItems`)에 오른다 | 위 큐에서 `dueItems` 가 raw 포함 | 〃 |
| a3 | 패킷이 적으면(10초 미만) 수업 중에는 만들지 않고 봉인 때 flush 로 나온다 | 소량 투입 → tick 후 raw 0, 봉인 후 raw ≥ 1 | 〃 |
| b1 | 수업 중 증분 + 봉인 flush 의 결과가 **일괄 변환과 바이트 동일**(alias 집합, 각 payload sha256, 파일 바이트) | 같은 raw.journal 을 (i) 한 번에 (ii) 여러 구간 증분 후 final 로 변환해 비교 | RawArchiverTests |
| b2 | 청크 합계 sample_count, `first_sample_index`/`end_sample_index_exclusive` 연속(segment 내 chunk 간 틈·겹침 없음) | b1 결과의 헤더 검사 | 〃 |
| b3 | 센서 3종(EEG/PPG/ACC) 모두 b1 성립 | 센서별 반복 | 〃 |
| b4 | 증분 경계가 패킷 중간·청크 경계·세그먼트 롤오버(tick 되감김)와 겹쳐도 b1 성립 | 롤오버 포함 입력, 경계 위치를 여러 값으로 | 〃 |
| c1 | 앱 강제 종료(메모리 상태 소실) 후 재시작 → 새 RawArchiver(커서 0)로 재생해도 큐에 같은 alias·sha 만 존재, 항목 수 불변 | 수업 중 일부 enqueue → 새 인스턴스로 final → 항목 수/집합 비교 | RawArchiverTests, ManagerArchiveDuringClassTests |
| c2 | 복구 후 이어 받은 패킷(새 구간)도 누락 없이 최종 일괄과 동일 | 중단→재생→추가 패킷→final, 일괄과 비교 | 〃 |
| c3 | journal 끝이 찢긴(torn) 상태에서도 완결 레코드까지만 처리하고 다음 tick 에 이어짐 | 꼬리 절단 파일로 catchUp 2회 | JournalTests |
| d1 | 서버 raw-v2 규칙: segment 내 chunk_index 0..n 연속, sample_index 연속·비겹침, 크기 ≤ 1,048,576B, alias 정규식 | b1 산출물 검사(위 RawChunkerTests 규칙 재사용) | RawArchiverTests |
| d2 | 같은 alias·다른 bytes 는 enqueue 거절(`aliasBytesConflict`)을 유발하지 않음 | 증분 vs 재생 모두에서 throw 0건 | 〃 |
| e1 | 기존 swift 시험 전부 통과(기준선 대비 실패 증가 0, skip/삭제 0) | `swift test` 전체 | 전체 |
| e2 | 봉인 시 close intent 의 `expected_artifacts` 가 최종 큐 전체와 일치(기존 시험 유지) | 기존 `testStopWritesCloseIntentToDiskBeforeServerAck` | ManagerTests |
| e3 | 봉인 후 `RawArchiver` tick 이 더 이상 동작하지 않음(타이머 취소) | 봉인 후 시계 진행 → 큐 불변 | ManagerArchiveDuringClassTests |
| f1 | journal 증분 읽기: 오프셋 이후만 반환, 다음 오프셋 정확, 기존 `scan(url:)` 동작 불변 | AppendOnlyJournal 단위 | JournalTests |

## 허용되는 차이 (b1 예외 — 설명 필수)

| 항목 | 일괄 | 증분 | 영향 |
|---|---|---|---|
| gap 이벤트 `reconnect_count` | 종료 시점 값 | 이벤트 생성 시점 값 | event_id 동일(결정적)이라 건수·id 불변, 값만 다를 수 있음. 청크 바이트에는 영향 없음 |

## 시험 불가/제외

| 항목 | 이유 |
|---|---|
| 실기기 BLE·실제 업로드(presign/PUT)·dev 서버 | 앱 빌드·서버 접근 금지. 감독이 앱 재빌드 후 확인 |
| 40기기 동시 부하 실측 | 분석(plan.md §3)으로 대체 |

## 결과

2026-11-06 시험 결과(구현 후 기입). 전체 `swift test` 279개 실행 / 실패 0 / skip 7(기준선과 동일한 기존 skip, 신규 skip 0).

| # | 결과 | 근거 시험 |
|---|---|---|
| a1 a2 | 통과 | testRawItemsAppearInQueueDuringClassAndAreDue |
| a3 | 통과 | testShortSessionProducesRawOnlyAtSeal, testShortInputProducesNothingUntilFinalFlush |
| b1 b3 | 통과(경계 step 5종, alias·sha256·파일바이트·크기 동일) | testIncrementalEqualsBatchBytesForAllSensors, testStopAddsOnlyRemainder… |
| b2 d1 | 통과(chunk_index·sample_index 연속, 센서별 총 샘플=입력 행수) | testServerRawV2RulesHold |
| b4 | 통과(세그먼트 롤오버, 경계 5종) | testIncrementalAcrossSegmentRolloverEqualsBatch |
| c1 c2 | 통과(RawArchiver 단위 + 매니저 recoverOnLaunch 실경로) | testCrashRecovery…, testForceQuitRecovery… |
| c3 | 통과(찢긴 꼬리) — JournalTests 가 아니라 RawArchiverTests 에 둠 | testTornJournalTailIsReadOnNextCatchUp |
| d2 | 통과(재생 후 항목 수 불변, enqueue 충돌 없음) | testNoConflictThrownOnIncrementalThenReplay |
| e1 | 통과 279/0 | 전체 |
| e2 e3 | 통과 | testStopAddsOnlyRemainderAndEqualsBatchAndTimerStops |
| f1 | 통과 | testJournalScanFromOffsetReturnsOnlyNewRecordsAndKeepsFullScan |
| 시험 유효성 | 수업 중 타이머를 끄면 신규 매니저 시험 2개 실패 확인 후 원복 | — |

미확인: 실기기 BLE·실제 presign/PUT·dev 서버, 40기기 실측(감독이 앱 재빌드 후 확인).
