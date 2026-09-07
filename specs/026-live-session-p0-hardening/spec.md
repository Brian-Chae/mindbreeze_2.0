# SDD-026 — 라이브 세션 P0 안전망 (권한·복구·신호 정합)

> 코드 레벨 SDD. Linear 미편성. 멀티에이전트에 Codex 포함.
> 근거: specs/025-live-session-parity-analysis/ (SDD-024 /session-live 리뷰에서 발견된 P0 결함)

## 목표
SDD-024에서 만든 `/session-live` 실시간 뇌파 채널이 "동작하지만 운영 안전망이 없다"는 리뷰 결론에 따라, 라이브 운영 전 필수인 P0 결함 4가지를 해결한다.

## P0 결함 (Codex 리뷰 근거)

1. **권한 검증 부족** — connect가 잘못된 토큰도 예외 무시하고 허용, join은 session_id만으로 입장, EEG를 같은 room 모든 게스트에게 broadcast, 명시 participant_id가 소유 검증보다 우선해 대리 업로드 가능
2. **재접속 데이터 유실** — WS emit 성공을 저장 성공으로 오인, 단절 중 REST 버퍼가 재연결 시 폐기, offset 0 재시작으로 UNIQUE(session_id, participant_id, window_index) 충돌·중복 skip
3. **WS/REST 신호 불일치** — SQI 0.5(프론트 50→ok) vs 서버(degraded→lead_off), null SQI가 valid로 승격, 배터리/device_status 미전달
4. **제어 이벤트·snapshot 부재** — 시작/종료는 REST·폴링, EEG는 WS로 이원화. 새 참여자 EEG 없으면 WS 행 갱신 없음, 평균 미갱신

## P0 스코프

### 1. 참여 권한 계약
- connect: 토큰 검증 실패 시 연결 거부(현재 예외 무시 제거)
- join: session_id + 참여자 신원 검증(호스트는 허용된 참여자 metrics, 게스트는 본인 EEG만)
- feature 업로드: 참여자 소유 검증(participant_id가 현재 사용자와 일치), 동의·대기열 검증
- broadcast 분리: 게스트 간 EEG 비노출(호스트만 전체 수신)

### 2. 공통 상태 계약 (join snapshot + 이벤트)
- join 시 snapshot: status/version, started_at, 허용된 참여자 목록·상태·집계
- 이벤트: `session_state_changed`, `participant_changed`, `device_status_changed` (commit 후 발행, version으로 중복/역순 처리)
- snapshot 적용 전에는 연결만으로 폴백 중단 금지

### 3. 유실 없는 이어하기
- 프론트: 영속 미확정 큐(IndexedDB) → WS/REST 전송 → 서버 ACK 수신 시 삭제
- ACK는 stream/sequence + payload 일치 식별
- 재연결: 폐기 대신 재전송, offset 복구
- 멱등: window_index 기준, pause/resume 시 window_index 충돌로 데이터 소실되는 결함 해결

### 4. 기기·품질 정합
- LeadOff(접촉) / SQI(신호품질) 분리, unknown을 valid로 승격하지 않음
- 별도 device_status 이벤트 + last_eeg_at staleness로 BLE 단절/전송중단/미사용 구분
- 배터리 전달, null 정책 통일, 현재값·평균 WS/REST 동일 계약

## 수락 기준
- [ ] 비인가 room join/대리 업로드 거부(403/차단)
- [ ] 게스트 간 EEG 비노출, 호스트만 전체 수신
- [ ] WS 단절 중 생성된 데이터가 재연결 후 보존·재전송
- [ ] ACK 유실 재전송 시 중복 저장 없음
- [ ] pause/resume 시간축 보존(데이터 소실 없음)
- [ ] SQI 0.5/null의 WS·REST 표시 일치
- [ ] join snapshot + 상태/참여자/기기 이벤트 동작
- [ ] 백엔드 pytest 통과 + 프론트 tsc/build 통과
