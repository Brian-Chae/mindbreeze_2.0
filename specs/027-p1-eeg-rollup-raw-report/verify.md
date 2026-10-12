# SDD-027 — Verify (구현 전 QA 게이트)

## 1. 60초 롤업
- [ ] 1초 원천 → 60초 버킷 파생(valid_count/coverage/시간 범위)
- [ ] null/불량 0 치환 없음
- [ ] 전체 평균 = 유효 샘플 가중(버킷 단순 평균 아님)

## 2. raw chunk manifest
- [ ] EEGRawChunk 저장 + presigned PUT/ack API
- [ ] 게스트 raw 저장(participant_id, nullable user_id)
- [ ] participant 소유 검증(SDD-026 재사용)

## 3. 리포트 상태머신
- [ ] Report status 4단계(pending_analysis→pending_review→completed/error)
- [ ] pending_review = 승인 게이트 동작
- [ ] data_credibility = quality 게이트 파생

## 4. 회귀
- [ ] 백엔드 pytest 전체 통과
- [ ] 프론트 tsc 0 error + build 통과
