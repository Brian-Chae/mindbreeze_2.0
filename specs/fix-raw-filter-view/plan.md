# FIX — 회원 앱 원시 파형 필터링 표시 (plan)

## 문제
기기 메뉴 원시 파형이 무필터(뇌파 DC·50/60Hz·드리프트 포함, 맥파 DC 큼)이고, Android 는 120점 다운샘플 후에 도착해 필터 불가.

## 설계
- 신규 `frontend/src/lib/eeg/raw-preview-filter.ts` (순수 함수, 의존성 없음).
  - 필터: RBJ 2차 Butterworth(Q=0.7071) 바이쿼드. 뇌파 = HP 8Hz + LP 30Hz(250Hz), 맥파 = DC 제거 + HP 1Hz + LP 5Hz(50Hz, haru PPGSignalProcessor 와 동일 대역).
  - biquadjs 를 쓰지 않은 이유: 기존 EEGSignalProcessor 가 `makeBandpassFilter(low, high, fs)` 로 인자 의미가 d.ts(`frequency, sampleRate, Q`)와 달라 대역이 불명확하다. 직접 계수를 계산하면 대역이 코드에 명시되고 vitest 로 주파수 응답을 검증할 수 있다.
  - 과도응답: 4초 창을 매번 새로 필터하므로 앞부분 transient 가 생긴다. **filtfilt(정·역방향, 영위상) + 홀수 확장(odd-extension) 패딩**으로 처리. 창을 버리지 않아 파형이 계속 꽉 차고, 영위상이라 피크 위치가 어긋나지 않는다. 4차 효과(−24dB/oct).
  - 빈/짧은 배열(<8점)·비유한값은 안전하게 처리(원본 반환/0 치환).
- 표시 변환: min/max decimation(구간별 최소·최대를 시간순으로) 으로 120점, 채널별 자동 스케일(감쇠 smoothing 0.85, 급상승은 즉시 반영) — haru waveform-canvas 방식. 정규화(±1)한 값을 `device.raw/ppg` 로 넘기고 SVG 는 기존 wavePath 사용.
- 입력: Android `getRawPreview(platform, 4, 1000)` 로 원 샘플(EEG 1000·PPG 200)을 받아 JS 에서 필터. Kotlin `coerceIn(2, 500)` → `(2, 1000)` 1줄 변경. 웹은 useBand 원 샘플(뇌파 마지막 1000, 맥파 마지막 200)에 같은 필터.
- 라벨: '뇌파 · 8–30Hz', '맥파 · Red·IR'.

## 범위 밖
packages/measurement-core, eegPersonalScore/eegScore* (다른 워커 담당).
