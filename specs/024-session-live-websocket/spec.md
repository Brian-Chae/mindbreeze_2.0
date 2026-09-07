# SDD-024 — 클래스별 뇌파 실시간 WebSocket 브로드캐스트

> 코드 레벨 SDD. Linear 미편성. 멀티에이전트에 Codex 포함.

## 목표
현재 REST 폴링(setInterval) 기반인 클래스(세션)별 뇌파 모니터링을 WebSocket(Socket.IO) 실시간 push로 전환한다. 밴드 착용 참가자의 1초 EEG feature를 WS로 받아 서버가 저장(EEGFeatureWindow) + 같은 세션 룸의 호스트/게스트에게 실시간 브로드캐스트한다.

## 배경 (확인된 사실)
- Socket.IO 인프라 이미 존재: `app/ws/__init__.py`(AsyncServer), `/record`·`/chat` 네임스페이스
- `record_namespace.py` 패턴: `register_*_namespace(sio)` 등록 + token 인증 + room(`session:{id}`) join + 서버 내부 broadcast 함수
- SDD-023에서 REST ingestion(`POST /sessions/{id}/features`) + `useBand` 훅 + UI 폴링 완료
- 현재 호스트 모니터링은 `SessionLivePage`가 `window.setInterval` 폴링

## 스코프
1. **백엔드 `/session-live` 네임스페이스** (`ws/session_live_namespace.py` 신규, record 패턴 재사용):
   - connect: token 인증
   - `join(session_id)` / `leave(session_id)`: room(`session:{id}`) 진입/퇴장
   - `feature(data)`: 참가자 1초 EEG feature → (a) EEGFeatureWindow 저장 + (b) room broadcast
   - 서버 내부 `broadcast_session_eeg(session_id, feature)` 헬퍼
2. **프론트 useBand 훅 확장** — feature를 WS `feature` 이벤트로 emit(1초 실시간), REST 5초 배치는 폴백 유지
3. **UI 실시간 전환** — SessionLivePage(호스트)·GuestMeditationPanel(게스트)이 WS subscribe → 실시간 수신(폴링 제거)
4. **폴백** — WS 미연결 시 기존 REST 폴링 유지

## 설계 결정 (멀티에이전트 리뷰에서 확정)
- WS가 저장+브로드캐스트 단일 채널 담당, REST ingestion은 폴백/오프라인 큐로 유지
- 1초 feature는 경량(밴드파워 5종 + 지표 8종 + 품질), raw 250Hz는 WS로 보내지 않음
- 인증: JWT (record namespace와 동일)

## 수락 기준
- [ ] 호스트/게스트가 `/session-live` room join → feature 실시간 수신
- [ ] 참가자 feature emit → EEGFeatureWindow 저장 + room broadcast
- [ ] WS 미연결 시 REST 폴링 폴백 동작
- [ ] 백엔드 pytest 통과 + 프론트 tsc/build 통과
