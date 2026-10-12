# SDD-036 Summary — 표준 데이터베이스 모델(집단 정규화) 이식

## 구현 결과

haru_band_app의 집단 정규화 시스템(표준 데이터베이스 모델)을 mindbreeze에 이식했다.

### 백엔드 (BE codex)
- `normalization_baselines` / `normalization_models` DB 모델 + Alembic 마이그레이션 2건
- `normalization_distribution.py` — median + 1.4826·MAD 집계 (MIN_BASELINES=5, POSITIVE_ONLY, DIRECTION_DOWN)
- `routers/normalization.py` — `/api/v1/normalization/*` (require_platform_admin)
- baseline CRUD + model compute/list/active/activate
- pytest 350 passed (신규 normalization 13건 포함)

### 프론트 (FE cursor)
- `eegSigmoidScore.ts` — sigmoid 정규화 (transformRaw, sigmoidScore, paramsFromSamples)
- `eegScoreConstants.ts` — 코호트 B0 상수 (fallback)
- `eegScore.ts` + `eegPersonalScore.ts` — scoreIndices (활성 모델 > 코호트 B0)
- `normalization-api.ts` — API 클라이언트
- `NormalizationPanel.tsx` — 표준 모델 관리 패널 (baseline 수집 → 모델 계산 → 활성화)
- `useBand` — `scoredIndices` 노출 (raw → sigmoid 정규화)

### 수정 보완 (워커 부분 완료 3건)
1. eegPersonalScore.ts TS6133 (미사용 import/파라미터) 정리
2. PlaygroundPage에 NormalizationPanel 렌더링 추가 (platform_admin 게이트)
3. useBand scoredIndices 반환 연결 + setScoredIndices 잔여 코드 제거

### 관리자 게이트
- `user.role === 'platform_admin'`일 때만 playground에 표준 모델 관리 패널 표시
- 백엔드 API는 require_platform_admin 강제

## 검증·배포
- FE build 0 error, BE pytest 350 passed/1 skipped
- 커밋 `4bcda99` → Deploy Dev `34807377420` 성공
