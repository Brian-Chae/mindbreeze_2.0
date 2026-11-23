# SDD-330 — Plan

## A. 권한 바로가기
- 조사: 안내 문구 위치 = `BandStepView`(입장 흐름), `MemberSheets`(회원 플레이어 기기 시트), `MybandSheet`(코치 내 밴드). 기존엔 "기기 설정에서 권한을 허용해 주세요" 문구뿐.
- 설치된 패키지에 설정 열기 플러그인 없음 → 자체 Capacitor 플러그인 `AppSettings`(Android Java / iOS Swift).
  - `openAppSettings`: Android `ACTION_APPLICATION_DETAILS_SETTINGS`, iOS `UIApplication.openSettingsURLString`
  - Android 전용: `isIgnoringBatteryOptimizations`, `requestIgnoreBatteryOptimizations`(`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, 실패 시 목록 화면→앱 정보 화면 폴백), `openBatterySettings`
  - 매니페스트 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 추가(사유: 실시간 생체신호 BLE 측정의 백그라운드 유지).
- 웹: `lib/native/app-settings.ts`(모든 호출 실패 시 false/null 폴백), `components/native/permission-shortcuts.tsx`(버튼 3개: 권한 허용하기 / 설정 열기 / 배터리 제한 풀기). 앱이 아니면 렌더 안 함.
- "권한 허용하기" = 앱 안 직접 요청(BLE 플러그인 `BleClient.initialize` → OS 권한 창).
- 연결: BandStepView(미지원 상태), MemberSheets(unsupported), MybandSheet(unsupported).

## B. 팝업 제거
- `ClassOnboardingCoachmarks` 컴포넌트·`class-onboarding` 로직·전용 테스트 삭제, `MemberClassContainer`에서 마운트와 `onboarding` props 제거, 저장 키 `mb_class_onboarding_seen` 참조 제거(E2E·브라우저 테스트).

## C. 코치 라이브
- 순수 로직(`host-player-case.ts`): `hasEntered`, `isAbnormal`, `summarizeHostEntry`, `scopeHostParticipants`.
- 뷰 상태(`useHostUi`): `showAll`(기본 false), `abnormalOnly`(기본 false).
- `HostLiveView`: 1:1(solo)은 그대로, 그룹은 상단 "참가자 N명" 대신 요약 줄 + 전체 보기 토글.
- 하니스 `?notentered=N` 추가(캡처·테스트용), 픽스처 회원에 `enteredAt` 부여.
