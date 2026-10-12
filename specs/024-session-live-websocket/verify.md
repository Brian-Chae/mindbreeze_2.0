# SDD-024 — Verify (구현 전 QA 게이트)

## 1. WS 네임스페이스
- [ ] `/session-live` connect 시 token 인증(무토큰 거부/허용 정책 일관)
- [ ] join/leave로 room(`session:{id}`) 진입/퇴장
- [ ] feature emit → EEGFeatureWindow 저장 + room broadcast

## 2. 실시간 수신
- [ ] 호스트/게스트가 같은 session room에서 eeg_feature 실시간 수신
- [ ] 다른 세션 room의 feature는 수신 안 됨(룸 격리)

## 3. 폴백
- [ ] WS 미연결 시 REST 폴링 폴백 동작
- [ ] WS 재연결 시 폴링 중단 + 실시간 전환
- [ ] feature 멱등(window_index 기준 중복 skip)

## 4. 회귀
- [ ] 백엔드 pytest 전체 통과
- [ ] 프론트 tsc 0 error + build 통과
- [ ] 기존 REST ingestion·live-metrics 동작 유지
