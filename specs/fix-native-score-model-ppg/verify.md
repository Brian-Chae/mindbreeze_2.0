# fix-native-score-model-ppg — 검증 항목 (구현 전 작성)

## A. 표준 모델 적용
- [A1] `ModelPin`: 유효 모델 JSON → config 에 model_mode=active_sigmoid, model_hash=64자 소문자 hex(sha256), model_version 이 `^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$` 통과.
- [A2] `ModelPin`: 동일 params 는 키 순서와 무관하게 같은 hash. 다른 params 는 다른 hash.
- [A3] `ModelPin`: params 비어 있음/direction 불량/s<=0 지표는 제외, 전부 불량이면 null(코호트 유지).
- [A4] `ModelPin`: 1회 pin — 파일이 이미 있으면 새 입력을 무시하고 기존 pin 반환.
- [A5] 엔진: active_sigmoid + setModel 후 focus_display/relaxation_display/emotion_display 가 `valid` 이고 코호트 값과 다르다(합성 모델 기준 TS 와 동일 수식). 모델 없음 → legacy_cohort 기존 값 유지(회귀 0).
- [A6] 복구: pin 파일에서 읽어 같은 config 로 재생성/복원(체크포인트 fingerprint 일치).
- [A7] JS: `buildNativeModelPayload` — 유효 지표만, direction '1' 문자열 정규화, 모델 null → null. 시작 요청에 필드가 실리고, 모델 없으면 필드 생략.
- [A8] LiveConfig/BridgeInputs 의 model_version 이 pin 값(없으면 `b0-cohort-2`).

## B. PPG/ACC 수신
- [B1] `SubscribeSequencer`: 3개 순차 구독 — 콜백 성공 시 다음, 모두 끝나면 onDone.
- [B2] writeDescriptor false → 300ms 후 재시도, 5회 초과 시 onFail.
- [B3] 콜백 무응답 4초 → 실패(onFail), 늦게 온 콜백은 무시.
- [B4] `stop()` 후 예약된 재시도·워치독이 발화하지 않는다.
- [B5] JS: Android 에서 startForSession 전에 `releaseForNative` 가 먼저 호출되고, 주소를 해제 전에 확보. iOS/웹 경로는 호출 안 함.
- [B6] hook: 시작 후 band 상태가 disconnected 로 바뀌어도 native stop 이 호출되지 않는다(래치).

## 공통 회귀
- cargo test(packages/measurement-core) 전부 통과.
- `./gradlew testDevDebugUnitTest` 전부 통과(기존 + 신규).
- vitest 전체: 기준선 17 fail/8파일 외 새 실패 0. `tsc -b` 0 오류.
- 실기기(감독): 5분 수업 측정에서 ppgPackets>0, bpm/respiration/sdnn validity=valid, display 점수 중앙값 0 쏠림 해소.
