# SDD-026 — Verify (구현 전 QA 게이트)

## 1. 권한
- [ ] 잘못된 토큰으로 connect → 연결 거부
- [ ] 게스트가 다른 참여자 session_id로 join → 거부/본인만 수신
- [ ] 게스트가 타인 participant_id로 feature 업로드 → 403
- [ ] 게스트 간 EEG 브로드캐스트 없음 (호스트만 전체 수신)
- [ ] 동의 미완료/대기열 참여자 업로드 차단

## 2. 유실 없는 이어하기
- [ ] WS 단절 중 생성 데이터 → 재연결 후 보존·재전송
- [ ] ACK 유실 재전송 → 중복 저장 없음(멱등)
- [ ] 새로고침 후 offset 연속성 유지
- [ ] pause/resume 시 window_index 충돌로 데이터 소실 없음

## 3. 신호·기기 정합
- [ ] SQI 0.5/null의 WS·REST 표시 일치
- [ ] unknown이 valid로 승격되지 않음
- [ ] LeadOff(접촉) vs SQI(품질) 분리 표시
- [ ] 배터리 전달 + last_eeg_at로 BLE 단절 구분

## 4. 상태 계약
- [ ] join snapshot(status/version/참여자/집계) 수신
- [ ] session_state_changed/participant_changed/device_status_changed 이벤트
- [ ] snapshot 적용 전 폴백 중단 없음

## 5. 회귀
- [ ] 백엔드 pytest 전체 통과
- [ ] 프론트 tsc 0 error + build 통과
- [ ] 기존 호스트/게스트 라이브 플로우 동작
