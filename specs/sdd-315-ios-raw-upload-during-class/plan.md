# SDD-315 — Plan

## 1. 설계안 비교

| | A. 주기 증분 변환 (선택) | B. 패킷 도착 즉시 라이브 청커 | C. 현행 유지 + 종료 후 지터 단축 |
|---|---|---|---|
| 방식 | 매 30초 타이머로 `raw.journal`의 **새 구간(바이트 오프셋 이후)** 만 읽어, 매니저가 들고 있는 센서별 `RawChunker` 에 먹임. 청크가 봉인되면 즉시 파일 기록 + enqueue. 봉인 시 마지막 구간 + `flush()` | `bandLink(didReceive:)` 에서 패킷마다 청커에 직접 먹임 | 몰림만 완화 |
| 중복 방지 | alias 결정적 + `ArchiveQueue.enqueue` 멱등(같은 sha 는 무시) → 그대로 | 동일 | 동일 |
| 복구(재시작) | 커서(오프셋)=0 에서 journal 전체를 같은 결정적 변환으로 재생 → 이미 있는 청크는 멱등 | 별도 복구 경로 필요(메모리 청커 소실) | 변화 없음 |
| 청크 경계 | 청커는 **하나를 이어서** 쓰므로 일괄과 완전히 동일 | 동일 | 동일 |
| BLE 수신 경로 영향 | 없음 (수신 락·fsync 경로 안 건드림) | 수신 경로에 변환 비용 추가(SHA·JSON 직렬화) → 패킷 지연 위험 | 없음 |
| 코드량 | 작음 (증분 읽기 + 타이머 1개) | 중간 | 없음 |
| 문제 해결 | O | O | X (수업 중 0개 그대로) |

선택: **A**. 이유 — 대표 선호(단순·안전): 기존 변환 코드(청커·alias·gap 처리)를 그대로 재사용하고 "언제 돌리느냐"만 바꾼다. 수신 경로를 건드리지 않고, 복구가 "처음부터 같은 변환을 다시 돌리면 같은 결과" 한 가지 규칙으로 끝난다.

## 2. 구현

신규 `RawArchiver.swift` (MeasurementKit)
- `RawArchiver(dir:, sessionId:, streamId:, queue:, reconnectCount:)` — 센서별 `RawChunker`·`GapEventStore`·`LinkDropLog` 소유, `cursor`(raw.journal 바이트 오프셋) 보관.
- `catchUp(final: Bool)` — 오프셋 이후 레코드만 읽어 청커에 먹임. `final == true` 면 모든 청커 `flush()`.
- 청크 sink 는 기존 `put` 로직(파일 기록 후 `ArchiveItem` enqueue)을 그대로 쓴다.
- `origin` 은 첫 패킷 기준(일괄과 동일). 첫 패킷 이전에는 청커를 만들지 않는다.

`AppendOnlyJournal` — `scan(url:fromOffset:)` 추가: 오프셋부터 완결 레코드만 읽고 다음 오프셋 반환(기존 `scan(url:)` 불변, 내부 `walk` 재사용).

`MeasurementManager`
- `enqueueArchive(of:)` 의 raw 부분을 `RawArchiver` 호출로 대체. feature 부분은 그대로.
- 수업 중 타이머 `archiveTimer`(30초, 기존 `armStreamTimers/stopStreamTimers` 와 같은 규칙으로 arm/stop). 수집 중(`collecting`)일 때만 `catchUp(final: false)`.
- `seal()` 은 기존 순서 유지: `engine.seal()` → `enqueueArchive`(= `catchUp(final:true)` + feature) → close intent 기록. close intent 의 `expected_artifacts` 가 최종 큐 전체를 담도록 순서를 지킨다.
- 복구(`recoverOnLaunch`)·새 시작: 새 `RawArchiver`(커서 0)를 만들고, 첫 tick/봉인 때 전체 재생 → 멱등.

업로드 경로: 변경 없음. `SessionSync.start()` 는 미봉인 세션에서 지터 0 으로 즉시 pump, 60초 tick 마다 pump, 항목 verified 때 `pump()` 연쇄. 수업 중 큐에 들어온 항목은 이 경로로 올라간다. 종료 시 `sealed()` 의 0~60초 지터는 이제 **남은 구간(≤ 몇 개)** 에만 적용되므로 몰림이 크게 줄어든다.

## 3. 분석

| 항목 | 분석 |
|---|---|
| 중복 | alias 결정적(스트림·세그먼트·chunk_index) + enqueue 멱등. 수업 중 만든 청크를 봉인 때 다시 만들어도 sha 동일 → 무시 |
| 누락 | 커서는 "완결 레코드 끝" 까지만 전진. 찢긴 꼬리는 다음 tick 에 다시 읽음. 봉인 때 final catch-up + flush 로 잔여 확정 |
| 순서 | journal 순서 그대로 청커에 투입(일괄과 동일). 업로드 순서는 alias 정렬(기존) |
| 복구 | 메모리 상태(청커·커서)는 소실 가능, 디스크(journal, archive/*.bin, 큐)는 영속. 커서 0 재생은 결정적 → 같은 alias/sha |
| 메모리 | tick 당 새 구간만 읽음(30초 ≈ 수백 KB). 전체 journal 상주 안 함. 봉인 시 일괄 읽기보다 오히려 작음(이전: 32분분 18MB+ 한 번에 상주) |
| 배터리 | 30초마다 소량 디스크 읽기 + 청크당 SHA256. 종료 시 몰아서 하던 계산을 분산. 순증 미미 |
| 네트워크 | 분당 ≈17개 소량 PUT(Android 와 동일 수준). 종료 후 일괄 557개 → 잔여 몇 개 |
| 40대 동시 | 종료 시점 presign 요청이 40×557≈22,000건 → 40×(잔여 ≈ 3~10건). 수업 중에는 기기별 분산(기기마다 tick 위상 다름) |
| 알려진 차이 | gap 이벤트의 `reconnect_count` 는 그 시점의 값(일괄은 종료 시점 값). event_id 는 동일하고 중복 제거되므로 건수·id 불변, 값만 달라질 수 있음 |

## 4. Task

1. verify.md 작성 (구현 전) ✅
2. `AppendOnlyJournal.scan(fromOffset:)` + 시험
3. `RawArchiver` + 일괄 대비 바이트 동일 시험(청커 단위, 코어 무관)
4. `MeasurementManager` 연결(타이머·봉인·복구) + 매니저 시험(수업 중 enqueue, 복구)
5. 전체 `swift test`, summary.md
