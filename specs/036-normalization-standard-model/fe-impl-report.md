# SDD-036 FE 구현 보고 — 표준 데이터베이스 모델 이식

**워커**: cursor (Orca dispatch `ctx_d7abaf007170`)  
**일시**: 2026-09-14  
**대상**: `frontend/` Phase B + C

## 수행 내용

### T-F1. 정규화 로직
- `lib/eeg/eegSigmoidScore.ts` — CALIBRATION_METRIC_KEYS(11), transformRaw, sigmoidScore, paramsFromSamples, SIGMOID_C, MAD_TO_SIGMA, DIRECTION_UP/DOWN, POSITIVE_ONLY
- `lib/eeg/eegScoreConstants.ts` — 코호트 B0 상수
- `lib/eeg/eegScore.ts` — 코호트 B0 점수 함수 (+ ×100 비율 보정 `toRatioScale`)
- `lib/eeg/eegPersonalScore.ts` — 활성 모델 캐시 + scoreIndices (모델 > B0)

### T-F2. API 클라이언트
- `lib/api/normalization-api.ts` — createBaseline/listBaselines/deleteBaseline/computeModel/listModels/getActiveModel/activateModel
- mindbreeze `apiClient` JWT Bearer 패턴 사용

### T-F3. 관리자 UX
- `components/playground/NormalizationPanel.tsx` — 라이트 토큰(#5F0080, bg-white, #F5EDFC), 인라인 SVG 없음(버튼만)
- `PlaygroundPage.tsx` — `user.role === 'platform_admin'`일 때만 렌더
- 현재 지표 스냅샷으로 closed/open baseline 캡처 → 저장/목록/삭제 → 모델 계산/활성화

### T-F4. 지표 정규화 연동
- `useBand` — `scoredIndices` (scoreIndices) 노출, rawIndices 유지
- MetricsPanel/TrendPanel — scoredIndices 사용
- CalibrationPanel/NormalizationPanel — rawIndices 유지

## 검증

| 항목 | 결과 |
|------|------|
| `npm run build` | ✅ 0 error (`tsc -b && vite build`) |
| platform_admin 게이트 | ✅ PlaygroundPage 조건부 렌더 |

## 남은 작업 (본 워커 범위 외)
- BE Phase A API/DB 준비 후 E2E (baseline 5+ → compute → activate)
- Stage ⑥ summary / Stage ⑦ Review
- FAA 정본(ln α 차) vs hemisphericBalance 대리 사용 — 신호처리 정합 시 개선 권장
