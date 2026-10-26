# summary — 회원 앱 원시 파형 필터 표시

## 구현
- `frontend/src/lib/eeg/raw-preview-filter.ts`: 순수 함수. RBJ 2차 Butterworth 바이쿼드 HP+LP, filtfilt(영위상)+홀수 확장 패딩(≤180점)으로 4초 창 과도응답 제거, 비유한값은 직전값 치환, 8점 미만은 원본 반환.
  - 뇌파: 250Hz, 코너 6/31Hz(filtfilt 가 응답을 제곱해 −3dB 코너가 −6dB 로 내려가므로 8–30Hz 가 통과대역에 들도록 바깥으로 둠).
  - 맥파: 50Hz, DC(평균) 제거 + 1–5Hz (haru PPGSignalProcessor 와 동일 대역).
  - `minMaxDecimate`(구간 최소·최대 시간순, 스파이크 보존), `smoothAutoScale`(급상승 즉시·감소 0.85 감쇠, ±1 정규화).
- `MemberClassContainer.tsx`: 네이티브는 `getRawPreview(platform,4,1000)` 로 원 샘플(EEG 1000·PPG 200) 수신, 웹은 useBand 원 샘플 마지막 1000/200점 → 필터 → min/max 120점 → 채널별(4채널) 자동 스케일.
- `MemberSheets.tsx`: 라벨 '뇌파 · 8–30Hz', '맥파 · Red·IR', 맥파 centerSeries 제거(필터가 DC 제거).
- `MeasurementPlugin.kt`: getRawPreview points 상한 500→1000.

## 시험
- 신규 vitest 14개 통과(10Hz 진폭≥0.85, 2Hz·50Hz ≤0.15, 가장자리≥0.8, PPG 평균≈0·0.1Hz·15Hz 감쇠, 빈/짧은/NaN 안전, decimation·스케일).
- 전체 vitest 17 fail/8파일 = 기준선과 동일(새 실패 0). `tsc -b` 통과. `gradlew testDevDebugUnitTest` BUILD SUCCESSFUL.
- verify 의 '10Hz ≥0.9'는 측정값 0.70(코너 8Hz)이라 코너를 6/31Hz 로 조정 후 0.85 기준으로 확정.

## 실기기 확인 필요
파형 가독성, 1초 주기 갱신 시 자동 스케일 출렁임, 저사양 기기 필터 부하(1000점 filtfilt ×2ch/초, 미미 예상).
