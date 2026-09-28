# [SDD-094] 발언권 관리 (손들기 → 부여/해제)

## Goal

온라인 1:N(≤20) 양방향 클래스에서 회원이 **기본 뮤트(수신 전용)** 로 참여하고, **손들기 → 상담사가 발언권 부여** 시에만 카메라·마이크를 송출하도록 한다. 온라인 1:1은 현행대로 상시 송출.

## Context

- SDD-093에서 온라인 그룹(≤20) 회원에게 무조건 `can_publish=True`를 부여했으나, 실제 명상·그룹상담은 **발언권 부여** 방식이 맞다(Brian 결정).
- `SessionParticipant` 모델(`backend/app/models/session.py`)에 손들기/발언 상태 컬럼이 없음 → 추가 필요.
- WebSocket `/session-live` 네임스페이스(`backend/app/ws/session_live_namespace.py`)에 `participant_changed`/`device_status_changed` 브로드캐스트 및 `notify_*` sync→async 브리지가 이미 있음.
- 회원 토큰 발급은 `member_livekit_token()`(`session_service.py`)에서 `can_publish` 결정.

## Scope

### ✅ In-scope
- `SessionParticipant`에 `raise_hand`(손들기), `speaking`(발언권) boolean 컬럼 추가 (Alembic 마이그레이션).
- REST: 회원 손들기, 상담사 발언권 부여/해제.
- `member_livekit_token`의 `can_publish`를 **발언권 기반**으로 재계산: 온라인 1:1 → 항상 True, 온라인 그룹 ≤20 → `speaking=True`일 때만 True, 그 외 False.
- WebSocket 이벤트 `speaking_changed`(호스트 + 해당 참가자 본인 룸 브로드캐스트).
- 회원 UI: 손들기 버튼 + 발언권 부여 시 토큰 재발급·카메라/마이크 켜짐.
- 상담사 UI: 참여자 목록에 손들기 표시 + 부여/해제 버튼.

### ❌ Out-of-scope
- 클래스 채팅(P2/SDD-095).
- 다중 동시 발언자 수 제한(한 번에 1명만 등) — 후속 리파인먼트.
- 발언권 자동 타임아웃 — 후속.

## Acceptance Criteria
- [ ] 온라인 1:1 → 회원 토큰 `can_publish=True` (발언권 무관, 상시).
- [ ] 온라인 그룹 ≤20 → 기본 `can_publish=False`, `speaking=True` 부여 후 `can_publish=True`.
- [ ] 온라인 그룹 >20, 오프라인 → `can_publish=False` (발언권 무관).
- [ ] 손들기 → 상담사 화면에 표시 → 부여 시 회원 카메라/마이크 켜짐 → 해제 시 꺼짐.
- [ ] `pytest` + `npm run build` + `npx vitest run` 통과.

## Dependencies
- SDD-093(양방향 규칙) — `can_publish` 계산 로직을 발언권 기반으로 확장.
- Alembic 마이그레이션 파이프라인.

## Risks
- **토큰 재발급 타이밍**: 발언권 부여 후 회원이 재연결(토큰 재발급)하는 사이 지연 — WS `speaking_changed` 수신 → 재연결 흐름으로 처리.
- **상태 정합**: 호스트/회원 UI가 DB `speaking` 상태와 어긋나지 않게 `participant_changed` 계열 이벤트로 동기화.
