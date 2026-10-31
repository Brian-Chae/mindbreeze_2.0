# SDD-260 웹·공통 트랙 구현 노트 (W1·W2·UI)

- 소유 경로: `frontend/src/lib/measurement-web/**`, `lib/biosignal/**`, `hooks/use-biosignal-resume-sweeper.ts`, 업로드 진행 UI, `docs/sdd-260-native-js-events.md`. 기준 계약: `contract.md`(BE).
- 로컬 검증: `cd frontend && npx tsc -b && npx vitest run tests/sdd260-web tests/sdd246-web …`.

## 1. 구현 전 정독 결과 (plan §10 웹 해당분)

| 항목 | 확인 | 근거 |
|---|---|---|
| 웹 정본 저장이 소켓 ACK 에 의존 | `MetricOutbox` 가 `sendMetricBatch`(소켓) ACK 의 `durable` 로만 제거, 대기 300 초과 시 가장 오래된 창 **폐기** | 구 `metric-outbox.ts:13,53` |
| 구 v1 REST feature(`POST /sessions/{id}/features`) 소비처 | `useBand` 의 `uploadFeatureBatch`(`postSessionFeatures`/`postEntryFeatures`) 만. 서버에서 삭제되어 404 | `useBand.ts:667-673`, `api/session.ts`, `api/class-flow.ts` |
| 소켓 `session:feature` 소비처 | `useBand` 의 `emitQueuedItem`(`emitSessionLiveFeature`) 만 | `useBand.ts:678-697` |
| IndexedDB | `mindbreeze-eeg-raw` v2. additive 로 v3 + `feature_rest_outbox` 스토어 추가 | `biosignal/queue-db.ts` |
| 앱(native) 번들 | 앱에서는 네이티브가 정본(FeatureUploader). 웹 W1 은 웹 브라우저 참가자·`web_wasm` 경로용 | `measurement-path.ts` |

## 2. 설계 결정 (plan 대비 달라진 점 포함)

1. **정본 = IndexedDB 영속 outbox + REST 배치**(`metric-outbox.ts`). 대기 상한·폐기 삭제. 5초 주기(`FEATURE_FLUSH_INTERVAL_MS`)·≤60창·오름차순·동시 1. 소켓 `live:metric` 은 `pushEnvelope` 에서 **결과를 보지 않는 방송**으로만 호출(실패해도 저장과 무관, ACK 로 acked 처리하는 코드 0건).
2. **거절 처리**: `QUARANTINE_CODES` 4종(participant_mismatch·stream_not_owned·consent_withdrawn·hash_conflict)만 격리. 그 외 코드·네트워크·5xx·타임아웃·401 은 full jitter(0..min(60s,1s×2^n)) 무한 재시도. 응답에 빠진 창도 재시도.
3. **422 처리(plan 에 없음, iOS 노트 §2-4 와 동일 결정)**: contract 상 422 는 "재시도 ✗(앱 버그)"이나 독 창 하나가 배치 전체 저장을 막으므로 배치 → 1창씩 분리, 단건 422 면 그 창만 `invalid_message` 격리.
4. **완료 판정**(contract §2 경고 반영): `feature-reconcile.ts::diffAgainstSummary` — 로컬 sequence 집합 − 서버 보유(`[min_index,max_index] − missing_ranges`, truncated 면 마지막 range 이후 결측) = ∅. "빈 배열 = 완료" 판정 안 함. sequence 는 u64 문자열 BigInt 비교.
5. **스위퍼 W2**(`feature-sweeper.ts` + `hooks/use-biosignal-resume-sweeper.ts`): `RootLayout` 에서 앱 시작·`online`·visibilitychange·앱 복귀·60초. 현재 계정(`user:<id>`) 또는 sessionStorage 입장 자격(`entry:<participantId>`)과 일치하는 scope 만 전송, 불일치는 보존만(V-C6). 대조 후 결측 창만 `requeue` → 재전송 → 재조회(최대 3회). 완료 마커(`completedCount`) 전에는 삭제 0 — 이 트랙은 어떤 로컬 레코드도 삭제하지 않는다(7일 보관 정책은 별도).
6. **UI**: `NativeMeasurementFacade.onUploadProgress` 가 `feature.counts`/`archive.counts`/`reconcile.state` 3종을 받아 `uploadProgressStore` 에 부분 갱신 → `MemberLiveScreen` 의 `UploadProgressNotice`. 계약은 `docs/sdd-260-native-js-events.md`.
7. **`useBand` v1 feature 업로드 차단**: `MemberClassContainer` 에서 `v1FeatureUpload: false` 고정(이전: web_wasm/native 가 아닐 때만 true). 서버가 `/features`(404)·소켓 `session:feature` 저장 경로를 없앴으므로 회원 화면은 더 이상 이 경로를 쓰지 않는다. 기존 시험 `t12-native-start` 의 문자열 단정을 새 정책으로 갱신.
8. **IndexedDB 버전 3**: `RAW_DB_VERSION` 2→3(additive 스토어 `feature_rest_outbox`). 같은 DB 를 쓰는 기존 큐 코드는 `openRawDb` 공유라 영향 없음.

## 3. BE 노트 요청 항목 처리

- BE 보고 "레거시 소켓 `session:feature` → `persist_feature_windows` 가 아직 DB 저장" → **웹 회원 화면은 더 이상 의존하지 않는다**(위 7). 서버 쪽 제거 요청: `backend/app/ws/session_live_namespace.py:1163` 의 `session_service.persist_feature_windows` 호출(레거시 `session:feature` 핸들러)은 **웹 클라이언트 사용처가 호스트 화면(아래 §4) 하나만 남아** 있으므로, 호스트 화면 정리 후 제거 가능. 지금 제거하면 호스트 화면 동작이 달라지므로 감독 판단 필요.

## 4. 남은 위험 · 확인하지 못한 것

1. **호스트(상담사) 화면 `ClassPlayerPage.tsx:400` 의 `useBand` 는 `v1FeatureUpload` 기본 true** — 구 REST `/features`(404)·소켓 `session:feature` 를 그대로 쓴다. 소유 경로(plan §8 웹 행) 밖이라 변경하지 않았다. 호스트가 밴드를 착용하는 경우 호스트 자신의 feature 는 REST 404 로 재시도만 하고(IndexedDB 큐에 누적) 소켓 `session:feature` 경로로만 저장될 수 있다. 11/4 현장 40명 = 회원 화면이므로 합격선과 무관하나, 호스트 착용 시 별도 판단 필요.
2. **웹 브라우저 참가자의 `web_wasm` 경로는 코드·단위 시험까지만** 검증. 실제 브라우저+밴드 종단(V-A13 새로고침 복원)은 미실시(`IdbOutboxStore` 는 `fake-indexeddb` 로 360창 영속 복원·계정 격리·u64 정렬 시험 통과, 실제 브라우저 IndexedDB 는 미시험).
3. **summary 호출 부담**: 스위퍼가 60초마다 미완료 scope 에 대해서만 summary 를 부른다. 완료 마커가 있고 대기 0 이면 호출하지 않는다.
4. **앱(native)**: 이 트랙은 이벤트 수신·표시만 맡는다. 네이티브가 이벤트를 실제로 내보내는지는 iOS(`MeasurementManager.swift:726-731`) 만 확인, Android 방출부는 grep 에서 확인되지 않음(Android 트랙 확인 필요).
5. 완료 마커(`completedCount`)는 acked 건수와 같을 때만 "done". 이후 새 창이 쌓이면 다시 대조한다.

## 5. 후속 수정 — 호스트 화면 v1 feature 업로드 (W3)

- **조치**: `useBand.ts` `v1FeatureUpload` 기본값 true→false. `ClassPlayerPage.tsx:400`·`PlaygroundPage`·`useBandStep` 은 모두 명시 true 가 없으므로 업로드 비활성(404 재시도·큐 적체 중단). 명시 `true` 호출자는 코드베이스에 0곳(grep) — 코드경로(useBand.ts 669~934)는 옵션으로만 도달하는 죽은 경로이나, 큐/ack 훅과 얽혀 있어 이번 범위에선 삭제하지 않고 기본 차단만 했다(후속 정리 후보).
- **호스트 feature 가 저장 대상인가 → 아니오(표시만 유지)**. 근거: 리포트 통계는 `class_report_stats_service.py:~340-358` 에서 `report_scope.scope_for_session` 의 `included_ids`(= `SessionParticipant.report_included` 참인 참가자, `report_scope.py:62-80`) 의 `EEGFeatureWindow` 만 읽는다. 호스트는 회원 입장 플로우의 `report_included` 선택(`api/v1/session.py:761` 본인 참여자 선택)을 거치는 대상이 아니고 행 기본값은 False(`models/session.py:193`)라 리포트에 포함되지 않는다. 호스트 화면은 `ClassPlayerPage.tsx:1220-1280` 에서 `band.*` 로컬 값을 표시에만 쓴다.
- **확인하지 못한 것**: 호스트가 `report_included=true` 로 바뀌는 운영 경로가 있는지는 코드상 확인되지 않음(없다고 단정은 못함). 있다면 호스트용 REST 배치 연결이 필요하며 그건 별도 결정.
