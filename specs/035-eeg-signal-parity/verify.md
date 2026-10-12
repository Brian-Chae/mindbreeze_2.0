# SDD-035 Verify — 구현 전 QA 체크리스트

## 1. 상수·보정
- [ ] `N_CYCLES=7.0`, `MAX_ANALYSIS_SAMPLES=1000`, `PSD_CALIB=0.00739181390669613` 존재
- [ ] `PSD_CORRECTION_VECTOR`(1~45Hz) + `psdCorrectionFactor(f)` 동작

## 2. 밴드·transient
- [ ] bands: delta [1,4), gamma [30,45)
- [ ] transientSamples = `data.length × 0.15`

## 3. Morlet 정본
- [ ] wavelet 길이 `round(N_CYCLES·fs/f)` 기반
- [ ] norm = `π^(-0.25)·√(1/σt)/√(fs)`
- [ ] PSD = `PSD_CALIB × corr(f) × rawPower`

## 4. 밴드파워
- [ ] {linear,dB} 병기 구조
- [ ] 소비처가 `.linear` 추출 → 기존 지표(집중/이완/스트레스) 0~100 정상

## 5. 회귀
- [ ] `npm run build` 0 error
- [ ] mock 모드에서 playground 파형/스펙트럼/지표 정상 표시
