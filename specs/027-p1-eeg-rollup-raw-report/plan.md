# SDD-027 — Plan

## 태스크 분해

### BE (Claude)
- T1. 60초 롤업 집계 — EEGFeatureWindow 1초 원천 → 60초 버킷 파생(valid_count/coverage/가중평균), 조회 API
- T2. EEGRawChunk 모델 + EEGRecord 확장(participant_id/play_group_id/file_count, user_id nullable) + 마이그레이션
- T3. presigned PUT API + 확인(ack) API
- T4. Report 상태머신 — status 필드(pending_analysis/pending_review/completed/error) + data_credibility 파생
- T5. pytest

### FE (Cursor)
- T6. 리포트 상태 표시 (pending_analysis/pending_review/completed/error 배지)
- T7. raw 업로드 훅(로컬 큐→presigned PUT→ack, 재시도) — SDD-026 영속 큐 재사용

### 통합 (Codex)
- T8. 롤업·raw·리포트 상태머신 정합 검증

## 검증
- BE: `./venv/bin/python -m pytest -q`
- FE: `npm run build`
- null 보존·가중평균·게스트 raw·상태 전이 시나리오

## 리스크
- 60초 롤업 부하 — 인덱스 활용, 물화는 P2
- raw presigned 보안 — participant 소유 검증 재사용(SDD-026)
