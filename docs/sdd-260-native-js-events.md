# SDD-260 네이티브 ↔ JS 이벤트 계약 (저장 진행)

- 정본 저장 경로는 REST 배치다(`docs/sdd-260-api.md`). 이 문서는 **화면 표시용** 진행 이벤트만 정의한다. 저장 판정·삭제에는 쓰지 않는다.
- 공통 봉투: Capacitor 플러그인 `NativeMeasurement` 리스너로 전달. `{ bridge_version: 1, event, managerGeneration, seq, emitted_at_native_ms, payload }`.
- 웹 수신: `NativeMeasurementFacade.onUploadProgress(cb)` → `uploadProgressStore`(전역) → `UploadProgressNotice`. 세션이 다르면 무시. 형식 불일치 필드는 0/`idle` 로 정규화.
- 이 이벤트들은 manager `seq` 단조 필터를 적용하지 않는다(진행 표시는 마지막 값이 정본).

| 이벤트 | payload | 의미 |
|---|---|---|
| `feature.counts` | `{ sessionId, pending, acked, rejected }` | feature outbox 현황. `rejected` = 격리(4종 거절) 건수 |
| `archive.counts` | `{ sessionId, pending, uploading, verified, quarantined, signals? }` | 원시 archive 큐 현황. SDD-264: `signals`={eeg,ppg,acc 각각 {pending,uploading,verified,quarantined}} additive(폰 기대량 보고용, Android·iOS 동일) |
| `reconcile.state` | `{ sessionId, feature, raw, complete }` | 종료 후 summary 대조 상태. `feature`/`raw` = `idle`/`checking`/`resending`/`done` 등 문자열(표시에는 쓰지 않음), `complete` = **feature·원시 summary 대조 모두 끝남** |

## 화면 문구 규칙 (`describeUploadProgress`)

| 조건 | 문구 |
|---|---|
| `featurePending > 0` 또는 `rawPending + rawUploading > 0` | `데이터 업로드 중 · feature N창 · 원시 M건` |
| 대기 0, `complete=false` | `서버 저장 여부를 확인하고 있어요` (완료라고 하지 않는다) |
| `complete=true`, 격리 있음 | `업로드 완료 · 확인 필요 N건` |
| `complete=true` | `업로드 완료` |

- 종합 점수·판정 문구 없음. 화면 이탈 가능(비차단). 완료 표시는 **대조(complete)가 끝난 뒤에만**.
