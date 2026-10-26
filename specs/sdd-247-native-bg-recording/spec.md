# SDD-247 — 앱 자체 백그라운드 수업 녹음(iOS·Android)

- 상태: Stage ① Spec — 승인(Brian 10/26 "iOS 안드로이드 둘다 자체 녹음으로")
- 브랜치: `sdd/247-native-bg-recording` (PR #125 `fix/store-background-audio` 위에서 시작)
- 작성일: 2026-10-26

## 배경
- Brian 결정(10/26): 앱이 백그라운드여도 수업 음성 녹음은 유지돼야 한다(스토어 심사 필수 요건). iOS·Android 모두 앱 자체(네이티브) 녹음으로 전환한다.
- 실측(Note10, PR #125 V11): WebView MediaRecorder 는 마이크는 살아 있으나 백그라운드 약 1분 뒤 JS 타이머·네트워크가 멈춰 청크 업로드가 끊기고 공백 구간 오디오가 유실됐다(`specs/fix-store-background-audio/summary.md`).
- 스토어 규칙: Play 는 FGS microphone 선언 + 시연 영상, App Store 는 UIBackgroundModes `audio` 의 실제 사용(가이드라인 2.5.4). 선언한 기능이 실제로 동작해야 한다.

## 목표
1. 앱(Capacitor iOS·Android)에서 상담사(호스트) 수업 녹음을 네이티브 레코더가 수행하고, 앱이 백그라운드·화면 잠금이어도 녹음과 청크 업로드가 끊기지 않는다.
2. 웹 브라우저는 기존 MediaRecorder 경로를 그대로 쓴다.
3. 기존 녹음 규칙 유지: 녹음·녹화 필수 동의, 마이크 오프 시 녹음 제외, 정지·일시정지, 청크 인덱스 연속, 재시도 큐.
4. 녹음 저장·다시 듣기(리플레이)·STT 스위치(현재 off) 동작을 깨지 않는다.

## 범위
- Android: FGS(microphone) 안 네이티브 녹음 + 네이티브 청크 업로드(기존 `/sessions/{id}/audio/chunk` API). WEBM/OPUS(API 29+) 유지 → 서버 형식 변경 없음. API 24~28 은 기존 WebView 녹음 유지(전경 한정).
- iOS: AVAudioRecorder/AVAudioEngine 기반 네이티브 녹음 + 백그라운드에서도 동작하는 업로드 큐. 형식은 iOS 네이티브(AAC m4a) → 서버가 형식을 받아 저장·병합·리플레이할 수 있게 보강.
- 서버: 청크 업로드가 `audio/mp4`(m4a/aac)를 받도록 형식 메타 저장, 병합·리플레이·(STT on 시) 변환 경로가 형식별로 동작. 기존 webm 데이터 호환.
- 웹 브리지: Capacitor 플러그인(JS 인터페이스) + `useAudioRecorder` 가 네이티브 가능 시 네이티브로 위임.

## 비범위
- 비회원·회원(참여자) 녹음, 영상 녹화의 네이티브화, STT 재활성화.

## 합격 기준
- Note10(Android 12) 실기기: 녹음 중 홈 버튼 → 화면 잠금 5분 → 복귀. 서버 청크 인덱스 누락 0, 청크 간격 5±2초, 합본 길이 ≈ 실제 경과.
- iOS 실기기(Brian 아이폰, TestFlight): 같은 시나리오 동일 기준.
- 다시 듣기에서 webm·m4a 세션 모두 재생.
- 기존 시험 회귀 0(vitest 기준선 17 fail/8파일, pytest 0 fail, swift test, JVM test).
