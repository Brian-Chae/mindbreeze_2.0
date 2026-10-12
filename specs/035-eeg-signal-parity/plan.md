# SDD-035 Plan — EEG 신호처리 haru 정본 이식

## Task 분할 (단일 FE 워커 — cursor)

정본: `haru_band_app/feature-worker/src/processors/EEGSignalProcessor.ts`
대상: `frontend/src/lib/eeg/EEGSignalProcessor.ts`

### T1. 상수·PSD 보정 이식
- `N_CYCLES = 7.0`, `MAX_ANALYSIS_SAMPLES = 1000`
- `PSD_CALIB = 0.00739181390669613`
- `PSD_CORRECTION_VECTOR`(1~45Hz 보정테이블) + `psdCorrectionFactor(f)` 함수

### T2. 밴드 정의·transient 수정
- `bands`: delta [1,4), gamma [30,45) (theta/alpha/beta 동일)
- `transientSamples = Math.floor(data.length * 0.15)`

### T3. Morlet wavelet 정본 이식
- `morletWaveletTransform`: `targetLength = round(N_CYCLES·fs/f)`, `actualLength = min(target, data.length, MAX_ANALYSIS_SAMPLES)`, `effectiveCycles = actualLength·f/fs`, `PSD_CALIB × psdCorrectionFactor(f) × rawPower`
- `createMorletWavelet`: `sigmaT = cycles/(2πf)`, `norm = π^(-0.25)·√(1/σt)/√(fs)`

### T4. 밴드파워 정본 이식
- `computeBandPowersLinear`(Σ P(f)·Δf) + `linearBandPowersToBandPowers`({linear,dB})
- 소비처(StreamProcessor → useBand)가 `.linear`를 추출해 기존 지표 로직에 그대로 연결

## 참고 (haru 정본 핵심 위치)
- 상수: line 33-64
- morletWaveletTransform: line 696-715
- createMorletWavelet: line 721-737
- computeBandPowersLinear: line 757-769
- linearBandPowersToBandPowers: line 771-786

## 완료 기준
- `cd frontend && npm run build` 0 error
- 밴드파워가 haru와 동일한 {linear,dB} 구조로 반환
