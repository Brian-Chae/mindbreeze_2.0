# [SDD-115] — Summary

## 구현 결과

| 항목 | 변경 |
|---|---|
| 피크 검출 | `PPGSignalProcessor`에 `detectPeaksWithRefractory` 신규 — 불응기(기본 250ms, HRV 경로 400ms) + 적응 임계값(최근 피크 진폭 이동평균 + p90 부트스트랩) + 불응기 내 주 피크 교체. 이중 피크(숄더/딕로틱 노치) 제거 |
| 윈도우 | `AnalysisMetricsService.calculateTimeDomainMetrics` — RR 간격 **합 30초 이상**일 때만 SDNN/RMSSD 산출, 미만은 `hasTimeDomainMetrics=false` → getter null 반환(0 치환 금지) |

## 검증

- `npx tsc -b --noEmit`: **0 errors**
- `npm run build`: **성공**
- 런타임 HRV(SDNN/RMSSD) 실측값은 **LINK BAND 실측 필요** — live device 검증 대기 (현재 세션 데이터는 과거 산출값이라 재확인 필요)

## 회귀 가드

- `calculateHeartRate` 경로(`detectPeaksAdaptiveThreshold`, 400ms 불응기)는 유지 — 심박수(54~127 BPM) 정상성 보존.
- RR 200~2000ms 필터 유지.

## 커밋

- `59483eb3` feat(sdd-115): HRV(SDNN/RMSSD) 재계산 — 불응기+적응임계값 피크검출·30초 윈도우
