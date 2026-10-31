# SDD-260 — iOS 트랙 구현 노트 (N1~N6)

- 소유 경로: `frontend/ios/MeasurementKit/**`, `frontend/ios/App/App/Measurement/**`. 기준 계약: `contract.md`(BE, 커밋 304ea934) + plan §5.1.
- 로컬 검증: `cd frontend/ios/MeasurementKit && bash scripts/build-core-xcframework.sh && swift test`. xcframework(`Frameworks/`)는 gitignore 산출물이라 워크트리마다 1회 빌드해야 한다. 기준선 = 196 tests, 7 skipped(MK_WIRE_PYTHON 미지정), 0 failures.

## 1. 구현 전 정독 결과 (plan §10)

| 항목 | 확인 | 근거 |
|---|---|---|
| 소켓 ACK → `markAcked` 호출 위치 | `LiveSession.applyMetricAck` 한 곳(`durable==true` 이고 accepted/duplicate). 거절은 `markRejected`, 배치 오류는 `handleMetricError`(재시도·격리·`metricHalted`). 전부 **소켓 ACK 에 의존** | `LiveSession.swift:397-416`, `:375-389` |
| outbox 전송원 | `MetricOutbox.nextBatch(max,excluding)` = 미ack·미거절, **최신창 우선**(소켓용). 저장 경로(오름차순)·재개(reopen) API 없음 | `MetricOutbox.swift:75` |
| REST 인증 공급자 | `ArchiveUploader.post` = `Authorization: Bearer <access>` + `X-MB-Native: capacitor`. 토큰은 `TokenProvider.accessToken(handle:)`(만료 30초 전 single-flight 갱신). native 는 입장 자격(entry credential)을 쓰지 않음 | `ArchiveUploader.swift:55-63`, `MeasurementHost.swift:startArchive` |
| 429/background URLSession | `classify`: 408/429/5xx = backoff(`Retry-After` 하한, **지터 없음**). background task 완료 callback 은 `BackgroundFileUploader.onCompleted`(bootstrap 에서 비동기로 설정 → 그 전에 도착한 완료는 **유실**), 앱 재시작 후 `releaseOrphans` 는 **호출처 없음**(uploading 인 채 영구 정체 가능) | `Archive.swift:30-52`, `ArchiveUploader.swift` 하단, grep |
| drain 트리거 | `recoverOnLaunch` = CAPTURING 만 복구(`st != CLOSED, SEALING`). 앱 시작 시 `resumeArchiveUploads()` 는 `pending-archive/<sid>.json` 포인터만 보며 **포인터가 없으면(예: 종료 직후 즉시 kill) drain 불가**, 포그라운드·네트워크 복귀 트리거 없음 | `MeasurementManager.swift:340-345`, `MeasurementHost.swift:resumeArchiveUploads` |
| 계정 scope | 포인터에 `handle` 저장. 로그아웃(`wipe`)→재로그인 시 Keychain 항목이 새 handle 을 받아 **옛 포인터의 handle 이 무효**(재개 불가). 계정 id 로 현재 handle 을 찾는 API 없음 | `Credentials.swift` |
| feature 정본 사본 | `feature.journal`(코어 프레임) + `metric-outbox.journal`(envelope 전체). engine 열 때 feature→outbox 보충 | `MeasurementEngine.swift` recover |

## 2. 설계 결정 (plan 대비 달라진 점 포함)

1. **정본 저장 = `FeatureUploader`(REST)**. 소켓 `live:metric` 은 방송 전용: outbox 를 ack/reject 하지 않고, 재시도·격리·halt·분할 전송을 모두 삭제. 방송은 "마지막으로 방송한 sequence 이후 최신 ≤5창" best-effort. (plan §5.1 그대로)
2. **summary 대조 판정**(contract §2 의 경고 반영): `빈 missing_ranges` 만으로 완료 판정하지 않는다. 로컬 sequence 집합 − 서버 보유 집합(`[min_index,max_index] − missing_ranges`, 범위 밖·미존재 stream 은 결측) = ∅ 일 때 완료. `truncated` 이면 마지막 range 이후를 결측으로 간주해 재전송 후 재조회(수렴).
3. **로컬 거절(rejected) 창은 대조에서 제외**(`consent_withdrawn` 등은 영원히 서버에 없음 → 재전송 루프 방지). `gap(local_rejected)` 로 카운트만 보고.
4. **422(요청 전체 검증 실패)**: contract 상 "재시도 ✗(앱 버그)"이지만 poison 창 하나가 전체 저장을 막으므로, 배치 → 1창씩 분리 전송하고 단일 창이 422 면 그 창만 `invalid_message` 로 격리한다(plan 의 4종 격리 + 이 1종 추가, 사유 기록). 403/404/그 외 4xx 는 영구 실패로 단정하지 않고 느린 full-jitter(≤60s)로 재시도한다.
5. **로컬 보관**: summary 완료 마커(`feature-sync-complete.json`, `archive-sync-complete.json`) 전까지 삭제 0. 이 트랙은 어떤 로컬 파일도 삭제하지 않는다(7일 정책은 별도).
6. **계정 scope 격리**: `sessions/<sid>/scope.json`(accountId) 신설. drain 은 현재 로그인 계정의 handle(신규 `CredentialStore.handle(forAccount:)`)과 일치하는 scope 만 전송, 불일치는 보존만.
7. **뱃지 이벤트 이름**(FE1 계약 `docs/sdd-260-native-js-events.md` 과 맞출 것): `feature.counts`, `archive.counts`, `reconcile.state` — payload 는 §4.

## 3. 변경 내역 / 검증은 커밋별로 아래에 누적한다.
