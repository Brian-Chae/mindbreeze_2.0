# SDD-022 — Plan

## 아키텍처 (P0)

```text
[MB 2.0 FastAPI]
  services/eeg_metrics.py        ← metrics.py 순수 Python 포팅 (7지표·정규화·게이트·null 보존)
  services/normalization_constants.json  ← 정규화 상수 (version 추적)
  models/eeg_feature.py          ← EEGFeatureWindow (1초 feature 시계열)
  services/report_service.py     ← content 스키마 단일 계약 + EEG 병합
  tasks/report_task.py           ← null 보존 리팩터 (or 0/or {} 제거)

[MB 2.0 프론트]
  pages/reports/ReportDetailPage.tsx  ← 7지표 카드 + 품질 배너 + 3채널 타임라인
  components/reports/EegMetricsGrid.tsx   ← 신규
  components/reports/EegQualityBanner.tsx ← 신규
  components/reports/EegTimeline.tsx      ← 신규
  lib/api/report.ts                ← content.eeg 계약 반영
```

## 태스크 분해

### BE (Claude)
- T1. `services/eeg_metrics.py` — metrics.py 포팅 (score_trapezoid/linear/inverse/deviation/relaxation/stability + weighted_total + evaluate_session_quality + compute_session_metrics, None 보존)
- T2. `services/normalization_constants.json` — 7지표 정규화 상수
- T3. `models/eeg_feature.py` + Alembic 마이그레이션 — EEGFeatureWindow
- T4. `tasks/report_task.py` null 보존 리팩터 (or 0/or {} 제거)
- T5. `services/report_service.py` content 계약 단일화 + eeg 병합
- T6. pytest — 7지표 단위 테스트 + null/0 구분 + 품질 게이트

### FE (Cursor)
- T7. content 계약 어댑터 (lib/api/report.ts)
- T8. EegMetricsGrid / EegQualityBanner / EegTimeline 컴포넌트
- T9. ReportDetailPage 통합 (7지표 + 배너 + 타임라인 + counselor/client 비대칭 + 미착용 숨김)

### 통합 (Codex)
- T10. content 스키마 계약 정의·검증 (UI 기대 ↔ 생성기 산출 일치)
- T11. 교차 검토 + 정합 리스트

## 검증 계획
- BE: `./venv/bin/python -m pytest -q` 전체 통과 + 신규 7지표 테스트
- FE: `npm run build` + tsc 0 error
- 수락 기준 체크리스트 대조

## 리스크 완화
- 엣지 산출 신뢰성 → P0은 서버 산출(포팅)만, 실수집은 P1
- numpy 부재 → 순수 Python(statistics)으로 구현, 검증 테스트
- TimescaleDB → PostgreSQL 표준 테이블로 시작, 확장은 후속
