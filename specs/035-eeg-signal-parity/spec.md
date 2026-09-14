# SDD-035 — EEG 스펙트럼 신호처리 haru_band_app 정본 이식

> mindbreeze_2.0의 EEG 스펙트럼/밴드파워 신호처리가 haru_band_app과 일치하지 않아,
> haru_band_app `feature-worker/EEGSignalProcessor.ts`(SDD-040 교정본)를 **정본**으로 완전 이식한다.

## 1. 배경·목표

EEG 지표(집중/이완/스트레스)와 밴드파워가 haru_band_app과 수치적으로 동일해야 한다. 현재 mindbreeze는
Morlet wavelet 처리에서 5가지 핵심 차이가 있다. haru 정본으로 일치시킨다.

## 2. 이식 대상 (haru 정본 → mindbreeze)

정본: `/Volumes/Looxid SSD/looxid/repository/haru_band_app/feature-worker/src/processors/EEGSignalProcessor.ts`
대상: `mindbreeze_2.0/frontend/src/lib/eeg/EEGSignalProcessor.ts`

| 항목 | haru 정본 | mindbreeze 현재 | 이식 |
|------|----------|----------------|------|
| 상수 | `N_CYCLES=7.0`, `MAX_ANALYSIS_SAMPLES=1000` | sigma=7.0 (지역변수) | ✅ 이식 |
| PSD 보정상수 | `PSD_CALIB=0.00739181390669613` | 없음 | ✅ 이식 |
| PSD 보정벡터 | `PSD_CORRECTION_VECTOR`(1~45Hz) + `psdCorrectionFactor(f)` | 없음 | ✅ 이식 |
| 밴드 정의 | delta [1,4) / gamma [30,45) | delta [0.5,4) / gamma [30,50) | ✅ 수정 |
| transient 제거 | `data.length × 0.15` | 250 고정 | ✅ 수정 |
| Morlet 길이 | `round(N_CYCLES·fs/f)`, min(target, len, MAX_ANALYSIS_SAMPLES) | clamp(min,max) | ✅ 이식 |
| Morlet cycles | `effectiveCycles = actualLength·f/fs` | sigma=7.0 고정 | ✅ 이식 |
| Morlet norm | `π^(-0.25)·√(1/σt)/√(fs)`, σt=cycles/(2πf) | `π^(-0.25)·√(2/sigma)` | ✅ 이식 |
| PSD 산출 | `PSD_CALIB × corr(f) × rawPower` | rawPower (linear만) | ✅ 이식 |
| 밴드파워 | `computeBandPowersLinear` + `linearBandPowersToBandPowers` ({linear,dB}) | `computeBandPowers`(linear만) | ✅ 이식 |

## 3. 구현 계획

### T1. haru 정본 상수·보정 이식
- `N_CYCLES`, `MAX_ANALYSIS_SAMPLES`, `PSD_CALIB`, `PSD_CORRECTION_VECTOR`, `psdCorrectionFactor` 추가

### T2. 밴드 정의·transient 수정
- bands → delta [1,4) / gamma [30,45)
- transientSamples → `Math.floor(data.length × 0.15)`

### T3. Morlet wavelet 정본 이식
- `morletWaveletTransform`: N_CYCLES + effectiveCycles + `PSD_CALIB × corr(f) × rawPower`
- `createMorletWavelet`: σt = cycles/(2πf), norm = `π^(-0.25)·√(1/σt)/√(fs)`

### T4. 밴드파워 정본 이식
- `computeBandPowersLinear` + `linearBandPowersToBandPowers` ({linear,dB} 병기)
- 소비처(StreamProcessor/useBand)가 `.linear`를 추출하도록 맞춤

## 4. 검증 기준
- mindbreeze 밴드파워·지표가 haru_band_app과 수치적으로 동일
- 기존 마음 지표(집중/이완/스트레스) 0~100 정상
- `npm run build` 0 error, 회귀 없음
