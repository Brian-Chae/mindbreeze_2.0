# SDD-035 Summary — EEG 신호처리 haru 정본 이식

## 구현 결과

haru_band_app `feature-worker/EEGSignalProcessor.ts`(SDD-040 교정본)를 mindbreeze_2.0의
`frontend/src/lib/eeg/EEGSignalProcessor.ts`에 이식했다.

| 항목 | 이식 결과 |
|------|----------|
| 상수 | `N_CYCLES=7.0`, `MAX_ANALYSIS_SAMPLES=1000` |
| PSD 보정 | `PSD_CALIB=0.00739181390669613` + `PSD_CORRECTION_VECTOR`(1~45Hz) + `psdCorrectionFactor(f)` |
| 밴드 정의 | delta [1,4) / gamma [30,45) |
| transient | `Math.floor(data.length × 0.15)` |
| Morlet 길이 | `round(N_CYCLES·fs/f)`, `min(target, len, MAX_ANALYSIS_SAMPLES)` |
| Morlet cycles | `effectiveCycles = actualLength·f/fs` |
| Morlet norm | `π^(-0.25)·√(1/σt)/√(fs)`, `σt=cycles/(2πf)` |
| PSD 산출 | `PSD_CALIB × corr(f) × rawPower` (linear) |

- 밴드파워 반환 구조는 linear `{delta,theta,alpha,beta,gamma}` 유지 → 소비처 수정 없이 haru linear와 동일
- `npm run build` 0 error

## 검증
- bands/morlet norm/PSD 교정/transient 모두 haru 정본과 수치 동일 확인
- 커밋 `7db579d` → Deploy Dev `34804979269` 성공
