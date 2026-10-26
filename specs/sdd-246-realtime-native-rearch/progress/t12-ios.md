# SDD-246 T12-iOS 진행 (브랜치 `sdd/246-t12-ios`)

소유 경로 `frontend/ios/` + 이 문서만 수정. push·배포·TestFlight·메일·dev 접속 0. 로컬 커밋만.

## 변경

1. **peripheralId** (`feat(sdd-246): startMeasurement 선택 필드 peripheralId ...`)
   - `MeasurementManager.startMeasurement(..., peripheralId: String? = nil)` — 기본값 nil 로 하위호환. UUID 문자열이면 `band.connect(expectedPeripheral:)` 로 전달(→ retrievePeripherals 이어받기), 없거나 UUID 형식이 아니면 현행 스캔. 호출마다 덮어써서 이전 시작의 값이 새어 나오지 않는다.
   - 플러그인 `startMeasurement` 가 선택 옵션 `peripheralId` 를 읽어 전달.
   - 시험 4건(ManagerT07bTests): 전달·미지정=스캔·잘못된 UUID=스캔·이전 값 비누수. FakeBand 에 `lastExpected` 추가.
2. **Package.resolved** (`fix(sdd-246): Package.resolved ...`)
   - 원인: `frontend/package.json` 의 `@capacitor/ios` 가 8.5.3 이고 `CapApp-SPM/Package.swift` 도 exact 8.5.3 인데 `Package.resolved` 만 8.3.4(구버전 잔존). 
   - `xcodebuild -resolvePackageDependencies` 로 8.5.3(revision 4c7f346d)로 갱신. 이후 `-onlyUsePackageVersionsFromResolvedFile` 고정 빌드/아카이브 해석 성공.
3. **시간축 시험** 1건 추가(ManagerT07bTests `testWindowEndUsSharesAxisWithReanchorMonotonicUs`). 코드 변경 없음.

## (3) Release 아카이브 검증

명령(프로젝트 `frontend/ios/App/App.xcodeproj`, 산출물 `/tmp/t12arch/`, 워크트리 밖):
`xcodebuild archive -project App.xcodeproj -scheme App -destination 'generic/platform=iOS' -archivePath /tmp/t12arch/App.xcarchive -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO CODE_SIGN_IDENTITY=''` → **ARCHIVE SUCCEEDED**.

- 실행 파일 App: Mach-O arm64, `platform IOS`, minos 15.0, sdk 26.5(시뮬레이터 아님).
- dSYM(DWARF) 심볼: Rust 코어 `_mc_abi_version`·`_mc_advance`·`_mc_buffer_free`·`_mc_checkpoint` 등 `_mc_*` 10개가 `T`(정의)로 정적 링크, MeasurementKit 심볼 3398개. 실행 파일은 strip 되어 `nm` 불가(`strings` 로 NativeMeasurement/MeasurementKit 36건 확인).
- 코어는 정적 라이브러리(`libmeasurement_core.a`)라 `Frameworks/` 에 별도 프레임워크로 들어가지 않고 App 바이너리에 포함된다.
- **재현 선행조건 두 가지(빠지면 실패, 둘 다 gitignore 산출물)**
  1. `frontend/ios/MeasurementKit/scripts/build-core-xcframework.sh` (Rust 코어 xcframework). 없으면 `swift test`/빌드 모두 "does not contain a binary artifact".
  2. `cap sync` 산출물(`App/App/public`, `capacitor.config.json`, `config.xml`, `GoogleService-Info.plist`). 클린 체크아웃 시험에서는 빈 자리표시 파일로 대체(아카이브에 들어간 값은 자리표시이며 실제 배포본은 `npm run build && npx cap sync ios` 필요).
  - 빌드 phase 로 Rust 빌드를 자동화하지는 않았다(Xcode 샌드박스·rustup 환경 의존). CI(T12 감독)에서 위 1·2 를 선행 단계로 두면 된다.
- 서명은 하지 않았다(CODE_SIGNING_ALLOWED=NO). 서명 아카이브·TestFlight 는 미수행.

## (4) 시간축 점검 — 결론: 일치(수정 불필요)

- 코어 창: `packages/measurement-core/src/engine.rs:478` `wall_us = anchor.wall_ms*1000 + (arrival_monotonic_us − anchor.monotonic_us)`, `:479` now_ms 파생 → 표본 시각 → `:612` `end_us = ts_us(last_ts)`(`:845` ms*1000) → `:711` `emit_frame(end_us)`, `:811-821` `window_start_us = end_us − FRAME_INTERVAL_US`, `window_end_us = end_us`. 갭 프레임도 `:670` `last_data_end_us + (monotonic_us − last)` 로 같은 축.
- Swift anchor: `MeasurementManager.swift:428` `anchor = (nowMs(), monoUs())` — 코어에 `:530` `wallMs: a.wallMs, anchorMonotonicUs: a.monoUs` 로 그대로 전달.
- reanchor: `MeasurementManager.swift:484-488` `coreDomainUs() = anchor.wallMs*1000 + (monoUs() − anchor.monoUs)`; `:503` `capture.reanchor.monotonic_us = coreDomainUs()`, `:494` 클록 probe 도 같은 값.
- 서버 환산: `backend/app/services/live_ingest_service.py:79-81` `anchor_server_at + (window_end_us − anchor_monotonic_us)`; `session_live_commands.py:392` `anchor_monotonic_us = int(payload["monotonic_us"])`. 양쪽이 같은 축이므로 환산식이 성립.
- 시험: 합성 패킷 300개 투입 후 `window_end_us` 가 `wall·1000 + (도착 − anchor)` 의 5초 이내이고, reanchor `monotonic_us` 가 같은 값으로 정확히 일치.
- 주의(위험): `anchor` 는 수집 시작 시점의 (벽시계, 단조시계) 한 쌍이라 벽시계가 시작 후 NTP 등으로 점프해도 영향 없다(단조 경과만 사용). 앱 재시작(recoverOnLaunch) 시 anchor 는 새로 잡히므로 재시작 전후 창은 축이 달라질 수 있고, 서버가 reanchor 로 다시 묶어야 한다 — 실기기 확인 대상.

## (5) 검증

| 명령 | 결과 |
|---|---|
| `MK_WIRE_PYTHON=<venv python> swift test` | **155건 실행, 2 skip(실서버 왕복 드라이버 필요), 실패 0** (기준 150 → +5) |
| App 시뮬레이터 빌드 (`-onlyUsePackageVersionsFromResolvedFile`, Package.resolved 8.5.3 고정) | BUILD SUCCEEDED |
| Release generic iOS 아카이브 | ARCHIVE SUCCEEDED |

## T01 요청 (감독이 반영, contracts 미수정)

- `StartMeasurementRequest` 에 선택 필드 `peripheralId: string`(BLE 장치 UUID, 8-4-4-4-12 형식, iOS 전용 의미) 추가. 없으면 native 가 스캔. 현재 스키마는 additionalProperties=false 라 웹이 이 필드를 보내면 검증이 거절되므로 반영 필요.

## 남은 일·타 워커 요청

1. T06: 웹뷰 BLE(bluetooth-le)로 선택한 장치의 `deviceId`(iOS 는 CBPeripheral UUID)를 `peripheralId` 로 전달. 웹뷰가 BLE 연결을 먼저 끊고 `setJSBandOwnership(false)` 후 `startMeasurement` 호출해야 중복 연결이 없다.
2. T12(CI): 위 아카이브 선행조건 1·2 를 워크플로 단계로. 서명(.p8/프로비저닝)·TestFlight 는 별도.
3. 실기기: `retrievePeripherals(withIdentifiers:)` 로 이어받기 실제 성공 여부(앱 재설치/장치 변경 시 UUID 불일치 → 스캔 폴백이 현재 동작인지)는 시뮬레이터에서 확인 불가.
