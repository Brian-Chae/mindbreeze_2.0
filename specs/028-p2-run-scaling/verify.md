# SDD-028 — Verify (구현 전 QA 게이트)

## 1. run_id
- [ ] 기본 run_id = session_id
- [ ] 새 실행(명시적) → 새 run_id, 이어하기/pause/resume → 기존 run_id 유지
- [ ] completed 세션 즉시 재시작 차단

## 2. 조회 최적화
- [ ] EEGFeatureWindow/EEGRawChunk 조회가 batch key 기반(전체 스캔 제거)
- [ ] 복합 인덱스(session_id, participant_id, window_index) 적용
- [ ] live-metrics·eeg-rollup 범위 한정 조회

## 3. 회귀
- [ ] 백엔드 pytest 전체 통과
- [ ] 프론트 tsc 0 error + build 통과
- [ ] 기존 라이브·리포트 동작 유지
