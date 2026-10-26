# FIX — 앱 회원 기기 메뉴 신호·접촉·원시 파형 (네이티브 측정 중)

## 원인
- 345c1fd5 에서 Android 는 네이티브 시작 직전 `bluetoothService.releaseForNative()` 로 JS BLE 연결을 놓는다 (use-native-measurement.ts startForSession releaseJsBand).
- 기기 메뉴는 여전히 useBand(JS 연결) 값을 읽는다: `MemberClassContainer.tsx` device 모델의 `signalQualityLevel`/`deviceStatus`/`battery`(약 450~452행), 원시 파형 `bandRef.current.getEegWaveformSamples()`(약 332행, 조건 `isLive`=band.connectionState).
- JS 수신이 끊겼으니 SQI·lead-off 가 갱신되지 않아 '미확인', 파형 버퍼는 비어 있다. 6지표는 nativeM.metrics 로 이미 분기돼 정상.

## 설계
1. 신호·접촉: **네이티브 MeasurementSnapshot(metrics.sqi, metrics.contact, collection.band_state)** 사용.
   - 이유: 이미 `facade.onMeasurement` 구독이 있어 훅 확장만으로 끝난다(v2 LiveState 는 서버 왕복·상담사 입장 의존, 오프라인 시 끊김).
   - 순수 함수 `toNativeDevice(snap)`: sqi→`signalQualityLevel()`, contact(fp1/fp2: leadoff 하나라도→`lead_off`, 둘 다 contact→`ok`, 그 외 `unknown`), band_state→연결 상태. 기존 라벨 함수 재사용.
   - 네이티브 소유 동안 `deriveBandUi` 입력(connectionState/deviceStatus/signalQualityLevel/lastEegAt)도 네이티브 값으로 대체해 'lost' 오표시 방지.
2. 배터리: 네이티브는 아직 밴드 배터리를 읽지 않는다(NativeRuntime.maybeReportDevice 의 battery null). 네이티브 값 없으면 JS 마지막 값(release 이전) 유지, 둘 다 없으면 '—'. 네이티브 배터리 읽기는 범위 밖(실기기 위험으로 보고).
3. 원시 파형: 플러그인 메서드 `getRawPreview({seconds, points})` (Android). `MeasurementEngine` 안 `RawPreviewBuffer`(EEG fp1/fp2 4초·PPG red/ir 4초 링버퍼, 잠금 보호)가 onNotification 파싱 후 채움 → 균등 다운샘플해 반환. 토큰·원문 바이트 미포함(수치 배열만).
   - JS: facade.getRawPreview() — platform==='android' 일 때만 호출, try/catch(UNIMPLEMENTED 포함) → null. iOS·웹은 기존 경로.
   - 시트가 열려 있을 때만 1초 폴링(`sheet==='device'`).
4. 화면: 원시 블록을 '뇌파 원시 · 2채널'(Fp1·Fp2) / '맥파 원시 · Red·IR' 두 개로 분리(.mp-raw 재사용). 채널별 정규화: wavePath 가 이미 채널 단위 peak. PPG 는 DC 오프셋이 커서 평균 제거 후 정규화. 색은 기존(#B373EF, #01F0C8). 웹은 useBand.getPpgWaveformSamples()/ppgWaveform 사용.
