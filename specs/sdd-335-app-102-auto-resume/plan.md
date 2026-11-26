# SDD-335 plan

## 1. 측정 자동 재시작 (`use-native-measurement.ts`)
- 순수 함수 `shouldRestartOnResume({status, snap})`: status `failed` 이거나 snapshot 이 unhealthy 면 true. snapshot 을 못 읽으면(null) 판단 보류.
- `subscribeAppResume(order: ble)` 로 포그라운드 복귀 구독 → 조건 충족 시 best-effort native stop → `startedRef`/소유권 해제 → `attemptRef++`, 재시도 카운터 0 → `retryTick++` 로 메인 effect 재시작(새 requestId).
- 하강(`nativeFailed`)·path≠native 인 회차는 건드리지 않는다.

## 2. 재진입 재연결
- 원인 가설: `deterministicRequestId(session, participant)` 가 매 마운트 동일 → native 가 stop 후 같은 requestId 를 replay 로 취급. 모듈 단위 세대 번호(`startGeneration`)를 두고 실제 `stopOwned` 때 증가, 첫 요청 id 에 섞는다(세대 0 은 기존 값과 동일 → 기존 테스트 유지).
- `EntryPage` 에 `useLeaveGuard` + `LeaveConfirmModal`: live phase·뇌파 동의·밴드 수업일 때 SPA 이탈 시 확인. 확정 이탈(`onLeave`)은 bypass.

## 3. 동의 안내
- `IntegratedEntryConsentView`(뇌파 미선택 + 잠금 아님), `EegConsentChoiceView`(거절 버튼 위) 에 안내 문구. 정책·저장 로직 불변.

## 4. 구버전 차단
- `latest.json` 은 이미 앱이 읽는 서버 설정(SDD-259). `minAppVersion` 선택 필드 추가(없으면 차단 안 함) — 백엔드·마이그레이션 변경 없음. 비교는 `x.y.z` 숫자 비교(`-dev` 접미 무시).
- 새 `AppUpdateRequiredScreen`(스토어 열기) 을 `EntryPage` 래퍼에서 네이티브일 때만 먼저 판정.
- **서버 입장 API 차단 검토**: 1.0.0/1.0.1 은 REST 에 앱 버전 헤더를 보내지 않는다(`X-MB-Native: capacitor` 만). 기록된 앱 버전은 `session_band_devices`(밴드 보고 후)·`device_tokens`(푸시 등록, 사용자 단위·다기기)뿐이라 **입장 시점에 1.0.0 과 1.0.1 을 구분할 근거가 없다** → 서버 입장 API 차단은 적용하지 않는다(오차단 위험). 1.0.0 앱에 이미 있는 강제 업데이트 경로(`latest.json` 의 `minSupportedVersionCode`, 홈 화면에서 닫기 불가 배너)가 운영상 유일한 즉시 수단이며 값 변경은 다운로드 사이트 파일 작업(감독).

## 5. PPG
- `getUint32(0, true)`. `sdd244-capture-session`·`sdd273-ppg-diag` 테스트 갱신.

## 6. 릴리스
- 버전 1.0.2, iOS 빌드 번호·Android versionCode 증가. dev 앱(TestFlight MB Dev·dev APK) → 스토어용 prod 빌드 제출(게시 버튼 금지).
