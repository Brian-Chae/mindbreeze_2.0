# SDD-284 Plan — iOS 측정 데이터 저장·실시간 안정화 (최소 수정안)

- 근거: `analysis.md`. 범위: 코드·검증 설계까지. 앱 빌드·TestFlight 업로드는 APP 창구.
- 일정 가정(11/11 행사 기준): 11/5~11/6 구현·웹 단위시험 → 11/7 APP 창구 TestFlight 빌드 → 11/8~11/9 실기기 30분 시험(verify.md) → 11/10 공개 베타 배포. 베타 심사가 필요하면 11/7 업로드가 마지노선(추정, 심사 소요는 미확인).

## 1. 설계 원칙

1. **원인이 "스트림 확정 실패"라는 점은 확정, "왜 실패했나"는 가설** → 원인을 단정하는 수정이 아니라 **실패를 감지하고 자동으로 우회·복구하는 이중 안전장치**로 간다.
2. 이미 현장에서 검증된 경로를 재사용: 웹 경로(`web_wasm`: JS BLE + WASM 코어 + `features/batch` + 원시 업로드)는 게스트 앱에서 이미 사용 중(PR #226). 회원 앱이 네이티브 실패 시 이 경로로 **내려앉게** 한다.
3. 서버 계약 불변(`features/batch`, `capture.*`). 서버 변경은 진단 로그뿐(선택).

## 2. 변경 목록

### T1. 네이티브 "스트림 확정" 감시 + 자동 재시작 (웹 번들, 핵심)
- 파일: `frontend/src/lib/measurement-web/use-native-measurement.ts`
- 현재: `startForSession` 반환 즉시 `status='running'`. 재시도는 예외 시에만.
- 변경: `running`으로 두기 전에 **확정 대기** — `getMeasurementSnapshot`을 2초 간격 폴링해 `streamId != null` 이고 `state ∈ {CAPTURING, RECONNECTING}`이면 `running`. **20초 안에 확정 안 되면** → `facade.stop({reason:'user_left'})` 후 기존 지수 백오프 재시도(`RETRY_MAX` 유지). 새 requestId 사용(같은 requestId는 native가 replay로 막음 — `startMeasurement`의 `idempotentReplay`).
- 이어서 `running` 중에도 **10초 간격 건강 점검**: `state`가 `BLOCKED/CLOSED/IDLE`이거나 `streamId == null`로 되돌아갔고 회차가 진행 중이면 재시작 경로로 진입.
- 위험: stop→start 반복이 서버에 `capture.close`+새 stream(generation +1)을 만들어 데이터 조각이 늘 수 있음 → 재시작은 최대 5회, 간격 지수 백오프. 기존 `stopOwned/ownerRef` 소유권 로직과 충돌하지 않게 `resumeInPlace`와 분리해 단위시험.

### T2. 네이티브 실패 시 웹 경로(`web_wasm`)로 하강 (웹 번들, 핵심)
- 파일: `measurement-path.ts`(`decideMeasurementPath`에 `nativeFailed?: boolean` 추가: `native && !guest && !nativeFailed` → `native`, 그 외 BLE·밴드 연결이면 `web_wasm`), `use-native-measurement.ts`(재시도 소진·확정 실패 3회 시 `nativeFailed` 상태 노출), `MemberClassContainer.tsx`(두 훅의 `path` 합성, `useWebMeasurementV2`에 `guest` 대신 `nativeFailed` 반영).
- 근거: `isBleSupported()`가 앱에서 true(CapacitorBleAdapter), 게스트 앱이 같은 경로로 이미 측정 중. 회원은 `accountId`가 있어 outbox·JWT 인증 그대로.
- 위험: 같은 밴드를 JS와 네이티브가 동시에 잡으면 구독 충돌(코드 주석에 이미 명시). → 하강 전 **반드시** `stop` 완료 + `setJSBandOwnership({owning:true})`(iOS) 확인, 실패 시 하강하지 않고 오류 배너만. 하강 후에는 네이티브로 되돌아가지 않음(회차 내 단방향).
- 롤백: `nativeFailed` 입력 제거(기본 undefined=현행 동작).

### T3. 네이티브(iOS) 스트림 확정 보강 (Swift, 선택 — 실기기 시험 가능할 때만)
- 파일: `ios/MeasurementKit/Sources/MeasurementKit/MeasurementManager.swift`
- 3-a. `.arming && streamId == nil`이 **READY가 된 뒤 8초** 지속되면 같은 `captureStartCommand`를 재전송(ledger가 동일 command_id → duplicate 결과 반환, 새 stream 생성 안 함). 현재는 `retryable` 응답이 있을 때만 재전송.
- 3-b. `.arming` 지속 시간·`live.state`·마지막 ACK 코드를 snapshot 진단 필드(`armingMs`, `liveState`, `lastStartAck`)로 노출(T1이 폴링 판단·화면 진단에 사용).
- 3-c. (보류) 확정 전 패킷 폐기 → 제한 버퍼링: `bandLink(didReceive:)`의 `guard engine`을 앞에 두는 현 구조상 변경 범위가 크고 코어 anchor와 얽힘 → **11/11 범위 제외**, 확정 지연 20초 내 손실은 허용하고 T1이 지연을 짧게 한다. 문서화만.
- 위험: 앱 빌드 필요, `swift test` 불가(xcframework) → APP 창구 Xcode에서 `ManagerT07bTests` 계열에 시험 추가 후 실행.

### T4. 현장 진단 가시화 (웹 번들)
- 파일: 측정 상태 UI의 기기 시트(기존 `device-status.ts`/기기 메뉴) 하단 접이식 "연결 진단": `path`, `status`, `code`, native `state`, `streamId` 앞 8자리, `liveSocket`, `uploadCounts`(feature pending/acked, raw), `재시작 횟수`.
- 금지 표현(점수·종합점수·좋음·나쁨·완료·보증·100% 단정) 사용 금지. 개인정보·토큰 미표시.
- 목적: 11/11 현장에서 지원 인력이 화면 하나로 "시작 단계 정체 / 소켓 / 업로드 적체"를 구분.

### T5. 서버 진단 (선택, 작게)
- `capture.start` 처리 시 `app_build`/`client_instance_id`(소켓 hello가 이미 보냄)와 UA 분류(`CFNetwork`/`okhttp`)를 INFO 로그 + `capture_stream` 부가 컬럼 없이 로그로만 남김. 로깅 설정 부재(SDD-282 F14)와 겹치므로 **SDD-282/285에서 로깅이 켜질 때 함께** 반영. 11/11 필수 아님.

## 3. 하지 않는 것
- 서버 계약·스키마 변경, 운영 DB 쓰기, 원시 업로드 경로 재설계, 확정 전 패킷 버퍼링(T3-c), Android 변경(SDD-285), 비회원 403·정원 이슈(SDD-282).

## 4. 시험 설계
- vitest(로컬 즉시 가능): `measurement-path.test` (nativeFailed 분기), `use-native-measurement` 확정 대기·건강 점검·재시도 소진·하강 시나리오(fake timers, facade mock). 기존 SDD-246/260 시험 회귀.
- Swift: T3 변경분 단위시험(arming 8초 재전송, 진단 필드). 실행은 APP 창구 Xcode.
- 실기기: `verify.md` 전 항목.

## 5. 위험 요약
| 위험 | 대응 |
|---|---|
| 재시작 폭주로 stream 조각 증가 | 최대 5회·지수 백오프, 조각은 서버가 generation별로 수용(기존 설계) |
| 하강 시 JS/네이티브 밴드 이중 구독 | 하강 전 stop 완료·소유권 확인, 실패 시 하강 안 함 |
| 20초 확정 대기 오탐(느린 망) | 임계 20초는 현장 로그 후 조정 가능한 상수(`NATIVE_CONFIRM_MS`), 재시작은 같은 command가 아닌 새 requestId라 서버가 새 stream을 만듦 → T3-a(동일 command 재전송)가 먼저 작동하도록 8초<20초 |
| 빌드 일정 지연 | T1·T2(웹 번들)만으로도 iOS 앱 JS 번들 업데이트 경로 확인 필요 — **웹뷰가 원격 URL을 로드하는 구조인지 번들 내장인지 APP 창구가 확인**(원격이면 TestFlight 재빌드 없이 dev/prod 배포로 반영 가능, 미확인) |

## 6. 롤백
- T1·T2: `nativeFailed`/확정 대기 상수를 기본값으로 되돌리거나 커밋 revert(웹 번들만). T3: 커밋 revert 후 재빌드. 데이터 마이그레이션 없음.
