# SDD-036 — 표준 데이터베이스 모델(집단 정규화 시스템) 이식

> haru_band_app의 "표준 데이터베이스 모델" = **집단 정규화 시스템**(SDD-041 baseline + SDD-042 표준 모델).
> baseline(눈 감기/뜨기 측정)을 수집 → 표준 모델(median+MAD {m,s,direction}) 계산 → 지표를 sigmoid 정규화(0~100) → 관리자가 모델을 지속 업데이트·활성화.
> mindbreeze에는 없던 기능. **platform_admin(시스템 관리자)만 playground에서 활성화**한다.

## 1. 배경·목표

현재 mindbreeze 지표는 코호트 고정 상수 기반(또는 미정규화)이다. haru는 서버에 baseline 데이터를 쌓아
표준 모델을 계산하고, 지표값을 집단 분포 기준으로 정규화해 해석 가능한 0~100 점수로 만든다.
시스템 관리자가 모델을 지속 업데이트할 수 있도록 이 시스템을 이식한다.

## 2. haru 정본 시스템 (분석 결과)

### 개념 흐름
```
baseline 수집(눈 감기/뜨기 측정값) → median+MAD 집계 → 표준 모델 {m,s,direction} → sigmoid 정규화 → 0~100
```

### 구성 요소 (haru 정본 경로)
| 계층 | 파일 | 역할 |
|------|------|------|
| DB | `normalization_baselines` (alembic 005) | baseline(closed/open JSON, gender/birth_date) |
| DB | `normalization_models` (alembic 007) | 표준 모델(version, n_samples, params JSON) |
| API | `backend/app/routers/normalization.py` | `/api/v1/normalization/*` (관리자 전용) |
| 집계 | `backend/app/services/normalization_distribution.py` | median + 1.4826·MAD |
| 점수 | `src/utils/eegSigmoidScore.ts` | sigmoid 정규화 + transformRaw |
| 상수 | `src/utils/eegScoreConstants.ts` | 코호트 B0 잠정값 (fallback) |

### 핵심 로직
- **transformRaw**: faa→abs, breathingStability→그대로, 나머지→ln(raw+eps), POSITIVE_ONLY(sdnn/avgHeartRate/autonomicStability)는 ≤0 제외
- **집계**: `m = median(z)`, `s = 1.4826 × median(|z−m|)`
- **direction**: DOWN(stressIndex/cognitiveLoad/faa/avgHeartRate)=−1, 나머지=+1
- **sigmoid**: `score = 100·σ(d·c·t)`, `t=(z−m)/s`, `c=ln9/1.28155`
- **faa**: `exp(−ln2·(|faa|/s)²)` (0 기준 편차형)
- **MIN_BASELINES = 5**

### 지표 키 11종
focusIndex, relaxationIndex, stressIndex, totalNeuralActivity, faa, cognitiveLoad,
emotionalStability, autonomicStability, sdnn, avgHeartRate, breathingStability

## 3. 이식 범위

### 백엔드 (mindbreeze_2.0/backend)
- **T-B1**: `NormalizationBaseline` / `NormalizationModel` SQLAlchemy 모델 + Alembic 마이그레이션
- **T-B2**: `normalization_distribution.py` 집계 서비스 (median+MAD, MIN_BASELINES=5)
- **T-B3**: `normalization.py` 라우터 (`/api/v1/normalization/*`, `require_platform_admin`)
- **T-B4**: Pydantic 스키마 (BaselineCreate/Response, ModelResponse, ActiveModel 등)

### 프론트 (mindbreeze_2.0/frontend)
- **T-F1**: `eegSigmoidScore.ts` + `eegScoreConstants.ts` 이식 (sigmoid 정규화 + 코호트 상수)
- **T-F2**: `normalization-api.ts` 클라이언트 이식 (baseline/model CRUD)
- **T-F3**: playground에 **표준 모델 관리 패널** 추가 (platform_admin만 표시)
  - baseline 수집(눈 감기/뜨기 측정 캡처) + 목록/삭제
  - "표준 모델 계산" 버튼 (compute) + 모델 목록/활성화
- **T-F4**: 지표 정규화 연동 — 활성 모델({m,s}) > 코호트 상수(B0) fallback

### 관리자 게이트
- playground에서 `user.role === 'platform_admin'`일 때만 표준 모델 관리 패널 표시
- 백엔드 API는 `require_platform_admin`으로 강제

## 4. 구현 순서 (Phase)
1. **Phase A (백엔드)**: DB 모델 + 마이그레이션 + 집계 서비스 + API
2. **Phase B (프론트 로직)**: sigmoid/정규화 로직 + API 클라이언트
3. **Phase C (관리자 UX)**: playground 표준 모델 관리 패널 + 지표 정규화 연동
