# SDD-315 — Summary

## 원인 (확정)
`MeasurementManager.enqueueArchive` 가 봉인 후에만 raw.journal 을 청크로 변환해 큐에 넣어, 수업 중 큐의 raw 가 0개였다. 업로더는 정상이었다(큐가 비어 올릴 것이 없었음).

## 변경 (iOS Swift만, Rust 코어·서버·계약 변경 없음)
| 파일 | 내용 |
|---|---|
| `Sources/MeasurementKit/RawArchiver.swift` (신규) | 센서별 `RawChunker` 를 세션 내내 유지, raw.journal 커서 이후만 증분 변환, 청크 봉인 즉시 파일 기록+enqueue, `final` 이면 flush |
| `AppendOnlyJournal.swift` | `scan(url:fromOffset:)` 추가(완결 레코드만, 찢긴 꼬리는 다음 호출로). 기존 `scan(url:)` 불변 |
| `MeasurementEngine.swift` | `rawPackets(in:fromOffset:)` 추가 |
| `MeasurementManager.swift` | 30초 `archiveTimer`(수집 중에만), 봉인 시 `catchUp(final:true)`, 세션 시작·복구 시 RawArchiver 초기화(커서 0 재생) |
| 시험 | `RawArchiverTests`(9), `ManagerArchiveDuringClassTests`(4) |

## 선택한 설계
주기 증분 변환(A안). 청커를 이어 쓰므로 결과가 일괄 변환과 바이트 동일하고, 복구는 "처음부터 같은 변환 재생 → alias 결정적이라 멱등" 한 규칙. BLE 수신 경로 무변경. (비교표는 plan.md)

## 시험
`swift test` 279개, 실패 0, skip 7(기존). 기준선 266. gitignore 된 xcframework 는 sdd292 워크트리 것을 심볼릭 링크(`.git/info/exclude` 로 제외, 커밋 대상 아님)해서 실행.

## 알려진 차이
gap 이벤트 `reconnect_count` 값이 일괄은 종료 시점, 증분은 생성 시점. event_id 동일(결정적)이라 건수·id 불변, 청크 바이트 무관.

## 앱 재빌드 필요: 예
## 위험
- 30초 tick 이 매니저 락을 잡고 journal 증분(≈30초분)을 읽음 → 락 점유 시간 짧으나 실기기 BLE 지연 영향은 미실측.
- 수업 중 업로드 시작은 SessionSync 가 이미 돌고 있다는 전제(코드상 확인, 실기기 미확인).
