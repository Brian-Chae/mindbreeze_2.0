# SDD-030 Summary — 생체신호 고도화 (클라이언트 처리)

## 구현 결과

### Phase 1 — 호흡수 산출 (PPG RSA)
- `AnalysisMetricsService`: RR interval → 4Hz 재샘플 → 0.15~0.4Hz 지배주파수 × 60 → `respiratoryRate` (breaths/min)
- 생리 범위 6~40 bpm 밖은 null 처리 (0 치환 금지)
- `StreamProcessor`: respiratoryRate 스텁(하드코딩 0) 제거, null 보존 전달

### Phase 2 — 몸 지표 실시간 전달
- `useBand`: 1초 feature에 heart_rate/respiratory_rate/HRV 포함 + state 노출
- 백엔드: `EEGFeatureWindow.respiratory_rate` 컬럼 + 마이그레이션 `8e30b17c920a`
- WS `/session-live` eeg_feature payload에 몸 지표 포함
- 상담사 `SessionMonitorTable`: BPM·호흡수 컬럼
- 사용자 `GuestMeditationPanel`: BPM·호흡수·HRV 몸 지표 패널

### Phase 3 — 리포트 상세화
- `HRVMotionSummary`에 respiratory_rate 추가 + 롤업/리포트 BPM/호흡수/HRV 평균 반영

## 검증
- 프론트 `npm run build` 0 error
- 백엔드 `pytest` 337 passed, 1 skipped (기존 328 + 신규 9)

## 배포
- 커밋 `c35466d`, Deploy Dev `34792859677` 성공 (frontend + deploy + 마이그레이션)

## 남은 것 (후순위)
- 실제 LINK BAND 하드웨어로 호흡수 정확도 E2E 검증 (Chrome)
- FeatureWorker(logic 서버) — 제외, 나중에 문제 시 도입
- 네이티브 하이브리드 앱 (SDD-032)
