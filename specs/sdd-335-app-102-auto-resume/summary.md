# SDD-335 summary (작성 중 — 빌드·제출 후 갱신)

## 구현
1. 복귀 자동 재시작: `shouldRestartOnResume` + `subscribeAppResume(ble)` (use-native-measurement.ts). 실패·멈춘 엔진은 stop 후 새 requestId 로 재시작.
2. 재진입: 실제 stop 마다 세대 증가 → 다음 시작 requestId 가 새 값(세대 0 은 기존과 동일). 측정 중 뒤로가기는 `MeasuringLeaveGuard`(데이터 라우터에서만) 확인 창.
3. 동의 안내: 입장 통합 동의(뇌파 미선택)·뇌파 선택 화면에 "측정과 리포트 지표가 없어요" 문구. 정책 불변.
4. 구버전 차단: `latest.json` 의 `minAppVersion` + `useMinAppVersion` → `AppUpdateRequiredScreen`(스토어 열기). 서버 입장 API 차단은 근거 부족으로 미적용(plan §4).
5. PPG 헤더 LE: `raw-capture.ts`, 새 프로필 `packet_endian='little'`(서버 검증은 'little' 이면 LE, 구앱 'mixed' 는 기존 BE 유지).

## 테스트
- vitest: 신규 `tests/sdd335-app-102.test.tsx` 11건, 전체 4773 통과 / 실패 파일 20개는 변경 전 기준선과 동일(기존 실패).
- 백엔드: 디코더·계약 111건 통과(`--noconftest`, LE 프로필 신규 1건).

## 머지·배포
- PR #337 → develop `9da27b84`, Deploy Dev success.

## 빌드·제출 (11/26)
| 대상 | 결과 |
|---|---|
| iOS MB Dev | 1.0.2 (21) VALID (TestFlight) |
| Android dev APK | vc58 / 1.0.2, sha256 `e0d117c3f2c36cf7a12168d36b94ec9c7118cb14c450c3b26ef90fcbf3ed1767`, `https://download.mindbreeze.looxidlabs.com/dev-test/mb-dev-9da27b84-vc58.apk` (공개 링크 sha 일치) |
| iOS 스토어 | 1.0.2 (42) VALID, App Store 버전 `WAITING_FOR_REVIEW`, 수동 출시, 출시 메모 한국어 |
| Android 스토어 | AAB vc51 / 1.0.2 sha256 `c074e1a86335e0c5b9ac18eefc70ca3aef4f393bc35b03d341697e25e2c4c26c`, Play 프로덕션 제출 ID 8 "검토 중", 관리형 게시 켜짐 |
- 게시·출시 버튼 미사용. React 내부키 3, prod 번들 dev-api 0, 서명 지문 일치.

## 구버전 차단 운영 메모
- 켜는 방법: 다운로드 사이트 `latest.json` 에 `"minAppVersion": "1.0.1"` 추가(감독 작업). 값이 없으면 차단 없음.
- 1.0.0 앱은 이 필드를 모르므로 화면이 바뀌지 않는다. 1.0.0 은 기존 `minSupportedVersionCode` 강제 업데이트 배너(홈, 닫기 불가)만 가능.
