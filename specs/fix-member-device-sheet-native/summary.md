# summary — 앱 회원 기기 메뉴 네이티브 신호·접촉·파형

## 원인
Android 는 네이티브 시작 직전 JS BLE 를 놓는데(use-native-measurement.ts releaseJsBand) 기기 메뉴는 useBand 값을 읽었다(MemberClassContainer.tsx device 모델·원시 파형 폴링). → 신호·접촉 '미확인', 파형 빈 버퍼.

## 수정
- FE: `native-measurement/device-status.ts`(toNativeDevice: sqi·contact·band_state), `use-native-measurement.ts`(device 반환), `MemberClassContainer.tsx`(native 소유 시 신호·접촉·bandUi·lead-off 시트가 native 값 사용, 시트 열림 중 1초 getRawPreview 폴링, 웹은 기존+PPG), `MemberSheets.tsx`(뇌파 원시·맥파 원시 두 블록, PPG 평균 제거 후 채널별 정규화), `facade.getRawPreview`(android 만, 예외·형식 불일치→null), types/member-metrics(centerSeries)/fixtures.
- Android: `RawPreviewBuffer.kt`(EEG 1000·PPG 200 링버퍼, 다운샘플), `MeasurementEngine`(패킷 파싱 후 채움·rawPreview), `MeasurementPlugin.getRawPreview`(수치 배열 4개만).
- 시험: tests/fix-member-device-sheet-native.test.ts(8), RawPreviewBufferTest(4).

## 결과
vitest 17 fail/8파일(기준선 동일, 새 실패 0), tsc -b 통과, gradle testDevDebugUnitTest 172건 실패 0.

## 남은 위험(실기기)
- 네이티브는 밴드 배터리를 읽지 않아(NativeRuntime battery null) 배터리는 JS 해제 이전 마지막 값 또는 '—'. 네이티브 배터리 GATT 읽기는 별도 작업.
- 폴링은 MeasurementManager.engine 기준 — 실기기에서 파형 갱신·PPG 스케일 확인 필요.
- iOS 는 getRawPreview 없음 → 파형 영역 생략(기존 동작 폴백), iOS 신호·접촉은 snapshot 경로 사용.
