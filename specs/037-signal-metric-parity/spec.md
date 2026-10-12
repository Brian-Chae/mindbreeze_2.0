# SDD-037 — 생체신호 지표 정합성 (haru 정본 대조, EEG·PPG 전체)

> haru_band_app의 신호처리·지표 계산 방식을 정본으로, mindbreeze에 **정확히 같은 수식·방식**이 적용됐는지
> 5번 루프를 반복하며 정합성을 맞춘다.
> 증상: 집중도·이완도가 100에 가깝게 포화, 스트레스 등 지표 단위 불일치.

## 1. 배경·목표

SDD-035(EEG 스펙트럼 Morlet/PSD 교정)와 SDD-036(표준 모델 정규화)에서 개별 조각은 이식했으나,
**raw 지표 계산식 → 정규화 → 0~100 표시** 전체 파이프라인의 수식·단위가 haru와 일치하는지 검증되지 않았다.
집중도/이완도가 100에 가깝게 나오고 스트레스 단위가 안 맞는 것은 raw 지표의 정의·스케일이 haru와 다르거나
이중 정규화가 일어나고 있음을 시사한다.

## 2. 검증 범위 (haru 정본 → mindbreeze 대조)

### EEG 지표 (7종)
- focusIndex, relaxationIndex, stressIndex, totalNeuralActivity, cognitiveLoad, emotionalStability, hemisphericBalance(faa)
- raw 계산식 (EEGSignalProcessor.calculateRawIndices) + 정규화 (transformRaw → sigmoidScore)

### PPG 지표
- BPM, SDNN, RMSSD, LF/HF, 호흡수(respiratory rate)
- raw 계산식 (PPGSignalProcessor + AnalysisMetricsService) + 단위/스케일

## 3. 정본 참조 (haru_band_app)

| 대상 | 경로 |
|------|------|
| EEG 지표 | `feature-worker/src/processors/EEGSignalProcessor.ts` (calculateRawIndices, ~line 299+) |
| EEG 정규화 | `src/utils/eegSigmoidScore.ts`, `src/utils/eegScoreConstants.ts` |
| PPG 지표 | `feature-worker/src/processors/PPGSignalProcessor.ts`, `src/services/AnalysisMetricsService.ts` |
| 지표 종합 | `feature-worker/src/processors/AnalysisMetricsService.ts` (7지표 종합) |

## 4. 5번 루프 계획

| 루프 | 내용 | 산출물 |
|------|------|--------|
| ① | haru EEG raw 지표 계산식 + 정규화 전체 정밀 분석 | 분석 문서 |
| ② | mindbreeze EEG 지표 대조 → 수식/단위 차이 도출 | 차이표 |
| ③ | haru PPG 지표 계산식 정밀 분석 | 분석 문서 |
| ④ | mindbreeze PPG 대조 → 차이 도출 | 차이표 |
| ⑤ | 수식/방식 수정(Orca) + 수치 검증 + 정합성 확정 | 수정 코드 + 검증 결과 |

## 5. 검증 기준
- mindbreeze 지표가 haru와 동일 입력 대비 동일 수치 산출 (단위·스케일 일치)
- 집중도/이완도가 100 포화 없이 정규 분포 (0~100)
- 스트레스 등 지표 단위가 haru와 동일
- mock 모드 + 실제 LINK BAND 모두 정상
