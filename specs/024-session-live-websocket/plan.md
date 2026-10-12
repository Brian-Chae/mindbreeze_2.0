# SDD-024 — Plan

## 아키텍처

```text
[밴드 착용 참가자] useBand → 1초 EEG feature
       │ Socket.IO `/session-live` emit("feature")
       ▼
[FastAPI ws/session_live_namespace]
  ├─ EEGFeatureWindow 저장 (REST ingestion 재사용)
  └─ room(`session:{id}`) broadcast("eeg_feature")
       │
[같은 세션 룸] 호스트(SessionLivePage) · 게스트(GuestMeditationPanel)
       └─ WS subscribe → 실시간 렌더 (폴링 제거)
```

## 태스크 분해

### BE (Claude)
- T1. `ws/session_live_namespace.py` 신규 — connect(token 인증), join/leave, feature(저장+broadcast)
- T2. `ws/__init__.py`에 `register_session_live_namespace(sio)` 등록
- T3. feature 저장 로직 — EEGFeatureWindow bulk insert 재사용 (session_service의 ingestion 함수 분리/호출)
- T4. `broadcast_session_eeg` 서버 내부 헬퍼
- T5. pytest — join/feature broadcast/저장/인증

### FE (Cursor)
- T6. `useBand` 훅 — WS `/session-live` connect + feature emit(1초) + subscribe. REST 5초 배치는 폴백.
- T7. `lib/socket.ts` 확장 — /session-live 네임스페이스 클라이언트
- T8. SessionLivePage + GuestMeditationPanel — WS 수신으로 실시간 렌더(폴링 제거, WS 미연결 시 폴백)

### 통합 (Codex)
- T9. 실시간 경로 정합 검증 — WS emit ↔ 저장 ↔ broadcast ↔ UI 수신 일치
- T10. 폴백/에지 케이스 문서화 (WS 끊김, 재연결, 다참가자)

## 검증
- BE: `./venv/bin/python -m pytest -q`
- FE: `npm run build` + tsc 0 error
- WS E2E: socket.io 클라이언트로 join→feature emit→broadcast 수신 확인(가능 시)

## 리스크
- WS와 REST 이중 저장 race — feature 1초 WS + 5초 REST 폴백 시 중복 방지(멱등, window_index 기준)
- broadcast 부하 — 그룹 세션 N명 × 1초. 경량 payload 유지
