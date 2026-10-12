# SDD-028 — Plan

## 태스크 분해

### BE (Claude)
- T1. `Session.run_id` 컬럼 추가(기본=session_id) + 마이그레이션 + 발급/유지 로직(새 실행=새 run_id, 이어하기=기존 run_id)
- T2. EEGFeatureWindow/EEGRawChunk 조회 최적화 — batch key(window_index 범위) 조회, 최신값/집계 LIMIT+인덱스
- T3. 복합 인덱스(session_id, participant_id, window_index) 마이그레이션
- T4. live-metrics·eeg-rollup 원천 전체 읽기 → 범위 한정 조회로 개선
- T5. pytest — run_id 발급/유지/재시작 차단/조회 최적화

### FE (Cursor)
- T6. WS 증분 갱신 계약 확인 + 필요한 경우 최신 feature만 반영(전체 재계산 회피)

### 통합 (Codex)
- T7. run_id·조회 최적화·증분 갱신 정합 검증

## 검증
- BE: `./venv/bin/python -m pytest -q`
- FE: `npm run build`
- run_id 발급/유지, completed 재시작 차단, batch key 조회

## 리스크
- run_id를 조회 키로만 쓰는 경량 접근이 도메인 요구를 충분히 만족하는지 — Codex 검증
- 조회 최적화 시 기존 동작 회귀 — pytest 유지
