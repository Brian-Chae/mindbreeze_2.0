# Summary — 앱 백그라운드 수업 음성 녹음 보장

## 원인
1. iOS: AVAudioSession 이 `.playback`(입력 불가) — 백그라운드 마이크 유지 근거 부족, 인터럽션 후 재활성 없음.
2. Android: microphone FGS 타입이 "호스트+온라인"에서만 요청 → 대면 수업 녹음은 백그라운드 마이크 차단. 로비에서 권한 거부로 connectedDevice 폴백되면 녹음 시작 후에도 업그레이드 안 됨.
3. 공통: 복귀 시 마이크 track 종료(인터럽션·OS 회수)를 감지·복구하지 않아 UI 는 '녹음 중'인데 실제론 끊김.

## 변경 (A안, 서버·파일 형식 불변, B안 미채택 사유는 plan.md)
- iOS `AudioSessionConfig`(playAndRecord + A2DP + defaultToSpeaker), 인터럽션 종료·미디어서비스 리셋 시 재활성.
- `useHostBackgroundSession(recording)`: 녹음 중이면 microphone 타입(옵션 변경 시 서비스 재시작).
- `useAudioRecorder`: 복귀 시 녹음 중이고 track 이 ended/recorder 비활성이면 새 스트림으로 이어 녹음(청크 인덱스 연속). 마이크 오프·정지·일시정지는 건드리지 않음.
- MeasurementService.kt 미변경.

## 시험 결과
- vitest 신규 14건(복구 4·FGS 2·정적 설정 4 + 기존 host-background 포함) 통과. 전체 실행의 실패 8개 파일은 변경 전에도 동일(기준선 동일, 무관).
- tsc 0 오류. xcodebuild 시뮬레이터 Debug 빌드 성공. gradlew assembleDevDebug·testDevDebugUnitTest 성공.

## 실기기 (Note10 R3CMA0C3Y4T)
- dev APK(508e6f35) 설치·실행 성공. **로그인에서 막힘**: 저장소 문서에 시드 비밀번호가 없고 알려진 값이 dev 에서 거부됨(ZR-6: 재시드 필요). 따라서 2분 백그라운드 청크 연속성은 **미검증**. 재시드 후 verify V11 을 수행해야 함.
- 폰 설정(deviceidle·battery)은 변경하지 않아 원복할 항목 없음.

## 한계
- iOS 실기기 백그라운드 마이크는 미검증(시뮬레이터는 백그라운드 마이크 확인 불가). 심사 제출 전 실기기 시험 필요.
