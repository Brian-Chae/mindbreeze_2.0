# SDD-035 FE 구현 보고 — EEG 신호처리 haru 정본 이식

**워커**: cursor (Orca dispatch `ctx_3aab05750a71`)  
**일시**: 2026-09-14  
**대상**: `frontend/src/lib/eeg/EEGSignalProcessor.ts`  
**정본**: `haru_band_app/feature-worker/src/processors/EEGSignalProcessor.ts`

## 수행 내용

### T1. 상수·PSD 보정
- `N_CYCLES = 7.0`, `MAX_ANALYSIS_SAMPLES = 1000` 모듈 상수 추가
- `PSD_CALIB = 0.00739181390669613` 추가
- `PSD_CORRECTION_VECTOR`(1~45Hz 전체) + `psdCorrectionFactor(frequency)` 이식

### T2. 밴드·transient
- bands: delta `[1,4)` / theta `[4,8)` / alpha `[8,13)` / beta `[13,30)` / gamma `[30,45)`
- `transientSamples = Math.floor(data.length * 0.15)` (기존 250 고정 제거)

### T3. Morlet 정본
- `morletWaveletTransform`: `targetLength → actualLength → effectiveCycles → PSD_CALIB × corr(f) × rawPower` (linear, dB 금지)
- `createMorletWavelet`: `σt = cycles/(2πf)`, `norm = π^(-0.25)·√(1/σt)/√(fs)`
- `convolve`도 haru와 동일하게 `Math.max(1, …)` 가드 적용

### T4. 밴드파워
- `computeBandPowers`는 haru `computeBandPowersLinear`와 동일 Σ 적분식
- 반환 구조는 linear `{delta,theta,alpha,beta,gamma}` 유지
- `{linear,dB}` 병기 / 소비처 수정 없음

## 검증

| 항목 | 결과 |
|------|------|
| `npm run build` | ✅ 0 error (`tsc -b && vite build` 성공) |
| 밴드파워 구조 | ✅ linear 유지 (소비처 미수정) |
| Morlet dB 변환 | ✅ 없음 (linear μV²) |

## 남은 작업 (본 워커 범위 외)
- Stage ⑤ 실기기 mock playground 시각 확인
- Stage ⑥ `summary.md` / Stage ⑦ Review
- haru 대비 실데이터 수치 스모크(동일 입력 벡터 대입)는 별도 QA에서 수행 권장
