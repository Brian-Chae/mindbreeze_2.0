# SDD-026 — Plan

## 태스크 분해

### BE (Claude)
- T1. connect 토큰 검증 강화 — 실패 시 연결 거부 (session_live_namespace.py)
- T2. join 권한 검증 — 호스트(전체 수신)/게스트(본인 EEG만) 구분, room 분리
- T3. feature 업로드 소유 검증 — participant_id ↔ 현재 user 일치, 동의·대기열 검증
- T4. join snapshot + 이벤트 — status/version/참여자 목록/집계, session_state_changed/participant_changed/device_status_changed
- T5. 기기·품질 정합 — LeadOff/SQI 분리, unknown 미승격, 배터리·last_eeg_at 전달
- T6. pause/resume window_index 충돌 해결 (session_service.py:895-911)
- T7. pytest — 권한 거부/게스트 격리/대리 업로드 차단/이벤트/snapshot/품질 정합

### FE (Cursor)
- T8. 영속 미확정 큐(IndexedDB) — 전송 전 큐, 서버 ACK 시 삭제
- T9. 재연결 복구 — 재전송 + offset 복구 (useBand.ts)
- T10. join snapshot 수신 + 폴백 중단 조건(version 확인 후)
- T11. device_status/참여자/상태 이벤트 구독 + UI 반영
- T12. SQI/LeadOff 분리 표시 + 배터리 전달

### 통합 (Codex)
- T13. 권한·복구·정합 전수 검증 (P0 시나리오 대조)

## 검증
- BE: `./venv/bin/python -m pytest -q`
- FE: `npm run build` + tsc 0 error
- 시나리오: 비인가 join/대리 업로드 거부, 게스트 격리, 재연결 데이터 보존, pause/resume 시간축

## 리스크
- 권한 계약 변경 시 기존 호스트/게스트 라이브 플로우 회귀 — 기존 테스트 유지
- 영속 큐 + ACK 도입 시 이중 저장 race — 멱등(window_index)으로 방어
